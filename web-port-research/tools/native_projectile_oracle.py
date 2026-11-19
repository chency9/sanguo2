"""Execute original projectile creation/callback/flight against synthetic objects.

Real PAK durations and original helpers/RNG are used. Only GetTickCount is fixed
to zero; target damage notifications are observed at a data-only callback. Full
target damage/death is covered separately, not claimed by these local traces.
"""
import json,random,shutil,struct,sys,hashlib
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP
from native_ai_oracle import Oracle,ROOT,HEAP,STOP,SHA
sys.path.insert(0,str(ROOT.parent/'sango2-web/tools'))
from convert_assets import parse,rows
from native_animation import attack_frames

def definitions():
    pak=next((ROOT.parent/'game-original-105plus').glob('*/Sango2.PAK')).read_bytes()
    digest=hashlib.sha256(pak).hexdigest()
    assert digest=='4db9aa8d7ecaedc61b2826c63e4e130bffaae0f3c36c0c34b20bc76bb7bc47e6'
    _,count,offset=struct.unpack_from('<4sII',pak)
    for i in range(count):
        entry=pak[offset+64*i:offset+64*(i+1)]
        if entry[24:].split(b'\0')[0].upper()==b'THINGS.INI':
            size,pos=struct.unpack_from('<II',entry);objects=rows(parse(pak[pos:pos+size].decode('cp950')),'OBJECT');break
    result={}
    for obj in objects:
        if obj.get('SEQUENCE') not in ['500','501','502','503']:continue
        assert obj['FLAGS']=='OF_NOGRAVITY, OF_NONSYNCHRONISM, OF_BIGSHAPE'
        result[obj['SEQUENCE']]={key.lower():[f['ticks'] for f in attack_frames(obj[key],obj['DIRECTORY'],finite=False)] for key in ['WAIT','DEATH']}
        result[obj['SEQUENCE']]['life']=int(obj['LIFE'])
    vm=Oracle()
    return dict(exeSha256=SHA,pakSha256=digest,units=[vm.call(0x4065D1,1<<i) for i in range(13)],objects=result)

DATA=definitions()
PTR=HEAP+0x10000
def setup(o):
    vm=Oracle();vm.set_rng(o['rng'])
    vm.cpu.mem_write(STOP+0x100,b'\x31\xc0\xc3');vm.put(0x4D43E0,STOP+0x100)
    vm.cpu.mem_write(STOP+0x200,b'\xc3')
    vm.put(0x4A6614,HEAP+0x4000);vm.put(0x4BBCA0,4);vm.put(0x4C09C4,PTR);vm.put(PTR,0xffff)
    frames={}
    for i in range(4):
        d,r=HEAP+0x4000+44*i,HEAP+0x5000+256*i
        vm.put(d,500+i);vm.put(d+4,3);vm.put(d+24,0x30040);vm.put(d+28,2400);vm.put(d+32,0x43E28B);vm.put(d+40,r)
        for action,off in [('wait',24),('death',44)]:
            durations=DATA['objects'][str(500+i)][action];base=HEAP+0x6000+i*0x800+(0 if action=='wait' else 0x400)
            vm.put(r+off,base)
            for j,ticks in enumerate(durations):
                ptr=base+j*20;frames[ptr]=j;vm.put(ptr+4,ticks);vm.put(ptr+8,base+((j+1)%len(durations))*20)
    unit,event,team=HEAP,HEAP+0x1000,HEAP+0x2000
    vm.put(unit+28,1<<o['unit']);vm.put(unit+44,4 if o.get('reserve') else 2);vm.put(unit+64,team);vm.put(unit+68,event)
    vm.put(team+112,o.get('power',150))
    for off,key in [(8,'x'),(12,'y'),(16,'z'),(44,'facing')]:vm.put(event+off,o[key])
    vm.call(0x43D5BF,unit)
    return vm,frames

def state(vm,frames):
    p=PTR
    return dict(**{key:vm.i32(p+off) for key,off in [('x',8),('y',12),('z',16),('vx',20),('vy',24),('vz',28),('life',40),('facing',44),('flags',48),('remaining',84),('fade',144)]},
        object=vm.u32(vm.u32(p+124)),phase='flight' if not vm.u32(p+140) else 'deflected' if vm.u32(p+52)==32 else 'hit',
        frame=frames[vm.u32(p+120)],alive=vm.u32(p)==4660)

def run(o):
    vm,frames=setup(o);initial=state(vm,frames);messages=[]
    def observed(cpu,address,size,_):
        sp=cpu.reg_read(UC_X86_REG_ESP);messages.append(vm.u32(sp+8))
    vm.cpu.hook_add(UC_HOOK_CODE,observed,begin=STOP+0x200,end=STOP+0x200)
    if o.get('impact') is not None:vm.call(0x43E28B,PTR,65539,o['impact'])
    if 'life' in o:vm.put(PTR+40,o['life'])
    if 'cell' in o:
        target,target_event,team,general=HEAP+0x20000,HEAP+0x21000,HEAP+0x22000,HEAP+0x23000
        x,y=o['cell'];vm.put(0x4B3CA0+4*(y*71+x),HEAP if o['occupant']=='self' else target)
        vm.put(target+64,HEAP+0x2000 if o['occupant']=='ally' else team);vm.put(target+68,target_event);vm.put(target_event+76,STOP+0x200)
        vm.put(target+44,1 if o.get('general') else 2);vm.put(team+72,general);vm.put(general+52,o.get('strength',80),True)
        for off,value in [(8,x),(12,y),(16,x if o.get('settled',True) else x+1),(20,y)]:vm.put(target+off,value)
    trace=[dict(state=state(vm,frames),rng=vm.rng(),messages=list(messages))]
    for _ in range(o['updates']):
        vm.call(0x43E28B,PTR,2,0);trace.append(dict(state=state(vm,frames),rng=vm.rng(),messages=list(messages)))
        if not trace[-1]['state']['alive']:break
    return dict(initial=initial,trace=trace)

def main():
    rand=random.Random(0x43E28B);cases=[]
    for i in range(240):
        facing=0 if i%2==0 else 0x800000
        o=dict(unit=[3,4,5,11][(i//2)%4],x=(35*96+48)*65536+rand.randrange(65536),y=(6*72+36)*65536+rand.randrange(65536),z=0,facing=facing,
            rng=[rand.getrandbits(32),rand.getrandbits(32)],updates=rand.randrange(8,34))
        if i<80:o['impact']=(i//8)%2
        elif i<200:
            o.update(cell=[35+(1 if facing==0 else -1),6],occupant=['ally','enemy','self'][i%3],reserve=bool(i&2),power=[0,100,300][(i//3)%3],general=bool(i&4),strength=100,settled=bool(i&8))
        else:o['life']=i%12+1
        cases.append(dict(input=o,native=run(o)))
    result=dict(**DATA,cases=cases)
    path=ROOT/'evidence/ai/native-projectile-vectors.json';path.write_text(json.dumps(result,separators=(',',':')),encoding='utf8')
    shutil.copyfile(path,ROOT.parent/'sango2-web/packages/core/fixtures/native-projectile-vectors.json')
    (ROOT.parent/'sango2-web/packages/core/src/native-projectile-types.json').write_text(json.dumps(DATA,separators=(',',':')),encoding='utf8')
    print(json.dumps(dict(cases=len(cases),updates=sum(len(v['native']['trace'])-1 for v in cases))))
if __name__=='__main__':main()
