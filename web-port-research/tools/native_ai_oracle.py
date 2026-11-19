"""Execute original, hash-pinned x86 decision functions in isolated Unicorn memory.

No Windows process, game startup, OS APIs, patched decisions or mocked RNG.
This validates function equivalence on synthetic snapshots, not whole-game parity.
Run with .venv-ai/Scripts/python.exe tools/native_ai_oracle.py.
"""
import hashlib
import csv
import json
import random
import struct
import shutil
from pathlib import Path

import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EBP, UC_X86_REG_EAX, UC_X86_REG_EIP, UC_X86_REG_FPCW, UC_X86_REG_FPTAG

ROOT = Path(__file__).resolve().parents[1]
EXE = ROOT / 'evidence/ida/Sango2.exe'
SHA = '1098558aaea96ae552753df786a8d3910df08fda11c8219dfa133ca001d8e419'
assert hashlib.sha256(EXE.read_bytes()).hexdigest() == SHA
PE = pefile.PE(str(EXE))
IMAGE = PE.get_memory_mapped_image()
PARAMETERS = [list(struct.unpack('<16i', PE.get_data(0x81070 + i * 64, 64))) for i in range(5)]
STACK, STOP, HEAP = 0x2000000, 0x3000000, 0x1000000


class Oracle:
    def __init__(self):
        self.cpu = Uc(UC_ARCH_X86, UC_MODE_32)
        # MSVC _setdefaultprecision 0x46FE00 requests _PC_53 (0x10000).
        # Unicorn starts at control word 0 (24-bit), not a Windows CRT FP state.
        self.cpu.reg_write(UC_X86_REG_FPCW,0x027f)
        self.cpu.reg_write(UC_X86_REG_FPTAG,0xffff)
        for address, size in [(0x400000, 0x100000), (STACK, 0x10000), (STOP, 0x1000), (HEAP, 0x100000)]:
            self.cpu.mem_map(address, size)
        self.cpu.mem_write(0x400000, IMAGE)
        self.comparisons = []
        def inspect(cpu, address, size, _):
            # Original joint-invasion branch reads two uninitialized stack slots.
            # Record actual inputs rather than silently inventing a branch rule.
            if address == 0x40C965:
                bp = cpu.reg_read(UC_X86_REG_EBP)
                self.comparisons.append(self.i32(bp - 0x28) < self.i32(bp - 0x30))
        self.cpu.hook_add(UC_HOOK_CODE, inspect, begin=0x40C965, end=0x40C965)

    def put(self, addr, value, short=False):
        self.cpu.mem_write(addr, struct.pack('<H' if short else '<I', value & (0xffff if short else 0xffffffff)))

    def u32(self, addr):
        return struct.unpack('<I', self.cpu.mem_read(addr, 4))[0]

    def i32(self, addr):
        return struct.unpack('<i', self.cpu.mem_read(addr, 4))[0]

    def call(self, addr, *args):
        sp = STACK + 0xF000
        self.cpu.mem_write(sp, struct.pack('<' + 'I' * (1 + len(args)), STOP, *args))
        self.cpu.reg_write(UC_X86_REG_ESP, sp)
        try:
            self.cpu.emu_start(addr, STOP, timeout=2_000_000, count=1_000_000)
        except Exception as error:
            raise RuntimeError(f'{addr:x} failed at {self.cpu.reg_read(UC_X86_REG_EIP):x}') from error
        assert self.cpu.reg_read(UC_X86_REG_EIP) == STOP, f'Unfinished native call {addr:x}'
        return self.cpu.reg_read(UC_X86_REG_EAX)

    def rng(self):
        return [self.u32(0x4922FC), self.u32(0x492300)]

    def tactical(self, o):
        own, enemy, general, opponent, magic = 0x4A8A60, 0x4B03A0, HEAP+0x2000, HEAP+0x3000, HEAP+0x4000
        self.put(0x4A61A0, magic)
        for ptr, gp, hp, maximum, strength, troops, flags in [
            (own,general,o['hp'],o['maxHp'],o['strength'],o['troops'],o['flags']),
            (enemy,opponent,o['enemyHp'],o['enemyMaxHp'],o['enemyStrength'],o['enemyTroops'],o['enemyFlags'])]:
            self.put(ptr+72,gp);self.put(gp+18,hp,True);self.put(gp+16,maximum,True)
            self.put(gp+52,strength,True);self.put(gp+66,100,True);self.put(ptr+92,troops);self.put(ptr+128,flags)
        self.put(own+80,o['entryHp']);self.put(own+88,o['initialTroops']);self.put(own+132,o['blockedFlags'])
        self.put(own+8,10);self.put(enemy+8,10+o['distanceX'])
        self.put(own+96,o['formationMask'].bit_length()-1)
        for slot in range(38,43):self.put(own+slot*4,0 if o['canAdvance'] else 1)
        self.put(own+76,120000 if o['canCast'] else 60000);self.put(general+22,100,True)
        self.put(own+108,1);self.put(enemy+108,2)
        if o['restrictRetreat']:
            self.put(general+211,HEAP+0x6000);self.put(HEAP+0x6000+52,2,True)
        # Actual learned-skill table consumed by original helper functions.
        for i,(key,flag) in enumerate([('hasDirectSkill',0x10),('hasAreaSkill',1),('hasHealSkill',0x100),('hasReinforceSkill',0x200)]):
            if o[key]:
                self.cpu.mem_write(general+84+i,bytes([i+1]));self.put(magic+22*(i+1)+14,flag,True)
        # Keep one affordable non-category skill so canCast is independent of categories.
        self.cpu.mem_write(general+91,b'\x05')
        captured=[]
        def sensor(cpu,address,size,_):
            sp=cpu.reg_read(UC_X86_REG_ESP)
            result=None
            if address==0x4687A0:
                captured.extend(struct.unpack('<7i',cpu.mem_read(sp+4,28)));result=0
            elif address==0x406622:
                result=o['unitClass'] if self.u32(sp+4)==1 else o['enemyUnitClass']
            elif address==0x450410:result=o['elapsedSinceCharge']
            elif address==0x402920:
                result=o['betweenUnits'] if self.u32(sp+4)==own else o['nearbyEnemies']
            if result is not None:
                cpu.reg_write(UC_X86_REG_EAX,result);cpu.reg_write(UC_X86_REG_EIP,self.u32(sp));cpu.reg_write(UC_X86_REG_ESP,sp+4)
        for address in [0x4687A0,0x406622,0x450410,0x402920]:self.cpu.hook_add(UC_HOOK_CODE,sensor,begin=address,end=address)
        self.call(0x402EA5,own)
        return captured

    def set_rng(self, pair):
        self.put(0x4922FC, pair[0]); self.put(0x492300, pair[1])

    def commander(self,o):
        team,general=HEAP,HEAP+0x2000
        self.put(team,len(o['members']));self.set_rng(o['rng']);self.put(0x4A79C8,256 if o['uncappedLeader'] else 0)
        for i,m in enumerate(o['members']):
            gp=general+i*0x100
            self.put(team+28+72*i,gp);self.put(team+32+72*i,0 if m['available'] else 1)
            for offset,key in [(18,'hp'),(22,'mp'),(52,'strength'),(54,'intelligence'),(68,'troops')]:self.put(gp+offset,m[key],True)
        return {'chosen':self.call(0x403D2F,team,int(o['uniform'])),'rng':self.rng()}

    def formation(self,o):
        gp=HEAP;self.set_rng(o['rng'])
        self.put(gp+66,o['capacity'],True);self.put(gp+68,o['troops'],True)
        self.put(gp+139,o['unitMask']);self.put(gp+167,o['learned'])
        captured=[]
        def inspect(cpu,address,size,_):
            sp=cpu.reg_read(UC_X86_REG_ESP)
            captured.extend(struct.unpack('<7i',cpu.mem_read(self.u32(sp+4),28)))
        self.cpu.hook_add(UC_HOOK_CODE,inspect,begin=0x468740,end=0x468740)
        chosen=self.call(0x403E6D,gp)
        return {'weights':captured,'chosen':chosen,'rng':self.rng()}

    def skill(self, o):
        own,enemy,general,magic=0x4A8A60,0x4B03A0,HEAP+0x2000,HEAP+0x4000
        self.put(0x4A61A0,magic);self.put(own+72,general);self.put(general+22,o['mp'],True)
        for addr,value in [(0x4C7500,o['hpRatio']),(0x4C6BDC,o['troopRatio']),(0x4C6CE4,o['enemyHpRatio'])]:
            self.cpu.mem_write(addr,struct.pack('<f',value))
        self.put(own+8,10);self.put(own+12,5);self.put(enemy+8,10+o['distanceX']);self.put(enemy+12,6)
        self.put(enemy+92,o['counts']['enemyTroops'])
        for i,s in enumerate(o['skills']):
            self.cpu.mem_write(general+84+i,bytes([s['sequence']]))
            self.put(magic+22*s['sequence']+8,s['mp'],True);self.put(magic+22*s['sequence']+12,s['attack'],True)
            self.put(magic+22*s['sequence']+14,s['flags'],True)
        captured=[]
        def sensor(cpu,address,size,_):
            sp=cpu.reg_read(UC_X86_REG_ESP)
            if address==0x468740:
                captured.extend(struct.unpack('<9i',cpu.mem_read(self.u32(sp+4),36)));value=8
            else:
                args=struct.unpack('<5i',cpu.mem_read(sp+4,20))
                if args[1:]==(0,0,54,3):value=o['counts']['edges']
                elif args[1:]==(0,9,54,13):value=0
                elif args[1:]==(8,3,12,7):value=o['counts']['near']
                else:value=o['counts']['line']
            cpu.reg_write(UC_X86_REG_EAX,value);cpu.reg_write(UC_X86_REG_EIP,self.u32(sp));cpu.reg_write(UC_X86_REG_ESP,sp+4)
        for addr in [0x468740,0x402920]:self.cpu.hook_add(UC_HOOK_CODE,sensor,begin=addr,end=addr)
        self.call(0x402A79,own)
        return captured

    def world(self, snapshot):
        cities = snapshot['cities']
        self.ptrs = [HEAP + 0x10000 + i * 0x200 for i in range(len(cities))]
        faction = HEAP
        self.put(0x4A64F0, HEAP + 0x1000)  # player
        self.put(0x4A79C8, 0)
        self.put(0x4C6CE8, 0x481070 + snapshot['profile'] * 64)
        self.put(faction + 36, 0)
        own = [i for i, c in enumerate(cities) if c['owner'] == 'ai']
        self.put(faction + 824, self.ptrs[own[0]] if own else 0)
        for p, i in enumerate(own):
            self.put(self.ptrs[i] + 162, self.ptrs[own[p + 1]] if p + 1 < len(own) else 0)
        gp = HEAP + 0x30000
        road = HEAP + 0x80000
        for i, city in enumerate(cities):
            cp = self.ptrs[i]
            self.put(cp + 16, {'ai':HEAP, 'player':HEAP+0x1000, 'rival':HEAP+0x2000, None:0}[city['owner']])
            self.put(cp + 44, 1 if city['visible'] else 0)
            self.put(cp + 48, len(city['generals']))
            self.put(cp + 68, city['capacity'], True)
            self.put(cp + 146, city['money'])
            self.put(cp + 158, city['kind'])
            if city['generals']:
                self.put(cp + 36, gp)
                self.put(cp + 20, gp if city['hasGovernor'] else 0)
            for j, g in enumerate(city['generals']):
                for offset, key in [(16,'maxHp'),(18,'hp'),(20,'maxMp'),(22,'mp'),(66,'maxTroops'),(68,'troops'),(70,'maxReserve'),(72,'reserve')]:
                    self.put(gp + offset, g[key], True)
                self.put(gp + 145, 1)
                self.put(gp + 227, gp+0x100 if j+1<len(city['generals']) else 0)
                gp += 0x100
            for j, neighbor in enumerate(city['neighbors']):
                self.put(cp + 70 + j*4, road)
                self.put(road, cp); self.put(road+4, self.ptrs[neighbor]); road += 16
        for i in own:
            cp = self.ptrs[i]
            self.put(cp + 56, self.call(0x4017E1, cp))
            self.put(cp + 60, self.call(0x401864, cp))
        self.set_rng(snapshot['rng'])
        self.call(0x40BE20)
        self.call(0x40CBB6, faction)
        candidates = []
        for i in range(self.u32(0x4C39A0)):
            row = list(struct.unpack('<7i', self.cpu.mem_read(0x4C32A0 + 28*i, 28)))
            for j in (1,2,3):
                row[j] = self.ptrs.index(row[j]) if row[j] else -1
            candidates.append(row)
        after_generation = self.rng()
        chosen = self.call(0x40CC10)
        return {'candidates':candidates, 'rngAfterGeneration':after_generation,
                'chosen':chosen, 'rngAfterChoice':self.rng(), 'cooperationComparisons':self.comparisons}


def main():
    rand = random.Random(105_20261117)
    fixtures = []
    for case in range(320):
        cities=[]
        size=rand.randrange(3,9)
        for i in range(size):
            owner='ai' if i==0 else rand.choice(['ai','player','rival',None])
            gs=[]
            for _ in range(rand.randrange(1,11) if owner else 0):
                gs.append(dict(maxHp=100,hp=rand.randrange(15,101),maxMp=60,mp=rand.randrange(61),
                               maxTroops=100,troops=rand.randrange(101),maxReserve=40,reserve=rand.randrange(41)))
            cities.append(dict(owner=owner,visible=rand.random()<.85,capacity=rand.choice([10,15,20]),
                               money=rand.randrange(25001),kind=rand.choice([0,0,0,2]),
                               hasGovernor=bool(gs),generals=gs,neighbors=[]))
        for i in range(size):
            for j in range(i+1,size):
                if j==i+1 or rand.random()<.3:
                    cities[i]['neighbors'].append(j);cities[j]['neighbors'].append(i)
        snapshot={'profile':case%5,'rng':[rand.getrandbits(32),rand.getrandbits(32)],'cities':cities}
        native=Oracle().world(snapshot)
        fixtures.append({'input':snapshot,'native':native})
    rng_cases=[]
    for pair in [[0,0],[31,1],[0xffffffff,0xffffffff],[0x12345678,0x87654321]]:
        o=Oracle();o.set_rng(pair)
        rng_cases.append({'input':pair,'outputs':[o.call(0x450132) for _ in range(100)],'state':o.rng()})
    out=ROOT/'evidence/ai'
    out.mkdir(exist_ok=True)
    # 0x42F2B9 attribute parser and 0x406622 troop range classes.
    attribute_values=[16,48,64,1,2,4,8,256,512]
    attributes={PE.get_data(0x8cb80+i*8,8).split(b'\0')[0].decode('cp950'):value for i,value in enumerate(attribute_values)}
    skills=[]
    for row in csv.DictReader((ROOT/'data/magic.csv').open(encoding='utf-8-sig')):
        flags=0
        for token in row['ATTRIB'].split():flags|=attributes.get(token,0)
        skills.append({'sequence':int(row['SEQUENCE']),'mp':int(row['MP']), 'attack':int(row['ATTACK']), 'flags':flags})
    skill_path=ROOT.parent/'sango2-web/packages/core/src/native-ai-skills.json'
    skill_path.write_text(json.dumps(skills,separators=(',',':')),encoding='utf8')
    tactical=[]
    for case in range(400):
        o=dict(hp=rand.randrange(1,101),maxHp=100,entryHp=rand.randrange(20,101),enemyHp=rand.randrange(1,101),enemyMaxHp=100,
               strength=rand.randrange(30,101),enemyStrength=rand.randrange(30,101),troops=rand.randrange(101),enemyTroops=rand.randrange(101),initialTroops=100,
               formationMask=rand.choice([1,2,4,8,16,32]),unitClass=rand.randrange(1,4),enemyUnitClass=rand.randrange(1,4),distanceX=rand.randrange(30),
               flags=rand.randrange(8),enemyFlags=rand.randrange(8),blockedFlags=rand.choice([0,4]),canAdvance=rand.choice([True,False]),canCast=rand.choice([True,False]),
               hasDirectSkill=rand.choice([True,False]),hasAreaSkill=rand.choice([True,False]),hasHealSkill=rand.choice([True,False]),hasReinforceSkill=rand.choice([True,False]),
               betweenUnits=rand.randrange(5),nearbyEnemies=rand.randrange(15),elapsedSinceCharge=rand.randrange(600),restrictRetreat=rand.choice([True,False]))
        tactical.append({'input':o,'weights':Oracle().tactical(o)})
    skill_cases=[]
    for case in range(240):
        o=dict(skills=[dict(sequence=i+1,mp=rand.randrange(61),attack=rand.randrange(51),flags=rand.choice([16,48,64,1,2,4,8,256,512,17,18,20,24])) for i in range(8)],
               mp=rand.randrange(61),hpRatio=rand.randrange(1,101)/100,troopRatio=rand.randrange(101)/100,enemyHpRatio=rand.randrange(1,101)/100,
               distanceX=rand.randrange(4),counts=dict(line=rand.randrange(15),edges=rand.randrange(20),near=rand.randrange(10),enemyTroops=rand.randrange(101)))
        skill_cases.append({'input':o,'weights':Oracle().skill(o)})
    commanders=[];formations=[]
    for case in range(80):
        o={'rng':[rand.getrandbits(32),rand.getrandbits(32)],'uniform':bool(case%2),'uncappedLeader':bool(case%3),
           'members':[dict(hp=rand.randrange(1,151),mp=rand.randrange(101),troops=rand.randrange(201),strength=rand.randrange(20,101),intelligence=rand.randrange(20,101),available=i==0 or rand.choice([True,False])) for i in range(rand.randrange(1,16))]}
        commanders.append({'input':o,'native':Oracle().commander(o)})
        index=rand.randrange(13)
        o={'rng':[rand.getrandbits(32),rand.getrandbits(32)],'troops':rand.randrange(201),'capacity':rand.choice([0,50,100,150,200]),'unitMask':1<<index,'unitClass':3 if index in [3,11] else 2 if index in [4,5] else 1,'learned':rand.randrange(128)}
        formations.append({'input':o,'native':Oracle().formation(o)})
    payload={'exeSha256':SHA,'oracle':'Unicorn 2.1.4 / original x86 bytes','x87ControlWord':'0x027f (53-bit; explicit CRT-compatible input, not a live-process capture)', 'parameters':PARAMETERS,
             'rngCases':rng_cases,'strategyCases':fixtures,'tacticalCases':tactical,'skillCases':skill_cases,'commanderCases':commanders,'formationCases':formations,
             'tacticalSensorBoundary':'Original scoring and learned skill helpers. Grid counts, troop class and elapsed clock supplied at helper boundaries; selection returns idle after weight capture.'}
    path=out/'native-strategy-vectors.json'
    path.write_text(json.dumps(payload,separators=(',',':')),encoding='utf8')
    fixture_path=ROOT.parent/'sango2-web/packages/core/fixtures/native-ai-vectors.json'
    fixture_path.parent.mkdir(exist_ok=True)
    shutil.copyfile(path,fixture_path)
    from capstone import Cs,CS_ARCH_X86,CS_MODE_32
    disassembler=Cs(CS_ARCH_X86,CS_MODE_32)
    ranges={name:{'address':hex(address),'hex':PE.get_data(address-0x400000,length).hex(),
                  'instructions':[{'address':hex(i.address),'instruction':i.mnemonic+' '+i.op_str} for i in disassembler.disasm(PE.get_data(address-0x400000,length),address)]}
            for name,address,length in [('calendar',0x41b849,0x52),('world_dispatch',0x41b94a,0x81),('fp_default',0x46fe00,0x14)]}
    (out/'dispatcher-bytes.json').write_text(json.dumps({'exeSha256':SHA,'ranges':ranges},indent=2),encoding='utf8')
    evidence_functions=['0040d751','0040cbb6','0040bfce','0040c1e4','0040c157','0040c635','0040c47c','0040c511','0040c34d','0040cc10',
                        '0040ce14','0040d03e','0040d299','0040d52f','0041aec6','0041aefe','00401910','00401b84','00450132','00450117',
                        '00468740','004687a0','00402ea5','00402a79','00403d2f','00403e6d','0042dd7f','0042d8f0','00406056','0041afab','0041af58','0041b1bf']
    hashes={}
    for stem in evidence_functions:
        for ext in ['.c','.asm.json']:
            source=ROOT/'evidence/ida/static-export'/f'{stem}{ext}'
            hashes[source.name]=hashlib.sha256(source.read_bytes()).hexdigest()
    (out/'manifest.json').write_text(json.dumps({'exeSha256':SHA,'vectorSha256':hashlib.sha256(path.read_bytes()).hexdigest(),
        'counts':{'strategy':len(fixtures),'tactical':len(tactical),'skill':len(skill_cases),'commander':len(commanders),'formation':len(formations),'rngSequences':len(rng_cases)},
        'sourceHashes':hashes,'unresolved':'Eight sampled joint-attack comparisons read prior stack values; captured predicate supplied to portable implementation. Global runtime, movement, complete skills and battle outcomes not validated.'},indent=2),encoding='utf8')
    print(json.dumps({'path':str(path),'cases':len(fixtures),'jointBranchComparisons':sum(len(f['native']['cooperationComparisons']) for f in fixtures),
                      'candidateKinds':sorted({c[0] for f in fixtures for c in f['native']['candidates']})}))


if __name__=='__main__':
    main()
