"""Run the charge/recovery prefix of original general update 0x43E964.

Stop at the next action dispatch, after the original charge and recovery code.
The original retreat test, action getter, charge modifiers and recovery function
execute unchanged. Movement, animation and the rest of the object update are
outside this oracle's boundary. No RNG or game function is replaced.
"""
import json
import random
import shutil
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EIP
from native_ai_oracle import Oracle, ROOT, HEAP, SHA, STOP


def run(o):
    vm = Oracle()
    event, unit, team, general = [HEAP + n for n in [0, 0x1000, 0x2000, 0x3000]]
    vm.put(event + 132, unit)
    vm.put(event + 52, 32 if o['deadAction'] else 1)
    vm.put(unit + 44, 1 | (0x4000 if o['retreat'] else 0))
    vm.put(unit + 64, team)
    vm.put(team + 72, general)
    for offset, key in [(76, 'charge'), (132, 'flags'), (136, 'parameter'),
                        (140, 'recoveryClock'), (144, 'chargeModifier')]:
        vm.put(team + offset, o[key])
    for offset, key in [(16, 'maxHp'), (18, 'hp'), (20, 'maxMp'), (22, 'mp'),
                        (52, 'strength'), (54, 'intelligence')]:
        vm.put(general + offset, o[key], True)
    calls = 0

    def stop_at_dispatch(cpu, address, size, _):
        nonlocal calls
        calls += 1
        if calls == (1 if o['retreat'] else 2):
            cpu.reg_write(UC_X86_REG_EIP, STOP)

    vm.cpu.hook_add(UC_HOOK_CODE, stop_at_dispatch, begin=0x42233D, end=0x42233D)
    vm.call(0x43E964, event)
    return dict(charge=vm.i32(team + 76), hp=vm.u32(general + 16) >> 16,
                mp=vm.u32(general + 20) >> 16, recoveryClock=vm.i32(team + 140))


def main():
    rng = random.Random(0x43E964)
    cases = []
    for i in range(640):
        o = dict(strength=rng.choice([0, 1, 50, 87, 100, 255]),
                 intelligence=rng.choice([0, 1, 56, 100, 255]),
                 retreat=bool(i & 1), deadAction=bool(i & 2),
                 charge=rng.choice([-100, 0, 49, 50, 119900, 119999, 120000]),
                 flags=rng.choice([0, 1, 2, 3, 32, 33, 34, 35]),
                 chargeModifier=rng.randrange(-3, 4),
                 hp=rng.choice([1, 99, 100]), maxHp=100,
                 mp=rng.choice([0, 59, 60]), maxMp=60,
                 parameter=rng.choice([0, 1, 50, 100]),
                 recoveryClock=rng.choice([0, 5900, 5999, 6000]))
        cases.append(dict(input=o, native=run(o)))
    output = dict(exeSha256=SHA, boundary=__doc__, cases=cases)
    path = ROOT / 'evidence/ai/native-general-tick-vectors.json'
    path.write_text(json.dumps(output, separators=(',', ':')), encoding='utf8')
    shutil.copyfile(path, ROOT.parent / 'sango2-web/packages/core/fixtures' / path.name)
    print(json.dumps(dict(cases=len(cases), example=cases[0])))


if __name__ == '__main__':
    main()
