"""Original decision clock, deferred callback and target search on synthetic memory.
No game function/RNG replacement or OS shims. See fixture metadata for boundaries.
"""
import json,random,shutil,struct
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP
from native_ai_oracle import Oracle,ROOT,HEAP,SHA,PE

def clock(o):
    vm=Oracle();unit,event=HEAP,HEAP+0x1000
    vm.put(unit+52,o['decision']);vm.put(unit+60,o['deferred']);vm.put(unit+44,(1 if o['general'] else 2)|(0x4000 if o['retreat'] else 0))
    vm.put(unit+64,0x4A8A60);vm.put(unit+68,event if o['event'] else 0)
    vm.put(event+132,unit);vm.put(event+76,0x43DDBF);vm.put(event+52,1)
    for team,general,speed in [(0x4A8A60,HEAP+0x2000,o['speed']),(0x4B03A0,HEAP+0x3000,o['enemySpeed'])]:
      # Enemy team is itself the general unit consumed by 0x4429FD.
      vm.put(team+64,team);vm.put(team+72,general);vm.put(general+64,speed,True)
    ready=vm.call(0x43B574,unit)
    return dict(ready=bool(ready),decision=vm.i32(unit+52),deferred=vm.i32(unit+60))

def search(o):
    vm=Oracle();vm.set_rng(o['rng']);unit,event=HEAP,HEAP+0x1000
    for offset,value in [(8,o['x']),(12,o['y']),(28,1<<o['unit']),(44,(1 if o['general'] else 2)|(4 if o['reserve'] else 0)|(0x4000 if o['retreat'] else 0)),(56,o['attack']),(64,0x4A8A60),(68,event)]:vm.put(unit+offset,value)
    vm.put(event+44,o['facing'])
    for i,c in enumerate(o['occupied']):
      ptr=HEAP+0x2000+128*i;vm.put(ptr+44,0x2000 if c['dead'] else 2);vm.put(ptr+64,0x4A8A60 if c['ally'] else 0x4B03A0)
      vm.put(0x4B3CA0+4*(71*c['y']+c['x']),ptr)
    distance=vm.call(0x43BCA7,unit)
    return dict(distance=distance if distance<0x80000000 else distance-0x100000000,attack=vm.i32(unit+56),rng=vm.rng())

def attack_decision(o):
    vm=Oracle();vm.set_rng(o['rng']);unit,event,other=HEAP,HEAP+0x1000,HEAP+0x2000
    definition,resource,action=HEAP+0x3000,HEAP+0x4000,HEAP+0x5000
    vm.put(definition+4,3);vm.put(definition+40,resource);vm.put(action+4,100)
    for offset in [24,28,32,36,40,44,48]:vm.put(resource+offset,action)
    for offset,value in [(8,35),(12,6),(28,1<<o['unit']),(44,2|(4 if o['reserve'] else 0)|(0x4000 if o['retreat'] else 0)),(52,1),(56,0),(64,0x4A8A60),(68,event)]:vm.put(unit+offset,value)
    for offset,value in [(8,(96*35+48)<<16),(12,(72*6+36)<<16),(44,o['facing']),(52,1),(76,0x43DDBF),(84,100),(120,action),(124,definition),(132,unit),(136,17)]:vm.put(event+offset,value)
    vm.put(0x4A79C4,17);vm.put(0x4B3CA0+4*(71*6+35),unit)
    if o['distance']:
      vm.put(other+44,2);vm.put(other+64,0x4B03A0);vm.put(0x4B3CA0+4*(71*6+35+o['distance']),other)
    messages=[]
    def observe(cpu,address,size,_):
      sp=cpu.reg_read(UC_X86_REG_ESP)
      if vm.u32(sp+8)==65543:
        value=vm.u32(sp+12);distance=value>>16
        messages.append(dict(distance=distance if distance<0x8000 else distance-0x10000,special=bool(value&0xffff)))
    vm.cpu.hook_add(UC_HOOK_CODE,observe,begin=0x43DDBF,end=0x43DDBF)
    vm.call(0x43D125,event)
    return dict(messages=messages,decision=vm.i32(unit+52),attack=vm.i32(unit+56),rng=vm.rng())

def main():
    r=random.Random(0x43B574);clocks=[];searches=[];cooldowns=[]
    for i in range(240):
      o=dict(decision=r.choice([-1,0,1,2,39,40,46]),deferred=r.choice([0,0,0,1,7,40]),general=bool(i%2),retreat=bool(i%3),event=i%7!=0,speed=r.randrange(0,101),enemySpeed=r.randrange(0,101))
      clocks.append(dict(input=o,native=clock(o)))
    for i in range(390):
      x=r.choice([0,1,35,69,70]);y=r.randrange(14)
      occupied=[dict(x=col,y=y,ally=bool(r.randrange(2)),dead=r.randrange(4)==0) for col in range(max(0,x-10),min(71,x+11)) if col!=x and r.randrange(3)==0]
      o=dict(x=x,y=y,unit=i%13,general=i%11==0,reserve=bool(i%2),retreat=bool(i%3==0),facing=0 if i%2 else 0x800000,attack=r.choice([-2,0,1,2,5]),occupied=occupied,rng=[r.getrandbits(32),r.getrandbits(32)])
      searches.append(dict(input=o,native=search(o)))
    vm=Oracle()
    for unit in range(13):
      for reserve in [False,True]:
        for special in [False,True]:
          o=dict(unit=unit,reserve=reserve,special=special)
          cooldowns.append(dict(input=o,native=vm.call(0x406717,1<<unit,int(reserve),int(special))))
    decisions=[]
    for i in range(312):
      o=dict(unit=i%13,reserve=bool(i%2),retreat=i%3==0,facing=0 if i%5 else 0x800000,distance=r.choice([-5,-2,-1,0,1,2,5]),rng=[r.getrandbits(32),r.getrandbits(32)])
      decisions.append(dict(input=o,native=attack_decision(o)))
    table=[list(struct.unpack('<4i',PE.get_data(0x4862d8-0x400000+56*i,16))) for i in range(13)]
    path=ROOT/'evidence/ai/native-unit-clock-vectors.json'
    path.write_text(json.dumps(dict(exeSha256=SHA,clocks=clocks,searches=searches,cooldowns=cooldowns,decisions=decisions),separators=(',',':')),encoding='utf8')
    shutil.copyfile(path,ROOT.parent/'sango2-web/packages/core/fixtures/native-unit-clock-vectors.json')
    (ROOT.parent/'sango2-web/packages/core/src/native-attack-cooldowns.json').write_text(json.dumps(table),encoding='utf8')
    print(json.dumps(dict(clocks=len(clocks),searches=len(searches),cooldowns=len(cooldowns),decisions=len(decisions))))
if __name__=='__main__':main()
