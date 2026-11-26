import json,unittest
from pathlib import Path
from native_arrow_animation import arrow_wait_animation

class NativeArrowAnimationTests(unittest.TestCase):
    def test_original_parser_node_vectors(self):
        vectors=json.loads((Path(__file__).resolve().parents[1]/'packages/core/fixtures/native-arrow-object-host-vectors.json').read_text(encoding='utf8'))
        for case in vectors['cases']:
            with self.subTest(object=case['object']):
                actual=arrow_wait_animation(case['text'],case['directory']);native=case['native']
                self.assertEqual(actual['frameTicks'],[f['ticks'] for f in native['frames']])
                self.assertEqual(actual['loop'],native['loop'])
                self.assertEqual(actual['scriptTicks'],[dict(tick=e['t'],script=e['arg']) for e in native['messages'] if e['event']==0x80000000])
                self.assertEqual(actual.get('removeTick'),next((e['t'] for e in native['messages'] if e['event']==3),None))
                self.assertEqual([f['key'] for f in actual['frames']],[f['key'] for f in native['frames']])

if __name__=='__main__':unittest.main()
