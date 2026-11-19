"""Original x86 movement lottery, blocked steps and forward target scans."""
import json, random, shutil, struct
from native_ai_oracle import Oracle, ROOT, HEAP, SHA, PE

PROFILES={name:list(struct.unpack('<17i',PE.get_data(a-0x400000,68))) for name,a in [('advance',0x48e6e8),('pursue',0x48e808),('retreat',0x48e8e0),('strict',0x48e730),('hold',0x48e6a0)]}
RANGES=[list(struct.unpack('<2i',PE.get_data(0x4862bc-0x400000+56*i,8))) for i in range(13)]

def scan(o):
    vm=Oracle();unit=HEAP
    vm.put(unit+8,o['x']);vm.put(unit+12,o['y']);vm.put(unit+28,1<<o['unit'])
    vm.put(unit+44,(1 if o['general'] else 2)|(4 if o['reserve'] else 0));vm.put(unit+64,0x4A8A60)
    for i,c in enumerate(o['occupied']):
      ptr=HEAP+0x1000+128*i;vm.put(ptr+44,0x2000 if c['dead'] else 2)
      vm.put(ptr+64,0x4A8A60 if c['ally'] else 0x4B03A0);vm.put(0x4B3CA0+4*(71*c['y']+c['x']),ptr)
    attack_range=vm.call(0x43B961,unit)
    distance=vm.call(0x43BBE6,unit,o['direction']&0xffffffff)
    return dict(range=attack_range,distance=distance if distance<0x80000000 else distance-0x100000000)

def step(o):
    vm=Oracle();vm.set_rng(o['rng']);unit,event,profile=HEAP,HEAP+0x1000,HEAP+0x2000
    vm.put(0x4A79C4,17)
    vm.put(unit+8,o['x']);vm.put(unit+12,o['y']);vm.put(unit+16,o['x']);vm.put(unit+20,o['y'])
    vm.put(unit+28,1);vm.put(unit+44,0x4002 if o['retreat'] else 2);vm.put(unit+64,0x4A8A60);vm.put(unit+68,event)
    vm.put(event+8,o['px']);vm.put(event+12,o['py']);vm.put(event+76,0x422847);vm.put(event+132,unit)
    vm.put(0x4B3CA0+4*(71*o['y']+o['x']),unit)
    for i,c in enumerate(o['occupied']):
      ptr=HEAP+0x3000+i*128;vm.put(ptr+8,c['x']);vm.put(ptr+12,c['y']);vm.put(ptr+44,1)
      vm.put(ptr+64,0x4A8A60 if c['ally'] else 0x4B03A0);vm.put(0x4B3CA0+4*(71*c['y']+c['x']),ptr)
    for i,v in enumerate(PROFILES[o['profile']]):vm.put(profile+4*i,v)
    vm.call(0x43C4C0,unit,o['dx']&0xffffffff,o['dy']&0xffffffff,profile)
    return dict(x=vm.i32(unit+8),y=vm.i32(unit+12),previousX=vm.i32(unit+16),previousY=vm.i32(unit+20),
      vx=vm.i32(event+20),vy=vm.i32(event+24),facing=vm.u32(event+44),escaped=bool(vm.u32(unit+44)&0x8000),rng=vm.rng())

def one(o):
    vm=Oracle();vm.set_rng(o['rng']);weights=HEAP+0x4000;out=HEAP+0x5000
    for i,v in enumerate(o['weights']):vm.put(weights+i*4,v)
    vm.call(0x43C2A5,o['dx']&0xffffffff,o['dy']&0xffffffff,weights,out)
    pairs=[]
    for i in range(8):
        packed=vm.u32(out+i*4);x=packed&0xffff;y=(packed>>16)&0xffff
        pairs.append([x if x<0x8000 else x-0x10000,y if y<0x8000 else y-0x10000])
    return dict(candidates=pairs,rng=vm.rng())

def main():
    r=random.Random(0x43C2A5);vectors=[]
    weight_sets=[[1,0,0,0,0,0,0,0],[0,80,10,10,0,0,0,0],[1,100,0,0,0,0,0,0],
                 [5,7,11,13,17,19,23,29],[0,0,0,0,0,0,0,0]]
    for dx in range(-1,2):
      for dy in range(-1,2):
       for weights in weight_sets:
        for i in range(7):
         o=dict(dx=dx,dy=dy,weights=weights,rng=[r.getrandbits(32),r.getrandbits(32)])
         vectors.append(dict(input=o,native=one(o)))
    steps=[]
    for i in range(280):
      x=r.choice([0,1,35,69,70]);y=r.choice([0,1,6,12,13]);occupied=[]
      for dx in range(-1,2):
       for dy in range(-1,2):
        if (dx or dy) and 0<=x+dx<71 and 0<=y+dy<14 and r.randrange(3)!=0:occupied.append(dict(x=x+dx,y=y+dy,ally=bool(r.randrange(2))))
      o=dict(x=x,y=y,dx=r.randrange(-1,2),dy=r.randrange(-1,2),px=((96*x+48)<<16)+r.randrange(-60,61)*65536,py=((72*y+36)<<16)+r.randrange(-50,51)*65536,occupied=occupied,
        profile=r.choice(list(PROFILES)),retreat=bool(i%2),rng=[r.getrandbits(32),r.getrandbits(32)])
      steps.append(dict(input=o,native=step(o)))
    scans=[]
    for i in range(260):
      x=r.choice([0,1,35,69,70]);y=r.randrange(14)
      occupied=[dict(x=col,y=y,ally=bool(r.randrange(2)),dead=r.randrange(3)==0) for col in range(max(0,x-10),min(71,x+11)) if col!=x and r.randrange(3)==0]
      o=dict(x=x,y=y,unit=i%13,reserve=bool(i%2),general=i%7==0,direction=r.choice([-1,1]),occupied=occupied)
      scans.append(dict(input=o,native=scan(o)))
    path=ROOT/'evidence/ai/native-movement-vectors.json';path.write_text(json.dumps(dict(exeSha256=SHA,vectors=vectors,steps=steps,scans=scans),separators=(',',':')),encoding='utf8')
    shutil.copyfile(path,ROOT.parent/'sango2-web/packages/core/fixtures/native-movement-vectors.json')
    (ROOT.parent/'sango2-web/packages/core/src/native-movement-profiles.json').write_text(json.dumps(PROFILES),encoding='utf8')
    (ROOT.parent/'sango2-web/packages/core/src/native-movement-ranges.json').write_text(json.dumps(RANGES),encoding='utf8')
    print(json.dumps(dict(vectors=len(vectors),steps=len(steps),scans=len(scans))))
if __name__=='__main__':main()
