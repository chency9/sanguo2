"""Extract ordinary formations and execute original division deployment.

Only the render-object allocator (0x4217FE) is stubbed. Coordinate lookup,
count allocation, position transform, occupancy and collision search execute
the hash-pinned EXE. This is a deployment fixture, not a whole-battle replay.
"""
import json
import shutil
import struct
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EAX, UC_X86_REG_EIP
from native_ai_oracle import Oracle, ROOT, HEAP, PE, SHA


def extract():
    result = []
    for formation in range(9):
        row = struct.unpack('<6h', PE.get_data(0x85DA8 + 12 * formation, 12))
        pointers = struct.unpack('<5I', PE.get_data(0x85B10 + 20 * formation, 20))
        divisions = []
        for count, pointer in zip(row[:5], pointers):
            assert bool(pointer) == bool(count)
            divisions.append([list(struct.unpack('<2h', PE.get_data(pointer - 0x400000 + 4 * i, 4))) for i in range(count)])
        result.append(dict(baseX=row[5], divisions=divisions))
    return dict(exeSha256=SHA, generalY=struct.unpack('<i', PE.get_data(0x8E4D0, 4))[0], formations=result)


class DeploymentOracle(Oracle):
    def __init__(self):
        super().__init__()
        self.objects = 0

        def render(cpu, address, size, data):
            sp = cpu.reg_read(UC_X86_REG_ESP)
            # Resource-only boundary. Native 442A1A still writes/reserves the
            # real cell via 43B028 and obtains its exact world position.
            self.objects += 1
            cpu.reg_write(UC_X86_REG_EAX, HEAP + 0x40000 + 0x100 * self.objects)
            cpu.reg_write(UC_X86_REG_EIP, self.u32(sp))
            cpu.reg_write(UC_X86_REG_ESP, sp + 4)

        self.cpu.hook_add(UC_HOOK_CODE, render, begin=0x4217FE, end=0x4217FE)

    def deploy(self, formation, active, reserve, mirror, mode, obstacles):
        team = 0x4A8A60 if mirror else 0x4B03A0
        self.cpu.mem_write(team, bytes(15000))
        self.cpu.mem_write(0x4B3CA0, bytes(71 * 14 * 4))
        self.cpu.mem_write(0x4B4C54, bytes(71 * 14 * 4))
        self.objects = 0
        base = self.call(0x404780, formation)
        for address, value in [(0x48E4C8, base), (0x4A8A40, formation), (0x4B0380, 0), (0x4A8A44, 128 if mirror else 0), (team + 104, mode)]:
            self.put(address, value)
        self.call(0x442CB6, HEAP, HEAP + 4, base, 6, active + reserve, int(mirror), mode)
        general = [self.i32(HEAP), self.i32(HEAP + 4)]
        assert 0 <= general[0] < 71
        # Ordinary deployment starts with this side's general on the field.
        for x, y in [general, *obstacles]:
            self.put(0x4B3CA0 + 4 * (71 * y + x), HEAP + 0x1000)
        for division in [1, 3, 4, 5, 2]:
            offset = 0
            for is_reserve, count in [(True, reserve), (False, active)]:
                amount = self.call(0x404D18 if is_reserve else 0x404A10, formation, count, division)
                self.call(0x442D38, team, division, offset, amount, 140 if is_reserve else 100, int(is_reserve), active + reserve)
                offset += amount
        soldiers = []
        for i in range(self.i32(0x4B0380)):
            ptr = team + 180 + 72 * i
            soldiers.append(dict(x=self.i32(ptr + 8), y=self.i32(ptr + 12), division=self.i32(ptr + 32), reserve=bool(self.u32(ptr + 44) & 4)))
        assert len(soldiers) == active + reserve
        return dict(general=general, soldiers=soldiers)


def main():
    data = extract()
    vm = DeploymentOracle()
    vectors = []
    for formation in range(9):
        for active, reserve in [(0, 0), (1, 0), (7, 0), (50, 0), (99, 0), (100, 0), (100, 33), (87, 92), (100, 100)]:
            for mirror in [False, True]:
                o = dict(formation=formation, active=active, reserve=reserve, mirror=mirror, mode=0, obstacles=[])
                vectors.append(dict(input=o, native=vm.deploy(**o)))
        for mode in [1, 2, 3, 4]:
            for mirror in [False, True]:
                # Deliberately block two positions to exercise the native
                # collision scan instead of merely checking the static table.
                first = vm.deploy(formation, 100, 100, mirror, mode, [])['soldiers'][:2]
                obstacles = [[p['x'], p['y']] for p in first]
                o = dict(formation=formation, active=100, reserve=100, mirror=mirror, mode=mode, obstacles=obstacles)
                vectors.append(dict(input=o, native=vm.deploy(**o)))
    destination = ROOT.parent / 'sango2-web/packages/core'
    table_path = ROOT / 'evidence/ai/native-formation-positions.json'
    vector_path = ROOT / 'evidence/ai/native-formation-vectors.json'
    table_path.write_text(json.dumps(data, separators=(',', ':')), encoding='utf8')
    vector_path.write_text(json.dumps(dict(exeSha256=SHA, vectors=vectors), separators=(',', ':')), encoding='utf8')
    shutil.copyfile(table_path, destination / 'src/native-formation-positions.json')
    shutil.copyfile(vector_path, destination / 'fixtures/native-formation-vectors.json')
    print(json.dumps(dict(formations=len(data['formations']), points=sum(len(d) for f in data['formations'] for d in f['divisions']), vectors=len(vectors), soldiers=sum(len(v['native']['soldiers']) for v in vectors))))


if __name__ == '__main__':
    main()
