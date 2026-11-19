"""Run the original ShootObject SO through the original EXE integer VM.

World/graphics/audio hosts are observed at their boundary using synthetic handles.
String pushes use decoded string tokens (no C++ allocator); child visual scripts
are recorded, not executed. Integer VM control flow, wait callbacks and host 771
RNG execute unmodified. These are script/host traces, not whole-battle parity.
"""
import hashlib
import json
import math
import shutil
import struct
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_ECX, UC_X86_REG_EIP, UC_X86_REG_ESP
from native_ai_oracle import Oracle, ROOT, HEAP, SHA, STACK, STOP

BINARY = ROOT / 'evidence/binary'
CODE = (BINARY / 'SCRIPT_MAGIC.SO').read_bytes()
SYMBOLS = json.loads((BINARY / 'SCRIPT_MAGIC.SO.symbols.json').read_text(encoding='utf8'))
STRINGS = json.loads((BINARY / 'SCRIPT_MAGIC.SO.strings.json').read_text(encoding='utf8'))
BY_NAME = {s['name']: s for s in SYMBOLS}
CTX, MODULE, VALUES, STATICS, BYTECODE = [HEAP + n for n in [0, 0x200, 0x1000, 0x3000, 0x40000]]
TOKEN = 0x10000000


def signed(n):
    return n if n < 0x80000000 else n - 0x100000000


class ScriptOracle:
    def __init__(self, spec, name, args=()):
        self.vm = vm = Oracle()
        vm.cpu.mem_map(0, 0x1000)  # MSVC's FS:[0] exception-chain slot.
        vm.set_rng(spec['rng'])
        vm.call(0x420D52)
        vm.cpu.mem_write(BYTECODE, CODE)
        vm.put(CTX + 8, MODULE)
        vm.put(MODULE + 4, BYTECODE)
        vm.put(MODULE + 24, STATICS)
        vm.put(CTX + 28, VALUES)
        vm.put(CTX + 32, 4096)
        for i, a in enumerate([*args, 0, 0]):
            vm.put(VALUES + i * 8, a)
        vm.put(CTX + 20, len(args) + 1)
        vm.put(CTX + 24, len(args) + 2)
        vm.put(CTX + 16, BY_NAME[name]['offset'])
        for i, n in [(2, 1), (3, 2), (4, spec.get('attack', 30)), (5, spec['side'])]:
            vm.put(0x4A6878 + i * 4, n)
        self.spec, self.time, self.brightness = spec, 0, 16
        self.events, self.created = [], []
        self.objects = {
            1: dict(x=spec['x'] << 16, y=spec['y'] << 16, z=0, facing=spec['side'] * 128, alive=1),
            2: dict(x=spec.get('targetX', 5000) << 16, y=spec['y'] << 16, z=0, facing=(1-spec['side']) * 128, alive=1),
        }
        self.recorded_hosts = {17, 19, 21, 24, 38, 41, 43, 44, 46, 256, 288, 293, 295, 296, 303, 305, 272, 784, 768}

        def ret(value=0):
            sp = vm.cpu.reg_read(UC_X86_REG_ESP)
            vm.cpu.reg_write(UC_X86_REG_EAX, value & 0xffffffff)
            vm.cpu.reg_write(UC_X86_REG_EIP, vm.u32(sp))
            vm.cpu.reg_write(UC_X86_REG_ESP, sp + 4)

        def string_push(cpu, address, size, _):
            # Replace only allocation/copy of an immutable literal string.
            ip = vm.u32(CTX + 16)
            index = struct.unpack_from('<I', CODE, ip)[0]
            vm.put(CTX + 16, ip + 4)
            top = vm.u32(CTX + 24)
            vm.put(VALUES + top * 8, TOKEN + index)
            vm.put(VALUES + top * 8 + 4, 0)
            vm.put(CTX + 24, top + 1)
            ret(1)

        vm.cpu.hook_add(UC_HOOK_CODE, string_push, begin=0x466560, end=0x466560)

        def child(cpu, address, size, _):
            top = vm.u32(CTX + 24)
            values = [vm.i32(VALUES + i * 8) for i in range(top - 5, top)]
            vm.put(CTX + 24, top - 5)
            self.events.append(dict(t=self.time, child=self.decode(values[0]), args=values[1:]))
            ret(1)

        vm.cpu.hook_add(UC_HOOK_CODE, child, begin=0x467490, end=0x467490)
        counts = {7:1,17:4,18:1,19:1,21:5,24:4,26:1,38:3,41:2,43:2,44:2,46:3,47:2,
                  256:2,261:1,262:1,272:0,288:2,293:3,295:2,296:2,303:1,304:0,305:0,306:0,309:1,310:0,768:3,784:6}
        for host, count in counts.items():
            address = vm.u32(0x4A69B0 + host * 4)

            def boundary(cpu, address, size, _, h=host, n=count):
                sp = cpu.reg_read(UC_X86_REG_ESP)
                values = [vm.i32(sp + 4 + 4*i) for i in range(n)]
                result = self.host(h, values)
                ret(result)

            vm.cpu.hook_add(UC_HOOK_CODE, boundary, begin=address, end=address)

    def decode(self, n):
        return STRINGS[n-TOKEN]['text_cp950'] if n >= TOKEN else n

    def host(self, host, a):
        if host in self.recorded_hosts:
            self.events.append(dict(t=self.time, host=host, args=[self.decode(n) for n in a]))
        obj = self.objects.get(a[0]) if a else None
        if host == 17:
            handle = len(self.objects) + 1
            self.objects[handle] = dict(x=obj['x'], y=obj['y'], z=obj['z']+(a[3]<<16), facing=a[2], alive=1)
            self.created.append(handle)
            return handle
        if host == 18: return obj['alive'] if obj else 0
        if host == 19:
            obj['alive'] = 0
        if host == 21:
            parent = self.objects[a[1]]
            angle = a[2] * 3.1415926 / 128
            obj.update(x=parent['x']+math.trunc(math.cos(angle)*a[3]*65536),
                       y=parent['y']+math.trunc(math.sin(angle)*a[3]*65536), z=parent['z']+(a[4]<<16))
        if host == 24:
            angle = a[1]*3.1415926/128
            obj.update(vx=math.trunc(math.cos(angle)*a[3]*65536), vy=math.trunc(math.sin(angle)*a[3]*65536), vz=0)
        if host == 26: return obj['facing'] if obj else 0
        if host == 46: obj['u'+str(a[1])] = a[2]
        if host == 47: return obj.get('u'+str(a[1]), 0)
        if host == 261: return obj['x'] >> 16 if obj else 0
        if host == 262: return obj['y'] >> 16 if obj else 0
        if host == 303: self.brightness = a[0]
        if host == 304: return self.brightness
        if host == 306: return 6816
        return 0

    def run(self, maximum=1000):
        for t in range(maximum):
            self.time = t
            self.vm.cpu.reg_write(UC_X86_REG_ECX, CTX)
            # Each source update is already instruction bounded. Avoid creating
            # a Unicorn wall-clock watchdog thread for every tiny wait poll.
            vm=self.vm;sp=STACK+0xF000
            vm.put(sp,STOP);vm.cpu.reg_write(UC_X86_REG_ESP,sp)
            vm.cpu.emu_start(0x467F10,STOP,count=100000)
            assert vm.cpu.reg_read(UC_X86_REG_EIP)==STOP
            result=vm.cpu.reg_read(UC_X86_REG_EAX)
            for obj in self.objects.values():
                if obj['alive']:
                    for axis in ['x', 'y', 'z']:
                        obj[axis] = signed((obj[axis]+obj.get('v'+axis, 0)) & 0xffffffff)
            if result == 0xffffffff:
                return dict(ticks=t+1, events=self.events, rng=self.vm.rng(), objects=self.objects)
        raise RuntimeError(f'Script did not terminate: {self.spec}')


def main():
    cases = []
    for name in ['Magic2', 'Magic14', 'Magic52', 'Magic58']:
        for side in [0, 1]:
            for x in [48, 1488, 3408, 5328, 6768]:
                for rng in [[0x12345678, 0x87654321], [1, 2], [13, 85]]:
                    spec = dict(name=name, side=side, x=x, y=468, rng=rng)
                    cases.append(dict(input=spec, native=ScriptOracle(spec, name).run()))
    out = dict(exeSha256=SHA, scriptSha256=hashlib.sha256(CODE).hexdigest(),
               boundary=__doc__, cases=cases)
    path = ROOT / 'evidence/ai/native-magic-shoot-script-vectors.json'
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    shutil.copyfile(path, ROOT.parent / 'sango2-web/packages/core/fixtures' / path.name)
    print(json.dumps(dict(cases=len(cases), first=cases[0]['native'])))


if __name__ == '__main__':
    main()
