"""Execute native reinforce host allocation and post-battle slot accounting.

The pinned PE host 281 (0x42068C -> 0x43A971), grid validation, first-free
record selection, active/reserve object selection, record initialization and
command inheritance execute unmodified. Only renderer object allocation
0x4217FE and invalid-grid warning 0x450260 are replaced. Settlement
0x443D29 executes without hooks on synthetic record snapshots. These are
isolated host vectors, not a complete battle or mixed object-list replay.
"""
import json
import shutil
import struct

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EIP, UC_X86_REG_ESP
from native_ai_oracle import Oracle, ROOT, SHA, HEAP

TEAMS = [0x4A8A60, 0x4B03A0]


class ReinforceHostOracle(Oracle):
    def __init__(self, spec):
        super().__init__()
        self.cpu.mem_map(0, 0x1000)
        self.call(0x420D52)
        self.spec = spec
        self.created = []
        self.warnings = []
        team = self.team = TEAMS[spec['side']]
        general = self.general = HEAP
        self.put(team+72, general)
        self.put(general+139, 1 << spec['unit'])
        self.put(team+88, len(spec['flags']))
        self.put(team+92, sum(not (f & 0x2000) for f in spec['flags']))
        self.put(team+52, spec.get('decision', 77))
        self.put(team+152, spec['command'])  # orders[1]
        for i, flags in enumerate(spec['flags']):
            slot = team+180+i*72
            self.put(slot+44, flags)
            self.put(slot+64, team)
            self.put(slot+24, i)
        if spec.get('occupied'):
            blocker = HEAP+0x2000
            self.put(blocker+64, TEAMS[1-spec['side']])
            self.put(0x4B3CA0+4*(71*spec['y']+spec['x']), blocker)

        def ret(value):
            sp = self.cpu.reg_read(UC_X86_REG_ESP)
            self.cpu.reg_write(UC_X86_REG_EAX, value & 0xffffffff)
            self.cpu.reg_write(UC_X86_REG_EIP, self.u32(sp))
            self.cpu.reg_write(UC_X86_REG_ESP, sp+4)

        def allocate(cpu, address, size, _):
            sp = cpu.reg_read(UC_X86_REG_ESP)
            args = [self.i32(sp+4+i*4) for i in range(5)]
            obj = HEAP+0x4000+0x100*len(self.created)
            handle = 1000+len(self.created)
            self.put(obj+4, handle)
            self.created.append(dict(handle=handle, x=args[0], y=args[1],
                                     z=args[2], facing=args[3], object=args[4]))
            ret(obj)

        def warn(cpu, address, size, _):
            self.warnings.append(address)
            ret(0)

        self.cpu.hook_add(UC_HOOK_CODE, allocate, begin=0x4217FE, end=0x4217FE)
        self.cpu.hook_add(UC_HOOK_CODE, warn, begin=0x450260, end=0x450260)

    def run(self):
        result = self.call(0x42068C, self.spec['side'],
                           self.spec['x'] & 0xffffffff, self.spec['y'])
        slots = []
        for i in range(self.u32(self.team+88)):
            slot = self.team+180+i*72
            if self.u32(slot+68):
                slots.append(dict(slot=i, x=self.i32(slot+8), y=self.i32(slot+12),
                                  index=self.i32(slot+24), unitMask=self.u32(slot+28),
                                  division=self.i32(slot+32), command=self.i32(slot+36),
                                  flags=self.u32(slot+44), decision=self.i32(slot+52)))
        return dict(handle=result, slotCount=self.u32(self.team+88),
                    living=self.u32(self.team+92), created=self.created,
                    slots=slots, warnings=len(self.warnings), rng=self.rng())


def death_then_reuse(side):
    spec = dict(label='death-before-corpse-cleanup', side=side, unit=0,
                command=1, flags=[2]*200, x=5, y=7, decision=31)
    vm = ReinforceHostOracle(spec)
    slot = vm.team+180+42*72
    vm.put(slot+8, 10)
    vm.put(slot+12, 7)
    vm.put(slot+68, HEAP+0x2000)
    vm.call(0x43DB0D, slot)
    deleted = dict(flags=vm.u32(slot+44), living=vm.u32(vm.team+92),
                   oldObject=vm.u32(slot+68))
    return dict(input=spec, afterDeath=deleted, native=vm.run())


def settlement(level, flags):
    vm = Oracle()
    team, general = TEAMS[0], HEAP
    vm.put(team+72, general)
    vm.put(general+46, level, True)
    capacity = [vm.call(address, general) for address in [0x409FB6, 0x409FD8]]
    for offset, count in zip([66, 70], capacity):
        vm.put(general+offset, count, True)
    vm.put(team+88, len(flags))
    for i, flag in enumerate(flags):
        vm.put(team+180+72*i+44, flag)
    vm.call(0x443D29, team)
    return dict(capacity=capacity,
                active=struct.unpack('<h', vm.cpu.mem_read(general+68, 2))[0],
                reserve=struct.unpack('<h', vm.cpu.mem_read(general+72, 2))[0])


def main():
    allocations = []
    layouts = [('empty', []), ('199-live', [2]*199), ('200-live', [2]*200),
               ('reuse-first', [0x2002]+[2]*199),
               ('reuse-interior', [2]*42+[0x2002]+[2]*157),
               ('reuse-first-of-two', [2]*7+[0x2002]+[2]*191+[0x2004]),
               ('corpse-fading', [0x8002]*200), ('retreating', [0x4002]*200)]
    for side in [0, 1]:
        for unit in range(13):
            for command in [0, 1, 8]:
                for label, flags in layouts:
                    spec = dict(label=label, side=side, unit=unit, command=command,
                                flags=flags, x=5, y=7, decision=77)
                    allocations.append(dict(input=spec, native=ReinforceHostOracle(spec).run()))
    for x in [-1, 71, 65536+5]:
        spec = dict(label='coordinate-boundary', side=0, unit=3, command=1, flags=[], x=x, y=7, decision=77)
        allocations.append(dict(input=spec, native=ReinforceHostOracle(spec).run()))
    for decision in [0, 1, 40, -3]:
        spec = dict(label='inherit-commander-clock', side=1, unit=11, command=8,
                    flags=[], x=5, y=7, decision=decision)
        allocations.append(dict(input=spec, native=ReinforceHostOracle(spec).run()))
    spec = dict(label='occupied-cell', side=0, unit=0, command=1,
                flags=[], x=5, y=7, decision=77, occupied=True)
    allocations.append(dict(input=spec, native=ReinforceHostOracle(spec).run()))
    settlements = []
    for level in [1, 19, 20, 25, 39, 40, 60]:
        for active, reserve, deadActive, deadReserve in [
            (0, 0, 0, 0), (1, 1, 0, 0), (100, 100, 0, 0),
            (150, 40, 5, 5), (40, 150, 5, 5), (90, 90, 10, 10),
            (0, 0, 100, 100), (180, 0, 0, 0)]:
            flags = [2]*active+[4]*reserve+[0x2002]*deadActive+[0x2004]*deadReserve
            spec = dict(level=level, active=active, reserve=reserve,
                        deadActive=deadActive, deadReserve=deadReserve)
            settlements.append(dict(input=spec, native=settlement(level, flags)))
    out = dict(exeSha256=SHA, boundary=__doc__, addresses=dict(
        host281='0x42068C', allocateRecord='0x43A971', initialize='0x442A1A',
        rendererBoundary='0x4217FE', deadFlag='0x43B556',
        soldierDeath='0x43DB0D', settlement='0x443D29'),
        allocations=allocations, deaths=[death_then_reuse(side) for side in [0, 1]],
        settlements=settlements)
    path = ROOT/'evidence/ai/native-reinforce-host-vectors.json'
    path.write_text(json.dumps(out, separators=(',', ':')), encoding='utf8')
    shutil.copyfile(path, ROOT.parent/'sango2-web/packages/core/fixtures'/path.name)
    print(json.dumps(dict(allocations=len(allocations), deaths=len(out['deaths']), settlements=len(settlements),
                         sample=allocations[0]['native'])))


if __name__ == '__main__':
    main()
