import type {BattleState,BattleUnit} from './battle';
import {nativeCasualty,nativeAdvanceFlight,nativeDetachedWalk} from './native-casualty';
import {projectBattleCell} from './native-battle-grid';
import {battleMovementCell} from './battle-movement';

const fixed=65536;
// Explicit projection between the current Web field and source 96x72 cells.
const sourcePoint=(u:{x:number;y:number})=>({x:Math.trunc(u.x/1200*71*96*fixed),y:Math.trunc(((u.y-150)/360*13+.5)*72*fixed)});
export function beginBattleCasualty(b:BattleState,u:BattleUnit,attacker:BattleUnit,unit:number):void {
  if(b.casualtyRules!=='native-v1'||u.casualty)return;
  const point=(unit:BattleUnit)=>b.movementRules&&unit.movement?{x:unit.movement.px,y:unit.movement.py}:sourcePoint(unit);
  const origin=point(u),cell=b.movementRules?battleMovementCell(u):projectBattleCell(u.x,u.y);
  const {flight,detached}=nativeCasualty({unit,reserve:u.nativeReserve===true,general:u.general,enemy:u.side==='defender',
    cellX:cell.x,cellY:cell.y,...origin,z:u.general?54*fixed:0,hasAttacker:true,attackerX:point(attacker).x},b.opponentAI!.rng);
  const {facing,...movement}=flight;
  u.casualty={flight:movement,facing,origin,born:b.tick};
  if(detached) {
    const display=battleDetachedPosition(origin);
    (b.detached??=[]).push({...detached,id:b.nextId++,side:u.side,...origin,vx:0,vy:0,age:0,
      ...(b.movementRules?{displayOffset:{x:u.x-display.x,y:u.y-display.y}}:{})});
  }
}
/** Grouped source updates, never driven by renderer frames. The original global
 * object-list scheduler is still not reproduced, so cross-object ordering is an
 * explicit Web adapter. Corpse fade/landing frames retain the existing renderer. */
export function advanceBattleCasualties(b:BattleState,updates:number):void {
  if(b.casualtyRules!=='native-v1')return;
  for(let step=0;step<updates;step++) {
    for(const u of b.units)if(u.casualty&&u.casualty.born<b.tick&&u.casualty.flight.z>0)nativeAdvanceFlight(u.casualty.flight);
    for(const d of b.detached??[]) {
      d.x=(d.x+d.vx)|0;d.y=(d.y+d.vy)|0;d.age++;
      if(d.object!==10&&d.age===24)Object.assign(d,nativeDetachedWalk(d.heading,b.opponentAI!.rng));
    }
    b.detached=b.detached?.filter(d=>d.life===0||d.age<d.life);
  }
}
/** Rendering only: fixed-point state remains unchanged. */
export function battleCasualtyPosition(u:BattleUnit):{x:number;y:number;height:number} {
  if(!u.casualty)return {x:u.x,y:u.y,height:0};
  const {flight:f,origin}=u.casualty;
  return {x:u.x+(f.x-origin.x)/fixed/(71*96)*1200,y:u.y+(f.y-origin.y)/fixed/(13*72)*360,height:f.z/fixed};
}
export function battleDetachedPosition(d:{x:number;y:number;displayOffset?:{x:number;y:number}}):{x:number;y:number} {
  return {x:d.x/fixed/(71*96)*1200+(d.displayOffset?.x??0),y:150+(d.y/fixed/72-.5)/13*360+(d.displayOffset?.y??0)};
}
export function validateBattleCasualties(b:BattleState,fail:()=>never):void {
  if(b.casualtyRules!==undefined&&b.casualtyRules!=='native-v1')fail();
  if(b.casualtyRules&&!Array.isArray(b.detached))fail();
  if(!b.casualtyRules&&(b.detached!==undefined||b.units.some(u=>u.casualty!==undefined)))fail();
  const i32=(n:unknown):n is number=>typeof n==='number'&&Number.isInteger(n)&&n>=-2147483648&&n<=2147483647;
  const uint=(n:unknown,max:number):n is number=>i32(n)&&n>=0&&n<=max;
  for(const u of b.units)if(u.casualty!==undefined) {
    const c=u.casualty;
    if(!c||u.hp!==0||u.action!=='death'||!c.flight||!c.origin||!uint(c.born,b.tick)||![0,0x800000].includes(c.facing))fail();
    if(![c.flight.x,c.flight.y,c.flight.z,c.flight.vx,c.flight.vy,c.flight.vz,c.origin.x,c.origin.y].every(i32)||c.flight.z<0)fail();
  }
  if(b.detached!==undefined) {
    if(!Array.isArray(b.detached)||b.detached.length>500)fail();
    const ids=new Set(b.units.map(u=>u.id));
    for(const d of b.detached) {
      if(!d||!uint(d.id,b.nextId-1)||ids.has(d.id)||!['attacker','defender'].includes(d.side)||!uint(d.age,b.tick*3))fail();
      if(![10,180,181,182,183,184,185,190,191,192,193,194,195].includes(d.object)||d.life!==(d.object===10?0:2400)||d.life>0&&d.age>=d.life)fail();
      if(![d.x,d.y,d.vx,d.vy,d.heading].every(i32)||![0,0x800000].includes(d.facing)||Math.abs(d.heading-d.facing)>0x100000)fail();
      if(d.displayOffset!==undefined&&(!d.displayOffset||![d.displayOffset.x,d.displayOffset.y].every(n=>Number.isFinite(n)&&Math.abs(n)<2000)))fail();
      ids.add(d.id);
    }
  }
}
