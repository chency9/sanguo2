import {describe,it,expect} from 'vitest';
import {createBattle,commandBattle,tickBattle,validateBattle,type BattleState} from './battle';
import {prepareBattleMovement} from './battle-movement';
import {updateBattleUnits} from './battle-unit-scheduler';
import {nativeRandom,nativeBelow,type NativeRandomState} from './native-strategic-ai';

function ready(unit='刀',troops=1):BattleState {
  const commander=(id:string)=>({id,name:id,portrait:'',strength:80,intelligence:80,hp:100,mp:40,unit,level:20});
  const b=commandBattle(createBattle({id:'source-clock',attacker:commander('a'),defender:commander('d'),attackingTroops:troops,defendingTroops:troops,seed:184}),{type:'start'});
  // Clock regression fixtures retain the pre-native-animation hit timings.
  delete b.nativeCommands;delete b.attackRules;delete b.projectileRules;delete b.projectiles;delete b.magicRules;delete b.generalRules;delete b.cameraRules;
  prepareBattleMovement(b);b.opponentAI!.countdown=60;
  for(const u of b.units){u.order='hold';u.movement!.clock!.decision=10000;}
  return b;
}
function place(b:BattleState,id:number,x:number,y:number) {
  const u=b.units.find(u=>u.id===id)!,m=u.movement!;
  Object.assign(m,{x,y,previousX:x,previousY:y,px:(x*96+48)*65536,py:(y*72+36)*65536});
  u.x=(x+.5)/71*1200;u.y=150+y/13*360;
}
const callbacks={unitType:()=>0,hit:()=>{},escaped:()=>{}};
function sourceGroup(b:BattleState,extra:Partial<typeof callbacks>={}){b.tick++;updateBattleUnits(b,{...callbacks,...extra});}

describe('per-source-update decisions and attacks',()=>{
  it('makes the second decision on source update 41, without losing the group remainder',()=>{
    const b=ready(),u=b.units.find(u=>!u.general&&u.side==='attacker')!,c=u.movement!.clock!;c.decision=1;c.attack=100;u.order='advance';
    sourceGroup(b);expect(c.decision).toBe(38);expect(u.movement!.remaining).toBe(38);
    for(let i=0;i<12;i++)sourceGroup(b);expect(c.decision).toBe(2);expect(c.attack).toBe(99);
    sourceGroup(b);expect(c.decision).toBe(39);expect(c.attack).toBe(98);expect(u.movement!.remaining).toBe(39);
    validateBattle(b);
  });
  it('uses 46 retreat updates and decrements attack cooldown only on decisions',()=>{
    const b=ready(),u=b.units.find(u=>!u.general&&u.side==='attacker')!,c=u.movement!.clock!;
    place(b,u.id,35,6);u.order='retreat';c.decision=1;c.attack=10;
    for(let i=0;i<15;i++)sourceGroup(b);
    expect(c.decision).toBe(2);expect(c.attack).toBe(9);
    sourceGroup(b);expect(c.decision).toBe(45);expect(c.attack).toBe(8);
  });
  it('searches the reserved row, respecting allies and consuming the direction draw even when blocked',()=>{
    const b=ready('刀',2),[u,ally]=b.units.filter(u=>!u.general&&u.side==='attacker'),enemy=b.units.find(u=>!u.general&&u.side==='defender')!;
    place(b,u.id,35,6);place(b,ally.id,36,6);place(b,enemy.id,37,6);
    u.movement!.clock!.decision=1;const expected=[...b.opponentAI!.rng] as NativeRandomState;nativeRandom(expected);
    sourceGroup(b);expect(u.action).toBe('wait');expect(b.opponentAI!.rng).toEqual(expected);
    // Directly neighbouring enemy now becomes the attack target.
    place(b,ally.id,36,5);place(b,enemy.id,36,6);u.movement!.clock!.decision=1;
    sourceGroup(b);expect(u.action).toBe('attack');expect(u.target).toBe(enemy.id);
  });
  it('uses the native archer search cooldown rather than waiting for its animation to finish',()=>{
    const b=ready('弓'),u=b.units.find(u=>!u.general&&u.side==='attacker')!,enemy=b.units.find(u=>!u.general&&u.side==='defender')!;
    place(b,u.id,35,6);place(b,enemy.id,45,6);const c=u.movement!.clock!;c.decision=1;
    sourceGroup(b,{unitType:()=>3});expect(u.action).toBe('attack');expect(c.attack).toBe(3);
    for(let i=0;i<13;i++)sourceGroup(b,{unitType:()=>3});expect(c.attack).toBe(2);
    for(let i=0;i<13;i++)sourceGroup(b,{unitType:()=>3});expect(c.attack).toBe(1);
  });
  it('keeps the 21st-source-update hit exactly once across a JSON restore',()=>{
    const b=ready(),u=b.units.find(u=>!u.general&&u.side==='attacker')!,enemy=b.units.find(u=>!u.general&&u.side==='defender')!;
    place(b,u.id,35,6);place(b,enemy.id,36,6);u.movement!.clock!.decision=1;
    let hits=0;for(let i=0;i<6;i++)sourceGroup(b,{hit:()=>{hits++;}});
    expect(hits).toBe(0);const restored:BattleState=JSON.parse(JSON.stringify(b));validateBattle(restored);let restoredHits=0;
    sourceGroup(b,{hit:()=>{hits++;}});sourceGroup(restored,{hit:()=>{restoredHits++;}});
    expect(hits).toBe(1);expect(restoredHits).toBe(1);expect(restored).toEqual(b);
    sourceGroup(b,{hit:()=>{hits++;}});expect(hits).toBe(1);
  });
  it('processes deferred waiting without searching or moving, and validates source-clock saves',()=>{
    const b=ready(),u=b.units.find(u=>!u.general)!,m=u.movement!,c=m.clock!;c.decision=1;c.deferred=7;m.vx=1000;
    const before=m.px,rng=[...b.opponentAI!.rng];sourceGroup(b);
    expect(c).toMatchObject({decision:5,deferred:0,attack:0});expect(m.px).toBe(before);expect(b.opponentAI!.rng).toEqual(rng);validateBattle(b);
    const bad=structuredClone(b);bad.units.find(a=>a.id===u.id)!.movement!.clock!.attack=NaN;expect(()=>validateBattle(bad)).toThrow();
    const missing=structuredClone(b);delete missing.units.find(a=>a.id===u.id)!.movement!.clock;expect(()=>validateBattle(missing)).toThrow();
  });
  it('runs the source hit through real damage and casualty creation',()=>{
    const b=ready(),u=b.units.find(u=>!u.general&&u.side==='attacker')!,enemy=b.units.find(u=>!u.general&&u.side==='defender')!;
    place(b,u.id,35,6);place(b,enemy.id,36,6);u.action='attack';u.target=enemy.id;u.hit=false;u.movement!.clock!.actionAge=18;
    let seed=0;while(nativeBelow([seed,0x87654321],300)>=50)seed++;
    b.opponentAI!.rng=[seed,0x87654321];
    tickBattle(b);expect(u.hit).toBe(true);expect(enemy.hp).toBe(0);expect(enemy.casualty).toBeDefined();validateBattle(b);
  });
  it('rechecks the hit cell and does not damage a melee target that has moved away',()=>{
    const b=ready(),u=b.units.find(u=>!u.general&&u.side==='attacker')!,enemy=b.units.find(u=>!u.general&&u.side==='defender')!;
    place(b,u.id,35,6);place(b,enemy.id,36,6);u.movement!.clock!.decision=1;
    sourceGroup(b);expect(u.target).toBe(enemy.id);place(b,enemy.id,38,6);
    let hits=0;for(let i=0;i<6;i++)sourceGroup(b,{hit:()=>{hits++;}});
    expect(u.hit).toBe(true);expect(hits).toBe(0);
  });
  it('keeps an issued retreat order from resetting the current decision or animation',()=>{
    let b=ready();const u=b.units.find(u=>!u.general&&u.side==='attacker')!;
    u.action='attack';u.movement!.clock!.actionAge=8;u.movement!.clock!.decision=20;
    b=commandBattle(b,{type:'order',division:'all',order:'retreat'});
    const saved=b.units.find(other=>other.id===u.id)!;
    expect(saved.action).toBe('attack');expect(saved.movement!.clock).toMatchObject({actionAge:8,decision:20});
    sourceGroup(b);expect(saved.movement!.clock!.decision).toBe(17);
  });
});
