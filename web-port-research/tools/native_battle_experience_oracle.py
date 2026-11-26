"""Run original x86 duel merit, encounter bonus, awards, growth and disposition.

No merit, RNG, progression or condition helper is replaced. Award cases intercept
only the final map ownership/prisoner/movement callbacks at 0x40EF9A/0x40F0A4/
0x40F171; those consequences are outside these vectors. Player UI is suppressed
by setting a different player faction, as a normal non-player award does.
"""
import json
import random
import shutil
import struct
from native_ai_oracle import Oracle, HEAP, ROOT, SHA, STACK, STOP
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EIP, UC_X86_REG_EAX


def word(vm, address):
    return struct.unpack('<h', vm.cpu.mem_read(address, 2))[0]


RECORDS = {'wins':159, 'losses':161, 'streak':163, 'bestStreak':165}
CONDITIONS = {'morale':56, 'fatigue':58, 'loyalty':60, 'constancy':199}


def round_case(o):
    vm = Oracle(); vm.set_rng(o['rng'])
    teams = [HEAP, HEAP+0x100]; generals = [HEAP+0x1000, HEAP+0x2000]
    for t, g, m in zip(teams, generals, o['members']):
        vm.put(t, g)
        for key, offset in [('status',4), ('merit',8), ('initialActive',20), ('initialReserve',24), ('settlementFlags',52), ('experienceModifier',60)]:
            vm.put(t+offset, m[key])
        for key, offset in [('level',46), ('active',68), ('reserve',72)]:vm.put(g+offset, m[key], True)
        for key, offset in RECORDS.items():vm.put(g+offset, m['record'][key], True)
    vm.call(0x41048D, teams[0], teams[1], o['kind'], 0)
    outputs = []
    for t, g, m in zip(teams, generals, o['members']):
        merit=vm.u32(t+8)
        gain=(merit-m['merit']) & 0xffffffff
        if gain >= 2**31:gain-=2**32
        outputs.append(dict(gain=gain, merit=merit, status=vm.i32(t+4), record={key:word(vm,g+offset) for key,offset in RECORDS.items()}))
    return dict(first=outputs[0], second=outputs[1], rng=vm.rng())


def bonus_case(o):
    vm=Oracle();vm.set_rng(o['rng']);rosters=[HEAP,HEAP+0x1000]
    for side,members in enumerate([o['winners'],o['losers']]):
        vm.put(rosters[side],len(members))
        for index,member in enumerate(members):
            record=rosters[side]+28+72*index;general=HEAP+0x10000+side*0x10000+index*0x200
            vm.put(record,general);vm.put(record+4,member['status']);vm.put(record+8,member['merit']);vm.put(general+46,member['level'],True)
    vm.call(0x410989,*rosters)
    merits=[vm.u32(rosters[0]+36+72*i) for i in range(len(o['winners']))]
    bonus=(merits[0]-o['winners'][0]['merit'])&0xffffffff
    if bonus>=2**31:bonus-=2**32
    return dict(bonus=bonus,merits=merits,rng=vm.rng())


def award_case(o):
    vm=Oracle();vm.set_rng(o['rng']);rosters=[HEAP,HEAP+0x1000];factions=[HEAP+0x2000,HEAP+0x3000]
    vm.put(0x4A64F0,HEAP+0x4000)
    def map_boundary(cpu,address,size,data):
        sp=cpu.reg_read(UC_X86_REG_ESP)
        cpu.reg_write(UC_X86_REG_EAX,0);cpu.reg_write(UC_X86_REG_EIP,vm.u32(sp));cpu.reg_write(UC_X86_REG_ESP,sp+4)
    for address in [0x40EF9A,0x40F0A4,0x40F171]:vm.cpu.hook_add(UC_HOOK_CODE,map_boundary,begin=address,end=address)
    for side,members in enumerate(o['rosters']):
        vm.put(rosters[side],len(members));vm.put(rosters[side]+8,1+side)
        vm.put(factions[side]+44,o['factionExperience'][side])
        for i,m in enumerate(members):
            record=rosters[side]+28+72*i;general=HEAP+0x10000+side*0x20000+i*0x200
            vm.put(record,general);vm.put(record+4,m['status']);vm.put(record+8,m['merit']);vm.put(general+203,factions[side])
            vm.put(general+42,m['experience']);vm.put(general+145,m['generalStatus'])
            for key,offset in [('level',46),('strength',52),('intelligence',54),('baseHp',24),('baseMp',26),('maxHp',16),('maxMp',20),('hp',18),('mp',22),('active',68),('reserve',72)]:
                vm.put(general+offset,m[key],True)
            for key,offset in CONDITIONS.items():vm.put(general+offset,m[key],True)
            vm.put(general+219,general+0x200 if i+1<len(members) else 0)
            if i==0:vm.put(factions[side]+24,general)
    sp=STACK+0xF000;vm.cpu.mem_write(sp,struct.pack('<4I',STOP,rosters[0],rosters[1],o['result']));vm.cpu.reg_write(UC_X86_REG_ESP,sp)
    vm.cpu.emu_start(0x40FA92,STOP,timeout=10_000_000,count=20_000_000)
    assert vm.cpu.reg_read(UC_X86_REG_EIP)==STOP,f"Unfinished award at {vm.cpu.reg_read(UC_X86_REG_EIP):x}"
    outputs=[]
    for side,members in enumerate(o['rosters']):
        output=[]
        for i,_m in enumerate(members):
            general=HEAP+0x10000+side*0x20000+i*0x200
            data={key:word(vm,general+offset) for key,offset in [('level',46),('maxHp',16),('maxMp',20),('hp',18),('mp',22),('active',68),('reserve',72)]}
            data.update({key:word(vm,general+offset) for key,offset in CONDITIONS.items()});data['experience']=vm.u32(general+42)
            output.append(data)
        outputs.append(output)
    return dict(rosters=outputs,factionExperience=[vm.u32(f+44) for f in factions],rng=vm.rng())


def main():
    r=random.Random(0x41048D);rng=lambda:[r.getrandbits(32),r.getrandbits(32)]
    rounds=[];bonuses=[];awards=[]
    for case in range(400):
        members=[]
        for side in range(2):
            members.append(dict(level=r.choice([1,2,20,40,99,32767,-32768]),initialActive=r.randrange(201),initialReserve=r.randrange(101),
                active=r.randrange(201),reserve=r.randrange(101),merit=r.choice([0,1,100,0x7fffffff,0x80000000,0xffffffff,r.getrandbits(32)]),status=r.randrange(7),
                settlementFlags=0x2000 if case&(1<<side) else 0,experienceModifier=r.choice([-100,-50,0,30,50,100,0x7fffffff,-2147483648]),
                record={key:r.choice([0,1,300,32766,32767,-32768]) for key in RECORDS}))
        o=dict(members=members,kind=1+case%5,rng=rng());rounds.append(dict(input=o,native=round_case(o)))
    for case in range(120):
        members=lambda:[dict(level=r.choice([1,20,40,99,32767,-32768]),merit=r.choice([0,r.getrandbits(32)]),status=r.randrange(7)) for _ in range(r.randrange(1,16))]
        o=dict(winners=members(),losers=members(),rng=rng());bonuses.append(dict(input=o,native=bonus_case(o)))
    for case in range(96):
        rosters=[]
        for side in range(2):
            members=[]
            for index in range(r.randrange(1,5)):
                level=r.choice([1,19,20,39,40,98,99]);strength=r.randrange(30,121);intelligence=r.randrange(30,121)
                base_hp=r.randrange(40,121);base_mp=r.randrange(20,81)
                mp_stat=intelligence if strength<=intelligence else (strength+intelligence)//2
                max_hp=base_hp+strength*2*level//100;max_mp=base_mp+mp_stat*2*level//100
                members.append(dict(level=level,experience=r.choice([0,5000,100000,200000,650000,0x7fffffff,0x80000000,0xffffffff]),
                    merit=r.choice([0,1,r.randrange(20000),0x3fffffff,0x40000000,0x7fffffff,0xffffffff]),status=r.randrange(7),generalStatus=r.choice([1,1,2,3,6]),
                    strength=strength,intelligence=intelligence,baseHp=base_hp,baseMp=base_mp,maxHp=max_hp,maxMp=max_mp,hp=r.randrange(1,max_hp+1),mp=r.randrange(max_mp+1),
                    active=r.randrange(min(100,level*5)+1),reserve=r.randrange(min(100,max(0,(level-20)*5))+1),
                    morale=r.choice([0,1,80,95,99,100]),fatigue=r.choice([0,40,100]),loyalty=r.choice([0,1,50,99,100]),constancy=r.choice([0,1,7,8,9,10])))
            rosters.append(members)
        o=dict(rosters=rosters,factionExperience=[r.getrandbits(32),r.getrandbits(32)],result=case%3,rng=rng())
        awards.append(dict(input=o,native=award_case(o)))
    output=dict(exeSha256=SHA,oracle='Unicorn / original x86 bytes',
        boundary='Award cases intercept only final map callbacks 0x40EF9A/0x40F0A4/0x40F171. No arithmetic, progression, disposition or RNG helper is intercepted. General learnsets are empty.',
        roundCases=rounds,bonusCases=bonuses,awardCases=awards)
    path=ROOT/'evidence/ai/native-battle-experience-vectors.json';path.write_text(json.dumps(output,separators=(',',':'))+'\n',encoding='utf8')
    destination=ROOT.parent/'sango2-web/packages/core/fixtures/native-battle-experience-vectors.json';shutil.copyfile(path,destination)
    print(json.dumps(dict(rounds=len(rounds),bonuses=len(bonuses),awards=len(awards),path=str(destination))))


if __name__=='__main__':main()
