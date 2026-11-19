"""Execute native command routing, movement, slot writes and AI advance orders.

Uses the hash-pinned EXE in Unicorn, never a Windows process. The movement
entry hook only records arguments; all command and movement code still runs.
"""
import json
import random
import shutil
import struct
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP
from native_ai_oracle import Oracle, ROOT, HEAP, SHA, PE

PROFILES = {'generalAdvance': 0x48E5C8, 'generalRetreat': 0x48E658,
            'backward': 0x48E778, 'lateral': 0x48E7C0, 'gather': 0x48E850,
            'centerAdvance': 0x48E898}
ALL_PROFILES = {**PROFILES, 'hold': 0x48E6A0, 'advance': 0x48E6E8,
                'strict': 0x48E730, 'pursue': 0x48E808, 'retreat': 0x48E8E0}


def movement(o):
    vm = Oracle()
    vm.set_rng(o['rng'])
    own, enemy = (0x4A8A60, 0x4B03A0) if o['mirror'] else (0x4B03A0, 0x4A8A60)
    unit, event = (own if o['general'] else own + 180), HEAP
    vm.put(0x4A79C4, 17)
    vm.put(own + 8, o['ownX']); vm.put(own + 12, 6)
    vm.put(own + 100, int(o['strict']))
    vm.put(enemy + 8, o['enemyX']); vm.put(enemy + 12, o['enemyY'])
    vm.put(enemy + 64, enemy); vm.put(enemy + 44, 1)
    for i, item in enumerate(o['enemies']):
        ptr = enemy + 180 + i * 72
        for offset, value in [(8, item['x']), (12, item['y']), (24, i),
                              (44, 0x2000 if item['dead'] else 2), (64, enemy)]:
            vm.put(ptr + offset, value)
    vm.put(enemy + 88, len(o['enemies']))
    vm.put(own + 14580, 0 if o['target'] is None else enemy + 180 + o['target'] * 72)
    for offset, value in [(8, o['x']), (12, o['y']), (16, o['x']), (20, o['y']),
                          (28, 1), (32, 0 if o['general'] else o['division']),
                          (36, o['previous']), (44, (1 if o['general'] else 2) | (0x4000 if o['retreat'] else 0)),
                          (64, own), (68, event)]:
        vm.put(unit + offset, value)
    for offset, value in [(8, o['px']), (12, o['py']), (44, o['facing']), (76, 0x422847), (132, unit)]:
        vm.put(event + offset, value)
    vm.put(0x4B3CA0 + 4 * (71 * o['y'] + o['x']), unit)
    for i, item in enumerate(o['occupied']):
        ptr = HEAP + 0x3000 + i * 128
        for offset, value in [(8, item['x']), (12, item['y']), (44, 1), (64, own if item['ally'] else enemy)]:
            vm.put(ptr + offset, value)
        vm.put(0x4B3CA0 + 4 * (71 * item['y'] + item['x']), ptr)
    route = {}

    def capture(cpu, address, size, data):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        route.update(dx=vm.i32(sp + 8), dy=vm.i32(sp + 12),
                     profile=next(k for k, v in ALL_PROFILES.items() if v == vm.u32(sp + 16)))

    vm.cpu.hook_add(UC_HOOK_CODE, capture, begin=0x43C4C0, end=0x43C4C0)
    vm.call(0x43CF07 if o['general'] else 0x43CFB1, unit, o['command'])
    target = vm.u32(own + 14580)
    return dict(route=route, x=vm.i32(unit + 8), y=vm.i32(unit + 12),
                vx=vm.i32(event + 20), vy=vm.i32(event + 24), facing=vm.u32(event + 44),
                command=vm.i32(unit + 36), flags=vm.u32(unit + 44),
                target=None if target == 0 else -1 if target == enemy else (target - enemy - 180) // 72,
                rng=vm.rng())


def slots(o):
    vm = Oracle()
    for i, n in enumerate(o['orders']): vm.put(HEAP + 148 + i * 4, n)
    vm.call(0x43ADED, HEAP, o['division'] & 0xffffffff, o['command'])
    return [vm.i32(HEAP + 148 + i * 4) for i in range(8)]


def ai(o):
    vm = Oracle(); vm.set_rng(o['rng'])
    vm.put(HEAP + 96, o['formation'])
    for i, n in enumerate(o['orders']): vm.put(HEAP + 148 + i * 4, n)
    can_advance = vm.call(0x402746, HEAP)
    vm.call(0x4027FB, HEAP)
    return dict(canAdvance=bool(can_advance), orders=[vm.i32(HEAP + 148 + i * 4) for i in range(8)], rng=vm.rng())


def main():
    r = random.Random(0x43CFB1); moves = []; writes = []; advances = []
    for general in [False, True]:
        for command in ([0, 1, 2, 8] if general else range(10)):
            for mirror in [False, True]:
                for case in range(24):
                    x, y = r.choice([0, 1, 20, 35, 69, 70]), r.choice([0, 3, 6, 7, 10, 13])
                    occupied = [dict(x=x+dx, y=y+dy, ally=bool(r.randrange(2)))
                                for dx in [-1, 0, 1] for dy in [-1, 0, 1]
                                if (dx or dy) and 0 <= x+dx < 71 and 0 <= y+dy < 14 and r.randrange(3) == 0]
                    enemies = [dict(x=15+i*4, y=3+i, dead=bool((case >> i) & 1)) for i in range(3)]
                    o = dict(general=general, command=command, mirror=mirror, division=1+case%5,
                             previous=case%10, strict=bool(case%2), x=x, y=y, ownX=60 if mirror else 10,
                             enemyX=r.choice([2, 34, 68]), enemyY=r.randrange(14),
                             enemies=enemies, target=None if case%4 == 3 else case%3,
                             px=(96*x+48)*65536, py=(72*y+36)*65536, facing=0x800000 if mirror else 0,
                             retreat=case%6 == 0, occupied=occupied, rng=[r.getrandbits(32), r.getrandbits(32)])
                    moves.append(dict(input=o, native=movement(o)))
    for division in [0, 1, 2, 3, 4, 5, 7, 8, 256, 257, 258, -1]:
        for command in range(10):
            o = dict(orders=list(range(8)), division=division, command=command)
            writes.append(dict(input=o, native=slots(o)))
    for formation in range(9):
        for mask in range(32):
            o = dict(formation=formation, orders=[0]+[int(bool(mask & (1 << i))) for i in range(5)]+[0, 0],
                     rng=[r.getrandbits(32), r.getrandbits(32)])
            advances.append(dict(input=o, native=ai(o)))
    destination = ROOT.parent / 'sango2-web/packages/core'
    path = ROOT / 'evidence/ai/native-command-vectors.json'
    path.write_text(json.dumps(dict(exeSha256=SHA, moves=moves, writes=writes, advances=advances), separators=(',', ':')), encoding='utf8')
    shutil.copyfile(path, destination / 'fixtures/native-command-vectors.json')
    profiles = {key: list(struct.unpack('<17i', PE.get_data(address-0x400000, 68))) for key, address in PROFILES.items()}
    (destination / 'src/native-command-profiles.json').write_text(json.dumps(profiles), encoding='utf8')
    print(json.dumps(dict(moves=len(moves), writes=len(writes), advances=len(advances))))


if __name__ == '__main__': main()
