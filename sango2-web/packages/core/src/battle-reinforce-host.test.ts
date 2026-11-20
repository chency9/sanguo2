import {describe,it,expect} from 'vitest';
import vectors from '../fixtures/native-reinforce-host-vectors.json';
import {createBattle,tickBattle,type BattleState,type BattleSide,type BattleUnit} from './battle';
import {prepareBattleMovement} from './battle-movement';
import {createBattleReinforceSoldier} from './battle-reinforce';
import {nativeSoldierObject} from './native-troops';

const UNIT_NAMES=['刀','槍','大','弓','鏈','飛','武','蠻','鐵','籐','賊','弩','女'];
const sideFor=(side:number):BattleSide=>side===0?'defender':'attacker';
type AllocationInput={label:string;side:number;unit:number;command:number;flags:number[];x:number;y:number;decision:number;occupied?:boolean};
type HostRecord={slot:number;x:number;y:number;index:number;unitMask:number;division:number;command:number;flags:number;decision:number};
type AllocationResult={handle:number;slotCount:number;living:number;created:{handle:number;x:number;y:number;z:number;facing:number;object:number}[];slots:HostRecord[];warnings:number;rng:number[]};
type AllocationCase={input:AllocationInput;native:AllocationResult};
const allocationCases=vectors.allocations as AllocationCase[];

function emptyBattle(level=40):BattleState {
  const commander=(id:string)=>({id,name:id,portrait:'portraits/001.png',strength:80,intelligence:80,hp:100,mp:100,unit:'刀',level});
  const b=createBattle({id:'native-host-reinforce',attacker:commander('a'),defender:commander('d'),attackingTroops:0,defendingTroops:0,seed:184});
  prepareBattleMovement(b);
  // Keep commanders away from the synthetic host's candidate cell. The host
  // fixtures expose occupancy explicitly, independently of sprite positions.
  for(const general of b.units) {
    const x=general.side==='attacker'?30:40,y=0;
    Object.assign(general.movement!,{x,y,previousX:x,previousY:y,px:(96*x+48)*65536,py:36*65536});
  }
  b.reinforceRules='native-reinforce-v1';
  b.opponentAI!.rng=[0x12345678,0x87654321];
  return b;
}

function soldier(b:BattleState,side:BattleSide,slot:number,flags:number):BattleUnit {
  const x=slot%71,y=1+Math.floor(slot/71),dead=!!(flags&0x2000);
  return {id:b.nextId++,side,general:false,division:'front',nativeDivision:1,nativeSoldierSlot:slot,
    nativeReserve:!!(flags&4),x:(x+.5)/71*1200,y:150+y/13*360,hp:dead?0:1,maxHp:1,
    ranged:false,order:'hold',action:dead?'death':'wait',actionTick:0,target:null,hit:false,escaped:false,
    movement:{x,y,previousX:x,previousY:y,px:(96*x+48)*65536,py:(72*y+36)*65536,
      vx:0,vy:0,remaining:0,facing:side==='attacker'?0:0x800000,exiting:false,
      clock:{decision:100000,attack:0,deferred:0,actionAge:0,special:false}}};
}

function hostSnapshot(input:AllocationInput):BattleState {
  const b=emptyBattle(),side=sideFor(input.side);
  b.commanders[side].unit=UNIT_NAMES[input.unit];
  b.nativeCommands![side].orders[1]=input.command;
  b.units.find(u=>u.general&&u.side===side)!.movement!.clock!.decision=input.decision;
  b.units.push(...input.flags.map((flags,index)=>soldier(b,side,index,flags)));
  if(input.occupied) {
    const blocker=soldier(b,side==='attacker'?'defender':'attacker',0,2);
    Object.assign(blocker.movement!,{x:input.x,y:input.y});b.units.push(blocker);
  }
  return b;
}

function compareAllocation(b:BattleState,input:AllocationInput,native:AllocationResult) {
  const side=sideFor(input.side),nextId=b.nextId,before=[...b.opponentAI!.rng];
  const id=createBattleReinforceSoldier(b,side,input.x,input.y);
  expect(!!id).toBe(!!native.handle);
  expect(b.opponentAI!.rng).toEqual(before);
  expect(before).toEqual(native.rng);
  expect(b.units.filter(u=>u.side===side&&!u.general&&u.hp>0)).toHaveLength(native.living);
  const slots=b.units.filter(u=>u.side===side&&!u.general).map(u=>u.nativeSoldierSlot!);
  expect(slots.length?Math.max(...slots)+1:0).toBe(native.slotCount);
  if(!native.handle) {expect(b.nextId).toBe(nextId);return;}
  expect(id).toBe(nextId);expect(b.nextId).toBe(nextId+1);
  const actual=b.units.find(u=>u.id===id)!,expected=native.slots.find(s=>s.slot===actual.nativeSoldierSlot)!;
  expect(expected).toBeDefined();expect(actual.nativeSoldierSlot).toBe(expected.slot);
  expect(actual.nativeDivision).toBe(expected.division);expect(actual.division).toBe('front');
  expect(actual.nativeReserve).toBe(!!(expected.flags&4));
  expect(actual.order).toBe(expected.command===0?'hold':expected.command===8?'retreat':'advance');
  expect(actual.reinforceHandle).toBe(id);expect(actual.reinforceAlpha).toBe(0);
  expect(actual.movement).toMatchObject({x:expected.x,y:expected.y,previousX:expected.x,previousY:expected.y,
    px:native.created[0].x*65536,py:native.created[0].y*65536,vx:0,vy:0,remaining:0,
    facing:native.created[0].facing*65536,exiting:false,
    clock:{decision:expected.decision,attack:0,deferred:0}});
  expect(actual.movement!.px/65536).toBe(expected.x*96+48);
  expect(actual.movement!.py/65536).toBe(expected.y*72+36);
  // Native side 0 is remapped to the Web defender to preserve facing, while
  // the Web renderer assigns player colors separately. Compare soldier kind
  // and active/reserve resource class, not an unsupported color equivalence.
  const nativeObjectWithoutColor=native.created[0].object-input.side*20;
  expect(nativeSoldierObject(input.unit,actual.nativeReserve===true,false)).toBe(nativeObjectWithoutColor);
  expect(expected.unitMask).toBe(1<<input.unit);
}

describe('reinforce host 281 original x86 differential',()=>{
  it.each(allocationCases)('$input.label side=$input.side unit=$input.unit command=$input.command x=$input.x decision=$input.decision',({input,native})=>{
    compareAllocation(hostSnapshot(input),input,native);
  });

  it.each(vectors.deaths)('reuses a source-deleted record before corpse cleanup on side $input.side',sample=>{
    const input=sample.input as AllocationInput,b=hostSnapshot(input),side=sideFor(input.side);
    const corpse=b.units.find(u=>u.side===side&&!u.general&&u.nativeSoldierSlot===42)!;
    corpse.hp=0;corpse.action='death';corpse.actionTick=0;
    Object.assign(corpse.movement!,{x:10,y:7});
    expect(sample.afterDeath.flags&0x2000).toBe(0x2000);
    expect(b.units.filter(u=>u.side===side&&!u.general&&u.hp>0)).toHaveLength(sample.afterDeath.living);
    compareAllocation(b,input,sample.native);
    expect(b.units.find(u=>u.id===corpse.id)).toBe(corpse);
    expect(b.units.find(u=>u.side===side&&u.hp>0&&u.nativeSoldierSlot===42)?.id).not.toBe(corpse.id);
  });
});

describe('reinforced round settlement original 0x443D29 differential',()=>{
  it.each(vectors.settlements)('caps level $input.level active=$input.active reserve=$input.reserve dead=$input.deadActive/$input.deadReserve',({input,native})=>{
    const b=emptyBattle(input.level);
    const flags=[...Array(input.active).fill(2),...Array(input.reserve).fill(4),
      ...Array(input.deadActive).fill(0x2002),...Array(input.deadReserve).fill(0x2004)];
    b.units.push(...flags.map((flag,index)=>soldier(b,'attacker',index,flag)));
    b.initial.attacker=flags.length;b.totalInitial.attacker=flags.length;
    b.rosters.attacker[0].troops=flags.length;
    b.troopDeployment!.attacker={active:input.active+input.deadActive,reserve:input.reserve+input.deadReserve};
    b.phase='fighting';b.units.find(u=>u.general&&u.side==='defender')!.hp=0;
    // Death of the opposing commander takes the real round-finalization
    // path; held soldiers do not fight or move before that settlement.
    tickBattle(b);
    expect(b.phase).toBe('finished');
    expect(b.rosters.attacker[0].troopSlots).toEqual({active:native.active,reserve:native.reserve});
    expect(b.rosters.attacker[0].troops).toBe(native.active+native.reserve);
  });
});
