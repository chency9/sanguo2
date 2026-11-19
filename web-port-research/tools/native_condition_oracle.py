"""Execute full original recovery and settlement, compare condition projection.
No helper hooks. XP, win records, HP/MP and troop writes are not parity claims.
"""
import json
import random
import shutil
import struct
from native_ai_oracle import Oracle, ROOT, HEAP, SHA

FIELDS={'morale':56,'fatigue':58,'loyalty':60}
TIMERS={'fatigue':32,'moraleLoss':34,'moraleGain':36,'loyaltyLoss':38,'loyaltyGain':40}


def recovery(o):
    vm=Oracle();g=HEAP;city=HEAP+0x1000
    vm.put(g+215,city if o['stationed'] else 0);vm.put(city+142,o['defense'])
    for key,offset in FIELDS.items():vm.put(g+offset,o['state'][key],True)
    for key,offset in TIMERS.items():vm.put(g+offset,o['timers'][key],True)
    # A plain native caller loop avoids starting Unicorn's timeout thread once
    # per update. The original callee, including all branches, stays untouched.
    caller=HEAP+0x3000
    code=b'\x56\xbe'+struct.pack('<I',o['updates'])+b'\x68'+struct.pack('<I',g)
    code+=b'\xe8'+struct.pack('<i',0x41B1BF-(caller+len(code)+5))
    code+=b'\x83\xc4\x04\x4e\x75\xf0\x5e\xc3'
    vm.cpu.mem_write(caller,code);vm.call(caller)
    read=lambda offset:struct.unpack('<h',vm.cpu.mem_read(g+offset,2))[0]
    return dict(state={key:read(offset) for key,offset in FIELDS.items()},timers={key:read(offset) for key,offset in TIMERS.items()})


def settlement(o):
    vm=Oracle();vm.set_rng(o['rng'])
    teams=[HEAP,HEAP+0x100];generals=[HEAP+0x1000,HEAP+0x2000]
    for i in range(2):
        t,g=teams[i],generals[i];vm.put(t,g)
        for key,offset in FIELDS.items():vm.put(g+offset,o['states'][i][key],True)
        vm.put(t+44,o['entryMorale'][i]);vm.put(t+52,4096 if o['enabled'][i] else 0);vm.put(t+56,o['modifiers'][i])
    # Real-time callers pass elapsed display counts through 0x443F2A.
    vm.put(0x4AC35C,11880-o['updates'])
    elapsed=vm.call(0x443F2A)
    vm.call(0x41048D,teams[0],teams[1],o['outcome'],elapsed)
    return dict(elapsed=elapsed,states=[{key:struct.unpack('<h',vm.cpu.mem_read(g+offset,2))[0] for key,offset in FIELDS.items()} for g in generals],rng=vm.rng())


def main():
    rand=random.Random(0x41B1BF);recoveries=[];settlements=[]
    for i in range(320):
        state=dict(morale=rand.choice([0,1,39,40,69,70,80,100]),fatigue=rand.choice([0,1,59,60,61,100]),loyalty=rand.choice([0,28,29,30,48,49,50,68,69,70,89,90,100]))
        timers={k:rand.choice([-32768,-1,0,1,2,45,360,1800]) for k in TIMERS}
        o=dict(state=state,timers=timers,stationed=i%7!=0,defense=rand.choice([0,50,300,999,1200,1000000000]),updates=rand.choice([1,2,10,60,361]))
        recoveries.append(dict(input=o,native=recovery(o)))
    for i in range(144):
        o=dict(states=[dict(morale=rand.randrange(101),fatigue=rand.choice([0,50,80,99,100]),loyalty=rand.randrange(101)) for _ in range(2)],
               entryMorale=[rand.randrange(101),rand.randrange(101)],enabled=[bool(i&1),bool(i&2)],modifiers=[rand.randrange(-6,7),rand.randrange(-6,7)],
               updates=rand.choice([0,119,120,1199,1200,11879,11880]),outcome=1+i%5,rng=[rand.getrandbits(32),rand.getrandbits(32)])
        settlements.append(dict(input=o,native=settlement(o)))
    path=ROOT/'evidence/ai/native-condition-vectors.json'
    path.write_text(json.dumps(dict(exeSha256=SHA,recovery=recoveries,settlement=settlements),separators=(',',':')),encoding='utf8')
    shutil.copyfile(path,ROOT.parent/'sango2-web/packages/core/fixtures/native-condition-vectors.json')
    print(json.dumps(dict(recovery=len(recoveries),settlement=len(settlements))))


if __name__=='__main__':main()
