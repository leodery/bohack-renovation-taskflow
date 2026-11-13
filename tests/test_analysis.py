import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from analysis_service import analyze


class AnalysisTest(unittest.TestCase):
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
