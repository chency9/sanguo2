"""Original magic-object collision, fade, direct HP and charge host functions.

Synthetic world snapshots; target action/death transitions and script creation
are observed boundaries. No collision classification, motion, fade, HP/charge
arithmetic or RNG is replaced. SO callbacks are checked separately in the VM.
"""
import json
import shutil
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EAX, UC_X86_REG_EIP, UC_X86_REG_ECX
from native_ai_oracle import Oracle, ROOT, HEAP, SHA, STOP
from native_magic_shoot_oracle import ScriptOracle, CTX


def intercept(vm, address, callback):
    def hook(cpu, address, size, _):
        sp = cpu.reg_read(UC_X86_REG_ESP)
        result = callback(sp)
        cpu.reg_write(UC_X86_REG_EAX, (result or 0) & 0xffffffff)
        cpu.reg_write(UC_X86_REG_EIP, vm.u32(sp))
        cpu.reg_write(UC_X86_REG_ESP, sp + 4)
    vm.cpu.hook_add(UC_HOOK_CODE, hook, begin=address, end=address)


def collision(spec):
    vm = Oracle()
    table, unit, other, team, enemy, frame = [HEAP+n for n in [0x10000,0x20000,0x21000,0x22000,0x23000,0x24000]]
    parent, target, weapon = [table+168*n for n in [1,2,3]]
    vm.put(0x4A64A0, table)
    for obj, handle in [(parent,1),(target,2),(weapon,3)]:
        vm.put(obj,4660);vm.put(obj+4,handle)
    vm.put(parent+132,unit);vm.put(unit+44,1);vm.put(unit+64,team)
    vm.put(weapon+116,1);vm.put(weapon+120,frame);vm.put(frame+4,9999);vm.put(weapon+84,9999)
    vm.put(weapon+48,spec['flags']);vm.put(weapon+8,2000*65536);vm.put(weapon+12,468*65536);vm.put(weapon+16,spec['z'])
    vm.put(weapon+20,16*65536);vm.put(weapon+152,3001)
    vm.put(0x4C2C04,weapon);vm.put(0x4C0BE0,weapon);vm.put(0x4C09C0,1)
    vm.put(other+44,1 if spec['general'] else 2);vm.put(other+64,team if spec['ally'] else enemy);vm.put(other+68,target)
    vm.put(0x4B3CA0+4*(6*71+21),other)
    vm.put(target+76,STOP+0x200);vm.cpu.mem_write(STOP+0x200,b'\xc3')
    events=[]
    vm.cpu.hook_add(UC_HOOK_CODE,lambda c,a,n,_:events.append(['target',vm.u32(c.reg_read(UC_X86_REG_ESP)+8)]),begin=STOP+0x200,end=STOP+0x200)
    intercept(vm,0x41F740,lambda sp:events.append(['script',*[vm.i32(sp+4+4*i) for i in range(4)]]) or 1)
    vm.call(0x40A8CC,weapon)
    return dict(x=vm.i32(weapon+8),y=vm.i32(weapon+12),z=vm.i32(weapon+16),events=events)


def fade(style):
    vm=Oracle();p,frame=HEAP,HEAP+0x1000
    vm.put(p,4660);vm.put(p+4,1);vm.put(p+120,frame);vm.put(p+84,9999)
    vm.put(0x4C2C04,p);vm.put(0x4C0BE0,p);vm.put(0x4C09C0,1)
    vm.put(p+48,0x10000);vm.put(p+16,80*65536)
    vm.call(0x40A828,p,16 if style==2 else 2,8 if style==2 else 1)
    trace=[]
    for _ in range(130):
        trace.append(dict(alive=vm.u32(p)==4660,fade=vm.i32(p+88),wait=vm.i32(p+80)))
        if vm.u32(p)!=4660:break
        vm.call(0x40A8CC,p)
    return trace


def hurt(spec):
    vm=Oracle();event,unit,team,general=[HEAP+n for n in [0,0x1000,0x2000,0x3000]]
    vm.put(event+132,unit);vm.put(event+76,0x43EF64);vm.put(unit+44,1);vm.put(unit+64,team);vm.put(team+72,general)
    vm.put(team+76,spec['charge']);vm.put(team+84,int(spec['locked']));vm.put(general+18,spec['hp'],True)
    actions=[]
    intercept(vm,0x421E1B,lambda sp:actions.append(vm.u32(sp+8)))
    vm.call(0x43EE09,event,spec['percent'])
    # A null source is what Hurt passes to host 293: no ordinary-attack RNG.
    vm.call(0x43ED96,event,0,spec['damage'])
    return dict(hp=int.from_bytes(vm.cpu.mem_read(general+18,2),'little',signed=True),charge=vm.i32(team+76),actions=actions)


def callback(style, flaming, general):
    spec=dict(side=1,x=1488,y=468,rng=[1,2],attack=30)
    vm=ScriptOracle(spec,'ShootObjectCallback',[3,2 if general else 4])
    vm.objects[3]=dict(x=1488<<16,y=468<<16,z=80<<16,facing=0,alive=1,u0=style,u1=flaming)
    vm.objects[4]=dict(vm.objects[2])
    vm.vm.cpu.reg_write(UC_X86_REG_ECX,CTX);vm.vm.call(0x467F10)
    return dict(events=vm.events,rng=vm.vm.rng())


def main():
    collisions=[]
    for flags in [0x1010000,0x3010000]:
        for general in [False,True]:
            for ally in [False,True]:
                for z in [69*65536,80*65536,96*65536]:
                    spec=dict(flags=flags,general=general,ally=ally,z=z)
                    collisions.append(dict(input=spec,native=collision(spec)))
    hurts=[]
    for locked in [False,True]:
        for hp in [100,300]:
            for damage in [0,14,25,30]:
                for charge in [0,50000,120000]:
                    spec=dict(locked=locked,hp=hp,damage=damage,charge=charge,percent=50)
                    hurts.append(dict(input=spec,native=hurt(spec)))
    callbacks=[dict(input=dict(style=s,flaming=f,general=g),native=callback(s,f,g)) for s in range(3) for f in range(2) for g in [False,True]]
    data=dict(exeSha256=SHA,boundary=__doc__,collisions=collisions,hurts=hurts,callbacks=callbacks,fades=[fade(s) for s in range(3)])
    path=ROOT/'evidence/ai/native-magic-impact-vectors.json'
    path.write_text(json.dumps(data,separators=(',',':')),encoding='utf8')
    shutil.copyfile(path,ROOT.parent/'sango2-web/packages/core/fixtures'/path.name)
    print(json.dumps(dict(collisions=len(collisions),hurts=len(hurts),callbacks=len(callbacks),fadeLengths=[len(x) for x in data['fades']])))


if __name__=='__main__':main()
