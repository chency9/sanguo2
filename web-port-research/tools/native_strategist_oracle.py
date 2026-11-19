"""Native strategist oracle. Synthetic runtime rates, NOT CSV Level aliases.

Execute alongside native_ai_oracle.py with the same pinned EXE and environment.
No selection, RNG, INT comparison or INI lookup routines are stubbed.
"""
import hashlib
import json
import random
import shutil
import struct
from pathlib import Path
from native_ai_oracle import Oracle, ROOT, HEAP, SHA, PE, UC_HOOK_CODE, UC_X86_REG_ESP


def selection(o):
    vm = Oracle()
    team, commander, advisor, table = HEAP, HEAP+0x1000, HEAP+0x2000, HEAP+0x4000
    vm.set_rng(o['rng'])
    vm.put(team+28, commander)
    vm.put(team+1108, advisor)
    vm.put(commander+68, min(100, o['troops']), True)
    vm.put(commander+72, max(0, o['troops']-100), True)
    vm.put(0x4A61A8, table)
    for i, s in enumerate(o['slots']):
        vm.cpu.mem_write(advisor+92+i, bytes([s['sequence']]))
        vm.put(table+24*s['sequence']+8, s['active'])
        vm.put(table+24*s['sequence']+12, s['rate'])
    weights = []
    def capture(cpu, address, size, data):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        weights.append(list(struct.unpack('<8i', cpu.mem_read(vm.u32(sp+4), 32))))
    vm.cpu.hook_add(UC_HOOK_CODE, capture, begin=0x468740, end=0x468740)
    sequence = vm.call(0x4040F3, team)
    assert vm.u32(team+1112) == sequence
    return {'sequence': sequence, 'slot': struct.unpack('<b', vm.cpu.mem_read(advisor+100, 1))[0],
            'weights': weights, 'rng': vm.rng()}


def cancellation(o):
    vm = Oracle()
    table, own, enemy = HEAP, HEAP+0x2000, HEAP+0x3000
    vm.put(0x4A61A8, table)
    for p, side in [(own, o['own']), (enemy, o['enemy'])]:
        vm.put(p+54, side['intelligence'], True)
        vm.put(table+24*side['sequence']+4, side['attribute'])
    return bool(vm.call(0x44D3E0, o['own']['sequence'], o['enemy']['sequence'], own, enemy))


def advisor(intelligence):
    vm = Oracle()
    for i, value in enumerate(intelligence):
        ptr = HEAP+0x2000+i*0x100
        vm.put(HEAP+4*i, ptr)
        vm.put(ptr+54, value, True)
    return (vm.call(0x40CC99, HEAP, len(intelligence))-(HEAP+0x2000))//0x100


def lottery(o):
    vm = Oracle()
    vm.set_rng(o['rng'])
    for i, value in enumerate(o['weights']):
        vm.put(HEAP+4*i, value)
    value = vm.call(0x468740, HEAP, len(o['weights']))
    return {'slot': -1 if value == 0xffffffff else value, 'rng': vm.rng()}


def missing_rate():
    vm = Oracle()
    # Real parser's linked entry representation: section+11 -> first key,
    # key+0/+4 -> string offsets, key+12 -> next entry. Only Level is present.
    vm.put(0x4A679C, HEAP)
    vm.put(0x4A6798, HEAP+0x2000)
    vm.put(0x4A6840, 0x1000)
    vm.put(HEAP+11, 0x100)
    vm.put(HEAP+0x100, 0)
    vm.put(HEAP+0x104, 6)
    vm.cpu.mem_write(HEAP+0x2000, b'Level\x00120\x00')
    vm.cpu.mem_write(HEAP+0x3000, b'Rate\x00')
    results = []
    for sentinel in [0, 120, -1, 0x12345678]:
        vm.put(HEAP+0x4000, sentinel)
        status = vm.call(0x45568D, 0, HEAP+0x3000, 1, HEAP+0x4000)
        results.append({'before': sentinel, 'status': status, 'after': vm.i32(HEAP+0x4000)})
        assert status == 0xffffffff and vm.i32(HEAP+0x4000) == sentinel
    return results


def main():
    rand = random.Random(0x4040F3)
    choices, conflicts, advisors, lotteries = [], [], [], []
    for case in range(256):
        slots = [dict(sequence=i+1 if rand.randrange(4) else 0, active=rand.choice([1,2,3,4,8]),
                      rate=rand.choice([0,99,100,120,199,200,299,300,490])) for i in range(8)]
        if case % 16 == 0:
            for s in slots: s['active'] = 1  # Force the fallback with no troops.
        if case % 16 == 1:
            for s in slots: s['rate'] = 0
        if case % 16 == 2:
            for s in slots: s['sequence'] = 0
        if case % 16 == 3:
            for s in slots: s['rate'] = rand.choice([-1, 0x7fffffff, 0x40000000])
        o = {'slots': slots, 'troops': 0 if case % 2 == 0 else rand.randrange(201),
             'rng': [rand.getrandbits(32), rand.getrandbits(32)]}
        choices.append({'input': o, 'native': selection(o)})
    for own_attribute in range(4):
        for enemy_attribute in range(4):
            for intelligence in [49,50,51]:
                for same in [False,True]:
                    if same and own_attribute != enemy_attribute: continue
                    o = {'own':dict(sequence=1,attribute=own_attribute,intelligence=intelligence),
                         'enemy':dict(sequence=1 if same else 2,attribute=enemy_attribute,intelligence=50)}
                    conflicts.append({'input':o,'succeeds':cancellation(o)})
    for _ in range(64):
        values = [rand.randrange(1,6)*20 for _ in range(rand.randrange(1,16))]
        advisors.append({'intelligence':values,'chosen':advisor(values)})
        o = {'weights':[rand.choice([-1,0,1,100,0x7fffffff,-0x80000000]) for _ in range(8)],
             'rng':[rand.getrandbits(32),rand.getrandbits(32)]}
        lotteries.append({'input':o,'native':lottery(o)})
    payload = {'exeSha256':SHA,'rateSource':'Synthetic runtime table, NOT the supplied Level config',
               'choices':choices,'conflicts':conflicts,'advisors':advisors,'lotteries':lotteries}
    out = ROOT/'evidence/ai'
    vectors = out/'native-strategist-vectors.json'
    vectors.write_text(json.dumps(payload,separators=(',',':')),encoding='utf8')
    shutil.copyfile(vectors,ROOT.parent/'sango2-web/packages/core/fixtures/native-strategist-vectors.json')
    sources = [ROOT/'evidence/ida/static-export'/f'{address}{ext}'
               for address in ['004040f3','0040cc99','0044d3e0','00468740','0042f3c8','0045509f','00455187','0045568d','00446b52','00446d4e']
               for ext in ['.c','.asm.json']]
    sources += [ROOT/'evidence/binary/MAGIC.INI.cp950.txt',Path(__file__).resolve()]
    evidence = {'exeSha256':SHA,'vectorSha256':hashlib.sha256(vectors.read_bytes()).hexdigest(),
                'sourceHashes':{str(p.relative_to(ROOT)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in sources},
                'loaderKeyAddress':'0x48CC58','loaderKeyBytes':PE.get_data(0x8cc58,5).hex(),
                'lookupAddress':'0x45568D','missingRateProbes':missing_rate(),
                'limitation':'Native loader 0x42F3C8 ignores missing Rate and copies uninitialized local var_8. Actual rates require runtime capture; Level is not substituted.'}
    (out/'strategist-manifest.json').write_text(json.dumps(evidence,indent=2),encoding='utf8')
    print(json.dumps({k:len(v) for k,v in payload.items() if isinstance(v,list)}))


if __name__ == '__main__':
    main()
