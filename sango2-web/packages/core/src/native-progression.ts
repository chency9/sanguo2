import type {GeneralDefinition} from '@sango2/content';
import type {GeneralState} from './index';
import {nativeTroopCapacity} from './native-troops';

export interface OfficerProgress {level:number;experience:number;maxHp:number;maxMp:number}
export const officerLevel=(state:GeneralState,def:GeneralDefinition)=>state.level??def.level??20;
export const officerMaxHp=(state:GeneralState,def:GeneralDefinition)=>state.maxHp??def.hp;
export const officerMaxMp=(state:GeneralState,def:GeneralDefinition)=>state.maxMp??def.mp;
export const officerExperience=(state:GeneralState,def:GeneralDefinition)=>state.experience??def.baseExperience??0;
/** 0x409EE0 / 0x40A020 / 0x40A098. Division truncates towards zero. */
export const nativeExperienceThreshold=(level:number)=>level<=99?Math.trunc(level*(137*(level-1)-34)/2)+17:9999999;
export function nativeLevelVitals(baseHp:number,baseMp:number,strength:number,intelligence:number,level:number) {
  const mpStat=strength<=intelligence?intelligence:Math.trunc((strength+intelligence)/2);
  return {hp:Math.min(32767,Math.max(baseHp,baseHp+Math.trunc(strength*2*level/100))),
    mp:Math.min(32767,Math.max(baseMp,baseMp+Math.trunc(mpStat*2*level/100)))};
}
/** 0x426B44's level-up loop: EXP can decrease; level never does. Its refill
 * happens only after an actual level-up, including zero-level-up recruits. */
export function applyRecruitExperience(state:GeneralState,def:GeneralDefinition,experience:number):number {
  let level=officerLevel(state,def),hp=officerMaxHp(state,def),mp=officerMaxMp(state,def),gained=0;
  const baseHp=def.baseHp??def.hp,baseMp=def.baseMp??def.mp;
  while(level<99&&experience>=nativeExperienceThreshold(level+1)) {
    const before=nativeLevelVitals(baseHp,baseMp,def.strength,def.intelligence,level);
    const after=nativeLevelVitals(baseHp,baseMp,def.strength,def.intelligence,++level);
    hp=short(hp-before.hp+after.hp);mp=short(mp-before.mp+after.mp);
    const capacity=nativeTroopCapacity(level);
    state.troopSlots={active:Math.max(0,capacity.active),reserve:capacity.reserve};
    state.troops=state.troopSlots.active+state.troopSlots.reserve;
    state.hp=hp;state.mp=mp;gained++;
  }
  Object.assign(state,{level,experience,maxHp:hp,maxMp:mp});return gained;
}
const short=(n:number)=>(n<<16)>>16;
