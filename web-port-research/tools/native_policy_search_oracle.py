"""Isolated original-x86 fixtures for search, persuasion, growth and autonomy.

Only malloc/free and UI callbacks are replaced. Search-route cases replace the
recruitment callback (tested separately) to observe selection without creating
map sprites. Persuasion cases replace join/growth side effects; autonomy cases
replace action callbacks. These are kernel tests, not whole-client replays.
"""
import json
import random
import struct
from pathlib import Path
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EIP, UC_X86_REG_EAX
from native_ai_oracle import Oracle, HEAP, SHA


class PolicyOracle(Oracle):
    def __init__(self):
        super().__init__()
        self.callbacks = {}
        self.cpu.hook_add(UC_HOOK_CODE, self.intercept)

    def intercept(self, cpu, address, size, data):
        if address not in self.callbacks:
            return
        sp = cpu.reg_read(UC_X86_REG_ESP)
        result = self.callbacks[address](sp)
        cpu.reg_write(UC_X86_REG_EAX, (result or 0) & 0xffffffff)
        cpu.reg_write(UC_X86_REG_ESP, sp+4)
        cpu.reg_write(UC_X86_REG_EIP, self.u32(sp))

    def allocator(self):
        self.callbacks[0x450440] = lambda sp: HEAP+0x80000
        self.callbacks[0x450451] = lambda sp: 0
        self.cpu.mem_write(0x4C6560, bytes(16))

    def items(self, rows, found):
        self.cpu.mem_write(0x4C3A60, bytes(86*128))
        for row in rows:
            ptr = 0x4C3A74+row['id']*86
            for offset, key in [(0,'flags'), (6,'searchType'), (10,'rate'), (34,'level')]:
                self.put(ptr+offset, row[key], True)
        for index in found:
            self.put(0x4C3A80+index*86, 1, True)


def signed(value):
    return value-2**32 if value >= 2**31 else value


def main():
    r = random.Random(426701)
    rng = lambda: [r.randrange(1,2**32), r.randrange(1,2**32)]
    output = dict(exeSha256=SHA, itemCases=[], routeCases=[], recruitCases=[], growthCases=[], autonomyCases=[])
    o = PolicyOracle()
    actor = HEAP+0x10000
    for i in range(240):
        rows = [dict(id=index, flags=r.choice([0,1,2,3]), searchType=r.randrange(4),
                     rate=r.randrange(0,301), level=r.randrange(1,61))
                for index in r.sample(range(1,128), r.randrange(1,18))]
        found = [row['id'] for row in rows if r.randrange(2)]
        level = r.randrange(1,100)
        if i == 0:
            rows = []; found = []
        before = rng();o.set_rng(before);o.items(rows,found);o.put(actor+46,level,True)
        result = signed(o.call(0x408EE2,actor))
        after = [j for j in range(128) if struct.unpack('<H',o.cpu.mem_read(0x4C3A80+86*j,2))[0] == 1]
        output['itemCases'].append(dict(items=rows,found=found,level=level,rng=before,item=result,foundAfter=after,rngAfter=o.rng()))
    # The complete original route function with native neighbor/list helpers.
    o.allocator()
    for i in range(180):
        o.cpu.mem_write(HEAP,bytes(0x70000))
        cities = [HEAP+j*0x200 for j in range(r.randrange(1,8))]
        faction = HEAP+0x60000;o.put(actor+203,faction)
        o.put(cities[0]+108,1+i%5,True)
        wild = {};pointers=[];selected=[]
        for index, city in enumerate(cities):
            o.put(city+16,faction);wild[str(index)]=[]
            if index:
                road=HEAP+0x20000+index*16
                o.put(road,cities[0]);o.put(road+4,city);o.put(cities[0]+70+4*(index-1),road)
            for k in range(r.randrange(4)):
                key=f'g{index}-{k}';ptr=HEAP+0x30000+len(pointers)*0x200
                wild[str(index)].append(key);pointers.append((key,ptr))
                o.put(ptr+145,8);o.put(ptr+215,city);o.put(city+40,ptr)
        for j,(_,ptr) in enumerate(pointers):o.put(ptr+243,pointers[j+1][1] if j+1<len(pointers) else 0)
        o.put(0x4A6184,pointers[0][1] if pointers else 0)
        def candidate(sp):
            target=o.u32(sp+12)
            selected.append(next(key for key,ptr in pointers if ptr==target));return 18
        o.callbacks[0x426C69]=candidate
        rows=[dict(id=2,flags=0,searchType=0,rate=100,level=1)]
        o.items(rows,[]);o.put(actor+46,10,True)
        before=rng();o.set_rng(before);result=signed(o.call(0x426D8C,cities[0],actor))
        route=dict(kind='none')
        if result==0x1002:route=dict(kind='item')
        elif selected:
            key=selected[0];route=dict(kind='officer',generalId=key,cityId=key[1:key.index('-')])
        output['routeCases'].append(dict(area=dict(home='0',category=1+i%5,neighbors=[str(j) for j in range(1,len(cities))],wild=wild),rng=before,route=route,rngAfter=o.rng()))
    o.callbacks.pop(0x426C69)
    o.callbacks[0x4230ED]=lambda sp: 0
    o.callbacks[0x426B44]=lambda sp: 0
    for i in range(160):
        candidate,own,loyal,leader=HEAP+0x2000,HEAP+0x3000,HEAP+0x4000,HEAP+0x5000
        relation=i%5;loyal_ptr=0 if relation==0 else own if relation==1 else loyal
        leader_owner=loyal if relation==2 else own if relation==3 else HEAP+0x6000
        o.put(actor+203,own);o.put(candidate+191,loyal_ptr)
        o.put(loyal+12,leader);o.put(leader+203,leader_owner)
        intelligence=r.choice([0,90,91,100,120]);o.put(candidate+54,intelligence,True)
        before=rng();o.set_rng(before);code=o.call(0x426C69,HEAP,actor,candidate)
        output['recruitCases'].append(dict(owner='own',loyalFaction=None if relation==0 else 'own' if relation==1 else 'loyal',
            loyalLeaderOwner='loyal' if relation==2 else 'own' if relation==3 else 'other',intelligence=intelligence,rng=before,code=code,rngAfter=o.rng()))
    o.callbacks.pop(0x426B44)
    for i in range(100):
        o.cpu.mem_write(HEAP,bytes(0x70000));o.allocator()
        faction=HEAP+0x60000;candidate=HEAP+0x50000;o.put(0x4A64F0,faction)
        count=r.randrange(1,16);roster=[]
        for j in range(count):
            ptr=HEAP+j*0x200;experience=r.randrange(0,200000)
            roster.append(dict(id=str(j),experience=experience));o.put(ptr+42,experience);o.put(ptr+145,1)
            o.put(ptr+219,HEAP+(j+1)*0x200 if j+1<count else 0)
        ruler=str(r.randrange(count));o.put(faction+12,HEAP+int(ruler)*0x200);o.put(faction+24,HEAP)
        level=r.randrange(1,41);strength=r.randrange(1,121);intelligence=r.randrange(1,121)
        base_hp=r.randrange(40,121);base_mp=r.randrange(20,81)
        o.put(candidate+24,base_hp,True);o.put(candidate+26,base_mp,True)
        o.put(candidate+52,strength,True);o.put(candidate+54,intelligence,True);o.put(candidate+46,level,True)
        hp=o.call(0x40A020,candidate)+5;mp=o.call(0x40A098,candidate)+3
        for offset,value in [(16,hp),(18,hp-10),(20,mp),(22,mp-10),(68,3),(72,2)]:o.put(candidate+offset,value,True)
        before=rng();o.set_rng(before);o.call(0x426B44,candidate)
        def word(offset):return struct.unpack('<h',o.cpu.mem_read(candidate+offset,2))[0]
        output['growthCases'].append(dict(roster=roster,ruler=ruler,rng=before,
            input=dict(level=level,strength=strength,intelligence=intelligence,baseHp=base_hp,baseMp=base_mp,maxHp=hp,maxMp=mp,hp=hp-10,mp=mp-10,troops=5),
            output=dict(level=word(46),experience=o.u32(candidate+42),maxHp=word(16),hp=word(18),maxMp=word(20),mp=word(22),troops=word(68)+word(72)),rngAfter=o.rng()))
    # Autonomy action scheduling only: callbacks deliberately consume no RNG.
    o.callbacks[0x4347B6]=lambda sp: 0
    for i in range(100):
        o.cpu.mem_write(HEAP,bytes(0x70000));faction=HEAP+0x60000;o.put(0x4A64F0,faction)
        cities=[];acted=[];operations=[];o.put(faction+12,HEAP+0x61000)
        for j in range(r.randrange(1,7)):
            city=HEAP+j*0x200;mode=r.randrange(5);officers=[]
            if j:o.put(HEAP+(j-1)*0x200+162,city)
            else:o.put(faction+824,city)
            o.put(city+106,mode,True)
            for k in range(r.randrange(6)):
                key=f'{j}-{k}';ptr=HEAP+0x10000+j*0x1000+k*0x100;officers.append(key)
                if k:o.put(ptr-0x100+227,ptr)
                else:o.put(city+36,ptr)
                if r.randrange(3)==0:o.put(ptr+149,1);acted.append(key)
            cities.append(dict(id=str(j),mode=mode,officers=officers))
        def action(sp,kind):
            ptr=o.u32(sp+4)-HEAP-0x10000;j=ptr//0x1000;k=(ptr%0x1000)//0x100
            operations.append(dict(cityId=str(j),generalId=f'{j}-{k}',action=kind));return 0
        o.callbacks[0x426F2C]=lambda sp: action(sp,'search')
        o.callbacks[0x427B9E]=lambda sp: action(sp,'develop')
        before=rng();o.set_rng(before);o.call(0x427701)
        output['autonomyCases'].append(dict(cities=cities,acted=acted,rng=before,operations=operations,rngAfter=o.rng()))
    destination=Path(__file__).resolve().parents[2]/'sango2-web/packages/core/fixtures/native-policy-search.json'
    destination.write_text(json.dumps(output,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    print({key:len(value) for key,value in output.items() if key.endswith('Cases')})
    print(destination)


if __name__=='__main__':main()
