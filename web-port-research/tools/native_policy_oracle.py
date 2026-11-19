"""Run unmodified native domestic kernels in isolated x86 memory.

This does not execute the Windows game or emulate its whole policy phase.
"""
import json
import random
from pathlib import Path
from native_ai_oracle import Oracle, HEAP, SHA


def main():
    oracle = Oracle()
    city, actor, governor = HEAP, HEAP+0x1000, HEAP+0x2000
    randomizer = random.Random(427947)
    cases = []
    for i in range(240):
        data = dict(population=[0, 30000, 999999, 1000000][i] if i < 4 else randomizer.randrange(0, 1000001),
                    defense=[0, 998, 999, 1000][i] if i < 4 else randomizer.randrange(0, 1000),
                    isPass=i % 4 == 0, strength=randomizer.randrange(0, 121),
                    intelligence=randomizer.randrange(0, 121), governorIntelligence=randomizer.randrange(0, 121))
        rng = [randomizer.randrange(1, 2**32), randomizer.randrange(1, 2**32)]
        oracle.set_rng(rng)
        oracle.put(city+20, governor)
        oracle.put(city+138, data['population'])
        oracle.put(city+142, data['defense'])
        oracle.put(city+158, 2 if data['isPass'] else 0, True)
        oracle.put(actor+52, data['strength'], True)
        oracle.put(actor+54, data['intelligence'], True)
        oracle.put(governor+54, data['governorIntelligence'], True)
        population_gain = oracle.call(0x427A84, city, actor)
        defense_gain = oracle.call(0x427947, city, actor)
        result = dict(population=oracle.u32(city+138),
            defense=oracle.u32(city+142), reportedPopulation=population_gain,
            reportedDefense=defense_gain)
        oracle.put(0x4A6174, city)
        oracle.put(city+166, 0)
        oracle.put(city+138, data['population'])
        oracle.put(city+146, 1234)
        oracle.call(0x423824)
        cases.append(dict(input=data, rng=rng, output=result,
                          annualRevenue=oracle.u32(city+146)-1234, rngAfter=oracle.rng()))
    output = Path(__file__).resolve().parents[2] / 'sango2-web/packages/core/fixtures/native-policy.json'
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(dict(exeSha256=SHA, addresses=['0x427a84','0x427947','0x423824'], cases=cases),
                                 ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(f'{len(cases)} unmodified x86 development cases: {output}')


if __name__ == '__main__':
    main()
