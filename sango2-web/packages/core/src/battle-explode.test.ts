import {describe,it,expect,vi} from 'vitest';
import {createBattle,commandBattle,validateBattle,battleGeneral,battleFieldTroops,CHARGE_LIMIT,type BattleState,type BattleUnit} from './battle';
import {prepareBattleMovement} from './battle-movement';
import {advanceBattleNativeMagic,battleScriptCameraLocked} from './battle-native-magic';
import {NATIVE_MAGIC} from './native-battle-rules';

function position(unit:BattleUnit,x:number,y:number) {
  Object.assign(unit.movement!,{x,y,previousX:x,previousY:y,px:(96*x+48)*65536,py:(72*y+36)*65536,vx:0,vy:0,remaining:0});
  unit.x=(x+.5)/71*1200;unit.y=150+y/13*360;
}
function ready(sequence=7,enemyTroops=0) {
  const commander=(id:string)=>({id,name:id,portrait:'portraits/001.png',strength:80,intelligence:80,hp:100,maxHp:100,mp:150,maxMp:150,unit:'刀',level:40,skillLearnset:[{level:1,sequence}]});
  let b=createBattle({id:'explode',attacker:commander('a'),defender:{...commander('d'),skillLearnset:[]},attackingTroops:0,defendingTroops:enemyTroops,seed:184});
  b=commandBattle(b,{type:'start'});prepareBattleMovement(b);
  position(battleGeneral(b,'attacker'),25,6);position(battleGeneral(b,'defender'),60,0);
  b.units.filter(u=>!u.general).forEach((u,i)=>position(u,55+Math.floor(i/12),i%12+1));
  b.commanders.attacker.charge=CHARGE_LIMIT;return b;
}
function script(b:BattleState) {if(b.activeScript?.kind!=='native-explode')throw new Error('Expected native ExplodeRound');return b.activeScript;}
function step(b:BattleState,count=1,death=vi.fn()) {
  for(let i=0;i<count&&b.activeScript;i++){b.tick++;advanceBattleNativeMagic(b,death);}
  return death;
}
function firstBlast(b:BattleState) {
  for(let i=0;i<400&&!script(b).runtime.objects.some(o=>o.alive&&o.callback===8001);i++)step(b);
  const object=script(b).runtime.objects.find(o=>o.alive&&o.callback===8001)!;
  expect(object).toBeDefined();return object;
}

describe('native ExplodeRound in real battle snapshots',()=>{
  it.each([7,16,23])('dispatches skill %s to its source script and consumes MP once',sequence=>{
    const b=commandBattle(ready(sequence),{type:'skill',sequence});
    expect(b.explodeRules).toBe('native-explode-v1');expect(script(b).magic).toBe(sequence);
    expect(b.commanders.attacker.mp).toBe(150-NATIVE_MAGIC[sequence].mp);
    expect(battleScriptCameraLocked(b)).toBe(true);step(b,400);
    expect(b.activeScript).toBeUndefined();expect(battleScriptCameraLocked(b)).toBe(false);
    expect(b.commanders.attacker.mp).toBe(150-NATIVE_MAGIC[sequence].mp);validateBattle(b);
  });
  it('does not replace its point collisions with damage to distant soldiers',()=>{
    const b=commandBattle(ready(23,100),{type:'skill',sequence:23});step(b,500);
    expect(battleFieldTroops(b,'defender')).toBe(100);
    expect(battleGeneral(b,'defender').hp).toBe(100);validateBattle(b);
  });
  it('kills a soldier in an actual blast cell before starting its fire callback',()=>{
    const b=commandBattle(ready(7,1),{type:'skill',sequence:7}),blast=firstBlast(b);
    const target=b.units.find(u=>!u.general&&u.side==='defender')!;
    position(target,Math.trunc((blast.x>>16)/96),Math.trunc((blast.y>>16)/72));
    const death=step(b);expect(target.hp).toBe(0);expect(target.action).toBe('death');
    expect(death).toHaveBeenCalledTimes(1);expect(death).toHaveBeenCalledWith(target,battleGeneral(b,'attacker'));
    validateBattle(b);
  });
  it('damages a general directly without consuming its charge',()=>{
    const b=commandBattle(ready(),{type:'skill',sequence:7}),blast=firstBlast(b),target=battleGeneral(b,'defender');
    position(target,Math.trunc((blast.x>>16)/96),Math.trunc((blast.y>>16)/72));
    b.commanders.defender.charge=50000;step(b);
    expect(target.hp).toBeLessThan(100);expect(target.hp).toBeGreaterThanOrEqual(89);
    expect(b.commanders.defender.charge).toBe(50000);validateBattle(b);
  });
  it('does not collide with friendly soldiers in the same blast cell',()=>{
    const b=commandBattle(ready(7,1),{type:'skill',sequence:7}),blast=firstBlast(b);
    const unit=b.units.find(u=>!u.general)!;unit.side='attacker';unit.order='hold';
    b.troopDeployment!.attacker.active=1;b.initial.attacker=1;b.totalInitial.attacker=1;
    position(unit,Math.trunc((blast.x>>16)/96),Math.trunc((blast.y>>16)/72));
    step(b,50);expect(unit.hp).toBe(1);validateBattle(b);
  });
  it.each([1,42,81,109,170])('replays source objects, RNG and camera after a save at update %s',at=>{
    const b=commandBattle(ready(23),{type:'skill',sequence:23});step(b,at);validateBattle(b);
    const copy=JSON.parse(JSON.stringify(b)) as BattleState;validateBattle(copy);
    for(let i=0;i<500&&b.activeScript;i++){step(b);step(copy);expect(copy).toEqual(b);}
    expect(b.activeScript).toBeUndefined();validateBattle(b);
  });
});
