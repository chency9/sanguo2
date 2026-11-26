import {describe,it,expect,vi} from 'vitest';
import {createBattle,commandBattle,tickBattle,validateBattle,battleGeneral,battleFieldTroops,CHARGE_LIMIT,type BattleState,type BattleUnit} from './battle';
import {prepareBattleMovement} from './battle-movement';
import {advanceBattleNativeMagic,battleMagicLocked,battleScriptCameraLocked} from './battle-native-magic';
import {NATIVE_MAGIC} from './native-battle-rules';
import {nativeRollTubHit} from './native-magic-rolltub';

function position(unit:BattleUnit,x:number,y:number) {
  Object.assign(unit.movement!,{x,y,previousX:x,previousY:y,px:(96*x+48)*65536,py:(72*y+36)*65536,vx:0,vy:0,remaining:0});
  unit.x=(x+.5)/71*1200;unit.y=150+y/13*360;
}
function ready(sequence=6,enemyTroops=0) {
  const commander=(id:string)=>({id,name:id,portrait:'portraits/001.png',strength:80,intelligence:80,hp:100,maxHp:100,mp:150,maxMp:150,unit:'刀',level:40,skillLearnset:[{level:1,sequence}]});
  let b=createBattle({id:'rolltub',attacker:commander('a'),defender:{...commander('d'),skillLearnset:[]},attackingTroops:0,defendingTroops:enemyTroops,seed:184});
  b=commandBattle(b,{type:'start'});prepareBattleMovement(b);
  position(battleGeneral(b,'attacker'),2,6);position(battleGeneral(b,'defender'),50,0);
  b.units.filter(u=>!u.general).forEach((u,i)=>position(u,5+Math.floor(i/12),i%12+1));
  b.commanders.attacker.charge=CHARGE_LIMIT;return b;
}
function script(b:BattleState) {if(b.activeScript?.kind!=='native-rolltub')throw new Error('Expected native RollTub');return b.activeScript;}
function step(b:BattleState,count=1,death=vi.fn()) {
  for(let i=0;i<count&&b.activeScript;i++){b.tick++;advanceBattleNativeMagic(b,death);}
  return death;
}
function firstTub(b:BattleState) {
  const inGrid=(o:{alive:boolean;callback:number;y:number})=>o.alive&&o.callback===39001&&(o.y>>16)<936;
  for(let i=0;i<200&&!script(b).runtime.objects.some(inGrid);i++)step(b);
  const object=script(b).runtime.objects.find(inGrid)!;
  expect(object).toBeDefined();return object;
}
function inNextCell(b:BattleState,unit:BattleUnit,handle:number) {
  const o=script(b).runtime.objects.find(o=>o.handle===handle)!;
  position(unit,Math.trunc(((o.x+o.vx)>>16)/96),Math.trunc(((o.y+o.vy)>>16)/72));
}

describe('native RollTub in actual battle snapshots',()=>{
  it.each([[6,1],[20,2],[35,4]])('dispatches skill %s into %s original waves and charges MP once',(sequence,waves)=>{
    const b=commandBattle(ready(sequence),{type:'skill',sequence});
    expect(b.rollTubRules).toBe('native-rolltub-v1');expect(script(b).magic).toBe(sequence);
    expect(b.commanders.attacker.mp).toBe(150-NATIVE_MAGIC[sequence].mp);
    expect(battleScriptCameraLocked(b)).toBe(true);const runtime=script(b).runtime;step(b,600);
    expect(runtime.objects.filter(o=>o.object===49001)).toHaveLength(19*waves);
    expect(b.activeScript).toBeUndefined();expect(battleScriptCameraLocked(b)).toBe(false);
    expect(b.commanders.attacker.mp).toBe(150-NATIVE_MAGIC[sequence].mp);validateBattle(b);
  });
  it('runs from the real tick scheduler on all three source updates',()=>{
    const b=commandBattle(ready(),{type:'skill',sequence:6});tickBattle(b,10);
    expect(script(b).runtime.age).toBe(30);expect(battleMagicLocked(b,battleGeneral(b,'attacker'))).toBe(true);
    expect(battleGeneral(b,'attacker').movement!.clock!.deferred).toBeGreaterThan(0);validateBattle(b);
  });
  it('publishes the script sound at its absolute source update',()=>{
    const b=commandBattle(ready(),{type:'skill',sequence:6});tickBattle(b,40);
    expect(b.soundEvents!.events).toContainEqual(expect.objectContaining({name:'m039snd01',volume:255,sourceTick:115}));
    validateBattle(b);
  });
  it('samples the enemy at update 55 and preserves the wave anchor afterwards',()=>{
    const b=commandBattle(ready(20),{type:'skill',sequence:20});step(b,40);
    position(battleGeneral(b,'defender'),40,0);step(b,16);
    const s=script(b).runtime,x=(40*96+48);
    expect(s.target!.x).toBe(x*65536);expect(s.tasks.filter(t=>t.kind==='CreateRollTub').map(t=>t.args[0])).toContain(x);
    position(battleGeneral(b,'defender'),60,0);step(b,90);
    expect(s.target!.x).toBe(x*65536);expect(s.tasks.filter(t=>t.kind==='CreateRollTub').every(t=>Math.abs(t.args[0]-x)<=864)).toBe(true);
  });
  it('keeps distant soldiers alive instead of applying a sampled area pulse',()=>{
    const b=commandBattle(ready(35,100),{type:'skill',sequence:35});step(b,600);
    expect(battleFieldTroops(b,'defender')).toBe(100);validateBattle(b);
  });
  it('sends soldier death before its delayed original break callback',()=>{
    const b=commandBattle(ready(6,1),{type:'skill',sequence:6}),tub=firstTub(b),target=b.units.find(u=>!u.general)!;
    inNextCell(b,target,tub.handle);const death=step(b);
    expect(target.hp).toBe(0);expect(target.action).toBe('death');expect(death).toHaveBeenCalledOnce();
    expect(script(b).runtime.tasks).toContainEqual(expect.objectContaining({kind:'RollTubCallback',args:[tub.handle,100000+target.id,NATIVE_MAGIC[6].attack]}));
    step(b,23);expect(script(b).runtime.objects.filter(o=>o.object!==49001)).toHaveLength(8);
    expect(tub.alive).toBe(false);validateBattle(b);
  });
  it('damages an enemy general once even when several tubes hit it',()=>{
    const b=commandBattle(ready(),{type:'skill',sequence:6}),tub=firstTub(b),target=battleGeneral(b,'defender');
    b.commanders.defender.charge=50000;inNextCell(b,target,tub.handle);step(b,2);
    const other=script(b).runtime.objects.find(o=>o.object===49001&&o.handle!==tub.handle&&o.alive)!;
    inNextCell(b,target,other.handle);step(b,30);
    expect(target.hp).toBe(100-NATIVE_MAGIC[6].attack);expect(b.commanders.defender.charge).toBe(50000);
    expect(script(b).runtime.generalHit).toBe(true);validateBattle(b);
  });
  it('allows another same-tube collision while the first callback waits for sound',()=>{
    const b=commandBattle(ready(),{type:'skill',sequence:6}),tub=firstTub(b),target=battleGeneral(b,'defender');
    inNextCell(b,target,tub.handle);step(b,2);
    expect(script(b).runtime.tasks.filter(t=>t.kind==='RollTubCallback'&&t.args[0]===tub.handle)).toHaveLength(2);
    step(b,24);
    expect(script(b).runtime.objects.filter(o=>o.object!==49001)).toHaveLength(16);
    expect(target.hp).toBe(100-NATIVE_MAGIC[6].attack);validateBattle(b);
  });
  it('does not hit an ally standing in a rolling object cell',()=>{
    const b=commandBattle(ready(),{type:'skill',sequence:6}),tub=firstTub(b),caster=battleGeneral(b,'attacker');
    inNextCell(b,caster,tub.handle);step(b,25);expect(caster.hp).toBe(100);
    expect(script(b).runtime.objects.filter(o=>o.object!==49001)).toHaveLength(0);validateBattle(b);
  });
  it('releases camera and all pending roll/break callbacks when a round ends',()=>{
    const b=commandBattle(ready(6,1),{type:'skill',sequence:6}),tub=firstTub(b),target=b.units.find(u=>!u.general)!;
    inNextCell(b,target,tub.handle);step(b,2);expect(script(b).runtime.ambientPending).toBe(true);
    battleGeneral(b,'defender').hp=0;tickBattle(b);
    expect(['intermission','finished']).toContain(b.phase);expect(b.activeScript).toBeUndefined();expect(battleScriptCameraLocked(b)).toBe(false);
    validateBattle(b);validateBattle(JSON.parse(JSON.stringify(b)));
  });
  it.each([1,21,56,111,150,300])('replays original objects, waits, camera and RNG after JSON at %s',at=>{
    const b=commandBattle(ready(35),{type:'skill',sequence:35});step(b,at);validateBattle(b);
    const copy=JSON.parse(JSON.stringify(b)) as BattleState;validateBattle(copy);
    for(let i=0;i<600&&b.activeScript;i++){step(b);step(copy);expect(copy).toEqual(b);}
    expect(b.activeScript).toBeUndefined();validateBattle(b);
  });
  it('restores a pending hit without repeating damage, fragments or sound',()=>{
    const b=commandBattle(ready(),{type:'skill',sequence:6}),tub=firstTub(b),s=script(b).runtime,target=battleGeneral(b,'defender');
    nativeRollTubHit(s,tub.handle,{id:2,general:true,alive:true,x:target.movement!.px,y:target.movement!.py,z:0},NATIVE_MAGIC[6].attack);step(b,3);
    const copy=JSON.parse(JSON.stringify(b)) as BattleState;validateBattle(copy);
    for(let i=0;i<600&&b.activeScript;i++){step(b);step(copy);expect(copy).toEqual(b);}
    expect(target.hp).toBe(100-NATIVE_MAGIC[6].attack);validateBattle(b);
  });
});
