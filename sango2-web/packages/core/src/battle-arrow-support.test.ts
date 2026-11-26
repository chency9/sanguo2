import {describe,it,expect,vi} from 'vitest';
import {createBattle,commandBattle,tickBattle,validateBattle,battleGeneral,battleFieldTroops,CHARGE_LIMIT,type BattleState,type BattleUnit} from './battle';
import {prepareBattleMovement} from './battle-movement';
import {advanceBattleNativeMagic,battleMagicLocked,battleScriptCameraLocked} from './battle-native-magic';
import {NATIVE_MAGIC} from './native-battle-rules';
import {nativeArrowSupportObjectEvent,type NativeArrowSupportObject} from './native-magic-arrow-support';

function position(unit:BattleUnit,x:number,y:number) {
  Object.assign(unit.movement!,{x,y,previousX:x,previousY:y,px:(96*x+48)*65536,py:(72*y+36)*65536,vx:0,vy:0,remaining:0});
  unit.x=(x+.5)/71*1200;unit.y=150+y/13*360;
}
function ready(sequence=4,enemyTroops=0) {
  const commander=(id:string)=>({id,name:id,portrait:'portraits/001.png',strength:80,intelligence:80,hp:100,maxHp:100,mp:150,maxMp:150,unit:'刀',level:40,skillLearnset:[{level:1,sequence}]});
  let b=createBattle({id:'arrow-support',attacker:commander('a'),defender:{...commander('d'),skillLearnset:[]},attackingTroops:0,defendingTroops:enemyTroops,seed:184});
  b=commandBattle(b,{type:'start'});prepareBattleMovement(b);
  position(battleGeneral(b,'attacker'),10,6);position(battleGeneral(b,'defender'),50,6);
  b.units.filter(u=>!u.general).forEach((u,i)=>position(u,40+Math.floor(i/12),i%12+1));
  b.commanders.attacker.charge=CHARGE_LIMIT;return b;
}
function script(b:BattleState) {if(b.activeScript?.kind!=='native-arrow-support')throw new Error('Expected native ArrowSupport');return b.activeScript;}
function step(b:BattleState,count=1,death=vi.fn()) {
  for(let i=0;i<count&&b.activeScript;i++){b.tick++;advanceBattleNativeMagic(b,death);}
  return death;
}
function descending(b:BattleState):NativeArrowSupportObject {
  const ready=(o:NativeArrowSupportObject)=>o.alive&&o.deathAt===undefined&&[6001,6002].includes(o.callback)&&o.z+o.vz>0&&o.z+o.vz<96*65536&&o.vz<0;
  for(let i=0;i<400&&!script(b).runtime.objects.some(ready);i++)step(b);
  const arrow=script(b).runtime.objects.find(ready);expect(arrow).toBeDefined();return arrow!;
}
function nextCell(unit:BattleUnit,o:NativeArrowSupportObject) {position(unit,Math.trunc(((o.x+o.vx)>>16)/96),Math.trunc(((o.y+o.vy)>>16)/72));}

describe('ArrowSupport in real battle state',()=>{
  it.each([4,15,30,45,72,87])('casts skill%s through the source wrapper and spends MP once',sequence=>{
    const b=commandBattle(ready(sequence),{type:'skill',sequence});
    expect(b.arrowSupportRules).toBe('native-arrow-support-v1');expect(script(b).runtime.attack).toBe(NATIVE_MAGIC[sequence].attack);
    expect(b.commanders.attacker.mp).toBe(150-NATIVE_MAGIC[sequence].mp);expect(battleScriptCameraLocked(b)).toBe(true);
    step(b,600);expect(b.activeScript).toBeUndefined();expect(battleScriptCameraLocked(b)).toBe(false);
    expect(b.commanders.attacker.mp).toBe(150-NATIVE_MAGIC[sequence].mp);validateBattle(b);
  });
  it('advances on every source update and locks the caster only during its pose',()=>{
    const b=commandBattle(ready(),{type:'skill',sequence:4});tickBattle(b,10);
    expect(script(b).runtime.age).toBe(30);expect(battleMagicLocked(b,battleGeneral(b,'attacker'))).toBe(true);
    tickBattle(b,5);expect(battleMagicLocked(b,battleGeneral(b,'attacker'))).toBe(false);validateBattle(b);
  });
  it('creates the original off-field archers and upward arrows from draw-node6004',()=>{
    const b=commandBattle(ready(),{type:'skill',sequence:4});step(b,160);
    const s=script(b).runtime;expect(s.objects.filter(o=>o.object===16002)).toHaveLength(17);
    expect(s.objects.filter(o=>o.object===16003)).toHaveLength(17);expect(s.objects.filter(o=>o.object===16009)).toHaveLength(17);
    expect(b.soundEvents!.events.filter(e=>e.name==='arrow')).toHaveLength(17);validateBattle(b);
  });
  it('does not apply any area damage while the arrows are above the native hit height',()=>{
    const b=commandBattle(ready(30,30),{type:'skill',sequence:30});step(b,240);
    expect(battleFieldTroops(b,'defender')).toBe(30);expect(battleGeneral(b,'defender').hp).toBe(100);validateBattle(b);
  });
  it('sends native soldier death before its fiery arrow callback',()=>{
    const b=commandBattle(ready(4,1),{type:'skill',sequence:4}),o=descending(b),target=b.units.find(u=>!u.general)!;
    nextCell(target,o);const death=step(b);
    expect(target.hp).toBe(0);expect(death).toHaveBeenCalledWith(target,battleGeneral(b,'attacker'));
    expect(script(b).runtime.tasks).toContainEqual(expect.objectContaining({entry:'ArrowCallback2'}));
    step(b,2);expect(script(b).runtime.objects.some(o=>o.object===10015)).toBe(true);
    expect(b.soundEvents!.events.some(e=>e.name==='Hit01'&&e.volume===255)).toBe(true);validateBattle(b);
  });
  it('uses ATTACK and the shared original divisor for consecutive general hits',()=>{
    const b=commandBattle(ready(),{type:'skill',sequence:4}),o=descending(b),target=battleGeneral(b,'defender'),s=script(b).runtime;
    const data=()=>({id:2,general:true,alive:true,hp:target.hp,x:target.movement!.px,y:target.movement!.py,z:0,facing:128});
    b.commanders.defender.charge=50000;
    nativeArrowSupportObjectEvent(s,o.handle,6002,data());step(b);
    expect(target.hp).toBe(94);expect(s.statics[8]).toBe(2);
    const other=s.objects.find(p=>p.callback===6002&&p.handle!==o.handle)!;
    nativeArrowSupportObjectEvent(s,other.handle,6002,data());step(b);
    expect(target.hp).toBe(91);expect(s.statics[8]).toBe(4);expect(b.commanders.defender.charge).toBe(50000);validateBattle(b);
  });
  it('ignores an ally occupying a descending arrow cell',()=>{
    const b=commandBattle(ready(),{type:'skill',sequence:4}),o=descending(b),target=battleGeneral(b,'attacker');
    nextCell(target,o);step(b,2);expect(target.hp).toBe(100);validateBattle(b);
  });
  it('clears archers, descending arrows, callbacks and camera ownership when a round ends',()=>{
    const b=commandBattle(ready(),{type:'skill',sequence:4});descending(b);
    battleGeneral(b,'defender').hp=0;tickBattle(b);
    expect(['intermission','finished']).toContain(b.phase);expect(b.activeScript).toBeUndefined();expect(battleScriptCameraLocked(b)).toBe(false);
    validateBattle(b);validateBattle(JSON.parse(JSON.stringify(b)));
  });
  it.each([1,21,71,132,172,270])('replays actual objects, nested VM frames and RNG after JSON at%s',at=>{
    const b=commandBattle(ready(30,3),{type:'skill',sequence:30});step(b,at);validateBattle(b);
    const copy=JSON.parse(JSON.stringify(b)) as BattleState;validateBattle(copy);
    for(let i=0;i<600&&b.activeScript;i++){step(b);step(copy);expect(copy).toEqual(b);}
    expect(b.activeScript).toBeUndefined();validateBattle(b);
  });
});
