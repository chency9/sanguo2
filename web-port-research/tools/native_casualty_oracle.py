"""Run original casualty setup, movement and grid counting on synthetic memory.

No gameplay/RNG helper is intercepted. GetTickCount is the only OS shim (fixed
zero); synthetic object definitions use original callbacks and action pointers.
This checks local call boundaries, not the game's complete object scheduler.
"""
import json
import random
import shutil
import struct
from native_ai_oracle import Oracle, ROOT, HEAP, STOP, SHA


def setup_objects(vm):
    # GetTickCount's return value only stamps object creation time.
    vm.cpu.mem_write(STOP+0x100, b'\x31\xc0\xc3')
    vm.put(0x4D43E0, STOP+0x100)
    definition, resource, action, free = [HEAP+n for n in [0x4000,0x5000,0x6000,0x7000]]
    ids=[10]+list(range(180,186))+list(range(190,196))
    vm.put(0x4A6614,definition);vm.put(0x4BBCA0,len(ids))
    for i, obj in enumerate(ids):
        ptr=definition+44*i
        vm.put(ptr,obj);vm.put(ptr+4,1 if obj==10 else 3)
        vm.put(ptr+32,0x43A003 if obj==10 else 0x43E1C7)
        vm.put(ptr+40,resource+i*0x100)
        vm.put(resource+i*0x100+(0 if obj==10 else 24),action)
        if obj!=10:vm.put(resource+i*0x100+28,action)
    vm.put(action+4,12)
    vm.put(0x4C09C4,free);vm.put(free,0xffff)
    return free


def casualty(o):
    vm=Oracle();vm.set_rng(o['rng']);detached=setup_objects(vm)
    unit,event,attacker=HEAP,HEAP+0x1000,HEAP+0x2000
    team=0x4B03A0 if o['enemy'] else 0x4A8A60
    vm.put(unit+8,o['cellX']);vm.put(unit+12,o['cellY'])
    vm.put(unit+28,1<<o['unit']);vm.put(unit+44,1 if o['general'] else 4 if o['reserve'] else 2)
    vm.put(unit+64,team);vm.put(unit+68,event);vm.put(team+92,200)
    for offset,key in [(8,'x'),(12,'y'),(16,'z')]:vm.put(event+offset,o[key])
    vm.put(event+132,unit);vm.put(attacker+8,o['attackerX'])
    if not o['general']:vm.call(0x43DB0D,unit)
    before_flight=vm.rng()
    horse=None
    if vm.u32(detached)==4660:
        horse=dict(object=vm.u32(vm.u32(detached+124)),facing=vm.i32(detached+136),heading=vm.i32(detached+140),life=vm.u32(detached+40))
    vm.call(0x43DC56,event,attacker if o['hasAttacker'] else 0)
    return dict(rngBeforeFlight=before_flight,rng=vm.rng(),detached=horse,
                flight={k:vm.i32(event+off) for k,off in [('x',8),('y',12),('z',16),('vx',20),('vy',24),('vz',28),('facing',44)]},
                troops=vm.u32(team+92),flags=vm.u32(unit+44))


def main():
    randomizer=random.Random(0x43DC56);deaths=[]
    for i in range(416):
        cx=randomizer.randrange(71);cy=6 if i%3==0 else randomizer.randrange(14)
        o=dict(unit=i%13,reserve=bool(i&1),general=i%17==0,enemy=bool(i&2),cellX=cx,cellY=cy,
               x=((cx*96+48)<<16)+randomizer.randrange(-130,131)*65536,
               y=((cy*72+36)<<16)+randomizer.randrange(-100,101)*65536,z=randomizer.randrange(60)*65536,
               hasAttacker=i%5!=0,attackerX=(cx*96+randomizer.randrange(-100,101))*65536,
               rng=[randomizer.getrandbits(32),randomizer.getrandbits(32)])
        deaths.append(dict(input=o,native=casualty(o)))
    movement=[];vm=Oracle()
    for i in range(128):
        o=dict(x=randomizer.randrange(6000)*65536,y=randomizer.randrange(1000)*65536,
               z=randomizer.randrange(-2,90)*65536,vx=randomizer.randrange(-100000,100001),
               vy=randomizer.randrange(-80000,80001),vz=randomizer.randrange(-300000,300001),
               flags=0x10000 if i%3==0 else 0,action=8 if i%7==0 else 32,updates=i%25+1)
        for key,off in [('x',8),('y',12),('z',16),('vx',20),('vy',24),('vz',28),('flags',48),('action',52)]:vm.put(HEAP+off,o[key])
        for _ in range(o['updates']):vm.call(0x43CD48,HEAP)
        movement.append(dict(input=o,native={key:vm.i32(HEAP+off) for key,off in [('x',8),('y',12),('z',16),('vx',20),('vy',24),('vz',28)]}))
    grid=[];vm=Oracle()
    for i in range(200):
        vm.cpu.mem_write(0x4B3CA0,bytes(71*14*4));cells=[]
        for j in range(60):
            x,y=randomizer.randrange(71),randomizer.randrange(14);side=randomizer.randrange(2);ptr=HEAP+j*128
            vm.put(ptr+64,0x4B03A0 if side else 0x4A8A60);vm.put(0x4B3CA0+4*(y*71+x),ptr)
            cells.append(dict(x=x,y=y,side=side))
        rect=[randomizer.randrange(-4,75),randomizer.randrange(-3,17),randomizer.randrange(-4,75),randomizer.randrange(-3,17)]
        side=i%2;count=vm.call(0x402920,0x4B03A0 if side else 0x4A8A60,*[v&0xffffffff for v in rect])
        grid.append(dict(input=dict(cells=cells,side=side,rect=rect),native=count))
    walking=[];vm=Oracle();ptr=setup_objects(vm)
    for i in range(104):
        heading=randomizer.randrange(-0x100000,0x900001);rng=[randomizer.getrandbits(32),randomizer.getrandbits(32)]
        vm.put(ptr+124,HEAP+0x4000+44);vm.put(ptr+136,0 if i%2 else 0x800000);vm.put(ptr+140,heading);vm.set_rng(rng)
        vm.call(0x43E1C7,ptr,65537,0)
        walking.append(dict(input=dict(heading=heading,rng=rng),native=dict(vx=vm.i32(ptr+20),vy=vm.i32(ptr+24),rng=vm.rng())))
    lookup=Oracle();types=[]
    for i in range(13):types.append(dict(unit=i,mounted=bool(lookup.call(0x406444,1<<i)),objects=[lookup.call(0x406569,1<<i,side) for side in [0,1]]))
    result=dict(exeSha256=SHA,environment='Synthetic objects with original callbacks; fixed-zero GetTickCount OS shim only',deaths=deaths,movement=movement,grid=grid,walking=walking,types=types)
    path=ROOT/'evidence/ai/native-casualty-vectors.json';path.write_text(json.dumps(result,separators=(',',':')),encoding='utf8')
    shutil.copyfile(path,ROOT.parent/'sango2-web/packages/core/fixtures/native-casualty-vectors.json')
    (ROOT.parent/'sango2-web/packages/core/src/native-casualty-types.json').write_text(json.dumps(types),encoding='utf8')
    print(json.dumps(dict(deaths=len(deaths),movement=len(movement),grid=len(grid),walking=len(walking),types=len(types))))


if __name__=='__main__':main()
