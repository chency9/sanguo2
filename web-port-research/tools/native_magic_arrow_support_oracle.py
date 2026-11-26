"""Execute ArrowSupport's original integer SO coroutine tree in pinned x86.

Actor queries, allocation, draw-node events, audio and camera are synthetic
world boundaries. Bytecode branching, calls, waits and RNG run unmodified.
This is a script/host differential fixture, not mixed-battle parity.
"""
import hashlib,json,math,shutil
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EIP, UC_X86_REG_ESP
from native_magic_rolltub_oracle import RollTubOracle
from native_magic_heal_oracle import CONTEXTS
from native_magic_shoot_oracle import BY_NAME, MODULE, CODE, STATICS
from native_ai_oracle import ROOT,SHA,STACK,STOP
from unicorn.x86_const import UC_X86_REG_ECX
OBJECTS={c['object']:c for c in json.loads((ROOT/'evidence/ai/native-arrow-object-host-vectors.json').read_text(encoding='utf8'))['cases']}


class ArrowSupportOracle(RollTubOracle):
    def __init__(self,spec):
        super().__init__(spec)
        # No source camera exists until the script actually calls host256.
        # All observed getter calls follow that first write.
        self.camera=None
        self.next_handle=3
        self.soldiers=[]
        for team in [0x4A8A60,0x4B03A0]:
            self.vm.put(team+0x58,spec.get('soldiers',0));self.vm.put(team+0x5C,spec.get('soldiers',0))
        for i in range(spec.get('soldiers',0)):
            h=100000+i
            self.objects[h]=dict(x=(spec.get('soldierX',3408)+i*96)*65536,
                y=(180+i%8*72)*65536,z=0,facing=0,alive=1,flags=0)
            self.soldiers.append(h)
            pointer=0x1000000+0x90000+i*16;self.vm.put(pointer+4,h)
            for team in [0x4A8A60,0x4B03A0]:
                self.vm.put(team+0xB4+i*72+0x2C,0);self.vm.put(team+0xB4+i*72+0x44,pointer)
        self.selection=0
        if spec.get('name') in ['ArrowCallback1','ArrowCallback2']:
            self.objects[3]=dict(x=spec['x']*65536,y=spec['y']*65536,z=0,
                facing=0,alive=1,object=16004,flags=0x3000000,callback=6001)
            self.objects[4]=dict(self.objects[2],facing=128,alive=1)
            self.next_handle=5
            self.vm.put(STATICS+8*8,spec.get('divisor',1))
        self.recorded_hosts.update({11,20,259,263,264,265,268,269,275,301})
        vm=self.vm
        for host,count in {11:0,20:4,259:1,263:1,264:1,265:1,268:1,275:2,301:0}.items():
            address=vm.u32(0x4A69B0+host*4)
            def boundary(cpu,address,size,_,h=host,n=count):
                sp=cpu.reg_read(UC_X86_REG_ESP);a=[vm.i32(sp+4+4*i) for i in range(n)]
                result=self.host(h,a)
                cpu.reg_write(UC_X86_REG_EAX,(result or 0)&0xffffffff)
                cpu.reg_write(UC_X86_REG_EIP,vm.u32(sp));cpu.reg_write(UC_X86_REG_ESP,sp+4)
            vm.cpu.hook_add(UC_HOOK_CODE,boundary,begin=address,end=address)
        # Host269 keeps its actual 0x43A7AC selection/RNG against a synthetic
        # native soldier list; there is no synthetic sequential selection.
        address=vm.u32(0x4A69B0+269*4)
        vm.cpu.hook_add(UC_HOOK_CODE,lambda cpu,a,n,_:self.events.append(dict(t=self.time,host=269,args=[vm.i32(cpu.reg_read(UC_X86_REG_ESP)+4)])),begin=address,end=address)

    def spawn_child(self,name,args):
        self.events.append(dict(t=self.time,child=name,args=args))
        count=BY_NAME[name]['arg_count_candidate']
        ctx=CONTEXTS+self.allocated*0x1000;self.allocated+=1;assert self.allocated<1024
        values=ctx+0x100;vm=self.vm
        for off,value in [(8,MODULE),(16,BY_NAME[name]['offset']),(20,count+1),(24,count+2),(28,values),(32,128)]:vm.put(ctx+off,value)
        for i,value in enumerate([*args[:count],0,0]):vm.put(values+8*i,value)
        self.contexts.append(dict(ptr=ctx,name=name))

    def host(self,h,a):
        if h in [11,20,259,263,264,265,268,275,301]:self.events.append(dict(t=self.time,host=h,args=a))
        if h==17:
            parent=self.objects[a[0]];handle=self.next_handle;self.next_handle+=1
            self.events.append(dict(t=self.time,host=h,args=a))
            self.objects[handle]=dict(x=parent['x'],y=parent['y'],z=parent['z']+a[3]*65536,
                facing=a[2],alive=1,object=a[1],born=self.time,frame=0,
                scaleX=65536,scaleY=65536,fade=16,fadeDuration=0,fadeAt=0,fadeInterval=1,
                shrink=0,vx=0,vy=0,vz=0,flags=OBJECTS.get(a[1],{}).get('flags',0) if self.spec.get('nativeObjects') else 0,callback=0,gravity=0)
            self.created.append(handle);return handle
        if h==20:
            o=self.objects[a[0]];o.update(x=a[1]*65536,y=a[2]*65536,z=a[3]*65536);return 0
        if h==784:
            self.events.append(dict(t=self.time,host=h,args=[self.decode(n) for n in a]))
            self.spawn_child(self.decode(a[0]),a[1:]);self.events.pop();return 0
        if h==11:return next((c.get('self',self.spec.get('objectSelf',1)) for c in self.contexts if c['ptr']==self.context),1)
        if h==263:return self.objects.get(a[0],{}).get('z',0)>>16
        if h==264:return math.trunc(a[0]/96)
        if h==265:return math.trunc(a[0]/72)
        if h==259:return a[0]*96+48
        if h==268:return len(self.soldiers)
        if h==275:return 1 if self.spec.get('occupied') and 0<=a[0]<71 and 0<=a[1]<14 else 0
        if h==301:return 71
        return super().host(h,a)

    def run(self,maximum=2400):
        for t in range(maximum):
            self.time=t;i=0
            while i<len(self.contexts):
                self.context=self.contexts[i]['ptr'];vm=self.vm;sp=STACK+0xF000;vm.put(sp,STOP)
                vm.cpu.reg_write(UC_X86_REG_ESP,sp);vm.cpu.reg_write(UC_X86_REG_ECX,self.context)
                vm.cpu.emu_start(0x467F10,STOP,count=2_000_000)
                assert vm.cpu.reg_read(UC_X86_REG_EIP)==STOP,(self.spec,t,hex(vm.cpu.reg_read(UC_X86_REG_EIP)))
                if vm.cpu.reg_read(UC_X86_REG_EAX)==0xffffffff:self.contexts.pop(i)
                else:i+=1
            for obj in self.objects.values():
                if 'born' not in obj or not obj['alive']:continue
                for axis in ['x','y','z']:obj[axis]=((obj[axis]+obj.get('v'+axis,0)+0x80000000)&0xffffffff)-0x80000000
                if obj['z']<0:obj['z']=0;obj['vz']=0
                elif obj['z']>0 and obj.get('gravity'):obj['vz']-=2*obj['gravity']
                obj['frame']+=1
                if obj['fadeDuration'] and t>obj['fadeAt'] and (t-obj['fadeAt'])%obj['fadeInterval']==0:obj['fade']=max(0,obj['fade']-16/obj['fadeDuration'])
                if obj['fadeDuration'] and obj['fade']==0:obj['alive']=0
                if self.spec.get('nativeObjects'):
                    evidence=OBJECTS.get(obj['object'])
                    if evidence:
                        for message in evidence['native']['messages']:
                            if obj['frame']==message['t']:
                                if message['event']==3:obj['alive']=0
                                elif message['event']==0x80000000:
                                    name={6003:'FlyArrowLU',6004:'FlyArrowRU'}[message['arg']]
                                    self.spawn_child(name,[]);self.events.pop()
                                    self.contexts[-1]['self']=next(h for h,p in self.objects.items() if p is obj)
                        if not evidence['native']['loop'] and obj['frame']>=sum(f['ticks'] for f in evidence['native']['frames']):obj['alive']=0
                        if obj.get('deathAt') is not None:
                            if t-obj['deathAt']>=next(e['t'] for e in evidence['deathNative']['messages'] if e['event']==3):obj['alive']=0
                        elif obj['flags']&0x400000 and obj['z']<=0:
                            obj['deathAt']=t
                            if evidence['deathNative']['messages'][0]['t']==0:obj['alive']=0
            if not self.contexts:return dict(ticks=t+1,events=self.events,rng=vm.rng(),objects=self.objects,divisor=vm.i32(STATICS+8*8))
        raise RuntimeError(f'ArrowSupport did not terminate {self.spec}')


def main():
    cases=[]
    for sequence,name in [(4,'Magic3'),(15,'Magic15'),(30,'Magic34'),(45,'Magic45'),(72,'Magic72'),(87,'Magic90')]:
        for side in [0,1]:
            for soldiers in [0,2,70]:
                for rng in [[1,2],[0x12345678,0x87654321]]:
                    spec=dict(sequence=sequence,name=name,side=side,x=1488,y=468,targetX=5328,rng=rng,soldiers=soldiers,nativeObjects=True)
                    cases.append(dict(input=spec,native=ArrowSupportOracle(spec).run(maximum=2400)))
            spec=dict(sequence=sequence,name=name,side=side,x=1488,y=468,targetX=5328,rng=[1,2],soldiers=2,nativeObjects=True,occupied=True)
            cases.append(dict(input=spec,native=ArrowSupportOracle(spec).run(maximum=2400)))
    callbacks=[]
    for name in ['ArrowCallback1','ArrowCallback2']:
        for target in [2,4]:
            for attack in [0,1,6]:
                for divisor in [0,1,2,8]:
                    spec=dict(name=name,side=1,x=3408,y=468,targetX=5000,rng=[1,2],args=[3,target],attack=attack,divisor=divisor)
                    callbacks.append(dict(input=spec,native=ArrowSupportOracle(spec).run(maximum=2000)))
    out=dict(exeSha256=SHA,scriptSha256=hashlib.sha256(CODE).hexdigest(),boundary=__doc__,cases=cases,callbacks=callbacks)
    path=ROOT/'evidence/ai/native-magic-arrow-support-vectors.json'
    path.write_text(json.dumps(out,separators=(',',':')),encoding='utf8')
    shutil.copyfile(path,ROOT.parent/'sango2-web/packages/core/fixtures'/path.name)
    print(json.dumps(dict(cases=len(cases),callbacks=len(callbacks),ticks=sum(c['native']['ticks'] for c in cases))))

if __name__=='__main__':main()
