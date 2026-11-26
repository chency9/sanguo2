"""Original persuasion, AI disposition, player selection and join loyalty.

No decisions or RNG helpers are replaced. UI report/selection callbacks are
observed at their boundary. Join cases run original 0x40EEAA through its loyalty
arithmetic and original ownership-list mutation; only map actor creation and
movement callbacks are intercepted. This does not validate map path timing.
"""
import json
import random
import shutil
import struct
from native_ai_oracle import Oracle,ROOT,HEAP,SHA
from native_policy_search_oracle import PolicyOracle


WINNER=HEAP+0x10000;LOSER=HEAP+0x11000;LOYAL=HEAP+0x12000;OTHER=HEAP+0x13000;PLAYER=HEAP+0x14000


def context(vm,g,c):
    vm.put(g+60,c['loyalty'],True);vm.put(g+199,c['constancy'],True)
    faction={None:0,'winner':WINNER,'loyal':LOYAL}.get(c['loyalFactionId'],0)
    vm.put(g+191,faction)
    if faction:
        leader=HEAP+0xD0000+faction-HEAP;vm.put(faction+12,leader)
        owner={None:0,'winner':WINNER,'loyal':LOYAL,'other':OTHER}[c['loyalLeaderOwnerId']]
        vm.put(leader+203,owner);vm.put(leader+145,1 if c['loyalLeaderActive'] else 2)


def persuasion(c):
    vm=Oracle();vm.set_rng(c['rng']);g=HEAP;context(vm,g,c)
    accepted=vm.call(0x404344,WINNER,g)==1
    return dict(accepted=accepted,reason=vm.i32(0x4C6CEC),rng=vm.rng())


def ai(o):
    vm=Oracle();vm.set_rng(o['rng']);winner,loser=HEAP,HEAP+0x1000
    vm.put(0x4A64F0,PLAYER);vm.put(winner+28,HEAP+0x2000);vm.put(HEAP+0x2000+203,WINNER)
    vm.put(WINNER+824,HEAP+0x5000 if o['winnerHasCity'] else 0);vm.put(loser,len(o['candidates']))
    for i,c in enumerate(o['candidates']):
        g=HEAP+0x30000+i*0x1000;record=loser+28+72*i;owner=PLAYER if c['ownerIsPlayer'] else HEAP+0x80000+i*0x1000
        vm.put(record,g);vm.put(record+4,c['status']);context(vm,g,c);vm.put(g+203,owner)
        if c['isRuler']:vm.put(owner+12,g)
        city=HEAP+0x70000+i*0x1000;vm.put(g+215,city);vm.put(owner+824,city)
        vm.put(city+162,city+0x100 if c['rulerHasOtherCity'] else 0)
    vm.call(0x40452E,winner,loser,0)
    return dict(statuses=[vm.i32(loser+32+72*i) for i in range(len(o['candidates']))],rng=vm.rng())


def player(o):
    vm=PolicyOracle();vm.set_rng(o['rng']);roster=HEAP;vm.put(0x4A64F0,WINNER);vm.put(0x4A8098,roster)
    vm.put(0x4A80A0,HEAP+0x1000);vm.put(0x4A809C,0);vm.put(roster,len(o['candidates']))
    for i,c in enumerate(o['candidates']):
        g=HEAP+0x30000+i*0x1000;vm.put(roster+28+72*i,g);vm.put(roster+32+72*i,c['status']);context(vm,g,c)
    vm.call(0x44E820)
    index=vm.i32(0x4A8090)
    result=None if index<0 else dict(index=index,id=o['candidates'][index]['id'],accepted=vm.u32(0x4A8094)==1,reason=vm.i32(0x4C6CEC))
    before=vm.rng();selection=[]
    vm.callbacks[0x44E820]=lambda sp:selection.append(True)
    address={'yield':0x44EBE2,'kill':0x44ECC2,'free':0x44EDB4}[o['choice']]
    if index>=0:vm.call(address)
    return dict(current=result,statuses=[vm.i32(roster+32+72*i) for i in range(len(o['candidates']))],advance=bool(selection),rngBeforeChoice=before,rng=vm.rng())


def join(o):
    vm=PolicyOracle();vm.set_rng(o['rng']);g=HEAP;city=HEAP+0x1000;new_army=HEAP+0x2000
    vm.put(g+60,o['loyalty'],True);vm.put(g+203,LOSER);vm.put(g+145,1)
    vm.put(LOSER+24,g);vm.put(g+68,17,True);vm.put(g+72,9,True);vm.put(g+18,0,True);vm.put(g+22,17,True)
    # General +153/+155/+157 are horse, weapon and carried item IDs.
    vm.put(g+153,12,True);vm.put(g+155,34,True);vm.put(g+157,56,True)
    calls=[]
    vm.callbacks[0x405678]=lambda sp:0
    vm.callbacks[0x412099]=lambda sp:new_army
    vm.callbacks[0x4390AF]=lambda sp:0
    vm.callbacks[0x41AB49]=lambda sp:0
    vm.callbacks[0x438909]=lambda sp:0
    vm.call(0x40EEAA,g,WINNER,0,city)
    word=lambda offset:struct.unpack('<h',vm.cpu.mem_read(g+offset,2))[0]
    return dict(loyalty=word(60),owner='winner' if vm.u32(g+203)==WINNER else 'other',status=vm.u32(g+145),
        active=word(68),reserve=word(72),hp=word(18),mp=word(22),equipment=[word(offset) for offset in [153,155,157]],rng=vm.rng())


def penalty(o):
    vm=Oracle();vm.set_rng(o['rng']);roster,g=HEAP,HEAP+0x1000
    vm.put(roster,1);vm.put(roster+28,g);vm.put(roster+32,o['status'])
    for offset,key in [(56,'morale'),(60,'loyalty'),(199,'constancy')]:vm.put(g+offset,o[key],True)
    vm.call(0x447520,roster)
    word=lambda offset:struct.unpack('<h',vm.cpu.mem_read(g+offset,2))[0]
    return dict(morale=word(56),loyalty=word(60),rng=vm.rng())


def main():
    r=random.Random(0x404344);rng=lambda:[r.getrandbits(32),r.getrandbits(32)]
    def candidate(index):
        relation=r.randrange(6)
        return dict(id=str(index),loyalty=r.choice([0,24,25,50,51,70,71,90,91,100,32767,-32768]),constancy=r.choice([0,2,3,4,5,10,32767,-32768]),
            loyalFactionId=None if relation==0 else 'winner' if relation==1 else 'loyal',loyalLeaderOwnerId=None if relation==0 else 'winner' if relation in [1,3,4] else 'loyal' if relation==2 else 'other',
            loyalLeaderActive=relation!=4,status=r.choice([0,1,2,3,3,3,5,6,7]),isRuler=False,ownerIsPlayer=False,rulerHasOtherCity=False)
    persuasion_cases=[];ai_cases=[];player_cases=[];join_cases=[];penalty_cases=[]
    for i in range(400):
        c=candidate(i);c['rng']=rng();persuasion_cases.append(dict(input=c,native=persuasion(c)))
    for i in range(160):
        cs=[candidate(j) for j in range(r.randrange(1,8))]
        player_ruler=False;player_member=False
        relation=candidate(99)
        for c in cs:
            for key in ['loyalFactionId','loyalLeaderOwnerId','loyalLeaderActive']:c[key]=relation[key]
            is_player=bool(r.randrange(3)==0) and not player_member
            if is_player:player_member=True
            is_ruler=bool(r.randrange(3)==0) and not(is_player and player_ruler)
            if is_player and is_ruler:player_ruler=True
            c.update(isRuler=is_ruler,ownerIsPlayer=is_player,rulerHasOtherCity=bool(r.randrange(2)))
        o=dict(candidates=cs,winnerHasCity=bool(i%3),rng=rng());ai_cases.append(dict(input=o,native=ai(o)))
    for i in range(120):
        cs=[candidate(j) for j in range(r.randrange(1,8))];relation=candidate(99)
        for c in cs:
            for key in ['loyalFactionId','loyalLeaderOwnerId','loyalLeaderActive']:c[key]=relation[key]
        o=dict(candidates=cs,choice=['yield','kill','free'][i%3],rng=rng());player_cases.append(dict(input=o,native=player(o)))
    for loyalty in [0,24,25,49,50,51,70,90,100,32767,-32768]:
        o=dict(loyalty=loyalty,rng=rng());join_cases.append(dict(input=o,native=join(o)))
    for index in range(96):
        o=dict(status=index%8,morale=r.choice([0,20,80,100,32767,-32768]),loyalty=r.choice([0,24,50,100,32767,-32768]),constancy=r.choice([0,3,6,10,32767,-32768]),rng=rng())
        penalty_cases.append(dict(input=o,native=penalty(o)))
    payload=dict(exeSha256=SHA,persuasionCases=persuasion_cases,aiCases=ai_cases,playerCases=player_cases,joinCases=join_cases,penaltyCases=penalty_cases,
        boundary=__doc__)
    path=ROOT/'evidence/ai/native-capture-vectors.json';path.write_text(json.dumps(payload,separators=(',',':'))+'\n',encoding='utf8')
    shutil.copyfile(path,ROOT.parent/'sango2-web/packages/core/fixtures/native-capture-vectors.json')
    print(json.dumps({k:len(v) for k,v in payload.items() if k.endswith('Cases')}))


if __name__=='__main__':main()
