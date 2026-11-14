import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime, timedelta

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import domain
from server import create_app


class WorkflowTest(unittest.TestCase):
    def setUp(self):
        model_env = patch.dict(os.environ, {key: '' for key in ('TASKFLOW_MODEL_URL', 'TASKFLOW_MODEL_KEY', 'TASKFLOW_MODEL_NAME')})
        model_env.start()
        self.addCleanup(model_env.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(self.temp.name)
        self.app.config['TESTING'] = True
        self.clients, self.headers, self.users = {}, {}, {}
        for role in ('coordinator', 'owner', 'designer', 'contractor'):
            client = self.app.test_client()
            result = client.post('/api/register', json={'username': role, 'name': role, 'role': role, 'password': 'Test-Safe-1234'}).get_json()
            self.clients[role] = client
            self.headers[role] = {'X-CSRF-Token': result['csrf']}
            self.users[role] = result['user']['id']
        p = self.post('coordinator', '/api/projects', {'title': '通铺样例', 'baseline': '原来为分区铺砖', 'reference': 'D01', 'synthetic': True}, 201)
        self.pid = p['id']
        for role in ('owner', 'designer', 'contractor'):
            token = self.post('coordinator', f'/api/projects/{self.pid}/invitations', {'role': role, 'revision': self.project()['revision']})['token']
            self.post(role, '/api/join', {'token': token})
        result = self.post('owner', f'/api/projects/{self.pid}/changes', {'text': '客厅和卧室改成全屋通铺', 'revision': self.project()['revision']}, 201)
        self.cid = result['change_id']

    def tearDown(self):
        self.temp.cleanup()

    def post(self, role, path, data, expected=200):
        response = self.clients[role].post(path, json=data, headers=self.headers[role])
        self.assertEqual(response.status_code, expected, response.get_json())
        return response.get_json()

    def project(self, role='coordinator'):
        response = self.clients[role].get('/api/projects/' + self.pid)
        self.assertEqual(response.status_code, 200)
        return response.get_json()

    def action(self, role, command, data=None, expected=200):
        return self.post(role, f'/api/projects/{self.pid}/changes/{self.cid}/{command}', {'revision': self.project()['revision'], **(data or {})}, expected)

    def test_site_issue_resolution(self):
        self.action('owner', 'site-issue', {'note': 'Unauthorized report'}, 403)
        result = self.action('contractor', 'site-issue', {'note': 'Materials delayed'})
        issue = result['data']['events'][-1]
        payload = {'issue_id': issue['id'], 'note': 'Rebooked crew for Friday'}
        self.action('contractor', 'site-issue', payload, 403)
        self.action('coordinator', 'site-issue', payload)
        self.action('coordinator', 'site-issue', payload, 409)
        events = self.project('contractor')['data']['events']
        report = next(event for event in events if event['id'] == issue['id'])
        self.assertEqual(report['resolution']['note'], payload['note'])
        self.assertEqual(report['resolution']['by'], 'coordinator')

    def upload(self, role, kind, reference, content=b'synthetic test evidence', filename=None, expected=200):
        response = self.clients[role].post(f'/api/projects/{self.pid}/changes/{self.cid}/files',
            data={'kind': kind, 'reference': reference, 'revision': str(self.project()['revision']),
                  'file': (io.BytesIO(content), filename or kind+'.txt')}, headers=self.headers[role])
        self.assertEqual(response.status_code, expected, response.get_json())
        if expected != 200:
            return response.get_json()
        return next(f['id'] for f in response.get_json()['files'] if f['kind'] == kind and f['reference'] == reference)

    def prepare(self, design=None):
        fields = design or {'tile_spec': '800x800', 'layout': '通铺', 'start_point': '客厅门口',
                            'edge_detail': '按图纸节点', 'drawing_version': 'D02'}
        self.action('designer', 'revise', {'reason': '补齐设计图', 'fields': fields})
        self.upload('designer', 'drawing', 'D02')
        start = datetime.now(domain.TZ).date()+timedelta(days=3)
        data = {'method': '基层确认后施工', 'supplier': '模拟供应商', 'quote_reference': 'Q01',
                'quote_scope': '本次 40 平方米材料及人工增项总额', 'quote_amount': '1500.00',
                'quoted_at': (datetime.now(domain.TZ)-timedelta(minutes=1)).isoformat(),
                'valid_until': (datetime.now(domain.TZ)+timedelta(days=1)).isoformat(),
                'arrival_date': start.isoformat(), 'crew_date': start.isoformat(), 'duration_days': 5,
                'parallel_days': 1, 'parallel_scope': '材料到场前完成基层复核'}
        self.action('contractor', 'revise', {'reason': '补齐材料条件', 'fields': data})
        self.upload('contractor', 'quote', 'Q01')
        selected = next(c for c in self.project()['data']['changes'] if c['id'] == self.cid)
        tasks = selected['versions'][-1]['tasks']
        for i, task in enumerate(tasks):
            task['due'] = (start+timedelta(days=max(0,i-1))).isoformat()
        self.action('coordinator', 'revise', {'reason': '确认分工和日期', 'tasks': tasks})

    def confirm(self):
        for role, kind in [('designer','design'),('contractor','construction'),('owner','owner')]:
            self.action(role, 'approve', {'kind': kind, 'decision': 'approve', 'note': '已核对本版依据'})

    def test_missing_information_and_authorization(self):
        c = self.project()['data']['changes'][0]
        self.assertIsNone(c['versions'][-1]['data']['tile_spec'])
        self.assertIsNone(c['plans']['sequential'])
        self.action('coordinator', 'publish', expected=409)
        self.action('owner', 'approve', {'kind': 'design', 'decision': 'approve', 'note': '冒充设计师'}, 403)
        self.action('owner', 'revise', {'reason': '越权', 'fields': {'tile_spec': '600x600'}}, 403)
        response = self.clients['owner'].post(f'/api/projects/{self.pid}/changes/{self.cid}/comment', json={'revision':self.project()['revision'], 'text':'CSRF'})
        self.assertEqual(response.status_code,403)
        outsider=self.app.test_client()
        result=outsider.post('/api/register',json={'username':'outsider','name':'外部人员','role':'owner','password':'Other-Test-123'}).get_json()
        self.assertEqual(outsider.get('/api/projects/'+self.pid).status_code,404)
        response=self.clients['owner'].get('/api/projects/'+self.pid)
        self.assertNotIn('password_hash',response.get_data(as_text=True))

    def test_return_revision_and_quote_expiry(self):
        self.prepare()
        self.action('designer','approve',{'kind':'design','decision':'return','note':'门口对齐说明不足'})
        self.action('coordinator','publish',expected=409)
        self.action('designer','revise',{'reason':'补齐对齐说明','fields':{'edge_detail':'按新图完整对齐'}})
        self.confirm()
        self.action('contractor','revise',{'reason':'重新核价','fields':{'quoted_at':(datetime.now(domain.TZ)-timedelta(days=2)).isoformat(),
                    'valid_until':(datetime.now(domain.TZ)-timedelta(days=1)).isoformat()}})
        change=self.project()['data']['changes'][0]
        self.assertIn('报价已过期，需要重新询价',change['blockers']['publish'])
        self.assertFalse(domain.approved(change,'design'))
        self.assertTrue(any(a['decision']=='return' for a in change['approvals']))
        self.action('coordinator','publish',expected=409)

    def test_shared_version_conflict_and_file_access(self):
        old=self.project()['revision']
        path=f'/api/projects/{self.pid}/changes/{self.cid}/comment'
        self.post('owner',path,{'revision':old,'text':'第一次'})
        self.post('designer',path,{'revision':old,'text':'过期页面'},409)
        self.assertEqual(self.project('designer')['revision'],self.project('owner')['revision'])
        file_id=self.upload('designer','drawing','D02')
        self.assertEqual(self.clients['owner'].get('/api/files/'+file_id).status_code,200)
        self.assertEqual(self.app.test_client().get('/api/files/'+file_id).status_code,401)

    def test_complete_flow_with_task_return_and_human_acceptance(self):
        self.prepare()
        self.confirm()
        self.action('coordinator','publish')
        project=self.project()
        self.assertEqual(project['data']['plan']['version'],2)
        self.assertEqual(project['data']['original_plan']['reference'],'D01')
        self.action('coordinator','publish',expected=409)
        file_id=self.upload('contractor','site','E05 | 施工证据')
        self.action('contractor','task',{'task_id':'installation','command':'submit','note':'跳过前置','file_ids':[file_id]},409)
        for task_id in ('materials','preparation','installation','self_check'):
            self.action('contractor','task',{'task_id':task_id,'command':'submit','note':'已完成，附件为依据','file_ids':[file_id]})
            if task_id=='materials':
                self.action('coordinator','task',{'task_id':task_id,'command':'return','note':'补充数量核对'})
                self.action('contractor','task',{'task_id':task_id,'command':'submit','note':'补齐数量','file_ids':[file_id]})
            self.action('coordinator','task',{'task_id':task_id,'command':'approve','note':'已人工核对'})
        self.assertEqual(self.project()['data']['changes'][0]['status'],'acceptance')
        self.action('coordinator','accept',{'decision':'approve','note':'越权验收'},403)
        self.action('owner','accept',{'decision':'return','note':'补充交付说明'})
        self.action('contractor','task',{'task_id':'self_check','command':'submit','note':'已补充','file_ids':[file_id]})
        self.action('coordinator','task',{'task_id':'self_check','command':'approve','note':'复核完成'})
        self.action('owner','accept',{'decision':'approve','note':'现场验收完成'})
        self.assertEqual(self.project('contractor')['data']['changes'][0]['status'],'closed')

    def test_every_assigned_reviewer_must_confirm(self):
        self.prepare()
        tasks = self.project()['data']['changes'][0]['versions'][-1]['tasks']
        tasks[0]['reviewer_ids'] = [self.users['contractor']]
        self.action('coordinator', 'revise', {'reason': '尝试自己审核自己的提交', 'tasks': tasks}, 400)
        tasks[0]['reviewer_ids'] = [self.users['coordinator'], self.users['designer']]
        self.action('coordinator', 'revise', {'reason': '材料需设计师共同确认', 'tasks': tasks})
        self.confirm()
        self.action('coordinator', 'publish')
        file_id = self.upload('contractor', 'site', 'E01 | 到货核对')
        self.action('contractor', 'task', {'task_id': 'materials', 'command': 'submit', 'note': '数量与样品已核对', 'file_ids': [file_id]})
        self.action('coordinator', 'task', {'task_id': 'materials', 'command': 'approve', 'note': '数量确认'})
        self.assertEqual(self.project()['data']['changes'][0]['tasks'][0]['status'], 'submitted')
        self.action('designer', 'task', {'task_id': 'materials', 'command': 'approve', 'note': '规格确认'})
        self.assertEqual(self.project()['data']['changes'][0]['tasks'][0]['status'], 'approved')

    def test_evidence_review_preserves_conflict_source_without_accepting(self):
        self.action('designer', 'revise', {'reason': '指定图纸', 'fields': {'drawing_version': 'D02'}})
        self.upload('designer', 'drawing', 'D02', '图纸版本：D01\n请人工复核文件版本。'.encode('utf-8'))
        result = self.action('owner', 'evidence-review')
        change = result['data']['changes'][0]
        report = change['evidence_reports'][-1]
        self.assertEqual(report['mode'], 'rules')
        self.assertEqual(report['missing'], ['报价依据', '施工交付记录'])
        self.assertEqual(report['findings'][0]['evidence'], '图纸版本：D01')
        self.assertEqual(report['findings'][0]['file'], 'drawing.txt')
        self.assertEqual(change['status'], 'clarifying')
        self.assertEqual(change['approvals'], [])
        self.action('designer', 'revise', {'reason': '更新图纸', 'fields': {'drawing_version': 'D03'}})
        latest = self.project()['data']['changes'][0]
        self.assertLess(latest['evidence_reports'][-1]['version'], latest['versions'][-1]['number'])

    def test_evidence_report_does_not_publish_or_accept(self):
        self.prepare()
        before = self.project()['data']
        checked = self.action('owner', 'evidence-review')['data']
        self.assertEqual(checked['plan'], before['plan'])
        self.assertEqual(checked['changes'][0]['approvals'], [])
        self.action('coordinator', 'publish', expected=409)
        self.confirm()
        self.action('coordinator', 'publish')
        for key in domain.EVIDENCE_STANDARDS:
            self.upload('contractor', 'site', key['key'] + ' | 合成留痕', filename=key['key']+'.png')
        before = self.project()['data']
        checked = self.action('owner', 'evidence-review')['data']
        c = checked['changes'][0]
        self.assertEqual(c['evidence_reports'][-1]['summary']['compliant'], 5)
        for key in ('status', 'tasks', 'approvals', 'blockers'):
            self.assertEqual(c[key], before['changes'][0][key])
        self.assertEqual(checked['plan'], before['plan'])
        self.action('owner', 'accept', {'decision': 'approve', 'note': '还有人工任务待确认'}, 409)

    def test_site_upload_requires_a_valid_standard_and_note(self):
        self.prepare()
        self.confirm()
        before = self.action('coordinator', 'publish')
        for reference in ('施工证据', 'E99 | 无效标准', 'E010 | 相似编号', 'E03 | '):
            self.upload('contractor', 'site', reference, expected=400)
        self.assertEqual(self.project()['revision'], before['revision'])
        self.assertEqual(self.project()['files'], before['files'])
        self.upload('contractor', 'site', 'E03 | 起铺点附近的铺贴过程')
        self.upload('contractor', 'site', 'E03 | 整改后重新提交')
        self.assertEqual(len([f for f in self.project()['files'] if f['kind'] == 'site']), 2)

    def test_task_photo_checks_metadata_and_records_visible_model_evidence(self):
        from PIL import Image

        self.prepare()
        self.confirm()
        self.action('coordinator', 'publish')
        path = f'/api/projects/{self.pid}/changes/{self.cid}/tasks/materials/photos'
        exif = Image.Exif()
        time = datetime.now(domain.TZ) - timedelta(hours=30)
        exif[0x9003] = time.strftime('%Y:%m:%d %H:%M:%S')
        exif[0x9011] = '+08:00'
        image = io.BytesIO()
        Image.new('RGB', (80, 80), 'tan').save(image, 'JPEG', exif=exif)

        def upload(role, key, content=None):
            return self.clients[role].post(path, data={
                'revision': str(self.project()['revision']), 'standard': key,
                'note': '客厅材料照片', 'file': (io.BytesIO(image.getvalue() if content is None else content), 'site.jpg'),
            }, headers=self.headers[role])

        self.assertEqual(upload('owner', 'E01').status_code, 403)
        self.assertEqual(upload('contractor', 'E02').status_code, 400)
        self.assertEqual(upload('contractor', 'E01', b'bad image').status_code, 400)
        with patch('photo_review.vision_review', return_value={
                'mode': 'model', 'model': 'test',
                'angle': {'status': 'pass', 'reason': '标签正向', 'evidence': '标签居中'},
                'content': {'status': 'fail', 'reason': '规格与约定不同', 'evidence': '标签写 600x600'},
        }):
            uploaded = upload('contractor', 'E01')
        self.assertEqual(uploaded.status_code, 201)
        data = uploaded.get_json()
        file = next(f for f in data['files'] if f['task_id'] == 'materials')
        report = file['photo_review']
        self.assertEqual(report['time']['status'], 'fail')
        self.assertGreater(report['time']['gap_seconds'], 86400)
        self.assertEqual(report['angle']['status'], 'pass')
        self.assertEqual(report['content']['evidence'], '标签写 600x600')
        self.assertEqual(data['data']['changes'][0]['tasks'][0]['status'], 'ready')
        self.action('coordinator', 'accept', {'decision': 'approve', 'note': '不能直接验收'}, 409)

    def test_coordinator_can_open_a_private_interactive_demo(self):
        path = '/api/projects/demo'
        self.post('owner', path, {}, 403)
        before = self.project()
        demo = self.post('coordinator', path, {}, 201)
        self.assertEqual(self.project(), before)
        self.assertTrue(demo['data']['synthetic'])
        change = demo['data']['changes'][0]
        self.assertEqual(len(demo['members']), 4)
        self.assertEqual(change['evidence_reports'][0]['summary'],
                         {'total': 5, 'compliant': 3, 'missing': 1, 'noncompliant': 1})
        task = change['tasks'][0]
        self.assertEqual(task['status'], 'submitted')
        command = f"/api/projects/{demo['id']}/changes/{change['id']}/task"
        updated = self.post('coordinator', command, {
            'revision': demo['revision'], 'task_id': task['id'], 'command': 'approve',
            'note': '人工核对示意图通过'})
        reopened = self.post('coordinator', path, {})
        self.assertEqual(reopened, updated)
        self.assertEqual(reopened['data']['changes'][0]['tasks'][0]['status'], 'approved')
        self.assertEqual(self.clients['owner'].get('/api/projects/' + demo['id']).status_code, 404)

    def test_demo_role_login_is_local_and_shares_only_its_browser_case(self):
        with tempfile.TemporaryDirectory() as data_dir:
            app = create_app(data_dir, demo_access=True)
            browser = app.test_client()
            outsider = app.test_client()
            path = '/api/demo-login'
            self.assertEqual(self.app.test_client().post(path, json={'role': 'coordinator'}).status_code, 404)
            self.assertEqual(browser.post(path, json={'role': 'owner'}).status_code, 409)
            cross_site = browser.post(path, json={'role': 'coordinator'}, headers={'Origin': 'https://other.example'})
            self.assertEqual(cross_site.status_code, 403)
            login = browser.post(path, json={'role': 'coordinator'}).get_json()
            headers = {'X-CSRF-Token': login['csrf']}
            demo = browser.post('/api/projects/demo', json={}, headers=headers).get_json()
            project_url = '/api/projects/' + demo['id']
            self.assertEqual(browser.get('/api/demo-access').get_json(), {'available': True, 'ready': True})
            for role in ('designer', 'contractor', 'owner', 'coordinator'):
                switched = browser.post(path, json={'role': role}).get_json()
                self.assertEqual(switched['user']['role'], role)
                self.assertEqual(switched['demo_project_id'], demo['id'])
                self.assertEqual(browser.get(project_url).status_code, 200)
                self.assertEqual(browser.post('/api/logout', json={}, headers=headers).status_code, 403)
                headers = {'X-CSRF-Token': switched['csrf']}
            outsider.post(path, json={'role': 'coordinator'})
            self.assertEqual(outsider.get(project_url).status_code, 404)

    def test_schedule_conflicts_and_approval_keep_published_plan_safe(self):
        from copy import deepcopy
        with tempfile.TemporaryDirectory() as folder:
            client = create_app(folder, demo_access=True).test_client()
            headers = {}
            def login(role):
                result = client.post('/api/demo-login', json={'role': role})
                self.assertEqual(result.status_code, 200)
                headers['X-CSRF-Token'] = result.get_json()['csrf']
            login('coordinator')
            demo = client.post('/api/projects/demo', json={}, headers=headers).get_json()
            uid = demo['id']
            change = demo['data']['changes'][0]
            endpoint = f"/api/projects/{uid}/changes/{change['id']}/schedule/"
            def send(action, value, status=200):
                project = client.get('/api/projects/' + uid).get_json()
                response = client.post(endpoint + action, json={**value, 'revision': project['revision']}, headers=headers)
                self.assertEqual(response.status_code, status, response.get_json())
                return response.get_json()
            nodes = deepcopy(change['schedule_view']['base']['nodes'])
            ids = {n['id']:n for n in nodes}
            ids['preparation']['included'] = False
            ids['installation']['start'] = ids['preparation']['start']
            wrong = send('preview', {'nodes':nodes, 'fees':{'delay':300,'idle':450}})
            self.assertTrue(any('不可删减' in x['message'] for x in wrong['issues']))
            send('propose', {'nodes':nodes,'note':'错误草案'}, 409)
            ids['preparation']['included'] = True
            bad = send('preview', {'nodes':nodes,'fees':{'delay':300,'idle':450}})
            self.assertTrue(any('重叠' in i['message'] for i in bad['issues']))
            candidate = bad['alternative']['nodes']
            proposal = send('propose', {'nodes':candidate,'note':'提前铺贴但保留基层复核'})['data']['changes'][0]['schedule_proposals'][-1]['id']
            send('publish', {'proposal_id':proposal}, 409)
            for role in ('designer','contractor','owner'):
                login(role)
                send('decide', {'proposal_id':proposal,'decision':'approve','note':'核对依赖和新交付日期'})
            login('coordinator')
            released = send('publish', {'proposal_id':proposal})
            self.assertLess(released['data']['plan']['finish_date'], demo['data']['plan']['finish_date'])
            self.assertEqual(released['data']['changes'][0]['tasks'][0], change['tasks'][0])
            self.assertEqual(released['data']['changes'][0]['schedule']['number'], 2)

    def invite_mediator(self):
        role = 'mediator'
        client = self.clients[role] = self.app.test_client()
        registered = client.post('/api/register', json={
            'username': role, 'name': '外部复核人', 'role': role,
            'password': 'Test-Safe-1234'}).get_json()
        self.headers[role] = {'X-CSRF-Token': registered['csrf']}
        token = self.post('coordinator', f'/api/projects/{self.pid}/invitations',
                          {'role': role, 'revision': self.project()['revision']})['token']
        self.post(role, '/api/join', {'token': token})

    def test_dispute_review_leaves_decisions_with_original_people(self):
        self.prepare()
        self.invite_mediator()
        for role, kind in [('designer', 'design'), ('contractor', 'construction')]:
            self.action(role, 'approve', {'kind': kind, 'decision': 'approve', 'note': '已核对'})
        self.action('coordinator', 'dispute', {'action': 'open', 'note': '尚未超时'}, 409)
        self.action('owner', 'approve', {'kind': 'owner', 'decision': 'return', 'note': '待解释增项费用'})
        before = self.action('owner', 'dispute', {'action': 'open', 'note': '请复核报价范围'})['data']
        self.action('coordinator', 'dispute', {'action': 'opinion', 'note': '越权复核'}, 403)
        self.action('coordinator', 'revise', {'reason': '试图跳过复核'}, 409)
        checked = self.action('mediator', 'dispute', {'action': 'opinion', 'note': '请按材料与人工分列'})['data']
        self.assertEqual(checked['plan'], before['plan'])
        self.assertEqual(checked['changes'][0]['approvals'], before['changes'][0]['approvals'])
        self.action('mediator', 'publish', expected=403)
        self.action('mediator', 'accept', {'decision': 'approve', 'note': '越权验收'}, 403)
        self.action('coordinator', 'publish', expected=409)
        new = self.action('contractor', 'revise', {
            'reason': '按意见补齐材料与人工分列', 'fields': {'quote_scope': '材料 1000 元、人工 500 元'}})['data']['changes'][0]
        self.assertFalse(domain.approved(new, 'design'))
        self.assertEqual(new['versions'][-1]['approvers'], before['changes'][0]['versions'][-1]['approvers'])
        self.assertEqual(new['disputes'][0]['opinion'], '请按材料与人工分列')
        self.confirm()
        self.action('coordinator', 'publish')

    def test_overdue_confirmation_can_escalate_without_auto_approving(self):
        past = (datetime.now(domain.TZ) - timedelta(hours=25)).isoformat()
        with patch('domain.now', return_value=past):
            self.prepare()
        waiting = self.project()['data']['changes'][0]['pending_confirmation']
        self.assertEqual(waiting['kind'], 'design')
        self.assertTrue(waiting['overdue'])
        self.action('coordinator', 'dispute', {'action': 'open', 'note': '确认已超时'})
        self.action('designer', 'approve', {'kind': 'design', 'decision': 'approve', 'note': '当前已争议'}, 409)
        self.action('owner', 'dispute', {'action': 'withdraw', 'note': '非发起人'}, 403)
        self.action('coordinator', 'dispute', {'action': 'withdraw', 'note': '设计师已恢复联系'})
        self.confirm()
        self.action('coordinator', 'publish')

    def test_utilities_template_reuses_full_workflow_with_its_own_evidence(self):
        result = self.post('owner', f'/api/projects/{self.pid}/changes', {
            'template_id': 'utilities', 'text': '增加厨房插座并调整水槽给排水点位',
            'revision': self.project()['revision']}, 201)
        self.cid = result['change_id']
        draft = result['project']['data']['changes'][-1]
        self.assertIn('待补充变更点位及适用范围', draft['blockers']['design'])
        self.assertNotIn('待补充瓷砖规格', draft['blockers']['design'])
        self.action('designer', 'revise', {'reason': '错误字段', 'fields': {'tile_spec': '800x800'}}, 403)
        self.prepare({'utilities_scope': '厨房插座与水槽', 'utilities_route': '按 D02 点位图',
                      'utilities_inspection': '现场复核检测记录', 'drawing_version': 'D02'})
        self.confirm()
        published = self.action('coordinator', 'publish')['data']['changes'][-1]
        self.assertEqual(published['tasks'][2]['depends_on'], ['materials', 'preparation'])
        self.assertIn('隐蔽', published['tasks'][2]['title'])
        self.upload('contractor', 'site', 'E03 | 误用铺砖标准', expected=400)
        photos = [self.upload('contractor', 'site', f'W0{i} | 合成留痕', filename=f'W0{i}.png')
                  for i in range(1, 6)]
        report = self.action('owner', 'evidence-review')['data']['changes'][-1]['evidence_reports'][-1]
        self.assertEqual([s['key'] for s in report['standards']], ['W01', 'W02', 'W03', 'W04', 'W05'])
        self.assertEqual(report['summary']['compliant'], 5)
        for task, file_id in zip(published['tasks'], photos):
            self.action('contractor', 'task', {'task_id': task['id'], 'command': 'submit',
                                               'note': '已提交合成留痕', 'file_ids': [file_id]})
            self.action('coordinator', 'task', {'task_id': task['id'], 'command': 'approve', 'note': '人工确认'})
        accepted = self.action('owner', 'accept', {'decision': 'approve', 'note': '演示验收'})
        self.assertEqual(accepted['data']['changes'][-1]['status'], 'closed')


if __name__ == '__main__':
    unittest.main()
