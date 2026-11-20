"""Execute ExplodeRound and its complete creation coroutine tree in original x86.

The pinned PE executes integer SO, waits, named-child scheduling and RNG.
Immutable strings and child-context storage use the existing Heal substitutions.
Object hosts, transforms, fade and lifetime are synthetic world boundaries;
they are observed inputs/outputs, not evidence of original renderer processing.
Collision callbacks are evaluated separately from these creation traces.
"""
import hashlib
import json
import math
import shutil
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_ECX, UC_X86_REG_EIP, UC_X86_REG_ESP
from native_ai_oracle import ROOT, SHA, STACK, STOP
from native_magic_heal_oracle import HealOracle, CONTEXTS
from native_magic_shoot_oracle import CODE, BY_NAME, MODULE, CTX, VALUES, STATICS


class ExplodeOracle(HealOracle):
    def __init__(self, spec):
        super().__init__({'hp':100,'maxHp':100,'attack':7,**spec})
        self.vm.cpu.mem_map(CONTEXTS+0x100000,0x300000)
        self.recorded_hosts.update({49})
        self.vm.put(STATICS+12*8,spec.get('divisor',1))
        if spec.get('args'):
            for i,value in enumerate([*spec['args'],0,0]):self.vm.put(VALUES+i*8,value)
            self.vm.put(CTX+20,len(spec['args'])+1);self.vm.put(CTX+24,len(spec['args'])+2)
        if spec.get('name')=='ExplodeRoundCallback':
            self.objects[3]=dict(x=spec['x']*65536,y=spec['y']*65536,z=0,facing=0,alive=1,flags=0x3000000)
            self.objects[4]=dict(self.objects[2],facing=128,alive=int(spec.get('targetAlive',True)))
        vm=self.vm
        def boundary(cpu,address,size,_):
            sp=cpu.reg_read(UC_X86_REG_ESP)
            self.host(49,[vm.i32(sp+4),vm.i32(sp+8)])
            cpu.reg_write(UC_X86_REG_EAX,0);cpu.reg_write(UC_X86_REG_EIP,vm.u32(sp));cpu.reg_write(UC_X86_REG_ESP,sp+4)
        address=vm.u32(0x4A69B0+49*4)
        vm.cpu.hook_add(UC_HOOK_CODE,boundary,begin=address,end=address)
        def unit_boundary(cpu,address,size,_):
            sp=cpu.reg_read(UC_X86_REG_ESP);value=vm.i32(sp+4)
            cpu.reg_write(UC_X86_REG_EAX,value);cpu.reg_write(UC_X86_REG_EIP,vm.u32(sp));cpu.reg_write(UC_X86_REG_ESP,sp+4)
        address=vm.u32(0x4A69B0+277*4)
        vm.cpu.hook_add(UC_HOOK_CODE,unit_boundary,begin=address,end=address)

    def spawn_child(self,name,args):
        # Same list append/entry-symbol semantics as HealOracle, with enough
        # independent contexts for the 48 x 6 smoke subtree.
        self.events.append(dict(t=self.time,child=name,args=args))
        count=BY_NAME[name]['arg_count_candidate'];assert count<=4
        ctx=CONTEXTS+self.allocated*0x1000;self.allocated+=1;assert self.allocated<1024
        values=ctx+0x100;vm=self.vm
        for offset,value in [(8,MODULE),(16,BY_NAME[name]['offset']),(20,count+1),(24,count+2),(28,values),(32,128)]:vm.put(ctx+offset,value)
        for i,value in enumerate([*args[:count],0,0]):vm.put(values+8*i,value)
        self.contexts.append(dict(ptr=ctx,name=name))

    def host(self,h,a):
        result=super().host(h,a)
        obj=self.objects.get(a[0]) if a else None
        if h==17:
            obj=self.objects[result]
            obj.update(object=a[1],born=self.time,frame=0,scaleX=65536,scaleY=65536,fade=16,fadeDuration=0,fadeAt=0,fadeInterval=1,shrink=0,vz=0,flags=0,callback=0)
        elif h==23:obj.update(vz=a[2]*65536)
        elif h==27:
            if a[1]:obj['scaleX']=a[1]
            if a[2]:obj['scaleY']=a[2]
        elif h==37:obj['shrink']=a[1]
        elif h==38:obj.update(fadeDuration=a[1],fadeInterval=a[2],fadeAt=self.time,fade=16-16/a[1])
        elif h==39:obj['fade']=a[1]
        elif h==40:
            for axis,value in zip(['x','y','z'],a[1:]):obj[axis]+=value*65536
        elif h==41:obj['flags']|=a[1]
        elif h==43:obj['flags']&=~a[1]
        elif h==44:obj['callback']=a[1]
        elif h==49:obj['blend']=a[1]
        return result

    def run(self,maximum=1500):
        trace=[]
        for t in range(maximum):
            self.time=t;i=0
            while i<len(self.contexts):
                self.context=self.contexts[i]['ptr'];vm=self.vm;sp=STACK+0xF000;vm.put(sp,STOP)
                vm.cpu.reg_write(UC_X86_REG_ESP,sp);vm.cpu.reg_write(UC_X86_REG_ECX,self.context)
                vm.cpu.emu_start(0x467F10,STOP,count=200000)
                assert vm.cpu.reg_read(UC_X86_REG_EIP)==STOP
                if vm.cpu.reg_read(UC_X86_REG_EAX)==0xffffffff:self.contexts.pop(i)
                else:i+=1
            for o in self.objects.values():
                if 'born' not in o or not o['alive']:continue
                o['z']+=o.get('vz',0)
                o['frame']+=1
                o['scaleX']=max(0,o['scaleX']-o['shrink']);o['scaleY']=max(0,o['scaleY']-o['shrink'])
                if o['fadeDuration'] and t>o['fadeAt'] and (t-o['fadeAt'])%o['fadeInterval']==0:o['fade']=max(0,o['fade']-16/o['fadeDuration'])
                if o['fade']==0:o['alive']=0
                if o['object']==18003 and o['frame']>=28 or o['object']==18004 and o['frame']>=18:o['alive']=0
            trace.append([*vm.rng(),len(self.contexts)])
            if not self.contexts:
                return dict(ticks=t+1,events=self.events,rng=vm.rng(),trace=trace,objects=self.objects,divisor=vm.i32(STATICS+12*8))
        raise RuntimeError(f'Explode tree did not terminate: {self.spec}')


def main():
    cases=[]
    for sequence,name in [(7,'Magic8'),(16,'Magic19'),(23,'Magic31')]:
        for side in [0,1]:
            for x in [48,3408,6768]:
                for rng in [[1,2],[0x12345678,0x87654321]]:
                    spec=dict(sequence=sequence,name=name,side=side,x=x,y=468,rng=rng)
                    cases.append(dict(input=spec,native=ExplodeOracle(spec).run()))
    callbacks=[]
    for general in [False,True]:
        for attack in [0,1,7,30]:
            for divisor in [1,2,4,8]:
                for hp in [0,100]:
                    spec=dict(name='ExplodeRoundCallback',side=1,x=1488,y=468,rng=[1,2],args=[3,2 if general else 4],attack=attack,divisor=divisor,hp=hp)
                    callbacks.append(dict(input=spec,native=ExplodeOracle(spec).run()))
    out=dict(exeSha256=SHA,scriptSha256=hashlib.sha256(CODE).hexdigest(),boundary=__doc__,cases=cases,callbacks=callbacks)
    path=ROOT/'evidence/ai/native-magic-explode-vectors.json';path.write_text(json.dumps(out,separators=(',',':')),encoding='utf8')
    shutil.copyfile(path,ROOT.parent/'sango2-web/packages/core/fixtures'/path.name)
    print(json.dumps(dict(cases=len(cases),ticks=sum(c['native']['ticks'] for c in cases),firstTicks=cases[0]['native']['ticks'],firstEvents=cases[0]['native']['events'][:15])))


if __name__=='__main__':main()
