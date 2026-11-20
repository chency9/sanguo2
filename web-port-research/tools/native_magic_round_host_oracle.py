"""Original ExplodeRound attachment and ordinary point-collision hosts.

Host 21 (0x41FBB8) runs unmodified against synthetic object records, including
the original fixed-point trigonometry. Collision 0x40A8CC runs its native
motion, frame update, category/height gate, point-grid query and callback
dispatch. Only the target's event handler and script-context construction
are observed boundaries; neither applies synthetic damage. This does not
execute the SO callback or a real mixed object list. Direct Hurt samples run
0x43ED96 and the original general HP/lock/clamp handler; action changes and
the post-zero-HP death event are observed, not executed. Casualty physics,
animation and other death side effects therefore are outside this fixture.
"""
import json
import shutil

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EAX, UC_X86_REG_EIP
from native_ai_oracle import Oracle, ROOT, HEAP, SHA, STOP


def intercept(vm, address, callback):
    def hook(cpu, address, size, _):
        sp=cpu.reg_read(UC_X86_REG_ESP)
        result=callback(sp)
        cpu.reg_write(UC_X86_REG_EAX,(result or 0)&0xffffffff)
        cpu.reg_write(UC_X86_REG_EIP,vm.u32(sp))
        cpu.reg_write(UC_X86_REG_ESP,sp+4)
    vm.cpu.hook_add(UC_HOOK_CODE,hook,begin=address,end=address)


def records(vm):
    table=HEAP+0x10000
    vm.put(0x4A64A0,table)
    objects=[table+168*n for n in [1,2,3]]
    for obj,handle in zip(objects,[1,2,3]):vm.put(obj,4660);vm.put(obj+4,handle)
    return objects


def attach(spec):
    vm=Oracle();vm.call(0x420D52)
    parent,_,effect=records(vm)
    for off,name in [(8,'x'),(12,'y'),(16,'z')]:vm.put(parent+off,spec[name])
    vm.call(0x41FBB8,3,1,spec['facing'],spec['distance'],spec['height'])
    return dict(x=vm.i32(effect+8),y=vm.i32(effect+12),z=vm.i32(effect+16),rng=vm.rng())


def collision(spec):
    vm=Oracle();parent,target,effect=records(vm)
    unit,other,team,enemy,frame=[HEAP+n for n in [0x20000,0x21000,0x22000,0x23000,0x24000]]
    vm.put(parent+132,unit);vm.put(unit+44,1);vm.put(unit+64,team)
    vm.put(effect+116,1);vm.put(effect+120,frame);vm.put(frame+4,9999);vm.put(effect+84,9999)
    vm.put(effect+48,spec['flags']);vm.put(effect+52,spec['action'])
    vm.put(effect+8,(21*96+48)*65536);vm.put(effect+12,(6*72+36)*65536);vm.put(effect+16,spec['z'])
    vm.put(effect+152,8001)
    vm.put(0x4C2C04,effect);vm.put(0x4C0BE0,effect);vm.put(0x4C09C0,1)
    vm.put(other+44,1 if spec['general'] else 2);vm.put(other+64,team if spec['ally'] else enemy);vm.put(other+68,target)
    if spec['occupied']:vm.put(0x4B3CA0+4*(6*71+21),other)
    vm.put(target+76,STOP+0x200);vm.cpu.mem_write(STOP+0x200,b'\xc3')
    events=[]
    vm.cpu.hook_add(UC_HOOK_CODE,lambda c,a,n,_:events.append(dict(kind='target',code=vm.u32(c.reg_read(UC_X86_REG_ESP)+8))),begin=STOP+0x200,end=STOP+0x200)
    intercept(vm,0x41F740,lambda sp:events.append(dict(kind='callback',args=[vm.i32(sp+4+4*i) for i in range(4)])) or 1)
    vm.call(0x40A8CC,effect)
    return dict(x=vm.i32(effect+8),y=vm.i32(effect+12),z=vm.i32(effect+16),events=events,rng=vm.rng())


def direct_hurt(spec):
    vm=Oracle();target,unit,team,general=[HEAP+n for n in [0,0x1000,0x2000,0x3000]]
    vm.put(target+132,unit);vm.put(target+76,0x43EF64);vm.put(unit+44,1);vm.put(unit+64,team);vm.put(team+72,general)
    vm.put(team+76,spec['charge']);vm.put(team+84,int(spec['locked']));vm.put(general+18,spec['hp'],True)
    actions=[];deaths=[]
    intercept(vm,0x421E1B,lambda sp:actions.append(vm.u32(sp+8)))
    def observe_death(cpu,address,size,_):
        sp=cpu.reg_read(UC_X86_REG_ESP)
        if vm.u32(sp+8)!=0x10003:return
        deaths.append(0x10003)
        cpu.reg_write(UC_X86_REG_EAX,0)
        cpu.reg_write(UC_X86_REG_EIP,vm.u32(sp));cpu.reg_write(UC_X86_REG_ESP,sp+4)
    vm.cpu.hook_add(UC_HOOK_CODE,observe_death,begin=0x43EF64,end=0x43EF64)
    # ExplodeRound supplies a null source and never calls the charge host295.
    vm.call(0x43ED96,target,0,spec['damage'])
    return dict(hp=int.from_bytes(vm.cpu.mem_read(general+18,2),'little',signed=True),
                charge=vm.i32(team+76),actions=actions,deaths=deaths,rng=vm.rng())


def main():
    attachments=[]
    for origin in [(1488*65536,468*65536,0),(1488*65536+12345,468*65536+321,9876)]:
        for facing in [0,1,31,32,63,64,95,96,127,128,159,160,191,192,223,224,255]:
            for distance in [72,180,240]:
                spec=dict(zip(['x','y','z'],origin),facing=facing,distance=distance,height=0)
                attachments.append(dict(input=spec,native=attach(spec)))
    collisions=[]
    for flags in [0,0x1000000,0x2000000,0x3000000,0xf000000]:
        for general in [False,True]:
            for ally in [False,True]:
                for z in [0,95*65536,96*65536]:
                    for action,occupied in [(0,True),(32,True),(0,False)]:
                        spec=dict(flags=flags,general=general,ally=ally,z=z,action=action,occupied=occupied)
                        native=collision(spec)
                        for event in native['events']:
                            if event['kind']=='callback':event['args'][0]='caster-object'
                        collisions.append(dict(input=spec,native=native))
    hurts=[]
    for locked in [False,True]:
        for hp in [1,100,300]:
            for damage in [1,4,9,18,37,75,150]:
                for charge in [0,60000,120000]:
                    spec=dict(locked=locked,hp=hp,damage=damage,charge=charge,percent=0)
                    hurts.append(dict(input=spec,native=direct_hurt(spec)))
    out=dict(exeSha256=SHA,boundary=__doc__,attachments=attachments,collisions=collisions,hurts=hurts)
    path=ROOT/'evidence/ai/native-magic-round-host-vectors.json'
    path.write_text(json.dumps(out,separators=(',',':')),encoding='utf8')
    shutil.copyfile(path,ROOT.parent/'sango2-web/packages/core/fixtures'/path.name)
    print(json.dumps(dict(attachments=len(attachments),collisions=len(collisions),hurts=len(hurts),firstCollision=next(c for c in collisions if c['native']['events']))))


if __name__=='__main__':main()
