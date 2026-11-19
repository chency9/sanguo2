import unittest
import json
from pathlib import Path
from native_general import experience_threshold, initial_level, initial_vitals, learning_entries, equipment_speed


class NativeGeneralTests(unittest.TestCase):
    def test_equipment_speed_against_original_exe(self):
        path=Path(__file__).resolve().parents[1]/'packages/core/fixtures/native-general-speed-vectors.json'
        for row in json.loads(path.read_text(encoding='utf8'))['cases']:
            spec=row['input']
            with self.subTest(spec=spec):
                self.assertEqual(equipment_speed(spec['level'],spec['items'],spec['speed']),row['native'])

    def test_real_scenario_experience_levels(self):
        self.assertEqual([initial_level(x) for x in [200, 800, 2000, 3800]], [2, 4, 6, 8])
        self.assertEqual(experience_threshold(3), 377)
        self.assertEqual([initial_level(x) for x in [376, 377, 378]], [2, 3, 3])

    def test_literal_exe_edge_cases(self):
        self.assertEqual(initial_level(0), -1)
        self.assertEqual(initial_level(experience_threshold(98)), 99)
        self.assertEqual(initial_vitals(32760, 32760, 100, 100, 99), (32767, 32767))

    def test_vitals_use_integer_truncation_and_mp_stat_branch(self):
        self.assertEqual(initial_vitals(83, 44, 87, 92, 2), (86, 47))
        self.assertEqual(initial_vitals(85, 36, 100, 42, 2), (89, 38))
        self.assertEqual(initial_vitals(83, 44, 87, 92, 8), (96, 58))

    def test_repeated_keys_preserve_pairs_and_source_order(self):
        fields=[('SKILL', '1, 2'), ('NAME', '曹操'), ('SKILL', '5, 1'), ('WISESKILL', '1, 7')]
        self.assertEqual(learning_entries(fields, 'SKILL'), [{'level': 1, 'sequence': 2}, {'level': 5, 'sequence': 1}])
        self.assertEqual(learning_entries(fields, 'WISESKILL'), [{'level': 1, 'sequence': 7}])
        self.assertEqual(len(learning_entries([('SKILL', f'{n}, 2') for n in range(1, 10)], 'SKILL')), 8)
        self.assertEqual(learning_entries([('SKILL', '01,02,03,04')], 'SKILL'), [{'level': 1, 'sequence': 2}])


if __name__ == '__main__':
    unittest.main()
