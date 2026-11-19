"""Execute the original troop-choice window callback and mouse dispatch.

0x41719C is absent from the legacy IDA function export. Read its bytes from the
hash-pinned PE, including its 13 static child windows. Only ACCEPT audio playback
is replaced; eligibility, current-force writes, hit testing and RNG run unchanged.
This proves the leaf event, not the complete client window/campaign lifecycle.
"""
import json
import random
import struct
from pathlib import Path

from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from unicorn import UC_HOOK_MEM_WRITE
from native_ai_oracle import HEAP, STACK, SHA, PE
from native_policy_search_oracle import PolicyOracle

ROOT = Path(__file__).resolve().parents[2]
HANDLER = 0x41719C


def main():
    r = random.Random(HANDLER)
    o = PolicyOracle()
    officer, city, owner, window, parent, input_ptr = [HEAP+i*0x1000 for i in range(1, 7)]
    writes, sounds = [], []

    def record(cpu, access, address, size, value, data):
        if not STACK <= address < STACK+0x10000:
            writes.append(dict(address=address, size=size, value=value))

    o.cpu.hook_add(UC_HOOK_MEM_WRITE, record)

    def sound(sp):
        sounds.append(dict(name=bytes(o.cpu.mem_read(o.u32(sp+4), 7)).split(b'\0')[0].decode('ascii'),
                           volume=o.u32(sp+8)))

    o.callbacks[0x4697B0] = sound
    names, windows = [], []
    for i in range(13):
        ptr = o.call(0x406400, 1 << i)
        names.append(bytes(o.cpu.mem_read(ptr, 32)).split(b'\0')[0].decode('big5'))
        values = struct.unpack('<14I', PE.get_data(0x487AF8+i*56-0x400000, 56))
        assert values[6:9] == (HANDLER, 0x487DD0, i)
        windows.append(dict(index=i, x=values[0], y=values[1], width=values[2], height=values[3],
                            handler=values[6], parent=values[7]))
    parent_values = struct.unpack('<4I', PE.get_data(0x487DD0-0x400000, 16))
    frame = dict(zip(['x', 'y', 'width', 'height'], parent_values))
    output = dict(exeSha256=SHA, handler=HANDLER, names=names, parent=frame, windows=windows, cases=[], mouseCases=[])

    def run(index, learned, current, event=4, pointer=None):
        # Distinct nonzero bytes catch unintended changes to soldiers, flags,
        # HP/MP, inventory and city resources. Check *all* non-stack writes.
        o.cpu.mem_write(HEAP, r.randbytes(0x7000))
        o.put(0x4C2E98, officer);o.put(0x4C30D0, city);o.put(0x4C2E80, input_ptr)
        o.put(officer+135, learned);o.put(officer+139, current)
        o.put(officer+203, owner);o.put(officer+215, city)
        o.put(0x4A64F0, owner)
        o.cpu.mem_write(window, bytes(80));o.cpu.mem_write(parent, bytes(80));o.cpu.mem_write(input_ptr, bytes(16))
        o.put(parent+8, frame['width']);o.put(parent+12, frame['height'])
        o.put(parent+64, frame['x']);o.put(parent+68, frame['y'])
        row = windows[index]
        left, top = frame['x']+row['x'], frame['y']+row['y']
        right = left+min(row['width'], frame['width']-row['x'])
        bottom = top+min(row['height'], frame['height']-row['y'])
        for offset, value in [(0,row['x']),(4,row['y']),(8,row['width']),(12,row['height']),
                              (24,HANDLER),(28,parent),(32,index)]:o.put(window+offset, value)
        if pointer:
            o.put(input_ptr+4, pointer['buttons'])
            o.put(input_ptr+8, pointer['x'], True);o.put(input_ptr+10, pointer['y'], True)
        before = [r.randrange(1, 2**32), r.randrange(1, 2**32)]
        o.set_rng(before);writes.clear();sounds.clear()
        o.call(HANDLER, window, event)
        actual, after = o.u32(officer+139), o.rng()
        triggered = event == 4 or (event == 512 and pointer['buttons'] & 0x10000 and
            left < pointer['x'] < right and top < pointer['y'] < bottom)
        accepted = bool(triggered and learned & (1 << index))
        assert actual == (1 << index if accepted else current)
        assert after == before
        assert writes == ([dict(address=officer+139, size=4, value=1 << index)] if accepted else [])
        assert sounds == ([dict(name='ACCEPT', volume=255)] if accepted else [])
        return dict(index=index, learned=learned, current=current, selected=actual, accepted=accepted,
                    rng=before, rngAfter=after, writes=[dict(offset=w['address']-officer, size=w['size'], value=w['value']) for w in writes],
                    sounds=list(sounds))

    for i in range(13):
        bit = 1 << i
        masks = [0, 8191, bit, 8191 ^ bit, 0x1555, 0xAAA, r.randrange(8192), r.randrange(8192)]
        for j, mask in enumerate(masks):
            current = bit if j % 2 else 1 << ((i+1) % 13)
            output['cases'].append(run(i, mask, current))
        row = windows[i]
        left, top = frame['x']+row['x'], frame['y']+row['y']
        right = left+min(row['width'], frame['width']-row['x'])
        bottom = top+min(row['height'], frame['height']-row['y'])
        x, y = left+2, top+2
        for kind, px, py, buttons, learned in [
            ('inside', x, y, 0x10000, 8191), ('unlearned', x, y, 0x10000, 8191 ^ bit),
            ('no-press', x, y, 0, 8191), ('other-button', x, y, 0x20000, 8191),
            ('left-edge', left, y, 0x10000, 8191), ('right-edge', right, y, 0x10000, 8191),
            ('top-edge', x, top, 0x10000, 8191), ('bottom-edge', x, bottom, 0x10000, 8191)]:
            pointer=dict(x=px, y=py, buttons=buttons)
            output['mouseCases'].append(dict(kind=kind, pointer=pointer, **run(i, learned, bit, 512, pointer)))
    fixture = ROOT/'sango2-web/packages/core/fixtures/native-troop-selection.json'
    fixture.write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf8')
    ranges = [(HANDLER, 0x417396), (0x41A923, 0x41A994)]
    evidence = dict(exeSha256=SHA, ranges=[])
    for start, end in ranges:
        instructions = [f'{i.address:08x} {i.mnemonic} {i.op_str}' for i in
                        Cs(CS_ARCH_X86, CS_MODE_32).disasm(PE.get_data(start-0x400000, end-start), start)]
        evidence['ranges'].append(dict(start=start, end=end, instructions=instructions))
    path = ROOT/'sango2-web/docs/evidence/native-troop-selection.json'
    path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(f'{len(output["cases"])} direct + {len(output["mouseCases"])} mouse cases; only current force written, RNG unchanged')


if __name__ == '__main__':
    main()
