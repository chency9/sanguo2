/** Original strategist decisions. Rates must come from native runtime memory:
 * 0x42F3C8 requests Rate, whereas the supplied MAGIC.INI contains Level.
 * Never silently substitute the latter for the former. See parity evidence.
 */
import {nativeWeightedChoice,type NativeRandomState} from './native-strategic-ai';

export interface NativeStrategySlot {sequence:number;active:number;rate:number}
export interface NativeStrategyChoice {slot:number;sequence:number;weights:number[][]}

/** 0x4040F3: highest hundred tier, followed by an unfiltered fallback lottery.
 * The no-soldiers exclusion is exact equality ACTIVE==1, not a bit test.
 * Empty/zero-weight draws do not consume RNG (0x468740).
 */
export function nativeChooseStrategy(slots:readonly NativeStrategySlot[],troops:number,rng:NativeRandomState):NativeStrategyChoice {
  const learned=Array.from({length:8},(_,i)=>slots[i]??{sequence:0,active:0,rate:0});
  const first=learned.map(s=>s.sequence&&(s.active!==1||troops!==0)?s.rate:0);
  const threshold=100*Math.trunc(Math.max(0,...first)/100);
  const weights=[first.map(w=>w<threshold?0:w)];
  let slot=nativeWeightedChoice(weights[0],rng);
  if(slot===-1||!learned[slot].sequence) {
    weights.push(learned.map(s=>s.sequence?s.rate:0));
    slot=nativeWeightedChoice(weights[1],rng);
  }
  return {slot,sequence:slot===-1?0:learned[slot].sequence,weights};
}

/** 0x40CC99: highest INT; later roster entry wins a tie. */
export function nativeStrategistIndex(intelligence:readonly number[]):number {
  let selected=-1;
  for(let i=0;i<intelligence.length;i++)if(selected===-1||intelligence[i]>=intelligence[selected])selected=i;
  return selected;
}

/** 0x44D3E0: cancelled when matching attribute conditions hold, unless INT is
 * strictly greater. Equal INT can cancel both sides, not produce a coin flip.
 */
export function nativeStrategySucceeds(own:{sequence:number;attribute:number;intelligence:number},enemy:{sequence:number;attribute:number;intelligence:number}):boolean {
  return ((own.attribute!==1||own.sequence!==enemy.sequence)
    &&(own.attribute!==3||enemy.attribute!==3)&&own.attribute!==2&&enemy.attribute!==2)
    ||own.intelligence>enemy.intelligence;
}
