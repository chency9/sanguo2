/** Native general offsets +56/+58/+60. Loader 0x42D1A3 initializes 80/0/90;
 * these are separate from LOYAL, which names a personal allegiance, not a score. */
export interface NativeOfficerCondition {morale:number;fatigue:number;loyalty:number}
export interface NativeConditionTimers {fatigue:number;moraleLoss:number;moraleGain:number;loyaltyLoss:number;loyaltyGain:number}
export const initialOfficerCondition=(s:Partial<NativeOfficerCondition>={}):NativeOfficerCondition=>({morale:s.morale??80,fatigue:s.fatigue??0,loyalty:s.loyalty??90});
export const initialConditionTimers=():NativeConditionTimers=>({fatigue:0,moraleLoss:0,moraleGain:0,loyaltyLoss:0,loyaltyGain:0});
const short=(n:number)=>(n<<16)>>16;
/** Condition portion of 0x41B1BF, one strategic callback. HP/MP and troop
 * clamps are separate; no timer runs for an officer without a city pointer. */
export function nativeRecoverCondition(s:NativeOfficerCondition,t:NativeConditionTimers,stationed:boolean,defense:number):void {
  if(!stationed)return;
  const due=(key:keyof NativeConditionTimers)=>(t[key]=short(t[key]-1))<=0;
  if(s.fatigue>0&&due('fatigue')) {
    s.fatigue--;t.fatigue=short(45+Math.trunc(Math.imul(999-defense,45)/2997));
  }
  // Uses fatigue AFTER the decrement: 60 -> 59 can change branch this callback.
  if(s.fatigue<60) {
    if(s.morale<70&&due('moraleGain')){s.morale=Math.min(100,s.morale+1);t.moraleGain=360;}
  } else if(due('moraleLoss')){s.morale=Math.max(0,s.morale-1);t.moraleLoss=100;}
  // Likewise, uses the newly updated morale at the 39/40 boundary.
  if(s.morale>=40) {
    if(s.loyalty<90&&due('loyaltyGain')) {
      s.loyalty=Math.min(100,s.loyalty+1);
      t.loyaltyGain=s.loyalty<30?300:s.loyalty<50?450:s.loyalty<70?900:1800;
    }
  } else if(due('loyaltyLoss')){s.loyalty=Math.max(0,s.loyalty-1);t.loyaltyLoss=150;}
}
/** 0x4103DE: out-of-range combined modifiers use the default 100%. */
export function nativeFatigueGain(base:number,modifier:number):number {
  const percent=({'-3':30,'-2':50,'-1':75,'1':150,'2':200,'3':250} as Record<string,number>)[modifier];
  return percent===undefined?base:Math.trunc(Math.imul(base,percent)/100);
}
/** 0x443F2A -> 0x41048D. Elapsed is the displayed native count, NOT seconds
 * or raw updates. Both participants receive the same base before modifiers. */
export function nativeBattleFatigue(fatigue:number,elapsedCount:number,modifier=0):number {
  return Math.min(100,short(fatigue+nativeFatigueGain(Math.trunc(elapsedCount/10)+15,modifier)));
}
