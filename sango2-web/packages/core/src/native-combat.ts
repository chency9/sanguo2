/** 1.05+ 0x43D400 / 0x43D4CB / 0x43EC54. Inputs describe native units,
 * not visual sprites. Web position and reserve adapters are kept at the caller. */
import {nativeBelow,type NativeRandomState} from './native-strategic-ai';
import tables from './native-combat-tables.json';

export interface NativeCombatUnit {
  general:boolean;reserve:boolean;settled:boolean;strength:number;
  power:number;flags:number;hitBonus:number;
}
const trunc=Math.trunc;
const unitIndex=(mask:number)=>{for(let i=0;i<13;i++)if(mask&(1<<i))return i;return -1;};
export function nativeUnitMatchup(ownMask:number,enemyMask:number):number {
  const own=unitIndex(ownMask),enemy=unitIndex(enemyMask);
  return own<0||enemy<0?0:tables.units[own][enemy];
}
export function nativeTerrainMatchup(mask:number,terrain:number):number {
  const unit=unitIndex(mask);return unit<0||terrain<0||terrain>=12?0:tables.terrain[terrain][unit];
}
export function nativeFormationMatchup(own:number,enemy:number):number {
  return own<0||enemy<0||own>=11||enemy>=11?0:tables.formation[own][enemy];
}
/** 0x443498 / 0x442EFA: the two divisions are signed, towards zero. */
export function nativeCombatPower(o:{base:number;unitMask:number;enemyUnitMask:number;terrain:number;formation:number;enemyFormation:number;defense:number;morale:number}):number {
  return o.base+nativeUnitMatchup(o.unitMask,o.enemyUnitMask)+nativeTerrainMatchup(o.unitMask,o.terrain)
    +nativeFormationMatchup(o.formation,o.enemyFormation)+trunc((o.defense+50)/100)+trunc((o.morale-50)/5);
}
export function nativeAttackHits(attacker:NativeCombatUnit,target:NativeCombatUnit,rng:NativeRandomState):boolean {
  let threshold:number;
  if(attacker.general) {
    threshold=150+(target.general?trunc((attacker.strength-target.strength)/2):trunc(attacker.strength/(target.reserve?3:2)));
    if(attacker.flags&512)threshold+=attacker.hitBonus;
  } else threshold=target.general?150-trunc(20*target.strength/100):attacker.power;
  if(!target.settled)threshold=trunc(2*threshold/3);
  if(nativeBelow(rng,300)<threshold)return true;
  // Only reserve SOLDIERS get a second draw, and only after the first miss.
  return !attacker.general&&attacker.reserve&&nativeBelow(rng,300)<trunc(2*threshold/3);
}
/** Call only after a hit on a general. Soldier hits do not consume damage RNG. */
export function nativeGeneralDamage(attacker:NativeCombatUnit,rng:NativeRandomState):number {
  if(attacker.general) {
    const half=trunc(attacker.strength/2);
    return Math.max(1,trunc((half+nativeBelow(rng,attacker.strength-half))/10));
  }
  const power=attacker.reserve?trunc(120*attacker.power/100):attacker.power;
  return Math.max(1,trunc(4*power/192));
}
