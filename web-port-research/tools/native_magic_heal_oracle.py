"""Execute the complete Heal coroutine tree in the pinned original x86 VM.

Integer bytecode, calls, numeric waits and RNG run unmodified. We substitute
string allocation, child-context allocation and named-wait string ownership;
the list is iterated/removes completed contexts as EXE 0x465700 does. Object,
HP, graphics and audio hosts are synthetic boundaries. This proves script
events/RNG on the supplied snapshots, not original object motion/rendering or
interleaving with the rest of a real battle.
"""
import hashlib
import json
import shutil
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_ECX, UC_X86_REG_EIP, UC_X86_REG_ESP
from native_ai_oracle import ROOT, SHA, STACK, STOP
from native_magic_shoot_oracle import ScriptOracle, CTX, MODULE, CODE, BY_NAME

CONTEXTS, NAMED_CALLBACK = 0x4000000, STOP + 0x100


class HealOracle(ScriptOracle):
    def __init__(self, spec):
        super().__init__(spec, spec.get('name', 'Magic1'))
        vm = self.vm
        vm.cpu.mem_map(CONTEXTS, 0x100000)
        self.contexts = [dict(ptr=CTX, name=spec.get('name', 'Magic1'))]
        self.allocated = 0
        self.hp = spec['hp']
        self.recorded_hosts.update({23,27,29,37,39,40,280,289,769})

        def ret(value):
            sp = vm.cpu.reg_read(UC_X86_REG_ESP)
            vm.cpu.reg_write(UC_X86_REG_EAX, value)
            vm.cpu.reg_write(UC_X86_REG_EIP, vm.u32(sp))
            vm.cpu.reg_write(UC_X86_REG_ESP, sp+4)

        def pending(name):
            # 0x465820 compares the entry symbol, not its current local call.
            return any(c['name'] == name for c in self.contexts)

        def named_wait(cpu, address, size, _):
            ctx = self.context
            top = vm.u32(ctx+24)-1
            token = vm.u32(vm.u32(ctx+28)+top*8)
            vm.put(ctx+24, top)
            waiting = pending(self.decode(token))
            vm.put(ctx+40, NAMED_CALLBACK if waiting else 0)
            vm.put(ctx+44, token)
            vm.put(ctx+48, 0)
            ret(0 if waiting else 1)

        def named_callback(cpu, address, size, _):
            sp = vm.cpu.reg_read(UC_X86_REG_ESP)
            ret(int(pending(self.decode(vm.u32(vm.u32(sp+4))))))

        vm.cpu.hook_add(UC_HOOK_CODE, named_wait, begin=0x467340, end=0x467340)
        vm.cpu.hook_add(UC_HOOK_CODE, named_callback, begin=NAMED_CALLBACK, end=NAMED_CALLBACK)

    def spawn_child(self, name, args):
        super().spawn_child(name, args)
        symbol = BY_NAME[name]
        count = symbol['arg_count_candidate']
        assert count <= 4
        ctx = CONTEXTS + self.allocated*0x1000
        self.allocated += 1
        assert self.allocated < 256
        values = ctx+0x100
        vm = self.vm
        vm.put(ctx+8, MODULE)
        vm.put(ctx+16, symbol['offset'])
        vm.put(ctx+20, count+1)
        vm.put(ctx+24, count+2)
        vm.put(ctx+28, values)
        vm.put(ctx+32, 128)
        for i, a in enumerate([*args[:count],0,0]):
            vm.put(values+8*i,a)
        self.contexts.append(dict(ptr=ctx,name=name))

    def host(self, host, args):
        if host == 279: return self.hp
        if host == 280: self.hp = min(self.spec['maxHp'], args[1])
        return super().host(host, args)

    def run(self, maximum=1200):
        trace = []
        for t in range(maximum):
            self.time = t
            i = 0
            while i < len(self.contexts):
                self.context = self.contexts[i]['ptr']
                vm = self.vm
                sp = STACK+0xF000
                vm.put(sp,STOP)
                vm.cpu.reg_write(UC_X86_REG_ESP,sp)
                vm.cpu.reg_write(UC_X86_REG_ECX,self.context)
                vm.cpu.emu_start(0x467F10,STOP,count=100000)
                assert vm.cpu.reg_read(UC_X86_REG_EIP) == STOP
                if vm.cpu.reg_read(UC_X86_REG_EAX) == 0xffffffff:
                    self.contexts.pop(i)
                else: i += 1
            trace.append([self.hp, *vm.rng(), len(self.contexts)])
            if not self.contexts:
                return dict(ticks=t+1,events=self.events,trace=trace,rng=vm.rng(),hp=self.hp)
        raise RuntimeError(f'Heal did not terminate: {self.spec}')


def main():
    specs = [dict(name=name,side=side,x=x,y=468,hp=hp,maxHp=100,attack=attack,rng=rng)
             for name,attack in [('Magic1',30),('Magic63',35)]
             for side in [0,1] for x in [48,3408,6768] for hp in [1,80,100]
             for rng in [[1,2],[0x12345678,0x87654321]]]
    cases = [dict(input=s,native=HealOracle(s).run()) for s in specs]
    out = dict(exeSha256=SHA,scriptSha256=hashlib.sha256(CODE).hexdigest(),boundary=__doc__,cases=cases)
    path = ROOT/'evidence/ai/native-magic-heal-vectors.json'
    path.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    shutil.copyfile(path,ROOT.parent/'sango2-web/packages/core/fixtures'/path.name)
    print(json.dumps(dict(cases=len(cases),ticks=sum(c['native']['ticks'] for c in cases),firstTicks=cases[0]['native']['ticks'],firstEvents=cases[0]['native']['events'][:8])))


if __name__ == '__main__': main()
