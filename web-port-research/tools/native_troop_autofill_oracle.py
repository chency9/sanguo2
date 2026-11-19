"""Execute original gradual troop autofill callbacks and mouse dispatch.

No native code or callback is replaced. Hash-pinned PE code runs under Unicorn.
These synthetic event traces establish leaf state transitions, not native update
frequency or a full Windows-client replay. Event 2 (drawing) is not exercised.
"""
import json
import random
import struct
from pathlib import Path

from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from unicorn import UC_HOOK_MEM_WRITE
from native_ai_oracle import Oracle, HEAP, STACK, SHA, PE

ROOT = Path(__file__).resolve().parents[2]
HANDLER, FLUSH, PENDING = 0x41A7CE, 0x41A6FB, 0x4A6424


def main():
    o, r = Oracle(), random.Random(HANDLER)
    officer, city, window, parent, pointer = [HEAP+i*0x1000 for i in range(1, 6)]
    writes = []

    def record(cpu, access, address, size, value, data):
        if not STACK <= address < STACK+0x10000:
            writes.append((address, size))

    o.cpu.hook_add(UC_HOOK_MEM_WRITE, record)

    def state():
        return dict(active=struct.unpack('<h', o.cpu.mem_read(officer+68, 2))[0],
                    reserve=struct.unpack('<h', o.cpu.mem_read(officer+72, 2))[0],
                    pool=o.u32(city+134), pending=o.u32(PENDING))

    def setup(initial):
        o.cpu.mem_write(HEAP, r.randbytes(0x6000))
        o.put(0x4C2E98, officer);o.put(0x4C30D0, city);o.put(0x4C2E80, pointer)
        o.put(PENDING, initial['pending'])
        for offset, key in [(66, 'maxActive'), (68, 'active'), (70, 'maxReserve'), (72, 'reserve')]:
            o.put(officer+offset, initial[key], True)
        o.put(city+130, initial['poolCapacity']);o.put(city+134, initial['pool'])
        for ptr in [window, parent, pointer]:o.cpu.mem_write(ptr, bytes(80))
        for offset, value in [(0, 10), (4, 10), (8, 100), (12, 30), (24, HANDLER), (28, parent)]:
            o.put(window+offset, value)
        for offset, value in [(8, 240), (12, 200), (64, 20), (68, 20)]:o.put(parent+offset, value)
        rng = [r.randrange(1, 2**32), r.randrange(1, 2**32)]
        o.set_rng(rng)
        return rng

    def step(event, buttons=0, x=40, y=40):
        o.put(pointer+4, buttons);o.put(pointer+8, x, True);o.put(pointer+10, y, True)
        before, rng = state(), o.rng()
        writes.clear()
        if event == 'flush':o.call(FLUSH)
        else:o.call(HANDLER, window, event)
        after = state()
        assert before['active']+before['reserve']+before['pool'] == after['active']+after['reserve']+after['pool']
        assert o.rng() == rng
        assert set(writes) <= {(officer+68, 2), (officer+72, 2), (city+134, 4), (PENDING, 4)}
        return dict(event=event, before=before, after=after)

    cases = []
    # Explicit boundary traces include last transfer retaining pending=1 until
    # the following update, repeated activation, and non-1 pending sentinels.
    patterns = [
        ('active-last', 4, 0, 5, 0, 20, 0, [4, 16, 512, 8, 16, 8, 8, 'flush']),
        ('reserve-last', 5, 1, 5, 2, 20, 0, [4, 8, 8, 8, 'flush']),
        ('pool-last', 0, 0, 5, 2, 1, 0, [4, 8, 8, 'flush']),
        ('active-then-reserve', 3, 0, 5, 2, 20, 0, [4, 4, 8, 16, 8, 8, 8, 8, 'flush']),
        ('empty-pool', 0, 0, 5, 2, 0, 0, [4, 8, 4, 'flush', 8]),
        ('full-slots', 5, 2, 5, 2, 20, 0, [4, 8, 4, 'flush', 8]),
        ('no-start', 0, 0, 5, 2, 20, 0, [8, 16, 32, 64, 128, 256, 512, 'flush']),
        ('pending-two', 0, 0, 5, 2, 20, 2, [8, 16, 'flush', 4, 8, 'flush']),
        ('pending-u32-max', 0, 0, 5, 2, 20, 0xffffffff, [8, 'flush', 4, 8, 'flush']),
        ('zero-capacity', 0, 0, 0, 0, 20, 1, [8, 4, 'flush']),
        ('existing-over-capacity', 7, 4, 5, 2, 20, 1, [8, 4, 'flush']),
    ]
    for label, active, reserve, max_active, max_reserve, pool, pending, events in patterns:
        initial = dict(active=active, reserve=reserve, maxActive=max_active, maxReserve=max_reserve,
                       pool=pool, poolCapacity=110, pending=pending)
        rng = setup(initial)
        cases.append(dict(name=label, input=initial, rng=rng, steps=[step(event) for event in events], rngAfter=o.rng()))

    for index in range(189):
        level = [1, 19, 20, 21, 39, 40, 60][index % 7]
        max_active, max_reserve = min(100, level*5), min(100, max(0, (level-20)*5))
        initial = dict(active=r.randrange(max_active+1), reserve=r.randrange(max_reserve+1),
                       maxActive=max_active, maxReserve=max_reserve, pool=r.randrange(601),
                       poolCapacity=600, pending=[0, 1, 2][index % 3])
        rng = setup(initial)
        events = [8, 'flush'] if index % 3 == 2 else [4]
        events += [r.choice([8, 8, 8, 4, 16, 32, 64, 128, 256, 512]) for _ in range(12)] + ['flush', 8]
        cases.append(dict(name=f'level-{level}-{index}', input=initial, rng=rng,
                          steps=[step(event) for event in events], rngAfter=o.rng()))

    mouse_cases = []
    for kind, buttons, x, y in [
        ('inside', 0x10000, 40, 40), ('no-press', 0, 40, 40), ('other-button', 0x20000, 40, 40),
        ('left-edge', 0x10000, 30, 40), ('right-edge', 0x10000, 130, 40),
        ('top-edge', 0x10000, 40, 30), ('bottom-edge', 0x10000, 40, 60),
    ]:
        initial = dict(active=1, reserve=0, maxActive=5, maxReserve=2, pool=20, poolCapacity=110, pending=0)
        rng = setup(initial)
        press = step(512, buttons, x, y)
        release = step(512, 0, x, y)
        tick = step(8, 0, 200, 200)
        flush = step('flush')
        accepted = kind == 'inside'
        assert press['after']['pending'] == int(accepted)
        assert release['after'] == press['after']
        assert tick['after']['active'] == (2 if accepted else 1)
        mouse_cases.append(dict(kind=kind, input=initial, pointer=dict(buttons=buttons, x=x, y=y), rng=rng,
                                steps=[press, release, tick, flush], accepted=accepted, rngAfter=o.rng()))

    table = list(struct.unpack('<8I', PE.get_data(0x41A903-0x400000, 32)))
    output = dict(exeSha256=SHA, handler=HANDLER, flush=FLUSH, pendingAddress=PENDING,
                  substitutedCallbacks=[], cases=cases, mouseCases=mouse_cases)
    (ROOT/'sango2-web/packages/core/fixtures/native-troop-autofill.json').write_text(
        json.dumps(output, separators=(',', ':'))+'\n', encoding='utf8')
    evidence = dict(exeSha256=SHA, substitutedCallbacks=[], eventJumpTable=table, ranges=[],
                    findings=[
                        'Event 4 only stores pending=1; repeated activation does not transfer soldiers.',
                        'Event 8 transfers exactly one soldier if pending==1, active before reserve.',
                        'The final transfer keeps pending=1; the next update clears it at the boundary.',
                        'Flush 0x41A6FB loops until city pool zero or both slots full, then clears pending.',
                        'Events other than 4 and 8 do not cancel pending; event 512 may activate through native hit testing.',
                        'A no-press event 512 after activation leaves pending unchanged; event 8 continues with button flags zero and pointer outside.',
                        'Pending values other than 1 are untouched by tick and flush.',
                        'Window update dispatcher 0x41C24E sends event 8 to every active child callback without a pointer/button condition.',
                        'This evidence does not establish original update frequency or the full native window lifecycle.',
                    ])
    for start, end in [(FLUSH, HANDLER), (HANDLER, 0x41A903), (0x41D160, 0x41D1D4), (0x41CF77, 0x41D160), (0x41C24E, 0x41C439)]:
        instructions = [f'{i.address:08x} {i.mnemonic} {i.op_str}' for i in
                        Cs(CS_ARCH_X86, CS_MODE_32).disasm(PE.get_data(start-0x400000, end-start), start)]
        evidence['ranges'].append(dict(start=start, end=end, instructions=instructions))
    (ROOT/'sango2-web/docs/evidence/native-troop-autofill.json').write_text(
        json.dumps(evidence, indent=2)+'\n', encoding='utf8')
    count = sum(len(case['steps']) for case in cases+mouse_cases)
    print(f'{len(cases)} direct + {len(mouse_cases)} mouse sequences / {count} native events; no substituted callbacks, soldiers and RNG conserved')


if __name__ == '__main__':main()
