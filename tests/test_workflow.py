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

    def upload(self, role, kind, reference, content=b'synthetic test evidence'):
        response = self.clients[role].post(f'/api/projects/{self.pid}/changes/{self.cid}/files',
            data={'kind': kind, 'reference': reference, 'revision': str(self.project()['revision']),
                  'file': (io.BytesIO(content), kind+'.txt')}, headers=self.headers[role])
        self.assertEqual(response.status_code, 200, response.get_json())
        return next(f['id'] for f in response.get_json()['files'] if f['kind'] == kind and f['reference'] == reference)

    def prepare(self):
        self.action('designer', 'revise', {'reason': '补齐铺砖图', 'fields': {
            'tile_spec': '800x800', 'layout': '通铺', 'start_point': '客厅门口', 'edge_detail': '按图纸节点', 'drawing_version': 'D02'}})
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
        tasks = self.project()['data']['changes'][0]['versions'][-1]['tasks']
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
        file_id=self.upload('contractor','site','施工证据')
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
        tasks[0]['reviewer_ids'] = [self.users['coordinator'], self.users['designer']]
        self.action('coordinator', 'revise', {'reason': '材料需设计师共同确认', 'tasks': tasks})
        self.confirm()
        self.action('coordinator', 'publish')
        file_id = self.upload('contractor', 'site', '到货核对')
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


if __name__ == '__main__':
    unittest.main()
