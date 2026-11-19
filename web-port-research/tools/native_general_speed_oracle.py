"""Read officer speed after original 0x4088FA equipment application.

Projects only LEVEL/SPEED from the 86-byte item record; other fields are zero.
Other item effects and their notification callbacks are outside this oracle.
"""
import csv
import json
import shutil
import struct
from native_ai_oracle import Oracle, ROOT, SHA, HEAP


def execute(spec):
    vm = Oracle()
    vm.put(HEAP+46, spec['level'], True)
    vm.put(HEAP+64, spec['speed'], True)
    vm.put(HEAP+16, 100, True)
    vm.put(HEAP+18, 100, True)
    vm.put(HEAP+20, 100, True)
    vm.put(HEAP+22, 100, True)
    for index, item in enumerate(spec['items'], 1):
        p = 0x4C3A60 + 86*index
        vm.put(p+54, item['level'], True)
        vm.put(p+70, item['speed'], True)
        vm.call(0x4088FA, HEAP, index)
    return struct.unpack('<h', vm.cpu.mem_read(HEAP+64, 2))[0]


def main():
    rows = list(csv.DictReader((ROOT/'data/items.csv').open(encoding='utf8')))
    cases = []
    for row in rows:
        item = dict(level=int(row['LEVEL'] or 1), speed=int(row['SPEED'] or 0))
        for level in [item['level']-1, item['level'], 99]:
            for speed in [0, 32767, -32768]:
                spec = dict(level=level, speed=speed, items=[item])
                cases.append(dict(input=spec, native=execute(spec)))
    for level in [1, 10, 20, 40, 99]:
        spec = dict(level=level, speed=0, items=[dict(level=1, speed=1), dict(level=10, speed=2), dict(level=20, speed=3)])
        cases.append(dict(input=spec, native=execute(spec)))
    out = dict(exeSha256=SHA, boundary=__doc__, cases=cases)
    path = ROOT/'evidence/ai/native-general-speed-vectors.json'
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    shutil.copyfile(path, ROOT.parent/'sango2-web/packages/core/fixtures'/path.name)
    print(json.dumps(dict(cases=len(cases))))


if __name__ == '__main__':
    main()
