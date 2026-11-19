"""Original SO LockCamera / MoveCamera traces through the original x86 VM.

Only camera/object host boundaries are synthetic. Integer instructions, waits and
branching execute in the pinned EXE. Input object paths are external snapshots;
spawned MoveCamera is recorded, not executed by this isolated-script oracle.
"""
import hashlib
import json
import shutil
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_ECX, UC_X86_REG_EIP, UC_X86_REG_ESP
from native_ai_oracle import ROOT, SHA, STACK, STOP
from native_magic_shoot_oracle import ScriptOracle, CTX, CODE


class CameraOracle(ScriptOracle):
    def __init__(self, spec):
        super().__init__(dict(rng=[1, 2], side=spec.get('side', 1), x=1000, y=468),
                         spec['name'], spec['args'])
        self.camera = list(spec['camera'])
        self.objects[3] = dict(x=0, y=0, z=0, alive=1)
        self.spec = spec
        for host, axis in [(273, 0), (274, 1)]:
            address = self.vm.u32(0x4A69B0 + host * 4)

            def getter(cpu, address, size, _, axis=axis):
                sp = cpu.reg_read(UC_X86_REG_ESP)
                cpu.reg_write(UC_X86_REG_EAX, self.camera[axis] & 0xffffffff)
                cpu.reg_write(UC_X86_REG_EIP, self.vm.u32(sp))
                cpu.reg_write(UC_X86_REG_ESP, sp + 4)

            self.vm.cpu.hook_add(UC_HOOK_CODE, getter, begin=address, end=address)

    def host(self, h, args):
        if h == 256:
            self.camera = list(args)  # 0x43A638 assigns; it does not clamp.
        return super().host(h, args)

    def run(self):
        trace = []
        spec = self.spec
        for t in range(1200):
            self.time = t
            if spec['name'] == 'LockCamera':
                path = spec['path']
                for handle, key in [(3, 'object'), (2, 'enemy')]:
                    x, y = path[key]
                    dx, dy = path.get(key + 'Velocity', [0, 0])
                    self.objects[handle].update(x=(x + dx*t)*65536, y=(y + dy*t)*65536,
                                                alive=int(t < path.get('deathAt', 10000)) if handle == 3 else 1)
            vm = self.vm
            sp = STACK + 0xF000
            vm.put(sp, STOP)
            vm.cpu.reg_write(UC_X86_REG_ECX, CTX)
            vm.cpu.reg_write(UC_X86_REG_ESP, sp)
            vm.cpu.emu_start(0x467F10, STOP, count=100000)
            assert vm.cpu.reg_read(UC_X86_REG_EIP) == STOP
            trace.append(self.camera[:])
            if vm.cpu.reg_read(UC_X86_REG_EAX) == 0xffffffff:
                return dict(ticks=t+1, trace=trace, events=self.events, rng=vm.rng())
        raise RuntimeError(f'Camera script did not terminate: {spec}')


def main():
    specs = []
    for start, target in [([4000, 339], [5328, 348]), ([1488, 348], [3408, 438]),
                          ([90, -100], [-90, -120]), ([6700, 830], [7000, 900]),
                          ([4000, 339], [4000, 339]), ([240, 0], [241, 1])]:
        for duration in [1, 2, 3, 7, 30, 60, 1000]:
            specs.append(dict(name='MoveCamera', camera=start, args=[*target, duration]))
    for side in [0, 1]:
        direction = 1 if side else -1
        for camera_x in [100, 1488, 3408, 5328, 6800]:
            for death_at in [0, 1, 5, 45, 200]:
                for moving in [False, True]:
                    specs.append(dict(name='LockCamera', side=side, camera=[camera_x, 348],
                        args=[3, 180, -120 if not moving else -41, side],
                        path=dict(object=[3408, 468], objectVelocity=[direction*16, int(moving)],
                                  enemy=[3408+direction*1200, 504], enemyVelocity=[-direction*int(moving), 0],
                                  deathAt=death_at)))
    cases = [dict(input=s, native=CameraOracle(s).run()) for s in specs]
    out = dict(exeSha256=SHA, scriptSha256=hashlib.sha256(CODE).hexdigest(), boundary=__doc__, cases=cases)
    path = ROOT / 'evidence/ai/native-magic-camera-vectors.json'
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    shutil.copyfile(path, ROOT.parent / 'sango2-web/packages/core/fixtures' / path.name)
    print(json.dumps(dict(cases=len(cases), ticks=sum(c['native']['ticks'] for c in cases))))


if __name__ == '__main__':
    main()
