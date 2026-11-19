import {describe,it,expect} from 'vitest';
import {createBattle,commandBattle,tickBattle,battleGeneral,battleSurvivors,validateBattle,type BattleState,type BattleUnit} from './battle';
import {prepareBattleMovement} from './battle-movement';
import {advanceBattleNativeMagic} from './battle-native-magic';

function ready(sequence=2,troops=0) {
  const c=(id:string)=>({id,name:id,portrait:'portraits/001.png',strength:80,intelligence:80,hp:100,maxHp:100,mp:150,maxMp:150,unit:'刀',level:1,skillLearnset:[{level:1,sequence}]});
  let b=createBattle({id:'native-shoot',attacker:c('a'),defender:{...c('d'),skillLearnset:[]},attackingTroops:0,defendingTroops:troops,seed:184});
  b=commandBattle(b,{type:'start'});prepareBattleMovement(b);
  position(battleGeneral(b,'attacker'),15,6);position(battleGeneral(b,'defender'),35,6);
  b.commanders.attacker.charge=120000;b.commanders.defender.charge=0;
  return b;
}
function position(u:BattleUnit,x:number,y:number) {
  Object.assign(u.movement!,{x,y,previousX:x,previousY:y,px:(x*96+48)*65536,py:(y*72+36)*65536,vx:0,vy:0,remaining:0});
  u.x=x/71*1200;u.y=150+y/13*360;
}
function step(b:BattleState,count=1) {for(let i=0;i<count;i++){b.opponentAI!.countdown=60;tickBattle(b);}}
function until(b:BattleState,predicate:()=>boolean,max=300) {for(let i=0;i<max&&!predicate();i++)step(b);expect(predicate()).toBe(true);}
function shot(b:BattleState) {if(b.activeScript?.kind!=='native-shoot')throw new Error('Expected native shot');return b.activeScript;}

describe('source ShootObject skills in actual battle snapshots',()=>{
  it.each([2,13,52,59])('executes skill %s on the source clock with the correct resource and damage',sequence=>{
    let b=ready(sequence);b=commandBattle(b,{type:'skill',sequence});
    expect(shot(b).runtime.phase).toBe('darken');expect(shot(b).runtime.age).toBe(0);
    step(b,23);expect(shot(b).runtime.phase).toBe('release');
    step(b);expect(shot(b).runtime.phase).toBe('flight');
    expect(shot(b).runtime.weapon?.object).toBe(({2:13001,13:13003,52:13001,59:13005} as Record<number,number>)[sequence]);
    const damage=shot(b).damage;
    until(b,()=>battleGeneral(b,'defender').hp<100);
    expect(battleGeneral(b,'defender').hp).toBe(100-damage);
    expect(b.effects.some(e=>e.targetZ===60)).toBe(true);
    until(b,()=>!b.activeScript);validateBattle(b);
  });
  it('misses a general that leaves the firing row and never homes toward it',()=>{
    let b=commandBattle(ready(),{type:'skill',sequence:2});step(b,24);
    const y=shot(b).runtime.weapon!.y;
    position(battleGeneral(b,'defender'),35,8);
    until(b,()=>!b.activeScript);
    expect(battleGeneral(b,'defender').hp).toBe(100);
    expect(y).toBe(468*65536);validateBattle(b);
  });
  it('launches from the caster position at release, including fixed-point fractions',()=>{
    const b=commandBattle(ready(),{type:'skill',sequence:2});step(b,22);
    const caster=battleGeneral(b,'attacker');position(caster,20,7);caster.movement!.px+=12345;
    step(b,2);const s=shot(b).runtime;
    expect(s.origin.x).toBe(caster.movement!.px);
    expect(s.weapon!.x).toBe(s.origin.x+80*65536+2*16*65536);
    expect(s.weapon!.y).toBe(caster.movement!.py);validateBattle(b);
  });
  it('御飛刀 deducts 60000 charge at collision while ordinary arrows leave charge intact',()=>{
    let b=commandBattle(ready(13),{type:'skill',sequence:13});
    until(b,()=>!!shot(b).runtime.weapon&&shot(b).runtime.weapon!.x>(35*96-50)*65536);
    b.commanders.defender.charge=120000;
    until(b,()=>battleGeneral(b,'defender').hp<100,5);
    // The hit occurs before this group's final two general source updates.
    expect(b.commanders.defender.charge).toBe(60160);validateBattle(b);
  });
  it('鬼戟 kills crossed soldiers and can continue to hit the enemy general',()=>{
    let b=ready(59,3);
    b.units.filter(u=>!u.general).forEach((u,i)=>position(u,20+i*3,6));
    b=commandBattle(b,{type:'skill',sequence:59});
    until(b,()=>!b.activeScript);
    expect(battleSurvivors(b,'defender')).toBe(0);
    expect(battleGeneral(b,'defender').hp).toBe(86);validateBattle(b);
  });
  it('ordinary arrows pass through soldiers and only collide with enemy generals',()=>{
    let b=ready(2,3);b.units.filter(u=>!u.general).forEach((u,i)=>position(u,20+i*3,6));
    b=commandBattle(b,{type:'skill',sequence:2});until(b,()=>!b.activeScript);
    expect(battleSurvivors(b,'defender')).toBe(3);expect(battleGeneral(b,'defender').hp).toBe(85);validateBattle(b);
  });
  it.each([1,14,19,24,38,45,60,100])('keeps the native coroutine and weapon identical after saving at step %s',at=>{
    const b=commandBattle(ready(59),{type:'skill',sequence:59});step(b,at);validateBattle(b);
    const restored=JSON.parse(JSON.stringify(b)) as BattleState;validateBattle(restored);
    for(let i=0;i<160;i++){step(b);step(restored);expect(restored).toEqual(b);}
    validateBattle(b);
  });
  it('keeps a battle without the new rules on the existing saved projectile adapter',()=>{
    const b=ready();delete b.magicRules;
    const old=commandBattle(b,{type:'skill',sequence:2});
    expect(old.activeScript?.kind).toBe('magic-projectile');step(old,16);
    expect(battleGeneral(old,'defender').hp).toBe(85);validateBattle(old);
  });
  it('does not allocate new effect ids, consume RNG or damage a target twice while saving',()=>{
    const b=commandBattle(ready(),{type:'skill',sequence:2});
    until(b,()=>battleGeneral(b,'defender').hp<100);const copy=JSON.parse(JSON.stringify(b)) as BattleState;
    step(b,10);step(copy,10);expect(copy).toEqual(b);expect(battleGeneral(b,'defender').hp).toBe(85);
  });
  it.each(['speed','resource','flags','phase','owner','damage','rule'])('rejects corrupt native magic %s',field=>{
    const b=commandBattle(ready(),{type:'skill',sequence:2});step(b,24);
    const s=shot(b);
    if(field==='speed')s.runtime.weapon!.vx++;
    if(field==='resource')s.runtime.weapon!.object=500;
    if(field==='flags')s.runtime.weapon!.flags=0;
    if(field==='phase')s.runtime.phaseAge=3000;
    if(field==='owner')s.casterId=s.targetId;
    if(field==='damage')s.damage=9000;
    if(field==='rule')delete b.magicRules;
    expect(()=>validateBattle(b)).toThrow();
  });
  it('allows the same native execution path for the enemy AI caster',()=>{
    let casts=0;
    for(let seed=1;seed<=128;seed++) {
      const b=ready();b.opponentAI!.rng=[seed,0x87654321];b.opponentAI!.countdown=1;
      b.commanders.defender.skillLearnset=[{level:1,sequence:2}];b.commanders.defender.charge=120000;
      tickBattle(b);
      if(b.activeScript?.kind==='native-shoot') {casts++;expect(b.activeScript.side).toBe('defender');expect(b.activeScript.runtime.sideFlag).toBe(0);validateBattle(b);}
    }
    expect(casts).toBeGreaterThan(0);
  });
});
