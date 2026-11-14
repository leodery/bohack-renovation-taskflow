"""新增功能的回归测试：5 条留痕标准的三态初审、方案推荐、照片预览权限。"""
import io
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import domain
from server import create_app


def change(number=3, **fields):
    data = {'arrival_date': None, 'crew_date': None, 'duration_days': None,
            'parallel_days': 0, 'parallel_scope': None, 'scheme': 'sequential',
            'valid_until': None}
    data.update(fields)
    return {'id': 'C1', 'versions': [{'number': number, 'data': data}]}


def site(name, reference, version=3):
    return {'id': name, 'change_id': 'C1', 'kind': 'site', 'name': name,
            'reference': reference, 'version': version}


class EvidenceAssessmentTest(unittest.TestCase):
    def test_three_states_are_counted_and_explained(self):
        files = [site('a.png', 'E01 | 材料到场'), site('b.png', 'E02 | 基层复核'),
                 site('c.png', 'E03 | 按图铺贴，起铺点附近'), site('e.txt', 'E05 | 只有文字记录')]
        result = domain.evidence_assessment(files, change(), 3)
        self.assertEqual(result['summary'],
                         {'total': 5, 'compliant': 3, 'missing': 1, 'noncompliant': 1})
        statuses = {i['key']: i['status'] for i in result['standards']}
        self.assertEqual(statuses, {'E01': 'compliant', 'E02': 'compliant', 'E03': 'compliant',
                                    'E04': 'missing', 'E05': 'noncompliant'})
        self.assertIn('3 条已配齐', result['summary_text'])
        self.assertIn('1 条缺失', result['summary_text'])
        self.assertIn('1 条资料有误', result['summary_text'])
        self.assertTrue(all(i['basis'] and i['reason'] for i in result['standards']))
        self.assertIn('必须由人完成', result['disclaimer'])

    def test_everything_missing_when_no_site_evidence(self):
        result = domain.evidence_assessment([], change(), 3)
        self.assertEqual(result['summary']['missing'], 5)
        self.assertEqual(result['summary']['compliant'], 0)

    def test_older_version_photo_is_not_counted_as_compliant(self):
        result = domain.evidence_assessment([site('old.png', 'E01 | 旧版照片', 1)], change(), 3)
        item = result['standards'][0]
        self.assertEqual(item['status'], 'noncompliant')
        self.assertIn('旧版留痕', item['reason'])

    def test_noncompliant_reason_is_a_photo_not_a_document(self):
        result = domain.evidence_assessment([site('x.pdf', 'E05 | 自检报告')], change(), 3)
        self.assertIn('不是照片', result['standards'][4]['reason'])

    def test_new_document_cannot_make_an_old_photo_current(self):
        result = domain.evidence_assessment(
            [site('old.png', 'E01 | 旧版照片', 1), site('current.txt', 'E01 | 当前文字记录')],
            change(), 3)
        self.assertEqual(result['standards'][0]['status'], 'noncompliant')


class PlanRecommendationTest(unittest.TestCase):
    def test_recommend_parallel_when_it_finishes_earlier(self):
        start = (datetime.now(domain.TZ).date() + timedelta(days=3)).isoformat()
        result = domain.recommend_plan(change(arrival_date=start, crew_date=start,
                                              duration_days=5, parallel_days=1,
                                              parallel_scope='材料到场前先做基层'))
        self.assertEqual(result['recommended'], 'parallel')
        self.assertTrue(any('早 1 天' in r for r in result['reasons']))
        self.assertTrue(any('不自动执行' in c for c in result['cautions']))

    def test_no_recommendation_when_dates_are_missing(self):
        result = domain.recommend_plan(change())
        self.assertIsNone(result['recommended'])
        self.assertIn('缺少材料到货日', result['reasons'][0])


class PhotoPreviewTest(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {k: '' for k in ('TASKFLOW_MODEL_URL', 'TASKFLOW_MODEL_KEY', 'TASKFLOW_MODEL_NAME')})
        env.start()
        self.addCleanup(env.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(self.temp.name)
        self.app.config['TESTING'] = True
        self.clients, self.headers = {}, {}
        for role in ('coordinator', 'owner', 'designer', 'contractor'):
            client = self.app.test_client()
            r = client.post('/api/register', json={'username': role, 'name': role,
                                                   'role': role, 'password': 'Test-Safe-1234'}).get_json()
            self.clients[role], self.headers[role] = client, {'X-CSRF-Token': r['csrf']}
        p = self.post('coordinator', '/api/projects',
                      {'title': '预览测试', 'baseline': '原方案', 'reference': 'D01'}, 201)
        self.pid = p['id']
        for role in ('owner', 'designer', 'contractor'):
            token = self.post('coordinator', f'/api/projects/{self.pid}/invitations',
                              {'role': role, 'revision': self.revision()})['token']
            self.post(role, '/api/join', {'token': token})
        r = self.post('owner', f'/api/projects/{self.pid}/changes',
                      {'text': '改成全屋通铺', 'revision': self.revision()}, 201)
        self.cid = r['change_id']

    def tearDown(self):
        self.temp.cleanup()

    def post(self, role, path, data, expected=200):
        response = self.clients[role].post(path, json=data, headers=self.headers[role])
        self.assertEqual(response.status_code, expected, response.get_json())
        return response.get_json()

    def revision(self):
        return self.clients['coordinator'].get('/api/projects/' + self.pid).get_json()['revision']

    def upload(self, filename, content):
        response = self.clients['designer'].post(
            f'/api/projects/{self.pid}/changes/{self.cid}/files',
            data={'kind': 'drawing', 'reference': 'D02', 'revision': str(self.revision()),
                  'file': (io.BytesIO(content), filename)}, headers=self.headers['designer'])
        self.assertEqual(response.status_code, 200, response.get_json())
        return next(f['id'] for f in response.get_json()['files'] if f['name'] == filename)

    def test_photo_preview_requires_membership_and_image_type(self):
        png = (b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01'
               b'\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0'
               b'\xf0\x1f\x00\x05\x05\x02\x00\x8a\x8a\x1c\x9a\x00\x00\x00\x00IEND\xaeB`\x82')
        file_id = self.upload('现场留痕.png', png)
        response = self.clients['owner'].get('/api/files/' + file_id + '/preview')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'image/png')
        self.assertEqual(self.app.test_client().get('/api/files/' + file_id + '/preview').status_code, 401)
        text_id = self.upload('说明.txt', b'plain text')
        self.assertEqual(self.clients['owner'].get('/api/files/' + text_id + '/preview').status_code, 400)


if __name__ == '__main__':
    unittest.main()
