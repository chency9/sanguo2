"""Run MoreSoldier/BackSoldier and all children in the pinned original x86 VM.

Integer script instructions, branching, waits and coroutine iteration execute
the original PE code. Context/string allocation uses the same substitutions as
the existing Heal oracle. World hosts expose a synthetic stationary occupancy
snapshot, level and living count; graphics/audio are observed, not rendered.
Level, count, occupancy and allocation are synthetic hosts: allocationCases
force host 281 to return 0 at a configured live-object count. They prove the
original caller and child behavior after rejection, not native allocator logic.
These are isolated script traces, not a complete native battle replay.
"""
import hashlib
import json
import shutil
from pathlib import Path

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_ECX, UC_X86_REG_EIP, UC_X86_REG_ESP

from native_ai_oracle import ROOT, SHA, STACK, STOP
from native_magic_heal_oracle import HealOracle
from native_magic_shoot_oracle import CODE


CONFIGS = [(5, 'Magic9', 17, 'MoreSoldier'), (17, 'Magic23', 32, 'MoreSoldier'),
           (57, 'Magic65', 25, 'MoreSoldier'), (81, 'Magic84', 42, 'MoreSoldier'),
           (19, 'Magic24', 25, 'BackSoldier'), (31, 'Magic33', 35, 'BackSoldier'),
           (37, 'Magic41', 45, 'BackSoldier')]


class ReinforceOracle(HealOracle):
    def __init__(self, spec):
        spec = dict(hp=100, maxHp=100, attack=0, y=468, **spec)
        super().__init__(spec)
        self.live = spec['live']
        self.camera = [0, 0]
        self.spawned = []
        self.occupied = {tuple(cell) for cell in spec.get('occupied', [])}
        self.next_handle = 1000
        self.recorded_hosts.update({268,273,274,275,278,281,301,302})
        counts = {268:1,273:0,274:0,275:2,278:1,281:3,301:0,302:0}
        vm = self.vm
        for host, count in counts.items():
            address = vm.u32(0x4A69B0+host*4)

            def boundary(cpu, address, size, _, h=host, n=count):
                sp = cpu.reg_read(UC_X86_REG_ESP)
                args = [vm.i32(sp+4+4*i) for i in range(n)]
                result = self.host(h, args)
                cpu.reg_write(UC_X86_REG_EAX, result & 0xffffffff)
                cpu.reg_write(UC_X86_REG_EIP, vm.u32(sp))
                cpu.reg_write(UC_X86_REG_ESP, sp+4)

            vm.cpu.hook_add(UC_HOOK_CODE, boundary, begin=address, end=address)

    def host(self, host, args):
        if host == 256:
            self.camera = args.copy()
        if host in [268,273,274,275,278,281,301,302]:
            self.events.append(dict(t=self.time,host=host,args=args.copy()))
        if host == 268: return self.live
        if host == 273: return self.camera[0]
        if host == 274: return self.camera[1]
        if host == 275: return int(tuple(args) in self.occupied)
        if host == 278: return self.spec['level']
        if host == 301: return 71
        if host == 302: return 14
        if host == 281:
            side,x,y = args
            if (x,y) in self.occupied or self.live >= self.spec.get('slots',200): return 0
            self.occupied.add((x,y))
            self.live += 1
            handle = self.next_handle
            self.next_handle += 1
            self.objects[handle] = dict(x=x*96*65536,y=y*72*65536,z=0,facing=side*128,alive=1)
            self.spawned.append(dict(t=self.time,side=side,x=x,y=y,handle=handle))
            return handle
        return super().host(host,args)

    def run(self, maximum=1000):
        trace = []
        for tick in range(maximum):
            self.time = tick
            index = 0
            while index < len(self.contexts):
                self.context = self.contexts[index]['ptr']
                vm = self.vm
                sp = STACK+0xF000
                vm.put(sp,STOP)
                vm.cpu.reg_write(UC_X86_REG_ESP,sp)
                vm.cpu.reg_write(UC_X86_REG_ECX,self.context)
                # A full occupied 71x14 board checks hundreds of cells in one
                # non-yielding ProduceSoldier call, still instruction bounded.
                vm.cpu.emu_start(0x467F10,STOP,count=2_000_000)
                assert vm.cpu.reg_read(UC_X86_REG_EIP) == STOP
                if vm.cpu.reg_read(UC_X86_REG_EAX) == 0xffffffff:
                    self.contexts.pop(index)
                else:
                    index += 1
            trace.append([self.live,*vm.rng(),len(self.contexts)])
            if not self.contexts:
                return dict(ticks=tick+1,events=self.events,trace=trace,rng=vm.rng(),
                            live=self.live,spawned=self.spawned,camera=self.camera)
        raise RuntimeError(f'Reinforce tree did not terminate: {self.spec}')


def main():
    cases = []
    states = [
        ('empty',1,0,[]), ('level19',19,80,[]), ('level20',20,80,[]),
        ('level40',40,80,[]), ('level60',60,80,[]), ('no-room',40,200,[]),
        ('one-room',40,199,[]), ('overflow',20,120,[]),
        ('occupied-edge',40,175,[[x,y] for x in [0,1,69,70] for y in range(1,14)]),
        ('all-occupied',40,175,[[x,y] for x in range(71) for y in range(1,14)]),
    ]
    for sequence,name,amount,family in CONFIGS:
        for side in [0,1]:
            for label,level,live,occupied in states:
                spec = dict(name=name,sequence=sequence,amount=amount,family=family,label=label,
                            side=side,x=1488 if side else 5328,level=level,live=live,occupied=occupied,rng=[0x12345678,0x87654321])
                native = ReinforceOracle(spec).run()
                cases.append(dict(input=spec,native=native))
    allocation_cases = []
    for sequence,name,amount,family in CONFIGS:
        for side in [0,1]:
            for slots in [175,176]:
                spec = dict(name=name,sequence=sequence,amount=amount,family=family,
                            label=f'allocation-limit-{slots}',slots=slots,side=side,
                            x=1488 if side else 5328,level=40,live=175,occupied=[],
                            rng=[0x12345678,0x87654321])
                allocation_cases.append(dict(input=spec,native=ReinforceOracle(spec).run()))
    out = dict(exeSha256=SHA,scriptSha256=hashlib.sha256(CODE).hexdigest(),boundary=__doc__,
               cases=cases,allocationCases=allocation_cases)
    path = ROOT/'evidence/ai/native-magic-reinforce-vectors.json'
    path.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    shutil.copyfile(path,ROOT.parent/'sango2-web/packages/core/fixtures'/path.name)
    print(json.dumps(dict(cases=len(cases),allocationCases=len(allocation_cases),ticks=sum(c['native']['ticks'] for c in cases),
                         firstTicks=cases[0]['native']['ticks'],firstSpawns=cases[0]['native']['spawned']),ensure_ascii=True))


if __name__ == '__main__': main()
