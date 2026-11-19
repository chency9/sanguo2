import {describe,it,expect} from 'vitest';
import vectors from '../fixtures/native-casualty-vectors.json';
import {nativeCasualty,nativeAdvanceFlight,nativeDetachedObject,nativeDetachedWalk} from './native-casualty';
import {nativeGridOccupancy,nativeGridCount,nativeGridIndex,projectBattleCell} from './native-battle-grid';
import type {NativeRandomState} from './native-strategic-ai';
import {nativeBelow} from './native-strategic-ai';
import {createBattle,commandBattle,tickBattle,validateBattle,type BattleState,type BattleCommander} from './battle';
import {advanceBattleCasualties,battleCasualtyPosition,beginBattleCasualty,battleDetachedPosition} from './battle-casualties';
import {prepareBattleMovement} from './battle-movement';

describe('original casualty and grid functions',()=>{
  it.each(vectors.deaths.map((v,index)=>({...v,index})))('matches casualty initialization and final RNG $index',({input,native})=>{
    const rng=[...input.rng] as NativeRandomState;
    expect(nativeCasualty(input,rng)).toEqual({flight:native.flight,detached:native.detached});expect(rng).toEqual(native.rng);
  });
  it.each(vectors.movement.map((v,index)=>({...v,index})))('matches signed fixed-point flight updates $index',({input,native})=>{
    const {flags,action,updates,...flight}=input;
    for(let i=0;i<updates;i++)nativeAdvanceFlight(flight,flags,action);
    expect(flight).toEqual(native);
  });
  it.each(vectors.walking.map((v,index)=>({...v,index})))('matches delayed horse speed and heading $index',({input,native})=>{
    const rng=[...input.rng] as NativeRandomState;
    expect({...nativeDetachedWalk(input.heading,rng),rng}).toEqual(native);
  });
  it.each(vectors.grid.map((v,index)=>({...v,index})))('matches native occupancy count including reversed/outside rectangles $index',({input,native})=>{
    expect(nativeGridCount(nativeGridOccupancy(input.cells),input.side,...input.rect as [number,number,number,number])).toBe(native);
  });
  it.each(vectors.types)('retains source object mappings for unit $unit',v=>{
    expect(nativeDetachedObject(v.unit,false)).toBe(v.objects[0]);expect(nativeDetachedObject(v.unit,true)).toBe(v.objects[1]);
  });
  it('keeps all 71 columns and 14 rows, rejecting out-of-range occupancy',()=>{
    expect(nativeGridIndex(70,13)).toBe(993);expect(nativeGridIndex(71,13)).toBe(-1);expect(nativeGridIndex(70,14)).toBe(-1);
    expect(projectBattleCell(1200,510)).toEqual({x:70,y:13});expect(projectBattleCell(0,150)).toEqual({x:0,y:0});
    const grid=nativeGridOccupancy([{x:70,y:13,side:0},{x:70,y:13,side:1},{x:-1,y:0,side:0}]);
    expect(nativeGridCount(grid,0,0,0,70,13)).toBe(0);expect(nativeGridCount(grid,1,0,0,70,13)).toBe(1);
  });
});

function readyStrike(reserve=true,legacy=false) {
  const commander=(id:string):BattleCommander=>({id,name:id,portrait:'portraits/001.png',strength:80,intelligence:80,hp:100,mp:40,level:40,unit:'刀'});
  const a=commander('a'),d=commander('d');
  let b=createBattle({id:'casualties',attacker:a,defender:d,attackingTroops:1,defendingTroops:1,seed:184,
    rosters:{attacker:[{commander:a,troops:1,withdrawn:false}],defender:[{commander:d,troops:1,troopSlots:{active:reserve?0:1,reserve:reserve?1:0},withdrawn:false}]}});
  // Preserve the existing v2 event/RNG fixture; v3 source-clock death has a
  // separate scheduler integration test with its own target-search draws.
  delete b.deploymentRules;delete b.nativeCommands;b.movementRules='native-grid-v2';delete b.attackRules;delete b.projectileRules;delete b.projectiles;delete b.magicRules;
  if(legacy){delete b.casualtyRules;delete b.detached;}
  b=commandBattle(b,{type:'start'});
  for(const u of b.units){u.order='hold';u.x=u.side==='attacker'?64:1136;u.y=342;}
  const attacker=b.units.find(u=>u.side==='attacker'&&!u.general)!,victim=b.units.find(u=>u.side==='defender'&&!u.general)!;
  attacker.x=500;attacker.y=330;victim.x=520;victim.y=330;
  attacker.action='attack';attacker.actionTick=6;attacker.target=victim.id;attacker.hit=false;b.opponentAI!.countdown=60;
  const seed=vectors.deaths.find(v=>nativeBelow([...v.input.rng] as NativeRandomState,300)<50)!.input.rng;
  b.opponentAI!.rng=[...seed] as NativeRandomState;
  return {b,attacker,victim,seed:[...seed] as NativeRandomState};
}
describe('casualty lifecycle and shared AI random stream',()=>{
  it('uses reserved cells and simulation coordinates for death RNG while preserving the visible horse origin',()=>{
    const {b,attacker,victim,seed}=readyStrike();prepareBattleMovement(b);
    const m=victim.movement!;m.x=30;m.y=6;m.px=(30*96+48)*65536;m.py=(6*72+36)*65536;
    // Visual separation must not move this casualty away from the source row-6 RNG branch.
    victim.x=600;victim.y=450;victim.hp=0;victim.action='death';
    nativeBelow(seed,0x200000);nativeBelow(seed,48);nativeBelow(seed,36);nativeBelow(seed,0x10000);
    beginBattleCasualty(b,victim,attacker,0);
    expect(b.opponentAI!.rng).toEqual(seed);expect(victim.casualty!.origin).toEqual({x:m.px,y:m.py});
    expect(battleDetachedPosition(b.detached![0])).toEqual({x:victim.x,y:victim.y});validateBattle(b);
    b.detached![0].displayOffset!.x=NaN;expect(()=>validateBattle(b)).toThrow();
  });
  it('consumes death setup once, then consumes detached-horse speed on the 24th source update',()=>{
    const {b,victim,seed}=readyStrike();
    nativeBelow(seed,300);nativeBelow(seed,0x200000);nativeBelow(seed,48);nativeBelow(seed,36);nativeBelow(seed,0x10000);
    tickBattle(b);expect(victim.hp).toBe(0);expect(b.opponentAI!.rng).toEqual(seed);
    expect(b.detached).toHaveLength(1);expect(b.detached![0]).toMatchObject({object:190,age:0,vx:0,vy:0});
    const before=battleCasualtyPosition(victim);tickBattle(b,7);
    expect(b.detached![0].age).toBe(21);expect(b.opponentAI!.rng).toEqual(seed);
    expect(battleCasualtyPosition(victim)).not.toEqual(before);
    const restored:BattleState=JSON.parse(JSON.stringify(b));validateBattle(restored);
    nativeBelow(seed,4);tickBattle(b);tickBattle(restored);
    expect(b.detached![0].age).toBe(24);expect(b.detached![0].vx).not.toBe(0);
    expect(b.opponentAI!.rng).toEqual(seed);expect(restored).toEqual(b);validateBattle(b);
  });
  it('keeps old saved battles on their old random schedule',()=>{
    const {b,victim,seed}=readyStrike(false,true);nativeBelow(seed,300);tickBattle(b);
    expect(victim.hp).toBe(0);expect(victim.casualty).toBeUndefined();expect(b.detached).toBeUndefined();expect(b.opponentAI!.rng).toEqual(seed);validateBattle(b);
  });
  it('uses no random values for visual-only flight and does not command dead units to retreat',()=>{
    const {b}=readyStrike();tickBattle(b);const state=b.opponentAI!.rng.slice();
    const dead=b.units.find(u=>u.casualty)!;dead.side='attacker';
    const retreat=commandBattle(b,{type:'order',division:'all',order:'retreat'});
    expect(retreat.units.find(u=>u.id===dead.id)!.action).toBe('death');
    advanceBattleCasualties(b,3);expect(b.opponentAI!.rng).toEqual(state);
  });
  it('rejects corrupt casualty snapshots and expires detached horses without changing troop totals',()=>{
    const {b}=readyStrike();tickBattle(b);const bad=structuredClone(b);bad.detached![0].age=NaN;expect(()=>validateBattle(bad)).toThrow();
    const badFlight=structuredClone(b);badFlight.units.find(u=>u.casualty)!.casualty!.flight.z=-1;expect(()=>validateBattle(badFlight)).toThrow();
    const ids=structuredClone(b);ids.detached![0].id=ids.units[0].id;expect(()=>validateBattle(ids)).toThrow();
    const missing=structuredClone(b);delete missing.detached;expect(()=>validateBattle(missing)).toThrow();
    const totals=structuredClone(b.initial);b.detached![0].age=2399;advanceBattleCasualties(b,1);
    expect(b.detached).toEqual([]);expect(b.initial).toEqual(totals);
  });
});
