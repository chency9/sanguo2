import type {BattleState,BattleUnit} from './battle';
import {INITIAL_CHARGE} from './native-battle-rules';
import {nativeGeneralTick} from './native-general-tick';

/** Called at the general's source update, before movement/attack decisions. */
export function advanceBattleGeneral(b:BattleState,u:BattleUnit):void {
  if(!b.generalRules||!u.general)return;
  const c=b.commanders[u.side],effect=b.strategies?.applied?b.strategies.effects[u.side]:undefined;
  const state={charge:c.charge??INITIAL_CHARGE,strength:c.strength,intelligence:c.intelligence,
    retreat:u.order==='retreat',deadAction:u.hp<=0,hp:u.hp,maxHp:u.maxHp,mp:c.mp,maxMp:c.maxMp??c.mp,
    flags:effect?.flags??0,parameter:effect?.parameter??0,recoveryClock:effect?.recoveryClock??0,chargeModifier:effect?.chargeModifier??0};
  nativeGeneralTick(state);c.charge=state.charge;u.hp=state.hp;c.mp=state.mp;
  if(effect){effect.hp=state.hp;effect.mp=state.mp;effect.recoveryClock=state.recoveryClock;}
}
