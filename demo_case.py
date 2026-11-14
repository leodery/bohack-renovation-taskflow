"""Populate an isolated, labelled example with ordinary workflow operations."""
from datetime import datetime, timedelta
import struct
import zlib

import domain as rules
from schedule import seed_demo_schedule


TITLE = '和光里 · 全屋通铺（演示案例）'
PEOPLE = {'owner': '周女士（演示）', 'designer': '王设计（演示）', 'contractor': '赵工长（演示）'}

REFUND_REQUEST = '原来我想把客厅和卧室都改成通铺，现在卧室先不做，只保留客厅。卧室的材料还没发货，之前付的增项款能退多少？交付日会变吗？'


def prepare_refund(project, owner, members, add_file):
    by_role = {role: next((m for m in members if m['role'] == role), None)
               for role in ('designer', 'contractor', 'coordinator')}
    rules.check(all(by_role.values()), '请先创建完整的四方演示案例。', 409)
    designer, contractor, coordinator = by_role.values()
    today = datetime.now(rules.TZ)
    start = today.date() + timedelta(days=2)
    change = rules.new_change(project, owner, REFUND_REQUEST, members, {
        'mode': 'rules', 'label': '合成返费案例', 'facts': [],
        'questions': ['住户核对预计返费 600 元及新的交付日期。']}, 'tiles')
    change['refund'] = {'paid': 1500, 'retained': 900, 'deduction': 0, 'refund': 600,
                        'basis': '合成案例假设：卧室材料未发货、未施工，取消无扣费；客厅材料与人工保留 900 元。'}
    design = {'tile_spec': '800×800', 'layout': '仅客厅通铺，卧室取消本次增项',
              'start_point': '客厅入户门中线起铺', 'edge_detail': '客厅与卧室交界保留过渡收边',
              'drawing_version': 'D03'}
    rules.revise(project, change, designer, {'reason': '按住户新要求缩减为客厅施工', 'fields': design}, members)
    attachments = [add_file(change, designer, 'drawing', 'D03', 'D03_客厅施工范围.txt',
                            '图纸版本：D03\n仅客厅通铺；卧室取消本次增项。')]
    fields = {'method': '保留客厅材料核对与基层复核，卧室未发货、未施工',
              'supplier': '演示供应商', 'quote_reference': 'Q02', 'quote_scope': '客厅部分保留费用；卧室取消，无取消扣费',
              'quote_amount': '900.00', 'quoted_at': (today-timedelta(minutes=1)).isoformat(),
              'valid_until': (today+timedelta(days=7)).isoformat(), 'arrival_date': start.isoformat(),
              'crew_date': start.isoformat(), 'duration_days': 3}
    rules.revise(project, change, contractor, {'reason': '核对取消范围、返费与交付安排', 'fields': fields}, members)
    attachments.append(add_file(change, contractor, 'quote', 'Q02', 'Q02_返费核对.txt',
                                '报价单编号：Q02\n已付 1500 元，保留 900 元，扣费 0 元，预计返费 600 元。'))
    tasks = [dict(t, due=(start+timedelta(days=offset)).isoformat(),
                  title='按确认图纸完成客厅铺贴' if t['id']=='installation' else t['title'])
             for t, offset in zip(rules.current(change)['tasks'], (0, 0, 1, 2))]
    rules.revise(project, change, coordinator, {'reason': '整理返费方案及保留工序', 'tasks': tasks}, members)
    for kind, actor in [('design', designer), ('construction', contractor)]:
        rules.approve(project, change, actor, {'kind': kind, 'decision': 'approve',
                                                'note': '已按合成案例核对本版'}, attachments)
    return change


def make_png(width, height, pixel_fn):
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            raw += bytes(pixel_fn(x, y))

    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xffffffff)

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
            + chunk(b'IEND', b''))


def tile_photo(base, accent):
    """瓷砖铺贴示意：网格 + 砖缝 + 一块标记区域。明确是合成示意图。"""
    def pixel(x, y):
        gx, gy = x // 40, y // 40
        shade = 12 if (gx + gy) % 2 else 0
        r, g, b = (min(255, v + shade) for v in base)
        if x % 40 < 2 or y % 40 < 2:
            return (146, 128, 96)
        if 70 <= x < 170 and 45 <= y < 115:
            return accent
        if 76 <= x < 164 and 51 <= y < 109:
            return tuple(min(255, v + 22) for v in accent)
        return (r, g, b)
    return make_png(240, 160, pixel)


def populate(actor, participants, add_file, kitchen=False):
    today = datetime.now(rules.TZ)
    arrival = today.date() + timedelta(days=2)
    original_finish = arrival + timedelta(days=2)
    baseline = {'version': 1, 'reference': 'D01', 'finish_date': original_finish.isoformat(),
                'text': '和光里旧房翻新。客厅与卧室分区铺砖，使用 600×600 瓷砖，门口以扣条收边。施工队先核对到场材料和基层，再铺贴，完工后自检交付。'}
    project = {'original_plan': baseline.copy(), 'plan': baseline.copy(), 'changes': [],
               'events': [], 'synthetic': True}
    people = {p['role']: p for p in participants}
    owner, designer, contractor = (people[role] for role in ('owner', 'designer', 'contractor'))
    rules.event(project, actor, '创建演示案例', TITLE)
    change = rules.new_change(
        project, owner, '客厅和卧室的砖能不能连着铺？我想改成全屋通铺，换 800×800 的砖，门口别用原来的扣条。会多花多少钱？原来约好的交付日还能赶上吗？',
        [actor, *participants],
        {'mode': 'rules', 'label': '演示用合成需求',
         'facts': [{'field': 'layout', 'value': '全屋通铺', 'evidence': '改成全屋通铺'},
                   {'field': 'tile_spec', 'value': '800×800', 'evidence': '换 800×800 的砖'}],
         'questions': ['设计师确认起铺方向及替代收边。', '施工团队核对到货、增项报价及交付日期。']})
    attachments = []

    def upload(uploader, kind, reference, name, content):
        f = add_file(change['id'], rules.current(change)['number'], uploader,
                     kind, reference, name, content)
        attachments.append(f)
        rules.event(project, uploader, '上传资料', name + ' · ' + reference, change['id'])
        return f['id']

    members = [actor, *participants]
    rules.revise(project, change, designer, {'reason': '补齐全屋通铺图',
                 'fields': {'tile_spec': '800×800', 'layout': '全屋通铺',
                            'start_point': '从客厅入户门中线起铺',
                            'edge_detail': '门口以同色石材过渡', 'drawing_version': 'D02'}}, members)
    upload(designer, 'drawing', 'D02', 'D02_通铺示意.txt',
           '图纸版本：D02\n合成示例：全屋通铺，从客厅入户门中线起铺。'.encode())
    rules.revise(project, change, contractor, {'reason': '确认材料与工期',
                 'fields': {'method': '现场复核和基层找平后施工', 'supplier': '演示供应商',
                            'quote_reference': 'Q01', 'quote_scope': '40 平方米通铺材料、辅材与人工',
                            'quote_amount': '1500.00',
                            'quoted_at': (today - timedelta(minutes=1)).isoformat(),
                            'valid_until': (today + timedelta(days=7)).isoformat(),
                            'arrival_date': arrival.isoformat(), 'crew_date': arrival.isoformat(),
                            'duration_days': 5, 'parallel_days': 1,
                            'parallel_scope': '材料到场前先做基层复核'}}, members)
    upload(contractor, 'quote', 'Q01', 'Q01_合成报价.txt',
           '报价单编号：Q01\n演示增项合计：1500 元。'.encode())
    tasks = [dict(t, due=(arrival + timedelta(days=offset)).isoformat())
             for t, offset in zip(rules.current(change)['tasks'], (0, 0, 3, 4))]
    rules.revise(project, change, actor, {'reason': '分配施工责任及截止日期',
                 'fields': {'scheme': 'sequential'}, 'tasks': tasks}, members)
    for kind, approver in [('design', designer), ('construction', contractor), ('owner', owner)]:
        rules.approve(project, change, approver,
                      {'kind': kind, 'decision': 'approve', 'note': '已核对本版依据（合成演示）'}, attachments)
    rules.publish(project, change, actor, attachments)
    seed_demo_schedule(change)

    images = (
        ('E01', '材料到场', (214, 198, 164), (176, 146, 96)),
        ('E02', '基层复核', (206, 196, 176), (150, 138, 112)),
        ('E03', '铺贴过程及起铺点', (222, 208, 178), (186, 160, 112)),
    )
    photo_ids = []
    for key, description, base, accent in images:
        photo_ids.append(upload(contractor, 'site', f'{key} | {description}（合成示意图）',
                                f'{key}_合成示意.png', tile_photo(base, accent)))
    upload(contractor, 'site', 'E05 | 完工说明待补照片',
           'E05_合成文字记录.txt', '演示：等待补交完工照片。'.encode())
    rules.handle_task(project, change, contractor,
                      {'task_id': 'materials', 'command': 'submit',
                       'note': '已上传合成材料到场示意，等待中介方人工核对。', 'file_ids': photo_ids[:1]},
                      attachments)
    report = rules.evidence_assessment(attachments, change)
    report.update(mode='rules', label='演示用规则核对 · 未调用模型', missing=[], findings=[],
                  model_notes=[], read_files=[], at=rules.now(), version=rules.current(change)['number'],
                  by=actor['name'])
    change['evidence_reports'] = [report]
    rules.event(project, actor, '生成演示初审', '3 项符合、1 项缺失、1 项不符合。', change['id'])
    if kitchen:
        # The base schedule remains in force until the replacement is published.
        change['kitchen_change'] = {
            'request': '厨房换成新版墙砖。砖周五才到，瓦工只约了周四。',
            'new_arrival': (arrival+timedelta(days=2)).isoformat(),
            'drawing': 'D03', 'quote_reference': 'KQ02',
            'old_quote': 3200, 'new_quote': 3680,
            'quote_scope': '同面积厨房墙砖材料报价，不含瓦工待工费',
            'cost_owner': contractor['id'], 'drawing_owner': designer['id'],
            'advice': '建议重约瓦工，向施工方核实是否产生待工费。',
            'evidence': '砖周五才到，瓦工只约了周四',
        }
        titles = {'materials':'新墙砖到货核对','preparation':'新版铺砖图纸核验',
                  'installation':'厨房铺砖','self_check':'厨房施工自检','handoff':'客厅保护膜铺设'}
        for node in change['schedule']['nodes']:
            node['title'] = titles[node['id']]
            if node['id']=='preparation':
                node['owner_id'] = designer['id']
            if node['id']=='handoff':
                node['start'] = (arrival+timedelta(days=3)).isoformat()
                node['owner_id'] = contractor['id']
        for task in change['tasks']:
            task.update(title=titles[task['id']], status='ready', attempt=0, submissions=[], reviews=[])
        project['events'] = [event for event in project['events'] if event['action']!='提交任务']
        upload(designer,'drawing','D03','D03_厨房墙砖图.txt','图纸版本：D03\n厨房新版墙砖铺贴范围与收边示意。'.encode())
        upload(contractor,'quote','KQ02','KQ02_厨房换砖报价.txt',
               '原报价 3200 元，新报价 3680 元，同面积材料差额 480 元，瓦工待工费待核实。'.encode())
    return project
