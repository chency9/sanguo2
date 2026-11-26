"""Execute native terrain remapping and A/B selection on synthetic resources.

0x40EA29 reads a real one-pixel PCX mask through original 0x44FD1B and
0x4060F8. 0x4366C4 runs original selection/RNG; only file-presence checking
at 0x46B030 returns 1 because the synthetic A/B names are known to exist.
No terrain selector, category function or RNG function is replaced.
"""
import json
import random
import shutil
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EIP, UC_X86_REG_ESP
from native_ai_oracle import Oracle, ROOT, SHA, HEAP


def terrain(mask, capacity):
    o = Oracle()
    pcx, city = HEAP, HEAP + 0x1000
    o.cpu.mem_write(pcx, bytes(128))
    o.cpu.mem_write(pcx + 128, bytes([0xC1, mask]) if mask >= 0xC0 else bytes([mask]))
    o.put(0x4A6434, pcx)
    if capacity is not None:
        o.put(city + 68, capacity, True)
    return o.call(0x40EA29, 0, 0, city if capacity is not None else 0)


def variant(mode, seed):
    o = Oracle()
    o.cpu.mem_write(0x4BBCC0, bytes(0x500))
    for address, value in [(0x4BBCDC, HEAP + 0x1000), (0x4BBCE0, HEAP + 0x1100)]:
        o.put(address, value)
        o.cpu.mem_write(value, b'available.shp\0')
    o.put(HEAP, mode)
    o.set_rng(seed)

    def present(cpu, address, size, _):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        cpu.reg_write(UC_X86_REG_EAX, 1)
        cpu.reg_write(UC_X86_REG_ESP, sp + 4)
        cpu.reg_write(UC_X86_REG_EIP, o.u32(sp))

    o.cpu.hook_add(UC_HOOK_CODE, present, begin=0x46B030, end=0x46B030)
    o.call(0x4366C4, 0, HEAP)
    return dict(variant='a' if o.u32(HEAP) == 1 else 'b', rng=o.rng())


def main():
    capacities = [None, -32768, 0, 5, 6, 8, 9, 12, 13, 15, 32767]
    terrain_cases = [dict(mask=m, capacity=c, terrain=terrain(m, c))
                     for m in [0, 1, 2, 3, 5, 8, 10, 11, 255] for c in capacities]
    r = random.Random(20261126)
    seeds = [[184, 0x87654321], [1, 2], [0, 0], [0xFFFFFFFF, 0xFFFFFFFF]]
    seeds += [[r.randrange(2**32), r.randrange(2**32)] for _ in range(28)]
    variant_cases = [dict(mode=mode, rng=seed, native=variant(mode, seed))
                     for mode in [0, 1, 2, 3] for seed in seeds]
    result = dict(exeSha256=SHA, boundary=__doc__, terrainCases=terrain_cases, variantCases=variant_cases)
    path = ROOT / 'evidence/ai/native-scenery-vectors.json'
    path.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    shutil.copyfile(path, ROOT.parent / 'sango2-web/packages/core/fixtures' / path.name)
    print(json.dumps(dict(terrainCases=len(terrain_cases), variantCases=len(variant_cases))))


if __name__ == '__main__':
    main()
