"""Execute 0x43C20D and observe its original event dispatch, without replacing it.

The generic source event callback intentionally leaves the occupant in place.
These vectors verify eligibility and post-update occupancy checks. The chain
fixtures execute real 0x43DDBF/0x43D125 soldier updates with synthetic animation
definitions, strict-forward orders and suppressed attack searches. No game
function or RNG is replaced, and no OS shim is needed on these paths.
"""
import json, shutil, random
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP
from native_ai_oracle import Oracle, ROOT, HEAP, SHA

def one(o):
    vm=Oracle();mover,other,event=HEAP,HEAP+0x1000,HEAP+0x2000
    vm.put(mover+64,0x4A8A60);vm.put(0x4A79C4,o['tick'])
    vm.put(other+64,0x4A8A60 if o['ally'] else 0x4B03A0)
    vm.put(other+48,o['lastUpdate']);vm.put(other+44,o['flags']);vm.put(other+68,event)
    vm.put(event+76,0x422847)
    if o['occupied']:vm.put(0x4B3CA0+4*(71*6+35),other)
    messages=[]
    def observe(cpu,address,size,_):
        sp=cpu.reg_read(UC_X86_REG_ESP)
        messages.append([vm.u32(sp+8),vm.u32(sp+12)])
    vm.cpu.hook_add(UC_HOOK_CODE,observe,begin=0x422847,end=0x422847)
    result=vm.call(0x43C20D,mover,35,6)
    return dict(vacated=bool(result),messages=messages)

def chain(o):
    vm=Oracle();vm.set_rng(o['rng']);vm.put(0x4A79C4,17)
    team=0x4B03A0;vm.put(team+100,1);vm.put(team+152,1);vm.put(0x4A8A60+8,70)
    definition,resource,action=HEAP+0x12000,HEAP+0x13000,HEAP+0x14000
    vm.put(definition+4,3);vm.put(definition+40,resource);vm.put(action+4,100)
    for offset in [24,28,32,36,40,44,48]:vm.put(resource+offset,action)
    count=o['length'];dispatch=[]
    for i in range(count):
      unit=HEAP+256*i;event=HEAP+0x4000+256*i;x=35+i
      flags=2;last=16;clock=1;owner=team
      if i==count-1:
        if o['end']=='general':flags=1
        if o['end']=='guard':flags|=0x1000
        if o['end']=='updated':last=17
        if o['end']=='enemy':owner=0x4A8A60
        if o['end']=='waiting':clock=4
      for offset,value in [(8,x),(12,6),(16,x),(20,6),(28,1),(32,1),(44,flags),(48,last),(52,clock),(56,100),(64,owner),(68,event)]:vm.put(unit+offset,value)
      for offset,value in [(8,(96*x+48)<<16),(12,(72*6+36)<<16),(52,2),(76,0x43DDBF),(84,100),(120,action),(124,definition),(132,unit),(136,17)]:vm.put(event+offset,value)
      vm.put(0x4B3CA0+4*(71*6+x),unit)
    def observe(cpu,address,size,_):
      sp=cpu.reg_read(UC_X86_REG_ESP)
      if vm.u32(sp+8)==2:dispatch.append((vm.u32(sp+4)-(HEAP+0x4000))//256)
    vm.cpu.hook_add(UC_HOOK_CODE,observe,begin=0x43DDBF,end=0x43DDBF)
    vm.call(0x43C4C0,HEAP,1,0,0x48E730)
    units=[]
    for i in range(count):
      unit=HEAP+256*i;event=HEAP+0x4000+256*i
      units.append(dict(x=vm.i32(unit+8),y=vm.i32(unit+12),vx=vm.i32(event+20),vy=vm.i32(event+24),lastUpdate=vm.i32(unit+48)))
    return dict(units=units,dispatch=dispatch,rng=vm.rng())

def main():
    vectors=[]
    for occupied in [False,True]:
      for ally in [False,True]:
       for flags in [0,1,2,4,0x1000,0x1001,0x4000,0x2000]:
        for last in [16,17,18]:
         o=dict(occupied=occupied,ally=ally,flags=flags,tick=17,lastUpdate=last)
         vectors.append(dict(input=o,native=one(o)))
    chains=[];rng=random.Random(0x43C20D)
    for length in [2,3,6,10]:
      for end in ['clear','general','guard','updated','enemy','waiting']:
       for _ in range(3):
        o=dict(length=length,end=end,rng=[rng.getrandbits(32),rng.getrandbits(32)])
        chains.append(dict(input=o,native=chain(o)))
    path=ROOT/'evidence/ai/native-yield-vectors.json'
    path.write_text(json.dumps(dict(exeSha256=SHA,vectors=vectors,chains=chains),separators=(',',':')),encoding='utf8')
    shutil.copyfile(path,ROOT.parent/'sango2-web/packages/core/fixtures/native-yield-vectors.json')
    print(json.dumps(dict(vectors=len(vectors),chains=len(chains))))
if __name__=='__main__':main()
