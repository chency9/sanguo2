"""Original x86 annual-AI kernels, item arithmetic and ordinary progression.

Replaces malloc/free and item script notifications (0x408818/65/8B2), which
format text and queue messages only. Action-scheduling vectors substitute
search/development callbacks deliberately consuming no RNG. Catchup, balance,
upgrade and inventory vectors execute their actual data-writing functions.
These are isolated kernel comparisons, not an end-to-end client replay.
"""
import json
import random
import struct
from pathlib import Path
from native_ai_oracle import HEAP, SHA
from native_policy_search_oracle import PolicyOracle

FIELDS = dict(level=46, strength=52, intelligence=54, maxHp=16, maxMp=20,
              hp=18, mp=22, morale=56, loyalty=60, fatigue=58, speed=64,
              weaponId=155, horseId=153, thingId=157)
ITEM_FIELDS = dict(flags=20, level=54, strength=56, intelligence=58, maxHp=60,
                   maxMp=62, forceMask=64, battleMask=66, speed=70,
                   hp=72, mp=74, morale=76, loyalty=78, fatigue=80)


def write_officer(o, ptr, g):
    for key, offset in FIELDS.items():
        o.put(ptr+offset, g[key], True)
    for key, offset in [('forceMask', 135), ('battleMask', 167)]:
        o.put(ptr+offset, g[key])


def read_officer(o, ptr):
    result = {key: struct.unpack('<h', o.cpu.mem_read(ptr+offset, 2))[0]
              for key, offset in FIELDS.items()}
    result.update(forceMask=o.i32(ptr+135), battleMask=o.i32(ptr+167))
    return result


def write_items(o, items):
    o.cpu.mem_write(0x4C3A60, bytes(128*86))
    for item in items:
        for key, offset in ITEM_FIELDS.items():
            o.put(0x4C3A60+86*item['id']+offset, item[key], True)


def main():
    r = random.Random(402711)
    o = PolicyOracle()
    def reset():
        o.cpu.mem_write(HEAP, bytes(0x70000))
        o.callbacks.clear()
        o.allocator()
        for address in [0x408818, 0x408865, 0x4088B2]:
            o.callbacks[address] = lambda sp: 0
    rng = lambda: [r.randrange(1, 2**32), r.randrange(1, 2**32)]
    def item(item_id, flags=None):
        result = dict(id=item_id, flags=r.choice([1,16,32,64]) if flags is None else flags,
                      level=r.randrange(1,61), forceMask=r.choice([0,0,1,2,4,16]),
                      battleMask=r.choice([0,0,1,2,4,256]))
        for key in ['strength','intelligence','maxHp','maxMp','speed','hp','mp','morale','loyalty','fatigue']:
            result[key] = r.randrange(-20,31)
        return result
    def officer():
        return dict(level=r.randrange(1,100),strength=r.randrange(-5,121),intelligence=r.randrange(-5,121),
                    maxHp=140,maxMp=90,hp=r.randrange(0,141),mp=r.randrange(0,91),
                    morale=r.randrange(101),loyalty=r.randrange(101),fatigue=r.randrange(101),speed=r.randrange(-5,16),
                    forceMask=r.randrange(32),battleMask=r.randrange(512),weaponId=0,horseId=0,thingId=0)
    result = dict(exeSha256=SHA, itemCases=[], inventoryCases=[], catchupCases=[], balanceCases=[], growthCases=[], actionCases=[])
    for i in range(200):
        reset();g=officer();it=item(r.randrange(1,128));ptr=HEAP+0x1000;owner=HEAP+0x60000
        if i<20:
            g['strength']=r.choice([-32768,32760]);it['strength']=r.choice([-50,50])
        ruler=i%3==0
        o.put(ptr+203,owner);o.put(owner+12,ptr if ruler else HEAP+0x2000)
        write_items(o,[it]);write_officer(o,ptr,g)
        eligible=bool(o.call(0x408E0E,ptr,it['id']))
        remove=i%2==0;o.call(0x408BDC if remove else 0x4088FA,ptr,it['id'])
        result['itemCases'].append(dict(input=g,item=it,ruler=ruler,remove=remove,eligible=eligible,output=read_officer(o,ptr)))
    for i in range(120):
        reset();owner=HEAP+0x60000;roster=[];pointers={}
        items=[item(j,flags=r.choice([1,16,32,64])) for j in r.sample(range(1,128),18)]
        # Keep realistic item effects in the inventory scenarios; arithmetic
        # overflow itself is covered separately above.
        for it in items:
            for key in ['maxHp','maxMp']:it[key]=max(0,it[key])
        inventory={str(it['id']):r.randrange(1,5) for it in items if r.randrange(3)}
        write_items(o,items)
        for j in range(r.randrange(1,9)):
            ptr=HEAP+0x1000+j*0x300;g=officer();pointers[str(j)]=ptr
            roster.append(dict(id=str(j),state=g,experience=r.randrange(100000)))
            write_officer(o,ptr,g);o.put(ptr+203,owner);o.put(ptr+145,1);o.put(ptr+42,roster[-1]['experience'])
            if j:o.put(ptr-0x300+219,ptr)
            else:o.put(owner+24,ptr)
        leader=str(r.randrange(len(roster)));o.put(owner+12,pointers[leader])
        for key,count in inventory.items():o.put(owner+308+2*int(key),count,True)
        before=rng();o.set_rng(before);o.call(0x4024F8,owner)
        after={str(j):struct.unpack('<h',o.cpu.mem_read(owner+308+2*j,2))[0] for j in range(1,128)}
        result['inventoryCases'].append(dict(officers=roster,leader=leader,items=items,inventory=inventory,rng=before,
            inventoryAfter={key:count for key,count in after.items() if count},officersAfter={key:read_officer(o,ptr) for key,ptr in pointers.items()},rngAfter=o.rng()))
    for i in range(180):
        reset();owner=HEAP+0x60000;player=HEAP+0x61000;roster=[]
        player_count=r.randrange(0,21);player_total=r.randrange(1000000);own_total=r.randrange(1000000)
        if i<12:player_total=r.randrange(2**32);own_total=r.randrange(2**32)
        o.put(0x4A64F0,player);o.put(owner+44,own_total);o.put(player+44,player_total)
        for j in range(player_count):
            ptr=HEAP+0x30000+j*0x300;o.put(ptr+145,1)
            if j:o.put(ptr-0x300+219,ptr)
            else:o.put(player+24,ptr)
        for j in range(r.randrange(0,16)):
            ptr=HEAP+0x1000+j*0x300;exp=r.randrange(400000);roster.append(dict(id=str(j),experience=exp))
            o.put(ptr+145,1);o.put(ptr+46,99,True);o.put(ptr+42,exp)
            if j:o.put(ptr-0x300+219,ptr)
            else:o.put(owner+24,ptr)
        before=rng();o.set_rng(before);o.call(0x402128,owner)
        result['catchupCases'].append(dict(officers=roster,playerCount=player_count,playerBattleExperience=player_total,ownBattleExperience=own_total,rng=before,
            experiences=[o.u32(HEAP+0x1000+j*0x300+42) for j in range(len(roster))],rngAfter=o.rng(),cacheAfter=o.u32(owner+44)))
    for i in range(120):
        reset();owner=HEAP+0x60000;player=HEAP+0x61000;roster=[];players=[]
        o.put(0x4A64F0,player)
        for entries,base,faction in [(roster,HEAP+0x1000,owner),(players,HEAP+0x30000,player)]:
            for j in range(r.randrange(1,24)):
                ptr=base+j*0x300;exp=r.randrange(2**32 if i<12 else 400000);entries.append(dict(id=str(j),experience=exp))
                o.put(ptr+145,1);o.put(ptr+46,99,True);o.put(ptr+42,exp)
                if j:o.put(ptr-0x300+219,ptr)
                else:o.put(faction+24,ptr)
        leader=str(r.randrange(len(players)));o.put(player+12,HEAP+0x30000+int(leader)*0x300)
        o.call(0x40221F,owner)
        result['balanceCases'].append(dict(officers=roster,player=players,leader=leader,experiences=[o.u32(HEAP+0x1000+j*0x300+42) for j in range(len(roster))]))
    for i in range(120):
        reset();ptr=HEAP+0x1000;g=officer();level=r.randrange(1,60);g['level']=level
        g.update(baseHp=r.randrange(50,121),baseMp=r.randrange(30,81))
        write_officer(o,ptr,g);o.put(ptr+24,g['baseHp'],True);o.put(ptr+26,g['baseMp'],True)
        g['maxHp']=o.call(0x40A020,ptr)+5;g['maxMp']=o.call(0x40A098,ptr)+3
        g['hp']=r.randrange(1,g['maxHp']+1);g['mp']=r.randrange(1,g['maxMp']+1)
        active=r.randrange(0,min(100,level*5)+1);reserve=r.randrange(0,min(100,max(0,(level-20)*5))+1)
        write_officer(o,ptr,g);o.put(ptr+68,active,True);o.put(ptr+72,reserve,True)
        exp=r.randrange(0x80000000,2**32) if i<12 else r.randrange(500000)
        o.put(ptr+42,exp);o.call(0x40F3C6,ptr,0)
        out=read_officer(o,ptr)
        out={key:out[key] for key in ['level','maxHp','maxMp','hp','mp']}
        out.update(experience=o.u32(ptr+42),troopSlots=dict(active=struct.unpack('<h',o.cpu.mem_read(ptr+68,2))[0],reserve=struct.unpack('<h',o.cpu.mem_read(ptr+72,2))[0]))
        result['growthCases'].append(dict(input=g,troopSlots=dict(active=active,reserve=reserve),experience=exp,output=out))
    for i in range(100):
        reset();owner=HEAP+0x60000;officers=[];pointers={};ops=[]
        for j in range(r.randrange(1,18)):
            ptr=HEAP+0x1000+j*0x300;g=dict(id=str(j),experience=r.randrange(10000),stationed=r.choice([True,False]),strength=r.choice([-5,0,80]),intelligence=r.choice([-5,0,80]))
            officers.append(g);pointers[ptr]=str(j)
            o.put(ptr+145,1);o.put(ptr+203,owner);o.put(ptr+42,g['experience']);o.put(ptr+52,g['strength'],True);o.put(ptr+54,g['intelligence'],True);o.put(ptr+215,HEAP+0x50000 if g['stationed'] else 0)
            if j:o.put(ptr-0x300+219,ptr)
            else:o.put(owner+24,ptr)
        leader=str(r.randrange(len(officers)));o.put(owner+12,next(ptr for ptr,key in pointers.items() if key==leader))
        def action(sp,kind):ops.append(dict(id=pointers[o.u32(sp+8)],action=kind))
        o.callbacks[0x426D8C]=lambda sp:action(sp,'search')
        o.callbacks[0x427A84]=lambda sp:action(sp,'develop')
        o.callbacks[0x427947]=lambda sp:0
        before=rng();o.set_rng(before);o.call(0x402004,owner)
        result['actionCases'].append(dict(officers=officers,leader=leader,rng=before,operations=ops,rngAfter=o.rng()))
    dest=Path(__file__).resolve().parents[2]/'sango2-web/packages/core/fixtures/native-policy-annual.json'
    dest.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf8')
    print({key:len(value) for key,value in result.items() if key.endswith('Cases')})


if __name__=='__main__':main()
