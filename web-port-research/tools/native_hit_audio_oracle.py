"""Original THINGS reaction-node audio and soldier callback sound output.

INI text, SHP lookup and sound handle lookup are supplied at data boundaries.
The x86 parser, animation selection and stepping execute unchanged; the audio
device callback is observed, not played. Defense cases intercept only animation
selection to record the selected action. Soldier case intercepts the final
death callback after recording its original named-sound call.
"""
import hashlib
import json
import shutil
import struct
import sys
from native_ai_oracle import Oracle,ROOT,HEAP,SHA
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP,UC_X86_REG_EAX,UC_X86_REG_EIP
sys.path.insert(0,str(ROOT.parent/'sango2-web/tools'))
from convert_assets import parse,rows,number


def cstr(vm,address):
    out=bytearray()
    while vm.cpu.mem_read(address+len(out),1)!=b'\0':out+=vm.cpu.mem_read(address+len(out),1)
    return out.decode('ascii')


def intercept(vm,addresses,callback):
    def hook(cpu,address,size,data):
        sp=cpu.reg_read(UC_X86_REG_ESP);value=callback(address,sp)
        cpu.reg_write(UC_X86_REG_EAX,(value or 0)&0xffffffff)
        cpu.reg_write(UC_X86_REG_EIP,vm.u32(sp));cpu.reg_write(UC_X86_REG_ESP,sp+4)
    for address in addresses:vm.cpu.hook_add(UC_HOOK_CODE,hook,begin=address,end=address)


def reaction(text,directory,kind):
    vm=Oracle();vm.set_rng([0x12345678,0x87654321])
    vm.put(0x4A7B40,HEAP+0x20000);vm.put(0x4D2778,0)
    vm.cpu.mem_write(0x4BBBA0,(directory.rstrip('\\')+'\\').encode('ascii')+b'\0')
    vm.put(0x4D267C,HEAP+0x1f000);vm.cpu.mem_write(HEAP+0x1f000,b'SHAPE\\\0')
    shapes={};sounds={};events=[];age=0
    def data(address,sp):
        if address==0x455662:vm.cpu.mem_write(vm.u32(sp+16),text.encode('ascii')+b'\0')
        elif address==0x46A930:return shapes.setdefault(cstr(vm,vm.u32(sp+4)).upper(),HEAP+0x10000+64*len(shapes))
        elif address==0x469860:
            name=cstr(vm,vm.u32(sp+4));return sounds.setdefault(name,len(sounds)+1)
        elif address==0x4698A0:
            handle=vm.u32(sp+16);name=next(name for name,value in sounds.items() if value==handle)
            events.append(dict(tick=age,name='SOUND\\'+name.upper()+'.WAV',volume=vm.u32(sp+20)))
    intercept(vm,[0x455662,0x46A930,0x469860,0x4698A0],data)
    action=vm.call(0x436B9A,HEAP,HEAP)
    event,definition,resource=HEAP+0x1000,HEAP+0x2000,HEAP+0x3000
    vm.put(definition+4,3);vm.put(definition+40,resource);vm.put(resource+(40 if kind=='pain' else 36),action)
    vm.put(event+124,definition);vm.put(event+76,0x422847)
    vm.call(0x421E1B,event,16 if kind=='pain' else 8)
    for age in range(1,10000):
        if vm.call(0x421BF2,event)==0xffffffff:break
    else:raise AssertionError('Reaction never ended')
    return dict(ticks=age,soundTicks=events,rng=vm.rng())


def defense(action,equal_facing,after_end):
    vm=Oracle();actor,attacker,node=HEAP,HEAP+0x1000,HEAP+0x2000
    vm.put(actor+52,action);vm.put(actor+44,0);vm.put(attacker+44,0 if equal_facing else 0x800000)
    vm.put(actor+120,node);vm.put(actor+84,1)
    selected=[]
    def observe(address,sp):
        chosen=vm.u32(sp+8);selected.append(chosen);vm.put(actor+52,chosen)
    intercept(vm,[0x421E1B],observe)
    vm.call(0x43E55C,actor,65546,attacker)
    before=dict(actions=list(selected),pending=bool(vm.u32(actor+104)&1))
    if after_end:vm.call(0x43E55C,actor,2,0)
    return dict(before=before,after=dict(actions=selected,pending=bool(vm.u32(actor+104)&1)))


def soldier():
    vm=Oracle();actor,callback=HEAP,HEAP+0xF000;vm.put(actor+76,callback)
    output=[]
    def observe(address,sp):
        if address==0x469900:output.append(dict(name=cstr(vm,vm.u32(sp+16)),volume=vm.u32(sp+20)))
        else:output.append(dict(event=vm.u32(sp+8)))
    intercept(vm,[0x469900,callback],observe)
    vm.call(0x43DDBF,actor,65540,HEAP+0x1000)
    return output


def main():
    pak=next((ROOT.parent/'game-original-105plus').glob('*/Sango2.PAK')).read_bytes()
    sha=hashlib.sha256(pak).hexdigest();assert sha=='4db9aa8d7ecaedc61b2826c63e4e130bffaae0f3c36c0c34b20bc76bb7bc47e6'
    _,count,offset=struct.unpack_from('<4sII',pak)
    for index in range(count):
        entry=pak[offset+64*index:offset+64*(index+1)]
        if entry[24:].split(b'\0')[0].upper()==b'THINGS.INI':
            size,pos=struct.unpack_from('<II',entry);objects=rows(parse(pak[pos:pos+size].decode('cp950')),'OBJECT');break
    cases=[]
    for obj in objects:
        sequence=number(obj.get('SEQUENCE'),-1)
        if not(600<=sequence<660 or 800<=sequence<860):continue
        for kind in ['pain','defense']:
            text=obj.get(kind.upper(),'')
            if text:cases.append(dict(object=sequence,kind=kind,text=text,native=reaction(text,obj['DIRECTORY'],kind)))
    defenses=[]
    for action in [1,4,32]:
        for equal in [False,True]:
            o=dict(action=action,equalFacing=equal,afterEnd=action==4)
            defenses.append(dict(input=o,native=defense(action,equal,action==4)))
    payload=dict(exeSha256=SHA,pakSha256=sha,reactions=cases,defenses=defenses,soldier=soldier(),
        boundary='SHP and sound handles supplied at data boundaries; actual sound-device call observed. Defense cases observe animation selection; soldier final death callback is observed. No RNG replacement.')
    path=ROOT/'evidence/ai/native-hit-audio-vectors.json';path.write_text(json.dumps(payload,separators=(',',':'))+'\n',encoding='utf8')
    shutil.copyfile(path,ROOT.parent/'sango2-web/packages/core/fixtures/native-hit-audio-vectors.json')
    print(json.dumps(dict(reactions=len(cases),defenses=len(defenses),soldier=payload['soldier'])))


if __name__=='__main__':main()
