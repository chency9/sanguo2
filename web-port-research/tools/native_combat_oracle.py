"""Hit, damage and matchup tables executed in the hash-pinned original x86.
No intercepted helpers or mocked random draws. Synthetic unit snapshots only;
this does not certify Web movement, animation events or whole-battle parity.
"""
import json
import random
import shutil
import struct
from native_ai_oracle import Oracle, ROOT, HEAP, PE, SHA


def combat(o):
    vm = Oracle()
    vm.set_rng(o['rng'])
    for i, unit in enumerate([o['attacker'], o['target']]):
        ptr, team, general, event = [HEAP + i * 0x1000 + n for n in [0, 0x100, 0x300, 0x500]]
        vm.put(ptr + 44, (1 if unit['general'] else 2) | (4 if unit['reserve'] else 0))
        vm.put(ptr + 64, team)
        vm.put(team + 72, general)
        vm.put(general + 52, unit['strength'], True)
        vm.put(team + 112, unit['power'])
        vm.put(team + 132, unit['flags'])
        vm.put(team + 116, unit['hitBonus'])
        vm.put(ptr + 8, 10)
        vm.put(ptr + 12, 5)
        vm.put(ptr + 16, 10 if unit['settled'] else 11)
        vm.put(ptr + 20, 5)
        vm.put(event + 132, ptr)
    hit = bool(vm.call(0x43D4CB if o['attacker']['general'] else 0x43D400, HEAP, HEAP + 0x1000))
    after_hit = vm.rng()
    # 0x43DDBF / 65540 kills a soldier without a damage draw. General hit
    # invokes 0x43EC54 through 0x43EF64 with victim event first.
    damage = vm.call(0x43EC54, HEAP + 0x1500, HEAP + 0x500) if hit and o['target']['general'] else None
    return dict(hit=hit, damage=damage, rngAfterHit=after_hit, rng=vm.rng())


def main():
    rand = random.Random(0x43D400)
    cases = []
    for i in range(512):
        def unit(bits):
            return dict(general=bool(bits & 1), reserve=bool(bits & 2), settled=bool(bits & 4),
                        strength=rand.choice([0, 1, 19, 50, 79, 80, 99, 100, 150, 300]),
                        power=rand.choice([-30, 0, 100, 149, 150, 179, 200, 300, 450]),
                        flags=512 if bits & 8 else 0, hitBonus=rand.choice([0, 10, 15, 20]))
        o = dict(attacker=unit(i % 16), target=unit(i // 16), rng=[rand.getrandbits(32), rand.getrandbits(32)])
        cases.append(dict(input=o, native=combat(o)))
    lookups = []
    vm = Oracle()
    for name, addr, rows, cols in [('units', 0x430766, 13, 13), ('terrain', 0x4307AE, 12, 13), ('formation', 0x4307E5, 11, 11)]:
        for a in range(rows):
            for b in range(cols):
                args = [1 << a, 1 << b] if name == 'units' else [1 << b, a] if name == 'terrain' else [a, b]
                value = vm.call(addr, *args)
                lookups.append(dict(kind=name, args=args, native=value if value < 0x80000000 else value - 0x100000000))
    for name, addr, args in [('units',0x430766,[0,1]),('units',0x430766,[3,6]),('terrain',0x4307AE,[0,0]),('terrain',0x4307AE,[1,12]),('formation',0x4307E5,[11,0])]:
        value=vm.call(addr,*args)
        lookups.append(dict(kind=name,args=args,native=value if value<0x80000000 else value-0x100000000))
    path = ROOT / 'evidence/ai/native-combat-vectors.json'
    path.write_text(json.dumps(dict(exeSha256=SHA, combat=cases, lookups=lookups), separators=(',', ':')), encoding='utf8')
    shutil.copyfile(path, ROOT.parent / 'sango2-web/packages/core/fixtures/native-combat-vectors.json')
    tables = dict(exeSha256=SHA)
    for name, addr, rows, cols in [('units',0x48CD88,13,13),('terrain',0x48D030,12,13),('formation',0x48D2A0,11,11)]:
        tables[name] = [list(struct.unpack('<'+'i'*cols, PE.get_data(addr-0x400000+i*cols*4, cols*4))) for i in range(rows)]
    (ROOT.parent/'sango2-web/packages/core/src/native-combat-tables.json').write_text(json.dumps(tables,indent=2),encoding='utf8')
    print(json.dumps(dict(combat=len(cases), lookups=len(lookups))))


if __name__ == '__main__':
    main()
