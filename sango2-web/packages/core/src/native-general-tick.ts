import {chargeIncrement,CHARGE_LIMIT} from './native-battle-rules';

export interface NativeGeneralTick {
  charge:number;strength:number;intelligence:number;retreat:boolean;deadAction:boolean;
  hp:number;maxHp:number;mp:number;maxMp:number;
  flags:number;parameter:number;recoveryClock:number;chargeModifier:number;
}

/** 0x43E964 before action dispatch, including its real 0x43E847 recovery.
 * Retreat subtracts 50 even from zero; action 32 suppresses normal growth and
 * recovery. Spell execution itself is not a veto in this native prefix. */
export function nativeGeneralTick(s:NativeGeneralTick):void {
  if(s.retreat){s.charge=(s.charge-50)|0;return;}
  if(s.deadAction)return;
  s.charge=Math.min(CHARGE_LIMIT,(s.charge+chargeIncrement(s.strength,s.intelligence,s.flags&32?s.chargeModifier:0))|0);
  if(s.flags&3) {
    s.recoveryClock=(s.recoveryClock+s.parameter)|0;
    if(s.recoveryClock>6000) {
      s.recoveryClock-=6000;
      if(s.flags&1)s.hp=Math.min(s.maxHp,s.hp+1);
      else s.mp=Math.min(s.maxMp,s.mp+1);
    }
  }
}
