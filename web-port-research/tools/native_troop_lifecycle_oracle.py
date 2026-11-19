"""Reproduce native allocation selection/closing order using the original x86.

Only slider lookup, animation/UI flag helpers, and generic UI closing are
substituted. Officer selection, index validation, pending-fill checks and the
complete 0x41A6FB transfer function execute from the SHA-pinned original PE.
This is an isolated window-callback test, not a full client input replay.
"""
import json
import random
import struct
from pathlib import Path

from unicorn import UC_HOOK_MEM_WRITE

from native_ai_oracle import HEAP, SHA
from native_policy_search_oracle import PolicyOracle

ROOT = Path(__file__).resolve().parents[2]
SELECT, WINDOW = 0x4169E2, 0x416EAB
OLD, NEW, CITY, PARENT, CHILD, ROWS = [HEAP+i*0x1000 for i in range(1, 7)]


def main():
    rng = random.Random(0x416D19)
    o = PolicyOracle()
    events = []

    def officer(ptr):
        maximum, active, reserve_maximum, reserve = struct.unpack('<4h', o.cpu.mem_read(ptr+66, 8))
        return dict(maxActive=maximum, active=active, maxReserve=reserve_maximum, reserve=reserve)

    def snapshot():
        selected = o.u32(0x4C2E98)
        return dict(old=officer(OLD), new=officer(NEW), pool=o.u32(CITY+134),
                    pending=o.u32(0x4A6424), selected='old' if selected == OLD else 'new', rng=o.rng())

    def selected_write(cpu, access, address, size, value, data):
        if address == 0x4C2E98:
            # The memory hook runs before the write. Record both the original
            # target and completed old-officer slots at that precise boundary.
            events.append(dict(kind='select-write', target='new' if value == NEW else 'old', before=snapshot()))

    o.cpu.hook_add(UC_HOOK_MEM_WRITE, selected_write)

    def ui(kind):
        def callback(sp):
            events.append(dict(kind=kind, before=snapshot(), arguments=[o.u32(sp+4), o.u32(sp+8)]))
            return 0
        return callback

    substitutions = [
        dict(address='0x41CE43', purpose='Find slider child: return null; skip only slider presentation.'),
        dict(address='0x41CFCA', purpose='Generic closing UI: record event and snapshot; skip window-stack mutation.'),
        dict(address='0x41C052', purpose='Window flag helper: record request; skip presentation flags.'),
        dict(address='0x42709C', purpose='Set closing animation: record request; skip animation setup.'),
    ]
    o.callbacks[0x41CE43] = ui('slider-lookup')
    o.callbacks[0x41CFCA] = ui('generic-close')
    o.callbacks[0x41C052] = ui('window-flags')
    o.callbacks[0x42709C] = ui('closing-animation')

    inputs = [
        (5, 1, 3, 0, 20), (5, 1, 3, 0, 0), (5, 1, 3, 0, 1),
        (5, 1, 3, 0, 4), (5, 1, 3, 0, 5), (5, 1, 3, 0, 7),
        (5, 5, 3, 0, 20), (5, 5, 3, 3, 20), (5, 6, 3, 1, 20),
        (5, 2, 3, 4, 20), (0, 0, 0, 0, 20), (0, 0, 3, 0, 20),
        (5, 0, 0, 0, 20), (5, 0, 3, 0, 8), (100, 0, 100, 0, 120),
        (100, 99, 100, 99, 1),
    ]

    def prepare(values, pending):
        o.cpu.mem_write(HEAP, bytes(0x7000))
        for ptr in (OLD, NEW, CITY):
            o.cpu.mem_write(ptr, rng.randbytes(256))
        for ptr in (OLD, NEW):
            for offset, value in zip((66, 68, 70, 72), values[:4]):
                o.put(ptr+offset, value, True)
        o.put(CITY+134, values[4]); o.put(0x4C30D0, CITY)
        o.put(0x4C2E98, OLD); o.put(0x4A6424, pending); o.put(0x4A6428, 0)
        o.put(PARENT+0x30, ROWS); o.put(PARENT+0x34, 2)
        o.put(ROWS, OLD); o.put(ROWS+4, NEW); o.put(CHILD+0x1c, PARENT)
        o.set_rng([rng.randrange(1, 2**32), rng.randrange(1, 2**32)])
        untouched = [bytes(o.cpu.mem_read(ptr, 256)) for ptr in (OLD, NEW, CITY)]
        events.clear()
        return snapshot(), untouched

    def expected(before, flush):
        result = json.loads(json.dumps(before))
        if flush and result['pending'] == 1:
            target = result['old']
            count = min(result['pool'], max(0, target['maxActive']-target['active']))
            target['active'] += count; result['pool'] -= count
            count = min(result['pool'], max(0, target['maxReserve']-target['reserve']))
            target['reserve'] += count; result['pool'] -= count
            result['pending'] = 0
        return result

    def verify_unrelated(untouched):
        for ptr, before, allowed in zip((OLD, NEW, CITY), untouched, ({68, 69, 72, 73}, set(), set(range(134, 138)))):
            after = bytes(o.cpu.mem_read(ptr, 256))
            assert all(left == right or index in allowed for index, (left, right) in enumerate(zip(before, after)))

    output = dict(exeSha256=SHA, selectionHandler=hex(SELECT), windowHandler=hex(WINDOW),
                  nativeFlush='0x41A6FB', substitutions=substitutions, selectionCases=[], closeCases=[])
    for values in inputs:
        for pending in (0, 1, 2):
            for index in (-1, 1, 2):
                before, untouched = prepare(values, pending)
                o.put(PARENT+0x38, index)
                o.call(SELECT, CHILD, 4)
                valid = 0 <= index < 2
                wanted = expected(before, valid)
                if valid:
                    wanted['selected'] = 'new'
                after = snapshot()
                assert after == wanted
                writes = [event for event in events if event['kind'] == 'select-write']
                assert len(writes) == int(valid)
                if valid:
                    at_switch = expected(before, True)
                    assert writes[0]['before'] == at_switch
                verify_unrelated(untouched)
                output['selectionCases'].append(dict(index=index, valid=valid, before=before, after=after, events=list(events)))

            for kind, event, child_open, flags in [
                ('exit-request', 0x80000, 0, 0),
                ('close-request', 0x400, 0, 0),
                ('close-blocked-child', 0x400, 1, 0),
                ('close-blocked-window-flag', 0x400, 0, 8),
            ]:
                before, untouched = prepare(values, pending)
                o.put(0x4A6428, child_open); o.put(PARENT+0x14, flags)
                o.call(WINDOW, PARENT, event)
                accepted = event == 0x80000 or not child_open and not flags & 8
                after = snapshot()
                assert after == expected(before, accepted)
                closing = [entry for entry in events if entry['kind'] == 'generic-close']
                if event == 0x80000:
                    assert len(closing) == 1 and closing[0]['before'] == after
                    assert closing[0]['arguments'] == [PARENT, event]
                else:
                    assert not closing
                    animations = [entry for entry in events if entry['kind'] == 'closing-animation']
                    assert len(animations) == int(accepted)
                    if accepted:
                        # Native animation setup precedes flush, unlike generic
                        # exit dispatch which observes the completed transfer.
                        assert animations[0]['before'] == before
                verify_unrelated(untouched)
                output['closeCases'].append(dict(kind=kind, event=event, childOpen=child_open, windowFlags=flags,
                                                 accepted=accepted, before=before, after=after, events=list(events)))

    destination = ROOT/'sango2-web/docs/evidence/native-troop-lifecycle.json'
    destination.write_text(json.dumps(output, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(f'{len(output["selectionCases"])} selection + {len(output["closeCases"])} close cases; original selection/flush, UI substitutions disclosed; RNG unchanged')


if __name__ == '__main__':
    main()
