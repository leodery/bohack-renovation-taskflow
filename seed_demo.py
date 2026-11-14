"""Create a synthetic tile-change case in a new database directory."""
import argparse
import io
import os
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent

import domain
from demo_case import tile_photo
from server import create_app  # noqa: E402

PASSWORD = 'bohack2026'
ACCOUNTS = [
    ('coordinator', '中介方·产品总监', 'coordinator'),
    ('owner', '住户·李女士', 'owner'),
    ('designer', '设计师·陈工', 'designer'),
    ('contractor', '施工队·王班组', 'contractor'),
]


# ---------- 生成演示用合成 PNG（纯标准库，不依赖 Pillow，不生成写实照片） ----------
def build(data_dir):
    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    db = data_dir / 'taskflow.sqlite3'
    if any(Path(str(db) + extra).exists() for extra in ('', '-wal', '-shm')):
        raise SystemExit('案例目录已有数据库，请指定新的目录。')

    app = create_app(str(data_dir))
    app.config['TESTING'] = True
    clients, headers = {}, {}
    for username, name, role in ACCOUNTS:
        client = app.test_client()
        result = client.post('/api/register', json={
            'username': username, 'name': name, 'role': role, 'password': PASSWORD}).get_json()
        assert result and 'csrf' in result, (username, result)
        clients[role] = client
        headers[role] = {'X-CSRF-Token': result['csrf']}

    def post(role, path, data, expect=200):
        response = clients[role].post(path, json=data, headers=headers[role])
        assert response.status_code == expect, (path, response.status_code, response.get_json())
        return response.get_json()

    def project(role='coordinator'):
        return clients[role].get('/api/projects/' + pid).get_json()

    def action(role, command, **data):
        return post(role, f'/api/projects/{pid}/changes/{cid}/{command}',
                    {'revision': project()['revision'], **data})

    def upload(role, kind, reference, filename, content):
        response = clients[role].post(
            f'/api/projects/{pid}/changes/{cid}/files',
            data={'kind': kind, 'reference': reference, 'revision': str(project()['revision']),
                  'file': (io.BytesIO(content), filename)},
            headers=headers[role])
        assert response.status_code == 200, (filename, response.get_json())
        return response.get_json()

    created = post('coordinator', '/api/projects', {
        'title': '和光里 3 号楼 · 全屋通铺变更（试用案例）',
        'baseline': '原方案：客厅与卧室分区铺砖，600x600 仿古砖，过门口用扣条收边。',
        'reference': 'D01', 'synthetic': True,
    }, 201)
    pid = created['id']
    for role in ('owner', 'designer', 'contractor'):
        token = post('coordinator', f'/api/projects/{pid}/invitations',
                     {'role': role, 'revision': project()['revision']})['token']
        post(role, '/api/join', {'token': token})

    changed = post('owner', f'/api/projects/{pid}/changes', {
        'text': '客厅和卧室想从分区铺砖改成全屋通铺，用 800x800 的砖，请先确认铺法、材料和交付日期。',
        'revision': project()['revision'],
    }, 201)
    cid = changed['change_id']

    # 设计依据 + 图纸
    action('designer', 'revise', reason='按住户要求出通铺图 D02', fields={
        'tile_spec': '800x800', 'layout': '全屋通铺', 'start_point': '客厅入户门中线起铺',
        'edge_detail': '过门口用同色石材过渡，取消扣条', 'drawing_version': 'D02'})
    upload('designer', 'drawing', 'D02', 'D02_全屋通铺图.txt',
           '图纸版本：D02\n铺法：全屋通铺\n起铺点：客厅入户门中线\n'.encode('utf-8'))

    # 材料 / 报价 / 工期
    start = datetime.now(domain.TZ).date() + timedelta(days=3)
    action('contractor', 'revise', reason='补齐材料、报价与工期条件', fields={
        'method': '基层找平后薄贴法施工', 'supplier': '演示建材供应商',
        'quote_reference': 'Q01', 'quote_scope': '40 平方米通铺增项：瓷砖、辅材、人工与收边',
        'quote_amount': '1500.00',
        'quoted_at': (datetime.now(domain.TZ) - timedelta(minutes=5)).isoformat(),
        'valid_until': (datetime.now(domain.TZ) + timedelta(days=7)).isoformat(),
        'arrival_date': start.isoformat(), 'crew_date': start.isoformat(),
        'duration_days': 5, 'parallel_days': 1,
        'parallel_scope': '材料到场前先完成基层复核与找平'})
    upload('contractor', 'quote', 'Q01', 'Q01_报价依据.txt',
           '报价单编号：Q01\n供应商：演示建材供应商\n'.encode('utf-8'))

    # 责任分派 + 当前方案保持「直接顺延」，让推荐区展示并行方案的优势
    tasks = project()['data']['changes'][0]['versions'][-1]['tasks']
    for i, task in enumerate(tasks):
        task['due'] = (start + timedelta(days=max(0, i - 1))).isoformat()
    action('coordinator', 'revise', reason='确认分工与截止日期', tasks=tasks,
           fields={'scheme': 'sequential'})

    for role, kind in [('designer', 'design'), ('contractor', 'construction'), ('owner', 'owner')]:
        action(role, 'approve', kind=kind, decision='approve', note='已核对本版依据（演示案例）')
    action('coordinator', 'publish')

    # 5 条留痕标准：3 张照片符合、E04 故意缺失、E05 故意用非照片文件（不符合）
    photo_specs = [
        ('E01', '材料到场', (214, 198, 164), (176, 146, 96), '瓷砖到场，包装规格 800x800 可辨识'),
        ('E02', '基层复核', (206, 196, 176), (150, 138, 112), '开工前基层平整度与找平完成'),
        ('E03', '按图铺贴', (222, 208, 178), (186, 160, 112), '按 D02 图纸的铺法与方向施工中'),
    ]
    for key, label, base, accent, caption in photo_specs:
        upload('contractor', 'site', f'{key} | {caption}（演示合成照片）',
               f'{key}_{label}_留痕照片.png', tile_photo(base, accent))
    upload('contractor', 'site', 'E05 | 完工自检说明（演示：故意用文本文件，用于展示「不符合」）',
           'E05_完工自检_文字记录.txt', '自检说明：铺贴完成，等待补拍整体效果照片。\n'.encode('utf-8'))

    # 生成并保存一份 AI 初审报告（规则层，无需模型密钥）
    action('owner', 'evidence-review')
    report = project()['data']['changes'][0]['evidence_reports'][-1]
    summary = report['summary']
    assert (summary['total'], summary['compliant'], summary['missing'], summary['noncompliant']) == (5, 3, 1, 1), summary

    # 把 WAL 合并进主库，再清掉附属文件，保证只交付一个自包含 db
    connection = sqlite3.connect(db)
    connection.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    connection.close()
    print('案例模板已生成:', db)
    print('统计: %d 条标准 → %d 符合 / %d 缺失 / %d 不符合' % (
        summary['total'], summary['compliant'], summary['missing'], summary['noncompliant']))
    print('演示账号:', ', '.join(a[0] for a in ACCOUNTS), '| 统一密码:', PASSWORD)


if __name__ == '__main__':
    for key in ('TASKFLOW_MODEL_URL', 'TASKFLOW_MODEL_KEY', 'TASKFLOW_MODEL_NAME'):
        os.environ.pop(key, None)
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', default=str(HERE / 'instance' / 'demo'))
    args = parser.parse_args()
    build(args.data_dir)
