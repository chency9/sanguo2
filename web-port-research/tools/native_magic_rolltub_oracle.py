"""Run RollTub, creation children and collision callbacks in the pinned x86 VM.

The SO integer instructions, calls, waits, named-child list and RNG run in the
original executable. Object allocation, graphics/audio, camera and the external
general query are synthetic world boundaries. Object motion follows the known
fixed-point host equations, outside the VM; this is not a mixed battle replay.
"""
import hashlib
import json
import math
import shutil

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EIP, UC_X86_REG_ESP
from native_ai_oracle import ROOT, SHA
from native_magic_explode_oracle import ExplodeOracle
from native_magic_shoot_oracle import CODE, CTX, VALUES, STATICS


class RollTubOracle(ExplodeOracle):
    def __init__(self, spec):
        super().__init__(spec)
        self.camera = [0, 0]
        self.recorded_hosts.update({16, 24, 27, 29, 38, 39, 273, 274, 297, 307})
        self.vm.put(STATICS+52*8, spec.get('generalHit', 0))
        if spec.get('args'):
            for i, value in enumerate([*spec['args'], 0, 0]):
                self.vm.put(VALUES+i*8, value)
            self.vm.put(CTX+20, len(spec['args'])+1)
            self.vm.put(CTX+24, len(spec['args'])+2)
        if spec.get('name') == 'RollTubCallback':
            self.objects[3] = dict(x=spec['x']*65536, y=spec['y']*65536, z=0,
                                   facing=0, alive=1, flags=0x3000000, object=49001)
            self.objects[4] = dict(self.objects[2], facing=128, alive=1, flags=0x3000000, object=49001)
            for handle in spec.get('extraSources', []):
                self.objects[handle] = dict(self.objects[3])
        for h, count in [(16, 5), (273, 0), (274, 0), (297, 1), (307, 0)]:
            address = self.vm.u32(0x4A69B0+h*4)

            def boundary(cpu, address, size, _, h=h, count=count):
                sp = cpu.reg_read(UC_X86_REG_ESP)
                values = [self.vm.i32(sp+4+4*i) for i in range(count)]
                result = self.host(h, values)
                cpu.reg_write(UC_X86_REG_EAX, (result or 0) & 0xffffffff)
                cpu.reg_write(UC_X86_REG_EIP, self.vm.u32(sp))
                cpu.reg_write(UC_X86_REG_ESP, sp+4)

            self.vm.cpu.hook_add(UC_HOOK_CODE, boundary, begin=address, end=address)

    def host(self, h, a):
        if h == 16:
            self.events.append(dict(t=self.time, host=h, args=a))
            handle = len(self.objects)+1
            self.objects[handle] = dict(x=a[0]*65536, y=a[1]*65536, z=a[2]*65536,
                facing=a[3], alive=1, object=a[4], born=self.time, frame=0,
                scaleX=65536, scaleY=65536, fade=16, fadeDuration=0, fadeAt=0,
                fadeInterval=1, shrink=0, vx=0, vy=0, vz=0, flags=0, callback=0, gravity=0)
            self.created.append(handle)
            return handle
        result = super().host(h, a)
        obj = self.objects.get(a[0]) if a else None
        if h == 17:
            obj = self.objects[result]
            obj.update(vx=0, vy=0, vz=0, gravity=0)
        elif h == 24:
            angle, elevation = a[1]*3.1415926/128, a[2]*3.1415926/128
            obj.update(vx=math.trunc(math.cos(angle)*math.cos(elevation)*a[3]*65536),
                       vy=math.trunc(math.sin(angle)*math.cos(elevation)*a[3]*65536),
                       vz=math.trunc(math.sin(elevation)*a[3]*65536))
        elif h == 29:
            obj['gravity'] = a[1]
        elif h == 38:
            obj['flags'] |= 0x40000
        elif h == 256:
            self.camera = list(a)
        elif h == 273:
            return self.camera[0]
        elif h == 274:
            return self.camera[1]
        elif h == 297:
            return 2 if self.spec.get('targetExists', True) else 0
        elif h == 307:
            return 1008
        return result

    def run(self, maximum=1600):
        from native_ai_oracle import STACK, STOP
        from unicorn.x86_const import UC_X86_REG_ECX
        trace = []
        for t in range(maximum):
            self.time=t; i=0
            for pending in self.spec.get('callbackSchedule', []):
                if pending['t'] == t:
                    # An external collision invokes this callback, rather than
                    # a SO child instruction; retain allocation but no child event.
                    self.spawn_child('RollTubCallback', pending['args'])
                    self.events.pop()
            while i<len(self.contexts):
                self.context=self.contexts[i]['ptr'];vm=self.vm;sp=STACK+0xF000;vm.put(sp,STOP)
                vm.cpu.reg_write(UC_X86_REG_ESP,sp);vm.cpu.reg_write(UC_X86_REG_ECX,self.context)
                vm.cpu.emu_start(0x467F10,STOP,count=200000)
                assert vm.cpu.reg_read(UC_X86_REG_EIP)==STOP
                if vm.cpu.reg_read(UC_X86_REG_EAX)==0xffffffff:self.contexts.pop(i)
                else:i+=1
            for obj in self.objects.values():
                if 'born' not in obj or not obj['alive']:continue
                for axis in ['x','y','z']:
                    obj[axis] = ((obj[axis]+obj.get('v'+axis,0)+0x80000000)&0xffffffff)-0x80000000
                if obj['z']<0:obj['z']=0;obj['vz']=0
                elif obj['z']>0 and obj.get('gravity'):obj['vz']-=2*obj['gravity']
                obj['frame']+=1
                if obj['fadeDuration'] and t>obj['fadeAt'] and (t-obj['fadeAt'])%obj['fadeInterval']==0:
                    obj['fade']=max(0,obj['fade']-16/obj['fadeDuration'])
                # Setting alpha to zero is the opening fade-in, not removal.
                # 0x40A8CC removes at zero only while a fade-out is active.
                if obj['fadeDuration'] and obj['fade']==0:obj['alive']=0
            trace.append([*vm.rng(),len(self.contexts),*self.camera])
            if not self.contexts:
                return dict(ticks=t+1,events=self.events,rng=vm.rng(),trace=trace,
                            objects=self.objects,generalHit=vm.i32(STATICS+52*8))
        raise RuntimeError(f'RollTub tree did not terminate: {self.spec}')


def main():
    cases=[]
    for sequence,name in [(6,'Magic6'),(20,'Magic18'),(35,'Magic35')]:
        for side in [0,1]:
            for target in [48,3408,6768]:
                for rng in [[1,2],[0x12345678,0x87654321]]:
                    spec=dict(sequence=sequence,name=name,side=side,x=1488,y=468,
                              targetX=target,rng=rng)
                    cases.append(dict(input=spec,native=RollTubOracle(spec).run()))
    callbacks=[]
    for target in [2,4]:
        for attack in [0,1,5,20]:
            for general_hit in [0,1]:
                spec=dict(name='RollTubCallback',side=1,x=3408,y=468,targetX=5000,
                          rng=[1,2],args=[3,target],attack=attack,generalHit=general_hit)
                callbacks.append(dict(input=spec,native=RollTubOracle(spec).run()))
    concurrent=[]
    for rng in [[1,2],[0x12345678,0x87654321]]:
        spec=dict(name='RollTubCallback',side=1,x=3408,y=468,targetX=5000,
                  rng=rng,args=[3,2],attack=20,extraSources=[5,6],
                  callbackSchedule=[dict(t=t,args=[source,2]) for t,source in [(1,4),(2,5),(21,6)]])
        concurrent.append(dict(input=spec,native=RollTubOracle(spec).run()))
    reentrant=[]
    for rng in [[1,2],[0x12345678,0x87654321]]:
        spec=dict(name='RollTubCallback',side=1,x=3408,y=468,targetX=5000,
                  rng=rng,args=[3,2],attack=20,
                  callbackSchedule=[dict(t=1,args=[3,2])])
        reentrant.append(dict(input=spec,native=RollTubOracle(spec).run()))
    out=dict(exeSha256=SHA,scriptSha256=hashlib.sha256(CODE).hexdigest(),boundary=__doc__,
             cases=cases,callbacks=callbacks,concurrent=concurrent,reentrant=reentrant)
    path=ROOT/'evidence/ai/native-magic-rolltub-vectors.json'
    path.write_text(json.dumps(out,separators=(',',':')),encoding='utf8')
    shutil.copyfile(path,ROOT.parent/'sango2-web/packages/core/fixtures'/path.name)
    print(json.dumps(dict(cases=len(cases),callbacks=len(callbacks),concurrent=len(concurrent),reentrant=len(reentrant),
                         ticks=sum(c['native']['ticks'] for c in cases),first=cases[0]['native']['events'][:20])))


if __name__=='__main__':main()
