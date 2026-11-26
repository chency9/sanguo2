import {nativeRandom,type NativeRandomState} from './native-strategic-ai';

/** 0x40EA29 / 0x4060F8. A city object replaces castle mask values with
 * its live capacity class; a road encounter has no city object. */
export function nativeSceneryTerrain(mask:number,cityCapacity?:number):number {
  if(mask===255)return 5;
  if((mask===1||mask===2)&&cityCapacity!==undefined) {
    const capacity=(cityCapacity<<16)>>16;
    const category=capacity<=5?0:capacity<=8?1:capacity<=12?2:3;
    return Math.max(0,Math.min(2,category-1));
  }
  return mask;
}

/** 0x4366C4: when both backgrounds exist, an odd native draw chooses A
 * and an even draw chooses B. Forced MAPMODE values consume no draw. */
export function nativeSceneryVariant(mode:'random'|'a'|'b',rng:NativeRandomState):'a'|'b' {
  return mode==='random'?(nativeRandom(rng)&1?'a':'b'):mode;
}
