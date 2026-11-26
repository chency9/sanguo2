"""Original SYSTEM.SO captive scripts through original x86 integer VM.

Original host771 RNG, host10/3 dialogue wait registration and opcode66 waits
execute unchanged. UI showing/polling, sound device and final callbacks are
observed at boundaries. Host512 name strings and immutable script literals use
synthetic pointers to avoid unrelated C++ string allocation. The presentation
boundary closes %E% immediately and releases each message after a chosen number
of source updates; these controlled inputs are recorded in every fixture.
"""
import hashlib
import json
import random
import shutil
import struct
import sys
from native_ai_oracle import Oracle,ROOT,HEAP,SHA,STACK,STOP
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP,UC_X86_REG_EAX,UC_X86_REG_EIP,UC_X86_REG_ECX

CODE=(ROOT/'evidence/binary/SCRIPT_SYSTEM.SO').read_bytes()
SYMBOLS=json.loads((ROOT/'evidence/binary/SCRIPT_SYSTEM.SO.symbols.json').read_text(encoding='utf8'))
STRINGS=json.loads((ROOT/'evidence/binary/SCRIPT_SYSTEM.SO.strings.json').read_text(encoding='utf8'))
BY_NAME={r['name']:r for r in SYMBOLS}
CTX,MODULE,VALUES,BYTECODE=HEAP,HEAP+0x200,HEAP+0x1000,HEAP+0x40000
RULER,CAPTIVE=HEAP+0x2000,HEAP+0x3000


def text_at(vm,address):
    out=bytearray()
    while vm.cpu.mem_read(address+len(out),1)!=b'\0':out+=vm.cpu.mem_read(address+len(out),1)
    return out.decode('ascii')


def run(spec,messages):
    vm=Oracle();vm.cpu.mem_map(0,0x1000);vm.call(0x420D52);vm.set_rng(spec['rng']);vm.cpu.mem_write(BYTECODE,CODE)
    name={'yield':'YieldGeneral','kill':'KillGeneral','free':'FreeGeneral'}[spec['choice']]
    vm.put(CTX+8,MODULE);vm.put(MODULE+4,BYTECODE);vm.put(CTX+28,VALUES);vm.put(CTX+32,4096)
    args=[int(spec['accepted']),0] if spec['choice']=='yield' else []
    for i,value in enumerate([*args,0,0]):vm.put(VALUES+i*8,value)
    vm.put(CTX+20,len(args)+1);vm.put(CTX+24,len(args)+2);vm.put(CTX+16,BY_NAME[name]['offset'])
    vm.cpu.mem_write(RULER,b'RULER\0');vm.cpu.mem_write(CAPTIVE,b'CAPTIVE\0')
    vm.put(0x4A6878+7*4,RULER);vm.put(0x4A6878+8*4,CAPTIVE)
    table=HEAP+0x10000;vm.put(0x4A64D4,table)
    for message in messages:vm.put(table+4*int(message),HEAP+0xC0000)
    events=[];samples=[];time=0;busy=False;release=0;callback=None
    def decode(value):
        if value==RULER:return 'ruler'
        if value==CAPTIVE:return 'captive'
        return value
    def ret(value=0):
        sp=vm.cpu.reg_read(UC_X86_REG_ESP);vm.cpu.reg_write(UC_X86_REG_EAX,value&0xffffffff)
        vm.cpu.reg_write(UC_X86_REG_EIP,vm.u32(sp));vm.cpu.reg_write(UC_X86_REG_ESP,sp+4)
    def boundary(cpu,address,size,data):
        nonlocal busy,release,callback
        sp=cpu.reg_read(UC_X86_REG_ESP)
        if address==0x466560:
            ip=vm.u32(CTX+16);index=struct.unpack_from('<I',CODE,ip)[0];ptr=HEAP+0x90000+index*128
            vm.cpu.mem_write(ptr,STRINGS[index]['text_cp950'].encode('ascii')+b'\0');vm.put(CTX+16,ip+4)
            top=vm.u32(CTX+24);vm.put(VALUES+top*8,ptr);vm.put(VALUES+top*8+4,0);vm.put(CTX+24,top+1);ret(1)
        elif address==0x465F60:
            ip=vm.u32(CTX+16)
            if struct.unpack_from('<I',CODE,ip)[0]!=512:return
            vm.put(CTX+16,ip+8);top=vm.u32(CTX+24);value=vm.u32(VALUES+(top-1)*8)
            events.append(dict(t=time,host=512,args=[decode(value)]));ret(1)
        elif address==0x41FA3C:
            channel,actor,message=[vm.u32(sp+4+4*i) for i in range(3)]
            events.append(dict(t=time,host=10,args=[channel,decode(actor),message]));busy=True;release=time+spec['dialogueUpdates']+1
        elif address==0x41F950:
            channel,actor,source=[vm.u32(sp+4+4*i) for i in range(3)];literal=text_at(vm,source)
            events.append(dict(t=time,host=3,args=[channel,decode(actor),literal]));busy=literal!='%E%';release=time+spec['dialogueUpdates']+1
        elif address==0x43483A:ret(0)
        elif address==0x4344DA:ret(int(busy))
        elif address==0x41F9C1:
            channel,kind,ptr=[vm.u32(sp+4+4*i) for i in range(3)]
            events.append(dict(t=time,host=6,args=[channel,kind,text_at(vm,ptr)]));ret(0)
        elif address==0x420B77:
            events.append(dict(t=time,host=769,args=[text_at(vm,vm.u32(sp+4)),vm.u32(sp+8)]));ret(0)
        elif address in [0x420AFE,0x420B08,0x420B12]:
            callback={0x420AFE:521,0x420B08:528,0x420B12:529}[address];events.append(dict(t=time,host=callback,args=[]));ret(0)
    for address in [0x466560,0x465F60,0x41FA3C,0x41F950,0x43483A,0x4344DA,0x41F9C1,0x420B77,0x420AFE,0x420B08,0x420B12]:
        vm.cpu.hook_add(UC_HOOK_CODE,boundary,begin=address,end=address)
    for time in range(300):
        if busy and time>=release:busy=False
        vm.cpu.reg_write(UC_X86_REG_ECX,CTX);sp=STACK+0xF000;vm.put(sp,STOP);vm.cpu.reg_write(UC_X86_REG_ESP,sp)
        vm.cpu.emu_start(0x467F10,STOP,count=100000);assert vm.cpu.reg_read(UC_X86_REG_EIP)==STOP
        result=vm.cpu.reg_read(UC_X86_REG_EAX)
        samples.append(dict(t=time,rng=vm.rng(),waiting='dialogue' if busy else 'wait' if vm.u32(CTX+40)==0x467320 else 'done' if result==0xffffffff else 'ready',remaining=vm.i32(CTX+44) if vm.u32(CTX+40)==0x467320 else 0))
        if result==0xffffffff:return dict(ticks=time+1,events=events,samples=samples,callback=callback,rng=vm.rng())
    raise AssertionError('Captive script never completed')


def metadata():
    pak=next((ROOT.parent/'game-original-105plus').glob('*/Sango2.PAK')).read_bytes();_,count,offset=struct.unpack_from('<4sII',pak)
    for i in range(count):
        entry=pak[offset+64*i:offset+64*(i+1)]
        if entry[24:].split(b'\0')[0].upper()==b'MESSAGE.INI':
            size,pos=struct.unpack_from('<II',entry);raw=pak[pos:pos+size];break
    messages={}
    for line in raw.decode('cp950').splitlines():
        if '=' not in line:continue
        key,value=line.split('=',1);key=key.strip().upper()
        if key.startswith('MSG') and key[3:].isdigit() and 910<=int(key[3:])<=988:messages[str(int(key[3:]))]=value.strip()
    start=BY_NAME['KillGeneral']['offset'];end=BY_NAME['DownBrightness']['offset']
    return dict(systemSha256=hashlib.sha256(CODE).hexdigest(),messageIniSha256=hashlib.sha256(raw).hexdigest(),
        codeOffset=start,words=list(struct.unpack_from('<'+'I'*((end-start)//4),CODE,start)),
        entries={choice:BY_NAME[name]['offset'] for choice,name in [('kill','KillGeneral'),('free','FreeGeneral'),('yield','YieldGeneral')]},
        strings={str(i):row['text_cp950'] for i,row in enumerate(STRINGS) if i in [47,53]},messages=messages)


def main():
    data=metadata();r=random.Random(0x41FA3C);cases=[]
    for choice in ['yield','kill','free']:
        for accepted in ([False,True] if choice=='yield' else [False]):
            for lag in [0,2,7]:
                for i in range(12):
                    o=dict(choice=choice,accepted=accepted,dialogueUpdates=lag,rng=[r.getrandbits(32),r.getrandbits(32)])
                    cases.append(dict(input=o,native=run(o,data['messages'])))
    destination=ROOT.parent/'sango2-web/packages/core'
    (destination/'src/native-captive-script-data.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf8')
    path=ROOT/'evidence/ai/native-captive-script-vectors.json';path.write_text(json.dumps(dict(exeSha256=SHA,boundary=__doc__,cases=cases),separators=(',',':'))+'\n',encoding='utf8')
    shutil.copyfile(path,destination/'fixtures/native-captive-script-vectors.json')
    print(json.dumps(dict(cases=len(cases),messages=len(data['messages']),systemSha256=data['systemSha256'])))


if __name__=='__main__':main()
