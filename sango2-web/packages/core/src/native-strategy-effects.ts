/** Verified subset of 0x44D450 and 0x43E847. Unported EXECUTE values return
 * false; callers retain the original choice rather than inventing its effect. */
import {nativeBelow,type NativeRandomState} from './native-strategic-ai';

export interface NativeStrategyCombat {
  hp:number;maxHp:number;mp:number;maxMp:number;troops:number;reserve:number;
  flags:number;parameter:number;recoveryClock:number;chargeModifier:number;
  /** Optional only for older saves; native combat initializes power to 150. */
  soldierPower?:number;generalHitBonus?:number;
  morale?:number;loyalty?:number;
  /** These are TEAM fields +52/+56, not combat flags +132. */
  settlementFlags?:number;fatigueModifier?:number;
}
export const SUPPORTED_STRATEGY_EXECUTES=[0,1,2,3,4,5,6,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,35,36,37,38,39,40,41,42,43,50,51,52,58,59,60,61,62,63,64,65,66,67] as const;
export function nativeStrategySupported(execute:number):boolean {
  return (SUPPORTED_STRATEGY_EXECUTES as readonly number[]).includes(execute);
}
export function nativeApplyStrategy(execute:number,own:NativeStrategyCombat,enemy:NativeStrategyCombat,rng:NativeRandomState):boolean {
  if(!nativeStrategySupported(execute))return false;
  if(execute>=1&&execute<=3) {
    enemy.morale=Math.max(0,(enemy.morale??80)-[15,25,40][execute-1]);
  } else if(execute>=4&&execute<=6) {
    own.morale=Math.min(100,(own.morale??80)+[15,25,40][execute-4]);
  } else if(execute>=9&&execute<=11) {
    enemy.settlementFlags=(enemy.settlementFlags??0)|4096;enemy.fatigueModifier=(enemy.fatigueModifier??0)+execute-8;
  } else if(execute>=12&&execute<=14) {
    own.settlementFlags=(own.settlementFlags??0)|4096;own.fatigueModifier=(own.fatigueModifier??0)-(execute-11);
  } else if(execute>=15&&execute<=20) {
    const hp=execute<=17,key=hp?'hp':'mp',max=hp?'maxHp':'maxMp';
    const rate=hp?[20,35,50][execute-15]:[25,40,60][execute-18];
    const delta=Math.trunc(own[max]*rate/100);
    own[max]+=delta;own[key]=Math.min(own[max],own[key]+delta);
  } else if(execute>=21&&execute<=23) {
    own.soldierPower=(own.soldierPower??150)+[10,20,30][execute-21];
  } else if(execute>=24&&execute<=26) {
    enemy.soldierPower=(enemy.soldierPower??150)-[10,20,30][execute-24];
  } else if(execute>=27&&execute<=29) {
    const delta=[5,10,15][execute-27];
    own.soldierPower=(own.soldierPower??150)+delta;enemy.soldierPower=(enemy.soldierPower??150)-delta;
  } else if(execute>=30&&execute<=32) {
    enemy.loyalty=Math.max(0,(enemy.loyalty??90)-[8,15,25][execute-30]);
  } else if(execute>=35&&execute<=40) {
    own.flags|=execute<=37?1:2;
    own.parameter=execute<=37?[40,60,80][execute-35]:[30,50,70][execute-38];own.recoveryClock=0;
  } else if(execute>=41&&execute<=43) {
    own.flags|=512;own.generalHitBonus=[10,15,20][execute-41];
  } else if(execute>=50&&execute<=52) {
    own.flags|=32;own.chargeModifier+=execute-49;
  } else if(execute>=58&&execute<=60) {
    const rate=[10,15,25][execute-58];
    // Active and reserve soldiers are rounded separately in the native code.
    enemy.troops=Math.max(0,enemy.troops-Math.trunc(enemy.troops*rate/100));
    enemy.reserve=Math.max(0,enemy.reserve-Math.trunc(enemy.reserve*rate/100));
  } else if(execute>=61&&execute<=63) {
    own.flags|=128;own.parameter=[66,50,25][execute-61];
  } else if(execute===64) {
    if(nativeBelow(rng,3)===0)enemy.flags|=256;
  } else if(execute>=65&&execute<=67) {
    enemy.flags|=32;enemy.chargeModifier-=execute-64;
  }
  return true;
}
/** Strictly >6000, not >=6000; HP takes precedence if both flags exist. */
export function nativeStrategyRecovery(state:NativeStrategyCombat,updates=1):void {
  for(let i=0;i<updates;i++)if(state.flags&3) {
    state.recoveryClock+=state.parameter;
    if(state.recoveryClock>6000) {
      state.recoveryClock-=6000;
      if(state.flags&1)state.hp=Math.min(state.maxHp,state.hp+1);
      else state.mp=Math.min(state.maxMp,state.mp+1);
    }
  }
}
/** 0x41048D: temporary capacity gains cannot become permanent healing. */
export function nativeRestoreStrategyVitals(state:Pick<NativeStrategyCombat,'hp'|'maxHp'|'mp'|'maxMp'>,entry:Pick<NativeStrategyCombat,'hp'|'maxHp'|'mp'|'maxMp'>):void {
  if(state.maxHp>entry.maxHp&&state.hp>entry.hp)state.hp=entry.hp;
  if(state.maxMp>entry.maxMp&&state.mp>entry.mp)state.mp=entry.mp;
  state.maxHp=entry.maxHp;state.maxMp=entry.maxMp;
  state.hp=Math.min(state.hp,state.maxHp);state.mp=Math.min(state.mp,state.maxMp);
}
