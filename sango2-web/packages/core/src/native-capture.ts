/** Post-encounter capture decisions from original 1.05+ x86. A combat knockdown
 * is roster status 3, not a dead/captured campaign officer until disposition. */
import {nativeBelow,type NativeRandomState} from './native-strategic-ai';

export interface NativeCaptureContext {
  loyalty:number;constancy:number;
  /** General +191 is the personal allegiance faction, separate from owner. */
  loyalFactionId:string|null;loyalLeaderOwnerId:string|null;loyalLeaderActive:boolean;
}
export interface NativeCapturePersuasion {accepted:boolean;reason:number}
const short=(n:number)=>(n<<16)>>16;

/** 0x404344. Short-circuit RNG consumption and the native reason global are
 * part of the result. A failed attempt cannot be rerolled by clicking again. */
export function nativeCapturePersuasion(winnerFactionId:string,c:NativeCaptureContext,rng:NativeRandomState):NativeCapturePersuasion {
  const loyalty=short(c.loyalty),constancy=short(c.constancy);let reason=1;
  if(loyalty<25)return {accepted:true,reason};
  let resistance=constancy>=5?1:constancy>=3?0:-1;
  if(c.loyalFactionId!==null) {
    if(c.loyalFactionId===winnerFactionId)return {accepted:true,reason:6};
    if(c.loyalLeaderOwnerId===c.loyalFactionId)resistance+=2;
    else if(c.loyalLeaderOwnerId===winnerFactionId&&c.loyalLeaderActive)return {accepted:true,reason:2};
  }
  if(resistance<0) {
    reason=3;
    if(nativeBelow(rng,100)>=(loyalty>>>0))return {accepted:true,reason};
    if(nativeBelow(rng,100)>=(loyalty>>>0))return {accepted:true,reason};
  } else if(resistance===0) {
    if(nativeBelow(rng,100)>=(loyalty>>>0))return {accepted:true,reason};
  } else if(nativeBelow(rng,100)>=(loyalty>>>0)&&nativeBelow(rng,3)!==0)return {accepted:true,reason};
  if(resistance>=2)reason=16;
  else if(loyalty>90)reason=17;
  else if(loyalty>70)reason=18;
  else if(loyalty>50)reason=19;
  return {accepted:false,reason};
}

export interface NativeCaptureCandidate extends NativeCaptureContext {
  id:string;status:number;isRuler:boolean;ownerIsPlayer:boolean;rulerHasOtherCity:boolean;
}
export interface NativeCaptureResolution {id:string;status:number;persuasion?:NativeCapturePersuasion}
/** 0x40452E. Only original status3 entries are resolved, in roster order.
 * A defeated player ruler is executed; another ruler escapes if a different
 * friendly city remains. Other prisoners face original recruitment and lottery. */
export function nativeResolveAICaptives(winnerFactionId:string,winnerHasCity:boolean,candidates:readonly NativeCaptureCandidate[],rng:NativeRandomState):NativeCaptureResolution[] {
  return candidates.map(c=>{
    if(c.status!==3)return {id:c.id,status:c.status};
    if(c.isRuler&&c.ownerIsPlayer)return {id:c.id,status:5};
    if(c.isRuler&&!c.ownerIsPlayer&&c.rulerHasOtherCity)return {id:c.id,status:7};
    const persuasion=winnerHasCity?nativeCapturePersuasion(winnerFactionId,c,rng):undefined;
    const status=persuasion?.accepted?6:nativeBelow(rng,100)>=50?2:5;
    return {id:c.id,status,...(persuasion?{persuasion}:{})};
  });
}

export interface NativePlayerCaptive extends NativeCapturePersuasion {id:string;index:number}
/** 0x44E820 scans from zero on every selection. It clamps condition BEFORE
 * the single persuasion draw. Store this result in the save until resolved. */
export function nativePreparePlayerCaptive(winnerFactionId:string,candidates:readonly Pick<NativeCaptureCandidate,'id'|'status'|'loyalty'|'constancy'|'loyalFactionId'|'loyalLeaderOwnerId'|'loyalLeaderActive'>[],rng:NativeRandomState):NativePlayerCaptive|null {
  const index=candidates.findIndex(c=>c.status===3);if(index===-1)return null;
  const c=candidates[index],decision=nativeCapturePersuasion(winnerFactionId,{...c,loyalty:Math.max(0,Math.min(100,short(c.loyalty)))},rng);
  return {id:c.id,index,...decision};
}
/** SYSTEM.SO ids70/71/72 finish through hosts521/528/529, then callbacks
 * 44ECC2/44EDB4/44EBE2. Rejected recruitment keeps the same prisoner selected. */
export function nativePlayerCaptiveDecision(current:NativePlayerCaptive,choice:'yield'|'kill'|'free'):{status:2|3|5|6;advance:boolean} {
  if(choice==='yield')return {status:current.accepted?6:3,advance:current.accepted};
  return {status:choice==='kill'?5:2,advance:true};
}

/** 0x40EEAA: joining changes loyalty only at >=50, preserving wounds, soldier
 * slots and equipment. The map adapter creates a return army to the given city. */
export function nativeCapturedJoinLoyalty(loyalty:number):number {
  const value=short(loyalty);return value>=50?Math.trunc(2*value/3):value;
}

/** 0x447520 runs once for real-time battle losers before the capture screen.
 * It changes only knocked-down (status3) participants; ordinary retreats do
 * not suffer this extra penalty. Original writes wrap signed short. */
export function nativeCaptiveDefeatCondition(morale:number,loyalty:number,constancy:number):{morale:number;loyalty:number} {
  return {morale:short(morale-20),loyalty:short(loyalty-2*(10-short(constancy)))};
}

/** 0x40ED3A. A player ruler does not use the non-player escape exception. */
export function nativeRulerCanEscape(isRuler:boolean,ownerIsPlayer:boolean,hasOtherCity:boolean):boolean {
  return isRuler&&!ownerIsPlayer&&hasOtherCity;
}
