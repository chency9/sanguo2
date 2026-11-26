"""Native strategic collision queue, route gate and postbattle state vectors.

Execute pinned x86 0x406169 -> 0x40E515 -> 0x439A48 -> 0x40E86F.
Queue-dispatch vectors retain 0x41152C and replace only battle entry/auto resolve
and the pool-id lifetime lookup. Route vectors retain 0x439329, the polyline
point lookup and fixed-distance helper; entry/merge/rerouting and heading are
observed at their boundary. Retreat vectors retain 0x439141 and original RNG;
route picking and rendering are observed separately, not invented as constants.
"""
import json
import random
import struct
from pathlib import Path
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP
from native_ai_oracle import HEAP, SHA
from native_policy_search_oracle import PolicyOracle


def main():
    o=PolicyOracle();r=random.Random(439329)
    result=dict(exeSha256=SHA,boundary=__doc__,collisionCases=[],dispatchCases=[],routeCases=[],stateCases=[],headingCases=[],retreatRouteCases=[],updateCases=[],pathCases=[])
    def reset():
        o.cpu.mem_write(HEAP,bytes(0x90000));o.callbacks.clear();o.put(0x4A6460,0);o.put(0x4A645C,0)
        o.cpu.mem_write(0x4C3100,bytes(16*24))
    def army(i):return HEAP+0x10000+i*0x200
    def sprite(i):return HEAP+0x30000+i*0x200
    def city(i):return HEAP+0x50000+i*0x200
    for case in range(240):
        reset();count=r.randrange(2,12);actors=[]
        origin=[r.randrange(40,250)*65536+r.randrange(65536) for _ in range(2)]
        for i in range(count):
            x=origin[0]+r.randrange(-12,13)*65536+r.choice([-1,0,1]);y=origin[1]+r.randrange(-12,13)*65536+r.choice([-1,0,1])
            if i==0:x,y=origin
            owner=r.randrange(3);cooldown=r.choice([-10,0,0,0,1,20,60]);handle=(i+1)*0x10000+i
            actors.append(dict(id=str(i),owner=owner,cooldown=cooldown,x=x,y=y,handle=handle))
            a,s=army(i),sprite(i);o.put(a+8,HEAP+0x80000+owner*0x100);o.put(a+36,cooldown);o.put(a+4,handle)
            for offset,value in [(8,x),(12,y),(16,0),(48,0x101),(60,4*65536),(64,4*65536),(68,48*65536),(72,0),(76,0x439A48),(128,sprite(i+1) if i+1<count else 0),(132,a)]:o.put(s+offset,value)
        # Seeded entries test per-frame participation, the 16-pair cap and
        # matching against either member (including unrelated earlier pairs).
        existing=[]
        for j in range(r.choice([0,0,0,1,2,15,16])):
            first,second=r.sample(range(count+8),2);existing.append([str(first),str(second)])
            for offset,value in [(0,2),(4,army(first)),(8,first),(12,2),(16,army(second)),(20,second)]:o.put(0x4C3100+j*24+offset,value)
        o.put(0x4A6460,len(existing));o.put(0x4C2C04,sprite(0));o.put(0x4862A8,0x40E515)
        dx=r.choice([-3,-1,0,1,3])*65536;dy=r.choice([-3,-1,0,1,3])*65536
        before=[r.randrange(2**32),r.randrange(2**32)];o.set_rng(before)
        can_move=o.call(0x406169,sprite(0),dx&0xffffffff,dy&0xffffffff,0)
        pairs=[]
        for j in range(len(existing),o.u32(0x4A6460)):
            pairs.append([str((o.u32(0x4C3104+24*j)-army(0))//0x200),str((o.u32(0x4C3110+24*j)-army(0))//0x200)])
        result['collisionCases'].append(dict(actors=actors,delta=[dx,dy],existing=existing,rng=before,native=dict(canMove=can_move,pairs=pairs,rng=o.rng())))
    for case in range(160):
        reset();player=HEAP+0x80000;owners=[r.randrange(3) for _ in range(12)]
        for i,owner in enumerate(owners):o.put(army(i)+8,player+owner*0x100);o.put(city(i)+16,player+owner*0x100)
        entries=[];valid={};operations=[]
        for j in range(r.randrange(0,17)):
            kind=r.choice(['city','armies']);first,second=r.sample(range(12),2);first_valid=r.choice([True,True,False]);second_valid=r.choice([True,True,False])
            h1=(j+1)*2;h2=h1+1;valid[h1]=army(first) if first_valid else 0;valid[h2]=army(second) if second_valid else 0
            entries.append(dict(kind=kind,first=str(first),second=str(second),firstOwner=owners[first],secondOwner=owners[second],firstValid=first_valid,secondValid=second_valid))
            for offset,value in [(0,1 if kind=='city' else 2),(4,city(first) if kind=='city' else army(first)),(8,0 if kind=='city' else h1),(12,2),(16,army(second)),(20,h2)]:o.put(0x4C3100+j*24+offset,value)
        o.put(0x4A6460,len(entries));o.put(0x4A64F0,player);auto=r.choice([False,True]);o.put(0x4A79C8,2 if auto else 0)
        o.callbacks[0x438810]=lambda sp:valid.get(o.u32(sp+4),0)
        def operation(sp,name,kind):
            first=o.u32(sp+4);second=o.u32(sp+8)
            operations.append(dict(kind=name,first=str((first-(city(0) if kind=='city' else army(0)))//0x200),second=str((second-army(0))//0x200)));return 0
        o.callbacks[0x40FE5F]=lambda sp:operation(sp,'auto-city','city')
        o.callbacks[0x40FFE9]=lambda sp:operation(sp,'auto-armies','armies')
        o.callbacks[0x40EAB8]=lambda sp:operation(sp,'player-city','city')
        o.callbacks[0x40EC0A]=lambda sp:operation(sp,'player-armies','armies')
        before=[r.randrange(2**32),r.randrange(2**32)];o.set_rng(before);o.call(0x41152C)
        result['dispatchCases'].append(dict(entries=entries,auto=auto,rng=before,native=dict(operations=operations,queueCount=o.u32(0x4A6460),rng=o.rng())))
    for case in range(240):
        reset();a,s,road,points=army(0),sprite(0),HEAP+0x60000,HEAP+0x61000
        count=r.randrange(2,8);path=[[r.randrange(20,200),r.randrange(20,200)] for _ in range(count)];index=r.randrange(count);next_index=r.randrange(count);direction=r.randrange(2)
        next_city=r.randrange(3);destination=r.choice([0,next_city,3]);owner=r.randrange(3);target_owner=r.choice([None,owner,(owner+1)%3]);cooldown=r.choice([-1,0,1,20,60]);speed=r.choice([0,1,3])
        # Include exact gate boundaries and larger distances in all quadrants.
        offset=r.choice([-1,0,1,2,3,6,7,20]);x=path[next_index][0]+offset;y=path[next_index][1]
        if case%3==0:x+=r.randrange(-3,4);y+=r.randrange(-3,4)
        for j,(px,py) in enumerate(path):o.cpu.mem_write(points+j*4,struct.pack('<hh',px,py))
        o.put(road+12,count);o.put(road+16,points);o.put(s+8,x*65536+r.randrange(65536));o.put(s+12,y*65536+r.randrange(65536));o.put(s+56,speed)
        for offset,value in [(8,HEAP+0x80000+owner*0x100),(36,cooldown),(60,city(0)),(64,city(destination)),(68,city(next_city)),(72,road),(76,count),(80,index),(84,next_index),(88,direction),(92,s)]:o.put(a+offset,value)
        o.put(city(next_city)+16,0 if target_owner is None else HEAP+0x80000+target_owner*0x100)
        operations=[]
        o.callbacks[0x438D21]=lambda sp:operations.append('heading') or 0x440000
        o.callbacks[0x438E59]=lambda sp:operations.append('enter') or 0
        o.callbacks[0x438D84]=lambda sp:operations.append('route') or 0
        o.callbacks[0x40E951]=lambda sp:operations.append('queue-city') or 0
        can_move=o.call(0x439329,a)
        result['routeCases'].append(dict(path=path,index=index,nextIndex=next_index,direction=direction,destination=str(destination),nextCity=str(next_city),lastCity='0',owner=owner,targetOwner=target_owner,cooldown=cooldown,x=x,y=y,speed=speed,
            native=dict(canMove=can_move,index=o.u32(a+80),nextIndex=o.u32(a+84),operations=operations)))
    for case in range(160):
        reset();a=army(0);flags=r.randrange(256);money=r.randrange(0,1000000);retreats=r.randrange(0,10);kind=r.choice([2,4,8,16]);operations=[]
        o.put(a+48,flags,True);o.put(a+32,money);o.put(a+52,retreats,True);o.put(a+96,sprite(0))
        for address,name in [(0x439F32,'redraw'),(0x438AD1,'empty'),(0x439074,'retreat-route'),(0x438FA2,'leader'),(0x439014,'advisor'),(0x41220C,'remove')]:o.callbacks[address]=lambda sp,name=name:operations.append(name) or 0
        before=[r.randrange(2**32),r.randrange(2**32)];o.set_rng(before);o.call(0x439141,a,kind)
        word=lambda offset:struct.unpack('<h',o.cpu.mem_read(a+offset,2))[0]
        result['stateCases'].append(dict(flags=flags,money=money,retreats=retreats,kind=kind,rng=before,native=dict(flags=word(48),money=o.u32(a+32),retreats=word(52),cooldown=o.u32(a+36),timer=word(50),operations=operations,rng=o.rng())))
    heading_inputs=[[0,0,x,y] for x,y in [(0,0),(0,1),(0,-1),(1,0),(-1,0),(1,1),(1,-1),(-1,1),(-1,-1),(1000,1),(1000,-1),(-1000,1),(1,1000),(-1,1000)]]
    heading_inputs += [[r.randrange(-1000,1001) for _ in range(4)] for _ in range(200)]
    for x,y,tx,ty in heading_inputs:
        reset();flags=r.randrange(256);o.put(army(0)+48,flags,True)
        heading=o.call(0x44FDE4,x&0xffffffff,y&0xffffffff,tx&0xffffffff,ty&0xffffffff);speed=o.call(0x4399E9,army(0))
        result['headingCases'].append(dict(x=x,y=y,targetX=tx,targetY=ty,flags=flags,native=dict(heading=heading,speed=speed)))
    for case in range(240):
        reset();count=r.randrange(2,9);a=army(0);own=HEAP+0x80000;leader=HEAP+0x81000;road=HEAP+0x82000
        city_defs=[]
        for j in range(count):
            owner=r.choice([None,'own','enemy']);hidden=r.choice([False,False,False,True]);capacity=r.choice([0,2,5,10,15]);residents=r.randrange(0,10)
            city_defs.append(dict(id=str(j),owner=owner,hidden=hidden,capacity=capacity,residents=residents,neighbors=[]))
            o.put(city(j)+16,0 if owner is None else own if owner=='own' else own+0x100)
            o.put(city(j)+158,int(hidden));o.put(city(j)+68,capacity,True);o.put(city(j)+166,city(j+1) if j+1<count else 0)
            for k in range(residents):
                gp=HEAP+0x2000+j*0x1000+k*0x100;o.put(gp+145,1);o.put(gp+227,gp+0x100 if k+1<residents else 0)
                if k==0:o.put(city(j)+36,gp)
        # Give every scenario an owned fallback, to avoid the native fatal path.
        city_defs[0]['owner']='own';o.put(city(0)+16,own);owned=[j for j,d in enumerate(city_defs) if d['owner']=='own']
        o.put(own+824,city(owned[0]));o.put(0x4A6174,city(0))
        for left,right in zip(owned,owned[1:]):o.put(city(left)+162,city(right))
        for j,d in enumerate(city_defs):
            neighbors=r.sample([k for k in range(count) if k!=j],r.randrange(count))
            d['neighbors']=[str(k) for k in neighbors]
            for k,next_city in enumerate(neighbors):
                rp=HEAP+0x60000+j*0x400+k*0x20;o.put(rp,city(j));o.put(rp+4,city(next_city));o.put(city(j)+70+k*4,rp)
        next_city=r.randrange(count);last=r.choice([None]+list(range(count)));opposite=r.choice([None]+[j for j in range(count) if j!=next_city]);avoid=r.choice([None]+list(range(count)));leader_city=r.choice([None]+owned);members=r.randrange(1,6)
        o.put(a+8,own);o.put(own+12,leader);o.put(leader+215,city(leader_city) if leader_city is not None else 0)
        o.put(a+56,city(avoid) if avoid is not None else 0);o.put(a+60,city(last) if last is not None else 0)
        o.put(a+68,city(next_city));o.put(a+72,road if opposite is not None else 0)
        if opposite is not None:o.put(road,city(next_city));o.put(road+4,city(opposite))
        for j in range(members):
            gp=HEAP+0x1000+j*0x100;o.put(gp+145,1);o.put(gp+223,gp+0x100 if j+1<members else 0)
            if j==0:o.put(a+28,gp)
        before=[r.randrange(2**32),r.randrange(2**32)];o.set_rng(before);dest=o.call(0x401454,a)
        result['retreatRouteCases'].append(dict(cities=city_defs,ownedOrder=[str(j) for j in owned],nextCity=str(next_city),lastCity=str(last) if last is not None else None,oppositeCity=str(opposite) if opposite is not None else None,
            avoidCity=str(avoid) if avoid is not None else None,leaderCity=str(leader_city) if leader_city is not None else None,members=members,rng=before,native=dict(destination=str((dest-city(0))//0x200),rng=o.rng())))
    for case in range(240):
        reset();a,s,road,points=army(0),sprite(0),HEAP+0x60000,HEAP+0x61000
        x=r.randrange(100,500)*65536+r.randrange(65536);y=r.randrange(100,500)*65536+r.randrange(65536)
        target=[r.randrange(600,900),r.randrange(600,900)];heading=r.randrange(256)*65536;flags=r.randrange(256)
        clock=r.randrange(-1,8);frame=r.randrange(6);cooldown=r.randrange(-1,65);timer=r.choice([0,1,2,50,120,240]);phase=r.choice([1,2,2,2])
        o.put(road+12,2);o.put(road+16,points);o.cpu.mem_write(points,struct.pack('<hhhh',10,10,*target))
        for offset,value in [(8,HEAP+0x80000),(36,cooldown),(40,x>>16),(44,y>>16),(60,city(0)),(64,city(1)),(68,city(1)),(72,road),(76,2),(80,0),(84,1),(88,1),(92,s)]:o.put(a+offset,value)
        o.put(a+48,flags,True);o.put(a+50,timer,True)
        for offset,value in [(8,x),(12,y),(44,heading),(48,0x101),(52,phase),(56,1),(60,4*65536),(64,4*65536),(68,48*65536),(72,0),(76,0x439A48),(84,clock),(132,a),(140,frame)]:o.put(s+offset,value)
        o.put(0x4C2C04,s);o.put(0x4862A8,0x40E515)
        o.callbacks[0x438AD1]=lambda sp:0
        o.callbacks[0x40975E]=lambda sp:1
        o.callbacks[0x439787]=lambda sp:0
        before=[r.randrange(2**32),r.randrange(2**32)];o.set_rng(before);o.call(0x439A48,s,2,0)
        word=lambda offset:struct.unpack('<h',o.cpu.mem_read(a+offset,2))[0]
        signed=lambda ptr:struct.unpack('<i',o.cpu.mem_read(ptr,4))[0]
        result['updateCases'].append(dict(x=x,y=y,target=target,heading=heading,flags=flags,clock=clock,frame=frame,cooldown=cooldown,timer=timer,phase=phase,rng=before,
            native=dict(x=signed(s+8),y=signed(s+12),heading=signed(s+44),flags=word(48),clock=signed(s+84),frame=o.u32(s+140),cooldown=signed(a+36),timer=word(50),armyX=signed(a+40),armyY=signed(a+44),speed=signed(s+56),rng=o.rng())))
    for case in range(180):
        reset();o.cpu.mem_write(0x4C6580,bytes(64*20));count=r.randrange(2,9);roads=[];neighbors=[[] for _ in range(count)]
        for i in range(count):
            o.put(city(i)+150,i);o.put(city(i)+166,city(i+1) if i+1<count else 0)
        o.put(0x4A6174,city(0))
        for i in range(count):
            for j in range(i+1,count):
                if j!=i+1 and r.randrange(3):continue
                ptr=HEAP+0x60000+len(roads)*0x20;length=r.choice([10,20,30,40,100]);roads.append(dict(id=str(len(roads)),fromCity=str(i),toCity=str(j),length=length))
                o.put(ptr,city(i));o.put(ptr+4,city(j));o.put(ptr+8,length);neighbors[i].append(ptr);neighbors[j].append(ptr)
        for i in range(count):
            for j,ptr in enumerate(neighbors[i]):o.put(city(i)+70+j*4,ptr)
        start,end=r.sample(range(count),2);distance=o.call(0x405BCE,city(start),city(end));next_city=o.call(0x405CE0)
        result['pathCases'].append(dict(cities=[str(i) for i in range(count)],roads=roads,start=str(start),end=str(end),native=dict(next=str((next_city-city(0))//0x200),distance=distance)))
    dest=Path(__file__).resolve().parents[2]/'sango2-web/packages/core/fixtures/native-strategic-movement.json'
    dest.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf8');print({k:len(v) for k,v in result.items() if k.endswith('Cases')})


if __name__=='__main__':main()
