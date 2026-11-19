"""Execute original projection tables, world projection and camera bounds.

No renderer replacement or projected-value hooks. The 640x480 initialization
constants come from 0x443B84 / 0x441D75; 0x441C9A builds every table entry.
"""
import json
import random
from native_ai_oracle import Oracle, ROOT, HEAP, SHA
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EIP, UC_X86_REG_EAX

def main():
    vm = Oracle()
    # Original 480-high screen: floor bottom = 480-128, baseY = 8.
    horizon = int(620 * (238 - (352 - 8)) / (352 - 8)) - 1
    for addr, value in [(0x4A8A48, 620), (0x4A8A54, 8), (0x4A8A5C, 238), (0x4B0388, horizon)]:
        vm.put(addr, value)
    vm.call(0x441C9A)
    tables = [[vm.i32(0x4AC380 + i*4), vm.i32(0x4B7B20 + i*4)] for i in range(4096)]
    rng = random.Random(0x43A562)
    points = []
    for camera in [dict(x=4000, y=339), dict(x=240, y=0), dict(x=6560, y=800)]:
        vm.put(0x4AC368, camera['x']); vm.put(0x4AC370, camera['y'])
        inputs = [(x*65536, (camera['y']+depth-1024)*65536, z*65536)
                  for depth in [-1, 0, 1023, 1024, 4095, 4096, 16383, 16384]
                  for x in [-32768, -1, 0, 4000, 6816, 32767] for z in [0, 54]]
        inputs += [(rng.randrange(-2147483648, 2147483648), rng.randrange(-2147483648, 2147483648),
                    rng.randrange(-2147483648, 2147483648)) for _ in range(160)]
        inputs += [((x*96+48)*65536, (y*72+36)*65536, 0) for x in [0, 10, 35, 60, 70] for y in range(14)]
        for x, y, z in inputs:
            signed = lambda n: (n + 2147483648) % 4294967296 - 2147483648
            x, y, z = map(signed, (x, y, z))
            vm.call(0x43A562, x & 0xffffffff, y & 0xffffffff, z & 0xffffffff, HEAP)
            points.append(dict(input=dict(x=x, y=y, z=z, camera=camera),
                               native=dict(x=vm.i32(HEAP), y=vm.i32(HEAP+4), scale=vm.i32(HEAP+8))))
    bounds = []
    for x in [-2147483648, -1, 0, 239, 240, 4000, 6560, 6561, 2147483647]:
        for y in [-1, 0, 339, 800, 801]:
            vm.put(0x4AC368, x); vm.put(0x4AC370, y); vm.call(0x441E07)
            bounds.append(dict(input=dict(x=x, y=y), native=dict(x=vm.i32(0x4AC368), y=vm.i32(0x4AC370))))
    render = []; captured = []

    def capture(cpu, address, size, data):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        captured.append(dict(x=vm.i32(sp+4), y=vm.i32(sp+8), depth=vm.i32(sp+16),
                             scaleX=vm.i32(sp+20), scaleY=vm.i32(sp+24)))
        # Capture the low-level graphics submission, not projection arithmetic.
        cpu.reg_write(UC_X86_REG_EAX, 0)
        cpu.reg_write(UC_X86_REG_EIP, vm.u32(sp))
        cpu.reg_write(UC_X86_REG_ESP, sp+4)

    vm.cpu.hook_add(UC_HOOK_CODE, capture, begin=0x46B910, end=0x46B910)
    vm.put(0x48E520, 16)
    for v in points[::7]:
        for facing, object_scale in [(0, 48384), (0x800000, 48384), (0, 65536), (0x800000, 65536)]:
            o = v['input']; event = HEAP+0x1000
            vm.put(0x4AC368, o['camera']['x']); vm.put(0x4AC370, o['camera']['y'])
            for offset, value in [(8,o['x']), (12,o['y']), (16,o['z']), (44,facing),
                                  (48,0x40 if object_scale == 48384 else 0), (92,65536), (96,65536), (112,HEAP+0x3000)]:
                vm.put(event+offset,value)
            vm.put(event+102,65535,True)
            captured.clear(); vm.call(0x43FF4E,event)
            render.append(dict(input={**o, 'facing':facing, 'objectScale':object_scale}, native=captured[0] if captured else None))
    result = dict(sha256=SHA, functions=['0x441C9A', '0x43A562', '0x441E07', '0x43FF4E'], horizon=horizon,
                  tables=tables, points=points, bounds=bounds, render=render)
    target = ROOT.parent / 'sango2-web/packages/core/fixtures/native-projection-vectors.json'
    target.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(f'Original projection: {len(tables)} table rows, {len(points)} points, {len(bounds)} camera bounds, {len(render)} render submissions; horizon={horizon}')


if __name__ == '__main__':
    main()
