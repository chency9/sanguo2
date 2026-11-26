"""Original annual appearance, disappearance and family-join x86 vectors.

The selection vectors execute 0x423681 and its year/status/RNG helpers, observing
0x4235EA at the transition boundary. Transition/family vectors execute the real
0x4235EA/0x423476 and city/faction linked-list mutations. Only sprite creation,
script notification and recruitment growth are replaced in transition vectors.
Ordered-stage vectors retain the real recruitment-growth routine between the
annual probability draws, including same-year chains of family recruitment.
"""
import json
import random
import struct
from pathlib import Path
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EIP
from native_ai_oracle import HEAP, SHA, PE
from native_policy_search_oracle import PolicyOracle


def main():
    o=PolicyOracle();r=random.Random(423681)
    output=dict(exeSha256=SHA,probabilities=list(struct.unpack('<5i',PE.get_data(0x8a238,20))),yearCases=[],selectionCases=[],transitionCases=[],orderedCases=[])
    def reset():
        o.cpu.mem_write(HEAP,bytes(0x90000));o.callbacks.clear()
        for address in [0x4A6184,0x4A6174,0x4A64F0,0x4A6888,0x4A64B4]:o.put(address,0)
        o.cpu.mem_write(0x4C6AA0,bytes(64*4))
    for year in [-1,0,184,186,187,193,194,195,203,204,205,212,213,214,220,999]:
        reset();o.put(0x4BD390,year);native=o.call(0x423020)
        output['yearCases'].append(dict(year=year,stage=native&0xffff,forced=bool(native&0x10000)))
    for i in range(160):
        reset();year=r.choice([184,186,187,193,194,195,203,204,205,212,213,214,220,999]);o.put(0x4BD390,year)
        officers=[];pointers={};city=HEAP+0x50000;o.put(0x4C6AA0+4,city)
        for j in range(r.randrange(0,16)):
            ptr=HEAP+0x1000+j*0x300;key=str(j);pointers[ptr]=key
            status=r.choice([1,2,8,4096,8192]);locations=[r.choice([None,'city']) for _ in range(5)]
            officers.append(dict(id=key,status=status,locations=locations));o.put(ptr+145,status)
            for stage,location in enumerate(locations):o.put(ptr+74+2*stage,1 if location else 8192,True)
            if j:o.put(ptr-0x300+243,ptr)
            else:o.put(0x4A6184,ptr)
        operations=[]
        o.callbacks[0x4235EA]=lambda sp:operations.append(dict(id=pointers[o.u32(sp+4)],cityId='city' if o.u32(sp+8) else None))
        before=[r.randrange(2**32),r.randrange(2**32)];o.set_rng(before);o.call(0x423681)
        output['selectionCases'].append(dict(year=year,officers=officers,rng=before,operations=operations,rngAfter=o.rng()))
    for case in range(80):
        reset();child,parent,leader=HEAP+0x1000,HEAP+0x2000,HEAP+0x3000
        owner,other=HEAP+0x60000,HEAP+0x61000
        cities=[HEAP+0x30000+i*0x300 for i in range(3)]
        player=r.choice([True,False]);o.put(0x4A64F0,owner if player else other);o.put(owner+12,leader)
        planned=r.choice([None,0,1,2]);current=r.choice([None,0]);relative=r.choice([True,False])
        parent_status=r.choice([1,8,8192]);parent_city=r.choice([None,0,1,2]);leader_city=r.choice([None,0,1,2])
        status=8 if planned is None else 8192
        o.put(child+145,status);o.put(child+195,parent if relative else 0);o.put(child+215,cities[current] if current is not None else 0)
        o.put(parent+145,parent_status);o.put(parent+203,owner);o.put(parent+215,cities[parent_city] if parent_city is not None else 0)
        o.put(leader+145,1);o.put(leader+203,owner);o.put(leader+215,cities[leader_city] if leader_city is not None else 0)
        for j,city in enumerate(cities):
            o.put(city+16,owner);o.put(city+68,r.choice([0,1,5]),True)
            if j:o.put(cities[j-1]+162,city);o.put(cities[j-1]+166,city)
            else:o.put(owner+824,city);o.put(0x4A6174,city)
        if current is not None:o.put(cities[current]+40,child)
        operations=[]
        o.callbacks[0x412099]=lambda sp: HEAP+0x70000
        o.callbacks[0x4390AF]=lambda sp:0
        o.callbacks[0x438909]=lambda sp:0
        o.callbacks[0x41F740]=lambda sp:operations.append('dialog')
        o.callbacks[0x426B44]=lambda sp:operations.append('growth')
        before=[r.randrange(2**32),r.randrange(2**32)];o.set_rng(before)
        o.call(0x4235EA,child,cities[planned] if planned is not None else 0)
        final_city=o.u32(child+215);final_owner=o.u32(child+203)
        output['transitionCases'].append(dict(status=status,plannedCityId=None if planned is None else str(planned),cityId=None if current is None else str(current),
            relative=relative,parentStatus=parent_status,parentCityId=None if parent_city is None else str(parent_city),leaderCityId=None if leader_city is None else str(leader_city),
            player=player,capacities=[struct.unpack('<h',o.cpu.mem_read(c+68,2))[0] for c in cities],rng=before,
            native=dict(status=o.u32(child+145),cityId=None if not final_city else str(cities.index(final_city)),ownerId='own' if final_owner==owner else None,
                acted=bool(o.u32(child+149)&1),operations=operations,notifications=o.u32(0x4A6888),rng=o.rng())) )
    growth=[];officer_ids={}
    def observe_growth(cpu,address,size,data):
        sp=cpu.reg_read(UC_X86_REG_ESP)
        growth.append(officer_ids[o.u32(sp+4)])
    o.cpu.hook_add(UC_HOOK_CODE,observe_growth,begin=0x426B44,end=0x426B44)
    for case in range(96):
        reset();o.allocator();growth=[]
        player,other=HEAP+0x60000,HEAP+0x61000
        o.put(0x4A64F0,player)
        city_ptrs=[HEAP+0x30000+i*0x300 for i in range(3)]
        city_defs=[dict(id=str(i),ownerId='player' if i<2 else 'other',capacity=r.choice([0,1,2,5,20]),officerCount=0,hidden=False) for i in range(3)]
        for j,city in enumerate(city_ptrs):
            o.put(city+16,player if j<2 else other);o.put(city+68,city_defs[j]['capacity'],True)
            o.put(city+166,city_ptrs[j+1] if j<2 else 0)
        o.put(0x4A6174,city_ptrs[0]);o.put(player+824,city_ptrs[0]);o.put(other+824,city_ptrs[2])
        o.put(city_ptrs[0]+162,city_ptrs[1])
        for j,city in enumerate(city_ptrs):o.put(0x4C6AA0+4*(j+1),city)
        year=[194,204,213,184,195,205,214,220][case%8];o.put(0x4BD390,year)
        officers=[];officer_ptrs=[]
        def add_officer(key,status,owner,city,relative,locations,experience=0):
            ptr=HEAP+0x1000+len(officers)*0x300;officer_ptrs.append(ptr)
            level=r.randrange(1,10);strength=r.randrange(35,110);intelligence=r.randrange(35,110)
            base_hp=r.randrange(50,91);base_mp=r.randrange(25,51)
            for offset,value in [(24,base_hp),(26,base_mp),(46,level),(52,strength),(54,intelligence)]:o.put(ptr+offset,value,True)
            maximum_hp=o.call(0x40A020,ptr);maximum_mp=o.call(0x40A098,ptr)
            for offset,value in [(16,maximum_hp),(18,maximum_hp-7),(20,maximum_mp),(22,maximum_mp-5),(68,2),(72,1)]:o.put(ptr+offset,value,True)
            o.put(ptr+42,experience);o.put(ptr+145,status)
            o.put(ptr+203,player if owner=='player' else other if owner=='other' else 0)
            o.put(ptr+215,city_ptrs[int(city)] if city is not None else 0)
            if city is not None:
                city_ptr=city_ptrs[int(city)];offset,next_offset=(36,227) if status==1 else (40,231)
                o.put(ptr+next_offset,o.u32(city_ptr+offset));o.put(city_ptr+offset,ptr)
                if status==1:city_defs[int(city)]['officerCount']+=1
            if owner:
                faction_ptr=player if owner=='player' else other
                o.put(ptr+219,o.u32(faction_ptr+24));o.put(faction_ptr+24,ptr)
            for stage,location in enumerate(locations):o.put(ptr+74+2*stage,int(location)+1 if location is not None else 8192,True)
            officers.append(dict(id=key,status=status,ownerId=owner,cityId=city,relativeId=relative,locations=locations,
                progress=dict(level=level,experience=experience,maxHp=maximum_hp,maxMp=maximum_mp,hp=maximum_hp-7,mp=maximum_mp-5,troops=3),
                definition=dict(level=level,hp=maximum_hp,mp=maximum_mp,baseHp=base_hp,baseMp=base_mp,strength=strength,intelligence=intelligence)))
        add_officer('ruler',1,'player','0',None,[],r.randrange(10000,50000))
        add_officer('enemy-ruler',1,'other','2',None,[],r.randrange(10000,50000))
        for j in range(r.randrange(1,6)):
            owner=r.choice(['player','other']);add_officer(f'known-{j}',1,owner,r.choice(['0','1']) if owner=='player' else '2',None,[],r.randrange(2000,50000))
        for j in range(10):
            relative=r.choice([None,'ruler','enemy-ruler']+[g['id'] for g in officers if g['id'].startswith('new-')])
            status=8192 if j<7 else 8
            city=None if status==8192 else r.choice(['0','1','2'])
            locations=[r.choice([None,'0','1','2']) for _ in range(5)]
            if case%8 in [0,1,2] and j<3:relative='ruler' if j==0 else f'new-{j-1}';locations=['0']*5
            add_officer(f'new-{j}',status,None,city,relative,locations)
        officer_ids={ptr:g['id'] for ptr,g in zip(officer_ptrs,officers)}
        by_id={g['id']:ptr for g,ptr in zip(officers,officer_ptrs)}
        for j,(g,ptr) in enumerate(zip(officers,officer_ptrs)):
            o.put(ptr+195,by_id[g['relativeId']] if g['relativeId'] is not None else 0)
            o.put(ptr+243,officer_ptrs[j+1] if j+1<len(officer_ptrs) else 0)
        o.put(0x4A6184,officer_ptrs[0]);o.put(player+12,by_id['ruler']);o.put(other+12,by_id['enemy-ruler'])
        notifications=[]
        o.callbacks[0x412099]=lambda sp:HEAP+0x70000
        o.callbacks[0x4390AF]=lambda sp:0
        o.callbacks[0x438909]=lambda sp:0
        def notify(sp):
            index=o.u32(0x4A6888);notifications.append(officer_ids[o.u32(4876520+8*index)]);return 0
        o.callbacks[0x41F740]=notify
        before=[r.randrange(2**32),r.randrange(2**32)];o.set_rng(before)
        try:o.call(0x423681)
        except Exception as error:raise RuntimeError(f'Annual ordered case {case}, EIP={o.cpu.reg_read(UC_X86_REG_EIP):x}, growth={growth}') from error
        finals=[]
        for g,ptr in zip(officers,officer_ptrs):
            word=lambda offset:struct.unpack('<h',o.cpu.mem_read(ptr+offset,2))[0]
            city=o.u32(ptr+215);owner=o.u32(ptr+203)
            finals.append(dict(id=g['id'],status=o.u32(ptr+145),cityId=str(city_ptrs.index(city)) if city else None,
                ownerId='player' if owner==player else 'other' if owner==other else None,acted=bool(o.u32(ptr+149)&1),
                progress=dict(level=word(46),experience=o.u32(ptr+42),maxHp=word(16),maxMp=word(20),hp=word(18),mp=word(22),troops=word(68)+word(72))))
        output['orderedCases'].append(dict(year=year,officers=officers,cities=city_defs,rng=before,
            native=dict(officers=finals,growth=growth,notifications=notifications,rng=o.rng())))
    dest=Path(__file__).resolve().parents[2]/'sango2-web/packages/core/fixtures/native-officer-appearance.json'
    dest.write_text(json.dumps(output,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf8')
    print({k:len(v) for k,v in output.items() if k.endswith('Cases')})


if __name__=='__main__':main()
