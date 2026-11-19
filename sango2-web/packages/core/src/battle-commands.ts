import type {BattleState,BattleSide,BattleUnit,Order} from './battle';
import {nativeChargeTarget,nativeWriteCommand,nativeAdvanceDivision,type NativeCommand,type NativeDivision} from './native-commands';

export interface BattleCommandSide {orders:number[];flags:number;target:number|null;strict:boolean}
export type BattleNativeCommands=Record<BattleSide,BattleCommandSide>;
export function createNativeCommands():BattleNativeCommands {
  const side=():BattleCommandSide=>({orders:Array<number>(8).fill(0),flags:0,target:null,strict:false});
  return {attacker:side(),defender:side()};
}
export const commandOrder=(command:number):Order=>command===8?'retreat':command===0?'hold':'advance';
export function battleUnitCommand(b:BattleState,u:BattleUnit):number {
  return b.nativeCommands?.[u.side].orders[u.nativeDivision??(u.general?0:u.division==='rear'?2:1)]??(u.order==='hold'?0:u.order==='retreat'?8:1);
}
export function syncNativeCommands(b:BattleState,side:BattleSide):void {
  const state=b.nativeCommands![side];
  for(const u of b.units)if(u.side===side)u.order=commandOrder(battleUnitCommand(b,u));
  if(side==='attacker')for(const [key,slot] of [['general',0],['front',1],['rear',2]] as const)b.orders[key]=commandOrder(state.orders[slot]);
  else if(b.opponentAI)b.opponentAI.flags=state.flags;
}
export function issueNativeCommand(b:BattleState,side:BattleSide,division:number,command:NativeCommand):void {
  const state=b.nativeCommands![side];
  nativeWriteCommand(state.orders,division,command);
  if(command===8)state.flags|=4;
  if(command===7&&division===257){state.flags|=1;state.strict=false;}
  if(command===9&&division===257){state.flags|=8;state.strict=false;}
  if(command===1&&(division===0||division===256)){state.flags|=2;state.flags&=~16;}
  if(command===2&&(division===0||division===256))state.flags|=16;
  if(command===0&&(division===0||division===256))state.flags&=~16;
  if(command===2||command===5||command===6)state.strict=false;
  syncNativeCommands(b,side);
}
export function advanceNativeAI(b:BattleState):void {
  nativeAdvanceDivision(b.opponentAI?.formation??0,b.nativeCommands!.defender.orders,b.opponentAI!.rng);
  syncNativeCommands(b,'defender');
}
export function battleChargeTarget(b:BattleState,side:BattleSide):BattleUnit {
  const state=b.nativeCommands![side],enemies=b.units.filter(u=>u.side!==side&&!u.general);
  const previous=state.target===null?null:state.target===-1?-1:enemies.findIndex(u=>u.id===state.target);
  const index=nativeChargeTarget(enemies.map(u=>u.hp>0&&!u.escaped),previous);
  const target=index===-1?b.units.find(u=>u.side!==side&&u.general)!:enemies[index];
  state.target=index===-1?-1:target.id;
  return target;
}
export function validateNativeCommands(b:BattleState,fail:()=>never):void {
  if(b.nativeCommands===undefined)return;
  if(!b.nativeCommands||!b.troopDeployment||b.movementRules!=='native-grid-v3')fail();
  for(const side of ['attacker','defender'] as const) {
    const state=b.nativeCommands[side];
    if(!state||!Array.isArray(state.orders)||state.orders.length!==8||!state.orders.every(n=>Number.isInteger(n)&&n>=0&&n<=9)||![0,1,2,8].includes(state.orders[0])||
      !Number.isInteger(state.flags)||state.flags<0||state.flags>31||typeof state.strict!=='boolean'||
      (state.target!==null&&state.target!==-1&&!b.units.some(u=>u.id===state.target&&u.side!==side&&!u.general)))fail();
    for(const u of b.units)if(u.side===side) {
      if(!Number.isInteger(u.nativeDivision)||u.nativeDivision!<0||u.nativeDivision!>5||u.general!==(u.nativeDivision===0)||u.order!==commandOrder(state.orders[u.nativeDivision!]))fail();
    }
  }
}
export type {NativeCommand,NativeDivision};
