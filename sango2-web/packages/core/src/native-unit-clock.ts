import {nativeRandom,nativeBelow,type NativeRandomState} from './native-strategic-ai';
import {nativeForwardTarget,nativeMovementRange} from './native-movement';
import cooldowns from './native-attack-cooldowns.json';

export interface NativeUnitClock {decision:number;attack:number;deferred:number}
/** 0x43B574 plus the real soldier/general 65549 callback. No clamping of
 * the retreat speed difference: the original can produce a negative counter. */
export function nativeUnitDecision(c:NativeUnitClock,o:{general:boolean;retreat:boolean;speed:number;enemySpeed:number;event?:boolean}):{ready:boolean;stopped:boolean} {
  c.decision=(c.decision-1)|0;
  if(c.decision>0)return {ready:false,stopped:false};
  c.decision=0;
  if(c.deferred!==0) {
    if(o.event===false)return {ready:true,stopped:false};
    c.decision=c.deferred;c.deferred=0;return {ready:false,stopped:true};
  }
  c.decision=o.retreat?46+(o.general?2*(o.enemySpeed-o.speed):0):40;
  return {ready:true,stopped:false};
}
export type NativeTargetOccupant='ally'|'enemy'|'dead'|undefined;
/** 0x43BCA7: called only on a decision, not on every animation update. */
export function nativeSearchTarget(c:NativeUnitClock,o:{x:number;y:number;unit:number;general:boolean;reserve:boolean;retreat:boolean;facing:number},rng:NativeRandomState,occupant:(x:number,y:number)=>NativeTargetOccupant):number {
  c.attack=(c.attack-1)|0;if(c.attack>0)return 0;
  let direction=o.retreat?(o.facing?-1:1):2*(nativeRandom(rng)&1)-1;
  for(let i=0;i<(o.retreat?1:2);i++) {
    const distance=nativeForwardTarget(o.x,o.y,direction,nativeMovementRange(o.unit,o.reserve,o.general),occupant);
    if(distance)return distance;direction=-direction;
  }
  return 0;
}
export function nativeAttackCooldown(unit:number,reserve:boolean,special:boolean):number {return cooldowns[unit][(reserve?2:0)+(special?1:0)];}
/** Soldier 0x43D125 / general 0x43E964 branch after a successful scan.
 * A melee special attack consumes below(8) before the retreat veto. */
export function nativePrepareAttack(c:NativeUnitClock,o:{unit:number;general:boolean;reserve:boolean;retreat:boolean;facing:number},distance:number,rng:NativeRandomState):{attack:boolean;special:boolean} {
  if(!distance)return {attack:false,special:false};
  const special=!o.general&&(nativeMovementRange(o.unit,o.reserve)<=1?nativeBelow(rng,8)===0:Math.abs(distance)===1);
  if(o.retreat&&((o.facing===0&&distance===-1)||(o.facing===0x800000&&distance===1)))return {attack:false,special};
  c.attack=o.general?1:nativeAttackCooldown(o.unit,o.reserve,special);
  return {attack:true,special};
}
