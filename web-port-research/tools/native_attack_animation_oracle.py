"""Original THINGS parser, action selection and frame stepping on real PAK text.

Only INI value/define retrieval and SHP lookup are supplied at data boundaries.
Original tokenizer, duration/event assignment, allocator, selection, frame step
and generic event callback execute unchanged. No timing or RNG is stubbed.
"""
import hashlib,json,shutil,struct,sys
from pathlib import Path
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX,UC_X86_REG_EIP,UC_X86_REG_ESP
from native_ai_oracle import Oracle,ROOT,HEAP,SHA
sys.path.insert(0,str(ROOT.parent/'sango2-web/tools'))
from convert_assets import parse,rows,number
from native_animation import attack_frames,attack_timeline

def trace(text,directory):
    vm=Oracle();vm.put(0x4A7B40,HEAP+0x20000);vm.put(0x4D2778,0)
    vm.cpu.mem_write(0x4BBBA0,(directory.rstrip('\\')+'\\').encode('ascii')+b'\0')
    vm.put(0x4D267C,HEAP+0x1f000);vm.cpu.mem_write(HEAP+0x1f000,b'SHAPE\\\0')
    shapes={};paths={};hits=[];at=0
    def cstr(addr):
        out=bytearray()
        while vm.cpu.mem_read(addr+len(out),1)!=b'\0':out+=vm.cpu.mem_read(addr+len(out),1)
        return out.decode('ascii')
    def supply(cpu,address,size,_):
        sp=cpu.reg_read(UC_X86_REG_ESP);value=0
        if address==0x455662:
            vm.cpu.mem_write(vm.u32(sp+16),text.encode('ascii')+b'\0')
        elif address==0x455513:
            key=cstr(vm.u32(sp+8));assert key.upper()=='DEFINE\\OM_ATTACK',key
            vm.cpu.mem_write(vm.u32(sp+16),b'65536\0')
        elif address==0x46A930:
            path=cstr(vm.u32(sp+4)).upper();value=shapes.setdefault(path,HEAP+0x10000+len(shapes)*64);paths[value]=path
        cpu.reg_write(UC_X86_REG_EAX,value);cpu.reg_write(UC_X86_REG_EIP,vm.u32(sp));cpu.reg_write(UC_X86_REG_ESP,sp+4)
    for address in [0x455662,0x455513,0x46A930]:vm.cpu.hook_add(UC_HOOK_CODE,supply,begin=address,end=address)
    action=vm.call(0x436B9A,HEAP,HEAP)
    nodes=[];ptr=action
    while ptr:
        nodes.append(dict(key=paths[vm.u32(ptr)],ticks=vm.i32(ptr+4),hit=vm.u32(ptr+16)==65536))
        ptr=vm.u32(ptr+8)
        assert len(nodes)<100,'Expected finite attack'
    if not nodes:return dict(frames=[],ticks=0,hitTicks=[],trace=[])
    event,definition,resource=HEAP+0x1000,HEAP+0x2000,HEAP+0x3000
    vm.put(definition+4,3);vm.put(definition+40,resource);vm.put(resource+32,action);vm.put(resource+48,action)
    vm.put(event+124,definition);vm.put(event+76,0x422847)
    def observe(cpu,address,size,_):
        sp=cpu.reg_read(UC_X86_REG_ESP)
        if vm.u32(sp+8)==65536:hits.append(at)
    vm.cpu.hook_add(UC_HOOK_CODE,observe,begin=0x422847,end=0x422847)
    vm.call(0x421E1B,event,64)
    frames_by_ptr={};ptr=action
    for i in range(len(nodes)):frames_by_ptr[ptr]=i;ptr=vm.u32(ptr+8)
    frames_trace=[frames_by_ptr[vm.u32(event+120)]]
    for at in range(1,10001):
        result=vm.call(0x421BF2,event)
        if result==0xffffffff:break
        frames_trace.append(frames_by_ptr[vm.u32(event+120)])
    else:raise AssertionError('No animation end')
    return dict(frames=nodes,ticks=at,hitTicks=hits,trace=frames_trace)

def main():
    pak=next((ROOT.parent/'game-original-105plus').glob('*/Sango2.PAK')).read_bytes()
    sha=hashlib.sha256(pak).hexdigest();assert sha=='4db9aa8d7ecaedc61b2826c63e4e130bffaae0f3c36c0c34b20bc76bb7bc47e6'
    _,count,offset=struct.unpack_from('<4sII',pak)
    for i in range(count):
        entry=pak[offset+64*i:offset+64*(i+1)]
        if entry[24:].split(b'\0')[0].upper()==b'THINGS.INI':
            size,pos=struct.unpack_from('<II',entry);objects=rows(parse(pak[pos:pos+size].decode('cp950')),'OBJECT');break
    ids=set(list(range(100,113))+list(range(120,133))+list(range(140,153))+list(range(160,173))+list(range(600,660))+list(range(800,860))+list(range(700,768))+list(range(900,908)))
    cases=[]
    for obj in objects:
        seq=number(obj.get('SEQUENCE'),-1)
        if seq not in ids:continue
        for key in ['ATTACK']+(['WIN'] if seq<180 else []):
            text=obj.get(key,'')
            if not text:continue
            native=trace(text,obj['DIRECTORY']);converted=attack_frames(text,obj['DIRECTORY']);timing=attack_timeline(converted)
            assert [{k:f[k] for k in ['key','ticks','hit']} for f in converted]==native['frames'],(seq,key)
            assert timing['ticks']==native['ticks'] and timing['hitTicks']==native['hitTicks'],(seq,key,timing,native)
            cases.append(dict(object=seq,action=key,text=text,directory=obj['DIRECTORY'],native=native))
    path=ROOT/'evidence/ai/native-attack-animation-vectors.json'
    path.write_text(json.dumps(dict(exeSha256=SHA,pakSha256=sha,cases=cases),separators=(',',':')),encoding='utf8')
    shutil.copyfile(path,ROOT.parent/'sango2-web/packages/core/fixtures/native-attack-animation-vectors.json')
    print(json.dumps(dict(actions=len(cases),ticks=sum(v['native']['ticks'] for v in cases))))
if __name__=='__main__':main()
