"""Read ArrowSupport original PAK defines and run original draw-node parser.

INI retrieval and shape handles are synthetic inputs. Tokenization, # timing,
!script / @event assignment and node stepping execute original executable.
"""
import hashlib,json,re,shutil,struct
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP,UC_X86_REG_EAX,UC_X86_REG_EIP
from native_ai_oracle import Oracle,ROOT,HEAP,SHA,STACK,STOP

def parse(text):
    records=[]
    for line in text.splitlines():
        line=line.strip()
        if not line or line.startswith((';','//')):continue
        if line.startswith('['):records.append(dict(kind=re.sub(r'\d+$','',line[1:line.index(']')]).upper(),entries={}))
        elif '=' in line and records:
            k,v=line.split('=',1);records[-1]['entries'][k.strip().upper()]=v.strip()
    return records

def rows(records,kind):return [r['entries'] for r in records if r['kind']==kind]
def number(v):
    try:return int(v)
    except (ValueError,TypeError):return 0

def trace(text,directory):
    vm=Oracle();vm.put(0x4A7B40,HEAP+0x20000);vm.put(0x4D2778,0)
    vm.cpu.mem_write(0x4BBBA0,(directory.rstrip('\\')+'\\').encode('ascii')+b'\0')
    vm.put(0x4D267C,HEAP+0x1f000);vm.cpu.mem_write(HEAP+0x1f000,b'SHAPE\\\0')
    shapes={};paths={};messages=[];at=0
    def cstr(addr):
        out=bytearray()
        while vm.cpu.mem_read(addr+len(out),1)!=b'\0':out+=vm.cpu.mem_read(addr+len(out),1)
        return out.decode('ascii')
    def boundary(cpu,address,size,_):
        sp=cpu.reg_read(UC_X86_REG_ESP);result=0
        if address==0x455662:vm.cpu.mem_write(vm.u32(sp+16),text.encode('ascii')+b'\0')
        elif address==0x455513:
            key=cstr(vm.u32(sp+8));assert key.upper()=='DEFINE\\OM_REMOVE',key
            vm.cpu.mem_write(vm.u32(sp+16),b'3\0')
        elif address==0x46A930:
            path=cstr(vm.u32(sp+4)).upper();result=shapes.setdefault(path,HEAP+0x10000+len(shapes)*64);paths[result]=path
        cpu.reg_write(UC_X86_REG_EAX,result);cpu.reg_write(UC_X86_REG_EIP,vm.u32(sp));cpu.reg_write(UC_X86_REG_ESP,sp+4)
    for addr in [0x455662,0x455513,0x46A930]:vm.cpu.hook_add(UC_HOOK_CODE,boundary,begin=addr,end=addr)
    first=vm.call(0x436B9A,HEAP,HEAP);nodes=[];ptr=first
    while ptr and ptr not in [f['ptr'] for f in nodes]:
        nodes.append(dict(ptr=ptr,key=paths.get(vm.u32(ptr),'NULSHAPE'),ticks=vm.i32(ptr+4),message=vm.u32(ptr+16)));ptr=vm.u32(ptr+8)
    loop=bool(ptr);event,definition,resource=HEAP+0x1000,HEAP+0x2000,HEAP+0x3000
    vm.put(definition+4,3);vm.put(definition+40,resource);vm.put(resource+24,first)
    vm.put(event+124,definition);vm.put(event+76,0x422847)
    def observe(cpu,address,size,_):
        sp=cpu.reg_read(UC_X86_REG_ESP);messages.append(dict(t=at,event=vm.u32(sp+8),arg=vm.u32(sp+12)))
        # Observe script construction/removal at the object event boundary;
        # this probe measures node entry, not the SO allocation subsystem.
        cpu.reg_write(UC_X86_REG_EAX,0);cpu.reg_write(UC_X86_REG_EIP,vm.u32(sp));cpu.reg_write(UC_X86_REG_ESP,sp+4)
    vm.cpu.hook_add(UC_HOOK_CODE,observe,begin=0x422847,end=0x422847)
    vm.call(0x421E1B,event,1)
    frames={f['ptr']:i for i,f in enumerate(nodes)};frames_trace=[frames[vm.u32(event+120)]]
    for at in range(1,min(1200,sum(f['ticks'] for f in nodes)+1)):
        sp=STACK+0xF000;vm.put(sp,STOP);vm.put(sp+4,event);vm.cpu.reg_write(UC_X86_REG_ESP,sp)
        vm.cpu.emu_start(0x421BF2,STOP,count=200000);assert vm.cpu.reg_read(UC_X86_REG_EIP)==STOP
        result=vm.cpu.reg_read(UC_X86_REG_EAX)
        if result==0xffffffff:break
        frames_trace.append(frames[vm.u32(event+120)])
    return dict(frames=[{k:v for k,v in f.items() if k!='ptr'} for f in nodes],loop=loop,messages=messages,trace=frames_trace,ticks=at)

def collision(spec):
    from native_magic_round_host_oracle import records,intercept
    vm=Oracle();parent,target,effect=records(vm)
    unit,other,team,enemy,frame=[HEAP+n for n in [0x20000,0x21000,0x22000,0x23000,0x24000]]
    vm.put(parent+132,unit);vm.put(unit+44,1);vm.put(unit+64,team)
    vm.put(effect+116,1);vm.put(effect+120,frame);vm.put(frame+4,9999);vm.put(effect+84,9999)
    vm.put(effect+48,spec['flags']);vm.put(effect+52,spec['action'])
    vm.put(effect+8,(21*96+48)*65536);vm.put(effect+12,(6*72+36)*65536);vm.put(effect+16,spec['z']);vm.put(effect+152,6001)
    vm.put(0x4C2C04,effect);vm.put(0x4C0BE0,effect);vm.put(0x4C09C0,1)
    vm.put(other+44,1 if spec['general'] else 2);vm.put(other+64,team if spec['ally'] else enemy);vm.put(other+68,target)
    if spec['occupied']:vm.put(0x4B3CA0+4*(6*71+21),other)
    vm.put(target+76,STOP+0x200);vm.cpu.mem_write(STOP+0x200,b'\xc3');events=[];actions=[]
    vm.cpu.hook_add(UC_HOOK_CODE,lambda c,a,n,_:events.append(vm.u32(c.reg_read(UC_X86_REG_ESP)+8)),begin=STOP+0x200,end=STOP+0x200)
    intercept(vm,0x41F740,lambda sp:1)
    intercept(vm,0x421E1B,lambda sp:actions.append(vm.u32(sp+8)) or 0)
    vm.call(0x40A8CC,effect)
    return dict(z=vm.i32(effect+16),events=events,actions=actions,rng=vm.rng())

def selection(spec):
    vm=Oracle();vm.set_rng(spec['rng']);team=0x4A8A60
    vm.put(team+0x58,len(spec['slots']));vm.put(team+0x5C,sum(h!=0 for h in spec['slots']))
    for i,h in enumerate(spec['slots']):
        unit=team+0xB4+i*72;vm.put(unit+0x2C,0 if h else 0x2000)
        if h:ptr=HEAP+0x10000+i*16;vm.put(ptr+4,h);vm.put(unit+0x44,ptr)
    chosen=[vm.call(0x43A7AC,0) for _ in range(20)]
    return dict(handles=chosen,rng=vm.rng())

def main():
    pak=next((ROOT.parent/'game-original-105plus').glob('*/Sango2.PAK')).read_bytes();_,count,offset=struct.unpack_from('<4sII',pak)
    for i in range(count):
        e=pak[offset+i*64:offset+(i+1)*64]
        if e[24:].split(b'\0')[0].upper()==b'THINGS.INI':size,pos=struct.unpack_from('<II',e);break
    records=parse(pak[pos:pos+size].decode('cp950'));define=rows(records,'DEFINE')[0]
    defs={k:int(v,0) for k,v in define.items() if k.startswith('OF_')};cases=[]
    for obj in rows(records,'OBJECT'):
        seq=number(obj.get('SEQUENCE'))
        if not(16001<=seq<=16018 or seq==10015):continue
        flags=0
        for key in obj['FLAGS'].replace('+',',').split(','):
            flags|=defs.get(key.strip(),0)
        result=dict(object=seq,flags=flags,text=obj['WAIT'],directory=obj['DIRECTORY'],native=trace(obj['WAIT'],obj['DIRECTORY']))
        if obj.get('DEATH'):result.update(deathText=obj['DEATH'],deathNative=trace(obj['DEATH'],obj['DIRECTORY']))
        cases.append(result)
    collisions=[]
    for flags in [0x3410000,0x490000,0x10000]:
        for z in [-65536,0,1,95*65536,96*65536]:
            for action in [0,32]:
                for general in [False,True]:
                    for ally in [False,True]:
                        for occupied in [False,True]:
                            spec=dict(flags=flags,z=z,action=action,general=general,ally=ally,occupied=occupied)
                            collisions.append(dict(input=spec,native=collision(spec)))
    selections=[]
    for slots in [[],[100000],[0,100000,0,100002,100003],[100000+i for i in range(200)]]:
        for rng in [[1,2],[0x12345678,0x87654321]]:
            spec=dict(slots=slots,rng=rng);selections.append(dict(input=spec,native=selection(spec)))
    out=dict(exeSha256=SHA,pakSha256=hashlib.sha256(pak).hexdigest(),boundary=__doc__,defines=defs,cases=cases,collisions=collisions,selections=selections)
    p=ROOT/'evidence/ai/native-arrow-object-host-vectors.json';p.write_text(json.dumps(out,separators=(',',':')),encoding='utf8')
    shutil.copyfile(p,ROOT.parent/'sango2-web/packages/core/fixtures'/p.name)
    print(json.dumps([dict(object=c['object'],flags=hex(c['flags']),ticks=c['native']['ticks'],nodes=[n['ticks'] for n in c['native']['frames']],messages=c['native']['messages']) for c in cases]))

if __name__=='__main__':main()
