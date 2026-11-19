"""Original strategist effects and recovery, using independently captured tables.
Only sprintf is suppressed; decision, integer math, mutations and RNG run x86.
"""
import csv
import hashlib
import json
import random
import shutil
from native_ai_oracle import Oracle, ROOT, HEAP, SHA, UC_HOOK_CODE, UC_X86_REG_ESP, UC_X86_REG_EAX, UC_X86_REG_EIP
from native_strategist_oracle import selection

SUPPORTED=[1,2,3,4,5,6,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,35,36,37,38,39,40,41,42,43,50,51,52,58,59,60,61,62,63,64,65,66,67]
FIELDS={'maxHp':16,'hp':18,'maxMp':20,'mp':22,'troops':68,'reserve':72,'morale':56,'loyalty':60}
MODIFIERS={'flags':132,'parameter':136,'recoveryClock':140,'chargeModifier':144,'soldierPower':112,'generalHitBonus':116}
TEAM={'settlementFlags':52,'fatigueModifier':56}
OUT=ROOT/'evidence/ai'
CAPTURES=[json.loads((OUT/f'runtime-strategist-{i}.json').read_text(encoding='utf8')) for i in [1,2,3]]
assert all(v['status']=='captured' and v['exeSha256']==SHA and v['rows']==CAPTURES[0]['rows'] for v in CAPTURES)
ROWS=CAPTURES[0]['rows']


def setup(states,rng):
    vm=Oracle();vm.set_rng(rng)
    team=[HEAP,HEAP+0x100];general=[HEAP+0x2000,HEAP+0x3000];combat=[0x4A8A60,0x4B03A0]
    table=HEAP+0x4000;vm.put(0x4A61A8,table)
    for row in ROWS:
        for offset,key in [(4,'attribute'),(8,'active'),(12,'rate'),(16,'execute'),(20,'level')]:
            vm.put(table+24*row['sequence']+offset,row[key])
    vm.put(0x4A664C,general[0]);vm.put(0x4A6650,general[1])
    for i,s in enumerate(states):
        vm.put(team[i],general[i]);vm.put(team[i]+68,general[i]);vm.put(combat[i]+72,general[i])
        for key,offset in FIELDS.items():vm.put(general[i]+offset,s[key],True)
        for key,offset in MODIFIERS.items():vm.put(combat[i]+offset,s[key])
        for key,offset in TEAM.items():vm.put(team[i]+offset,s[key])
    def output_only(cpu,address,size,data):
        sp=cpu.reg_read(UC_X86_REG_ESP)
        cpu.reg_write(UC_X86_REG_EAX,0);cpu.reg_write(UC_X86_REG_EIP,vm.u32(sp));cpu.reg_write(UC_X86_REG_ESP,sp+4)
    vm.cpu.hook_add(UC_HOOK_CODE,output_only,begin=0x46DAE0,end=0x46DAE0)
    def readout():
        import struct
        return [{**{k:struct.unpack('<h',vm.cpu.mem_read(general[i]+offset,2))[0] for k,offset in FIELDS.items()},
                 **{k:vm.i32(combat[i]+offset) for k,offset in MODIFIERS.items()},
                 **{k:vm.i32(team[i]+offset) for k,offset in TEAM.items()}} for i in range(2)]
    return vm,team,general,combat,readout


def effect(o):
    vm,team,general,combat,readout=setup(o['states'],o['rng'])
    vm.put(team[o['side']]+64,o['sequence'])
    vm.put(general[o['side']]+54,100,True);vm.put(general[o['side']^1]+54,1,True)
    vm.call(0x44D450,o['side'],team[o['side']],team[o['side']^1])
    return {'states':readout(),'rng':vm.rng()}


def recovery(o):
    vm,team,general,combat,readout=setup([o['state'],o['state']],[1,2])
    for _ in range(o['updates']):vm.call(0x43E847,combat[0])
    return readout()[0]


def main():
    rand=random.Random(0x44D450)
    def state():
        maximum=rand.randrange(50,201);mp=rand.randrange(40,151)
        return dict(hp=rand.randrange(1,maximum+1),maxHp=maximum,mp=rand.randrange(mp+1),maxMp=mp,
                    troops=rand.randrange(101),reserve=rand.randrange(101),flags=0,parameter=0,recoveryClock=0,chargeModifier=0,
                    soldierPower=rand.randrange(100,201),generalHitBonus=0,morale=rand.randrange(101),loyalty=rand.randrange(101),settlementFlags=0,fatigueModifier=0)
    effects=[];recoveries=[];choices=[]
    for row in ROWS:
        if row['execute'] not in SUPPORTED:continue
        for case in range(12):
            o=dict(sequence=row['sequence'],execute=row['execute'],side=case%2,states=[state(),state()],rng=[rand.getrandbits(32),rand.getrandbits(32)])
            effects.append({'input':o,'native':effect(o)})
    for flags in [0,1,2,3]:
        for rate in [30,40,50,60,70,80]:
            for clock in [0,5999,6000]:
                s=state();s.update(flags=flags,parameter=rate,recoveryClock=clock)
                o={'state':s,'updates':rand.choice([1,3,75,150,151,201])}
                recoveries.append({'input':o,'native':recovery(o)})
    for i in range(128):
        slots=[{k:r[k] for k in ['sequence','active','rate']} for r in rand.sample(ROWS,8)]
        o={'slots':slots,'troops':0 if i%3==0 else rand.randrange(201),'rng':[rand.getrandbits(32),rand.getrandbits(32)]}
        choices.append({'input':o,'native':selection(o)})
    payload={'exeSha256':SHA,'effects':effects,'recovery':recoveries,'runtimeChoices':choices}
    path=OUT/'native-strategy-effects-vectors.json';path.write_text(json.dumps(payload,separators=(',',':')),encoding='utf8')
    shutil.copyfile(path,ROOT.parent/'sango2-web/packages/core/fixtures/native-strategy-effects-vectors.json')
    names={int(r['SEQUENCE']):r['NAME'] for r in csv.DictReader((ROOT/'data/strategies.csv').open(encoding='utf-8-sig'))}
    table=[{**r,'name':names.get(r['sequence'],'不用军师技')} for r in ROWS]
    (ROOT.parent/'sango2-web/packages/core/src/native-ai-strategies.json').write_text(json.dumps(table,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'effects':len(effects),'recovery':len(recoveries),'runtimeChoices':len(choices),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}))


if __name__=='__main__':main()
