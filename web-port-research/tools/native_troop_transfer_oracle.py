"""Run original +/- soldiers, slider target and pending-fill x86 functions.

No callbacks, troop decisions, UI arithmetic or RNG are replaced. The slider
callback's 0x10000 event executes its native loops and 0x41D9A0 value update.
These are isolated snapshots, not a replay of the full Windows UI lifecycle.
"""
import json
import random
import struct
from pathlib import Path

from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from unicorn import UC_HOOK_MEM_WRITE
from native_ai_oracle import Oracle, HEAP, STACK, SHA, PE

ROOT = Path(__file__).resolve().parents[2]


def main():
    o = Oracle();r = random.Random(0x416366)
    officer, city, window = HEAP+0x1000, HEAP+0x2000, HEAP+0x3000
    writes = []
    def record(cpu, access, address, size, value, data):
        if not STACK <= address < STACK+0x10000:
            writes.append((address,size))
    o.cpu.hook_add(UC_HOOK_MEM_WRITE,record)
    cases = []
    for i in range(328):
        level = [1,19,20,21,39,40,60][i%7]
        cap = dict(active=min(100,level*5),reserve=min(100,max(0,(level-20)*5)))
        pool_cap = [110,122,150,510,600][i%5]
        active, reserve = r.randrange(cap['active']+1),r.randrange(cap['reserve']+1)
        pool = [0,pool_cap,pool_cap-1,r.randrange(pool_cap+1)][(i//4)%4]
        mode = ['add','return','target','fill'][i%4]
        if i < 8:
            active, reserve = min(2,cap['active']), min(5,cap['reserve'])
            pool = 0 if i%2 == 0 else pool_cap-1
        elif i%11==0:active,reserve=cap['active'],cap['reserve']
        elif i%13==0:active,reserve=0,0
        target = r.randrange(cap['active']+cap['reserve']+1)
        pending = 0 if i>=320 else 1
        if i>=320:mode='fill'
        state = dict(active=active,reserve=reserve,maxActive=cap['active'],maxReserve=cap['reserve'],pool=pool,poolCapacity=pool_cap)
        o.cpu.mem_write(HEAP, r.randbytes(0x5000))
        o.put(0x4C2E98,officer);o.put(0x4C30D0,city);o.put(0x4A6424,pending);o.put(0x4A642C,0)
        for offset,value in [(66,cap['active']),(68,active),(70,cap['reserve']),(72,reserve)]:o.put(officer+offset,value,True)
        o.put(city+130,pool_cap);o.put(city+134,pool)
        o.cpu.mem_write(window,bytes(80));o.put(window+4,38);o.put(window+8,236)
        o.put(window+40,target);o.put(window+48,max(1,cap['active']+cap['reserve']))
        rng = [r.randrange(1,2**32),r.randrange(1,2**32)];o.set_rng(rng);writes.clear()
        if mode=='add':o.call(0x416415,officer);target=active+reserve+1
        elif mode=='return':o.call(0x416366,officer);target=max(0,active+reserve-1)
        elif mode=='target':o.call(0x4164E0,window,0x10000)
        else:o.call(0x41A6FB);target=cap['active']+cap['reserve'] if pending else active+reserve
        after = dict(active=struct.unpack('<h',o.cpu.mem_read(officer+68,2))[0],
                     reserve=struct.unpack('<h',o.cpu.mem_read(officer+72,2))[0],pool=o.u32(city+134))
        assert active+reserve+pool == sum(after.values())
        assert o.rng()==rng
        if mode=='fill':assert o.u32(0x4A6424)==0
        allowed = {(officer+68,2),(officer+72,2),(city+134,4)}
        if mode=='target':allowed|={(window+40,4),(window+32,4)}
        if mode=='fill':allowed.add((0x4A6424,4))
        assert set(writes)<=allowed
        assert 0<=after['active']<=cap['active'] and 0<=after['reserve']<=cap['reserve']
        cases.append(dict(mode=mode,level=level,input=state,target=target,pending=pending,output=after,rng=rng,rngAfter=o.rng()))
    path = ROOT/'sango2-web/packages/core/fixtures/native-troop-transfer.json'
    path.write_text(json.dumps(dict(exeSha256=SHA,cases=cases),separators=(',',':'))+'\n',encoding='utf8')
    ranges = [(0x416366,0x4164E0),(0x4164E0,0x4167CF),(0x41A6FB,0x41A7CE)]
    evidence = dict(exeSha256=SHA,ranges=[])
    for start,end in ranges:
        instructions=[f'{ins.address:08x} {ins.mnemonic} {ins.op_str}' for ins in
                      Cs(CS_ARCH_X86,CS_MODE_32).disasm(PE.get_data(start-0x400000,end-start),start)]
        evidence['ranges'].append(dict(start=start,end=end,instructions=instructions))
    (ROOT/'sango2-web/docs/evidence/native-troop-transfer.json').write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf8')
    print(f'{len(cases)} original troop transfer cases; native slider/fill executed, no hooks replacing code, soldiers and RNG conserved')


if __name__=='__main__':main()
