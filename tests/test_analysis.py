import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from analysis_service import analyze, analyze_site_note, translate_project_text


class AnalysisTest(unittest.TestCase):
    def test_material_explanation_preserves_shortfall_and_pending_checks(self):
        source = ('原选浅色墙砖库存只有 12 箱，仍缺 8 箱。建议厨房统一改用同规格米白墙砖，'
                  '避免两种砖混铺。施工方核对到货日期和差价，设计师核对样品及收边。')
        with patch('analysis_service.urllib.request.urlopen') as model:
            result = translate_project_text(source, False)
        model.assert_not_called()
        self.assertEqual(result['mode'], 'rules')
        self.assertIn('还差 8 箱', result['translation'])
        self.assertIn('建议统一换成米白砖', result['translation'])
        self.assertIn('施工方核对差价和到货日', result['next_step'])

    def test_quote_explains_listed_difference_without_model(self):
        source = ('演示报价｜厨房暖白墙砖 300×600 mm，12 箱×110 元＝1320 元。'
                  '原木色12箱共1200元，换货配送费80元。错发8箱紫砖退回，不计入新报价，待工费未报价。')
        with patch('analysis_service.urllib.request.urlopen') as model:
            result = translate_project_text(source, False, evidence=True)
        model.assert_not_called()
        self.assertEqual(result['status'], 'ok')
        self.assertIn('多付 200 元', result['impact'])
        self.assertIn('没算进去', result['impact'])

    def test_document_translation_still_uses_model_for_material_text(self):
        source = '墙砖库存只有 12 箱，仍缺 8 箱。'
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = json.dumps({'choices': [{'message': {'content': json.dumps({
            'translation': '这份单据显示目前只有12箱，订货数量还差8箱。'
        })}}]}).encode()
        with patch.dict(os.environ, {'TASKFLOW_MODEL_KEY': '', 'TASKFLOW_NOTE_URL': 'https://example.invalid',
                                     'TASKFLOW_NOTE_MODEL': 'test'}), patch(
                'analysis_service.urllib.request.urlopen', return_value=response) as model:
            result = translate_project_text(source, False, evidence=True)
        model.assert_called_once()
        self.assertEqual(result['status'], 'ok')

    def test_site_note_rejects_model_placeholder_and_preserves_action(self):
        text = '砖周五才到，瓦工只约了周四。'
        response = MagicMock()
        response.__enter__.return_value = response
        content = json.dumps({'items': [{'finding': '具体影响与建议',
            'impact': '可能产生待工', 'action': '联系施工方重新安排',
            'evidence': ['砖周五才到']}]})
        response.read.return_value = json.dumps({'choices': [{'message': {'content': content}}]}).encode()
        with patch.dict(os.environ, {'TASKFLOW_NOTE_URL': 'https://example.invalid',
                                    'TASKFLOW_NOTE_MODEL': 'test'}), \
             patch('analysis_service.urllib.request.urlopen', return_value=response):
            result = analyze_site_note(text)
        self.assertEqual(result['mode'], 'fallback')
        self.assertIn('改约瓦工', result['items'][0]['action'])
        self.assertEqual(result['items'][0]['evidence'], ['砖周五才到', '瓦工只约了周四'])

    def test_extracts_requested_layout_instead_of_original(self):
        with patch.dict(os.environ, {'TASKFLOW_MODEL_KEY': ''}):
            result = analyze('客厅与卧室想从分区铺砖改为全屋通铺。')
        self.assertEqual(result['facts'][0]['value'], '全屋通铺')
        self.assertEqual(result['mode'], 'rules')

    def test_unavailable_model_is_explicitly_labelled(self):
        with patch.dict(os.environ, {'TASKFLOW_MODEL_URL': 'https://example.invalid/chat/completions',
                                    'TASKFLOW_MODEL_KEY': 'test-only', 'TASKFLOW_MODEL_NAME': 'test'}), \
             patch('analysis_service.urllib.request.urlopen', side_effect=TimeoutError):
            result = analyze('改成全屋通铺')
        self.assertEqual(result['mode'], 'rules')
        self.assertIn('模型暂不可用', result['label'])

    def test_model_cannot_invent_facts_without_original_excerpt(self):
        response = MagicMock()
        response.read.return_value = json.dumps({'choices': [{'message': {'content': json.dumps({
            'facts': [{'field': 'tile_spec', 'value': '800x800', 'evidence': '800x800'},
                      {'field': 'layout', 'value': '全屋通铺', 'evidence': '改成全屋通铺'}]})}}]}).encode()
        response.__enter__.return_value = response
        with patch.dict(os.environ, {'TASKFLOW_MODEL_URL': 'https://example.invalid/chat/completions',
                                    'TASKFLOW_MODEL_KEY': 'test-only', 'TASKFLOW_MODEL_NAME': 'test'}), \
             patch('analysis_service.urllib.request.urlopen', return_value=response):
            result = analyze('改成全屋通铺')
        self.assertEqual(result['mode'], 'model')
        self.assertEqual([f['field'] for f in result['facts']], ['layout'])


if __name__ == '__main__':
    unittest.main()
