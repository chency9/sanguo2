import json
from pathlib import Path
import unittest
from native_bitmap_font import native_big5_slot,bitmap,outline


class NativeBitmapFontTests(unittest.TestCase):
    def test_original_x86_big5_slot_and_draw_dispatch(self):
        vectors=json.loads((Path(__file__).resolve().parents[1]/'packages/core/fixtures/native-bitmap-font-vectors.json').read_text(encoding='utf8'))
        for case in vectors['chineseCases']:
            with self.subTest(code=case['code']):
                self.assertEqual(native_big5_slot(case['code']&255,case['code']>>8),case['slot'])
                expected=[]
                if case['shadow']:expected.append(dict(x=case['x']+1,y=case['y']+1,descriptor='chinese',flags=case['flags'],glyph=case['glyph'],color=case['shadow']))
                expected.append(dict(x=case['x'],y=case['y'],descriptor='chinese',flags=case['flags'],glyph=case['glyph'],color=case['color']))
                self.assertEqual(case['calls'],expected)
        for case in vectors['asciiCases']:
            with self.subTest(ascii=case['code']):
                expected=[] if case['code']==32 else [dict(x=10,y=20,descriptor='ascii',flags=3,glyph=case['code'],color=65535)]
                self.assertEqual(case['calls'],expected)

    def test_bitmap_is_most_significant_bit_first_and_stride_preserves_padding(self):
        self.assertEqual(bitmap(bytes([0x81,0x80,0,0x42,0,0]),0,10,2,3),[[1,0,0,0,0,0,0,1,1,0],[0,1,0,0,0,0,1,0,0,0]])

    def test_outline_keeps_exact_integer_pixel_grid(self):
        glyph=outline([[0,1,1],[1,0,0]],64)
        self.assertEqual(glyph.numberOfContours,2)
        self.assertEqual(list(glyph.coordinates),[(64,64),(64,128),(192,128),(192,64),(0,0),(0,64),(64,64),(64,0)])


if __name__=='__main__':unittest.main()
