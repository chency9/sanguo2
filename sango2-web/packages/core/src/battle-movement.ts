import type {BattleState,BattleUnit} from './battle';
import {nativeGridIndex,projectBattleCell} from './native-battle-grid';
import {nativeForwardTarget,nativePlanMove,nativeMovementRange} from './native-movement';
import {nativeTryVacateCell} from './native-unit-yield';
import type {NativeUnitClock} from './native-unit-clock';
import {nativeFormationDeployment} from './native-formation-deployment';
import {formationToNativeIndex} from './battle-formations';
import {battleUnitCommand,battleChargeTarget,issueNativeCommand} from './battle-commands';
import {nativeCommandRoute} from './native-commands';

/** Saved simulation coordinates are independent of the readable sprite spacing.
 * x/y reserve the destination as soon as a step is selected (0x43BF26). */
export interface BattleMovement {
  x:number;y:number;previousX:number;previousY:number;
  px:number;py:number;vx:number;vy:number;remaining:number;facing:number;exiting:boolean;
  /** v2 uses group timestamps; v3 uses each source timestamp. */
  updatedAt?:number;
  clock?:NativeUnitClock&{actionAge:number;special:boolean;attackEvent?:number};
}
export const battleMovementCell=(u:BattleUnit)=>u.movement??projectBattleCell(u.x,u.y);
const fixedX=(x:number)=>Math.trunc(x/1200*71*96*65536);
const fixedY=(y:number)=>Math.trunc((36+(y-150)/360*13*72)*65536);

/** New battles use the original formation cells. Older saves retain their
 * display projection; resolve its collisions without RNG or moving artwork. */
export function battleDeploymentCells(b:BattleState):Map<number,{x:number;y:number}> {
  const nativeCells=new Map<number,{x:number;y:number}>();
  if(b.deploymentRules==='native-tables-v1'&&b.troopDeployment) {
    const obstacles:number[][]=[];
    for(const side of ['attacker','defender'] as const) {
      const d=b.troopDeployment[side];
      const formation=side==='attacker'?formationToNativeIndex(b.formation):b.opponentAI?.formation??0;
      const positions=nativeFormationDeployment({formation,...d,mirror:side==='defender',obstacles});
      const general=b.units.find(u=>u.side===side&&u.general)!;
      nativeCells.set(general.id,{x:positions.general[0],y:positions.general[1]});obstacles.push(positions.general);
      const soldiers=b.units.filter(u=>u.side===side&&!u.general);
      soldiers.forEach((u,i)=>{const p=positions.soldiers[i];nativeCells.set(u.id,{x:p.x,y:p.y});obstacles.push([p.x,p.y]);});
    }
  }
  return nativeCells;
}
export function prepareBattleMovement(b:BattleState):void {
  if(!b.movementRules)return;
  const nativeCells=b.units.some(u=>u.movement)?new Map<number,{x:number;y:number}>():battleDeploymentCells(b);
  const occupied=new Set(b.units.filter(u=>u.hp>0&&!u.escaped&&u.movement&&!u.movement.exiting).map(u=>nativeGridIndex(u.movement!.x,u.movement!.y)));
  for(const u of b.units) {
    if(u.hp<=0||u.escaped||u.movement)continue;
    const native=nativeCells.get(u.id),cell=native??projectBattleCell(u.x,u.y);let x=cell.x,y=cell.y;
    if(occupied.has(nativeGridIndex(x,y))) {
      let best=Infinity;
      for(let row=0;row<14;row++)for(let col=0;col<71;col++) {
        if(occupied.has(nativeGridIndex(col,row)))continue;
        const distance=(col-cell.x)**2+(row-cell.y)**2;
        if(distance<best){best=distance;x=col;y=row;}
      }
    }
    occupied.add(nativeGridIndex(x,y));
    u.movement={x,y,previousX:x,previousY:y,px:native?(x*96+48)*65536:fixedX(u.x),py:native?(y*72+36)*65536:fixedY(u.y),vx:0,vy:0,remaining:0,facing:u.side==='attacker'?0:0x800000,exiting:false};
    if(b.movementRules==='native-grid-v3')u.movement.clock={decision:1,attack:0,deferred:0,actionAge:0,special:false};
  }
}

/** v1/v2 movement adapter. v3 integrates through battle-unit-scheduler. */
export function advanceBattleMovement(u:BattleUnit,updates:number):void {
  const m=u.movement!;
  for(let i=0;i<updates&&m.remaining>0;i++) {
    m.px=(m.px+m.vx)|0;m.py=(m.py+m.vy)|0;m.remaining--;
  }
  u.x=m.px/65536/96/71*1200;
  u.y=150+(m.py/65536-36)/72/13*360;
  u.action=m.vx||m.vy?'walk':'wait';
  if(m.exiting&&m.remaining===0)u.escaped=true;
}

export interface BattleYieldContext {update:(unit:BattleUnit)=>void;active:Set<number>;tick?:number}
/** Original candidate/velocity rules. v2 can dispatch eligible allies through
 * the caller's ordinary update; v1 retains conservative occupied-cell handling.
 * New battles route through the native command tables; older snapshots keep
 * their nearest-target/three-order adapter. */
export function planBattleMovement(b:BattleState,u:BattleUnit,target:BattleUnit|undefined,unitType=0,yieldContext?:BattleYieldContext):void {
  const m=u.movement!,retreat=u.order==='retreat',t=target?battleMovementCell(target):m;
  const hold=b.movementRules==='native-grid-v3'&&u.order==='hold';
  const dx=hold?0:retreat?(u.side==='attacker'?-1:1):Math.sign(t.x-m.x),dy=hold||retreat?0:Math.sign(t.y-m.y);
  const occupants=new Map<number,BattleUnit>();
  const refresh=()=>{
    occupants.clear();
    for(const other of b.units)if(other.hp>0&&!other.escaped&&!other.movement?.exiting) {
      const c=battleMovementCell(other);occupants.set(nativeGridIndex(c.x,c.y),other);
    }
  };
  refresh();
  const forwardTarget=()=>!!nativeForwardTarget(m.x,m.y,m.facing?-1:1,nativeMovementRange(unitType,u.nativeReserve===true,u.general),(x,y)=>{
    const other=occupants.get(nativeGridIndex(x,y));return other?(other.side===u.side?'ally':'enemy'):undefined;
  });
  const enemy=b.units.find(other=>other.general&&other.side!==u.side)!;
  const vacate=(x:number,y:number)=>{
    if(!['native-grid-v2','native-grid-v3'].includes(b.movementRules??'')||!yieldContext)return false;
    const index=nativeGridIndex(x,y);
    return nativeTryVacateCell(u.side==='attacker'?0:1,yieldContext.tick??b.tick*3,()=>{
      const other=occupants.get(index);if(!other)return;
      return {id:other.id,side:other.side==='attacker'?0:1,lastUpdate:other.movement?.updatedAt??-1,
        flags:(other.general?1:0)|(yieldContext.active.has(other.id)?0x1000:0)};
    },id=>{
      const other=b.units.find(other=>other.id===id)!;
      yieldContext.update(other);
      // A recursively updated unit may have moved more than just this neighbour.
      refresh();
    });
  };
  const command=battleUnitCommand(b,u),own=b.units.find(other=>other.general&&other.side===u.side)!;
  const charge=b.nativeCommands&&command===7?battleChargeTarget(b,u.side):enemy;
  const route=b.nativeCommands?nativeCommandRoute({command,general:u.general,division:u.nativeDivision!,mirror:u.side==='defender',strict:b.nativeCommands[u.side].strict,
    x:m.x,y:m.y,enemyX:battleMovementCell(enemy).x,enemyY:battleMovementCell(enemy).y,ownX:battleMovementCell(own).x,ownY:battleMovementCell(own).y,
    targetX:battleMovementCell(charge).x,targetY:battleMovementCell(charge).y}):{dx,dy,profile:hold?'hold' as const:retreat?'retreat' as const:'pursue' as const};
  const plan=nativePlanMove({...m,...route,retreat,general:u.general,returning:!!b.nativeCommands&&u.general&&command===2,forwardTarget,enemyX:battleMovementCell(enemy).x},b.opponentAI!.rng,
    (x,y)=>occupants.has(nativeGridIndex(x,y)),vacate);
  if(plan.returned)issueNativeCommand(b,u.side,0,0);
  if(b.nativeCommands&&u.general&&command===0){plan.vx=0;plan.vy=0;plan.facing=u.side==='attacker'?0:0x800000;}
  m.previousX=m.x;m.previousY=m.y;
  if(plan.kind==='move'){m.x=plan.x;m.y=plan.y;}
  m.exiting=plan.kind==='escape';m.vx=plan.vx;m.vy=plan.vy;m.facing=plan.facing;m.remaining=40;
  if(b.movementRules==='native-grid-v3')u.action=plan.kind==='hold'?'wait':'walk';
}

export function validateBattleMovement(b:BattleState,fail:()=>never):void {
  if(b.deploymentRules!==undefined&&(b.deploymentRules!=='native-tables-v1'||!b.troopDeployment||b.movementRules!=='native-grid-v3'))fail();
  if(b.movementRules===undefined){if(b.units.some(u=>u.movement!==undefined))fail();return;}
  if(!['native-grid-v1','native-grid-v2','native-grid-v3'].includes(b.movementRules))fail();
  const cells=new Set<number>();
  for(const u of b.units) {
    const m=u.movement;if(m===undefined)continue;
    if(!m||nativeGridIndex(m.x,m.y)<0||nativeGridIndex(m.previousX,m.previousY)<0||
      ![m.px,m.py,m.vx,m.vy].every(n=>Number.isInteger(n)&&n>=-2147483648&&n<=2147483647)||
      !Number.isInteger(m.remaining)||m.remaining<0||m.remaining>40||![0,0x800000].includes(m.facing)||typeof m.exiting!=='boolean'||
      Math.abs(m.vx)>7864320/40||Math.abs(m.vy)>5898240/40)fail();
    if(m.updatedAt!==undefined&&(!['native-grid-v2','native-grid-v3'].includes(b.movementRules)||!Number.isInteger(m.updatedAt)||m.updatedAt<0||m.updatedAt>b.tick*3))fail();
    if(b.movementRules==='native-grid-v3') {
      const c=m.clock;
      if(!c||![c.decision,c.attack,c.deferred,c.actionAge].every(n=>Number.isInteger(n)&&Math.abs(n)<=1000000)||c.actionAge<0||typeof c.special!=='boolean')fail();
      if(c.attackEvent!==undefined&&(b.attackRules!=='native-actions-v1'||!Number.isInteger(c.attackEvent)||c.attackEvent<0||c.attackEvent>64))fail();
    } else if(m.clock!==undefined)fail();
    if(u.hp>0&&!u.escaped&&!m.exiting){const index=nativeGridIndex(m.x,m.y);if(cells.has(index))fail();cells.add(index);}
  }
}
