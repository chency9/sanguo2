import actions from './native-attack-actions.json';
import type {BattleState,BattleUnit} from './battle';
import type {NativeAttackSound} from './battle-audio-events';

export interface NativeAttackAction {ticks:number;hitTicks:number[];frameTicks:number[];soundTicks?:NativeAttackSound[]}
const catalogue=actions as Record<string,Partial<Record<'sourceAttack'|'specialAttack',NativeAttackAction>>>;
export function nativeAttackAction(object:number,special:boolean):NativeAttackAction|undefined {return catalogue[object]?.[special?'specialAttack':'sourceAttack'];}
export function nativeAttackFrame(action:{frameTicks:readonly number[]},age:number):number {
  let remaining=Math.max(0,age);
  for(let i=0;i<action.frameTicks.length;i++){if(remaining<action.frameTicks[i])return i;remaining-=action.frameTicks[i];}
  return action.frameTicks.length-1;
}
export function battleAttackAction(b:BattleState,u:BattleUnit):{object:number;key:'sourceAttack'|'specialAttack';timing:NativeAttackAction}|undefined {
  if(b.attackRules!=='native-actions-v1')return;
  const appearance=b.commanders[u.side].appearance;
  const fallback=({'刀':100,'槍':101,'關':102,'大':102,'弓':103,'鏈':104,'鍊':104,'飛':105,'武':106,'蠻':107,'鐵':108,'籐':109,'賊':110,'黃':110,'弩':111,'女':112}[b.commanders[u.side].unit[0]]??100);
  const object=u.general?(appearance?.body??600)+(u.side==='defender'?200:0):(appearance?.soldier??fallback)+(u.nativeReserve?40:0)+(u.side==='defender'?20:0);
  const special=!u.general&&u.movement?.clock?.special===true,key=special?'specialAttack':'sourceAttack';
  const timing=nativeAttackAction(object,special);
  if(!timing)throw new Error(`缺少原版攻击动作 ${object}/${key}`);
  return {object,key,timing};
}
/** A restored live attack must not replay or skip an already-dispatched event. */
export function validateBattleAttackActions(b:BattleState,fail:()=>never):void {
  if(!b.attackRules)return;
  for(const u of b.units)if(u.hp>0&&!u.escaped&&u.action==='attack') {
    const c=u.movement?.clock,timing=battleAttackAction(b,u)!.timing;
    if(!c||c.actionAge>=timing.ticks||c.attackEvent!==timing.hitTicks.filter(t=>t<=c.actionAge).length)fail();
  }
}
