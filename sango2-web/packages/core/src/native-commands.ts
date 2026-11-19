import {nativeRandom,type NativeRandomState} from './native-strategic-ai';
import type {NativeMoveProfile} from './native-movement';

export type NativeCommand=0|1|2|3|4|5|6|7|8|9;
export type NativeDivision=0|1|2|3|4|5;
export const NATIVE_COMMAND_LABELS=['待命','前进','后退','向下移动','向上移动','分散','中央集中','冲锋','撤退','护卫主将'] as const;
/** 0x43ADED: eight saved command slots, including two reserved slots. */
export function nativeWriteCommand(orders:number[],division:number,command:number):void {
  if((division>>>0)<8)orders[division]=command;
  else for(let i=division===257?1:0;i<8;i++)orders[i]=command;
}
/** 0x402746 / 0x4027FB. The formation-4 branch consumes RNG even when
 * both wings have already advanced; do not simplify this into a set search. */
export function nativeCanAdvance(formation:number,orders:readonly number[]):boolean {
  return (formation===4?[1,4,3]:formation===5?[1,5,2]:[1]).some(i=>orders[i]===0);
}
export function nativeAdvanceDivision(formation:number,orders:number[],rng:NativeRandomState):void {
  if(formation===4) {
    if(orders[1]===0)orders[1]=1;
    else if(nativeRandom(rng)&1){if(orders[3]===0)orders[3]=1;else if(orders[4]===0)orders[4]=1;}
    else if(orders[4]===0)orders[4]=1;else if(orders[3]===0)orders[3]=1;
  } else if(formation===5) {
    if(orders[1]===0)orders[1]=1;else if(orders[5]===0)orders[5]=1;else if(orders[2]===0)orders[2]=1;
  } else orders[1]=1;
}
/** 0x43CDD3. All charging soldiers share their side's cursor into the
 * original enemy creation order. It is not a nearest-enemy search. */
export function nativeChargeTarget(alive:readonly boolean[],previous:number|null):number {
  if(previous!==null&&(previous===-1||alive[previous]))return previous;
  const start=previous??-1;
  for(let i=start+1;i<alive.length;i++)if(alive[i])return i;
  for(let i=0;i<start;i++)if(alive[i])return i;
  return -1;
}
export interface NativeCommandInput {
  command:number;general:boolean;division:number;mirror:boolean;strict:boolean;
  x:number;y:number;enemyX:number;enemyY:number;ownX:number;ownY:number;targetX:number;targetY:number;
}
/** 0x43CFB1 / 0x43CF07 and their original movement branches. */
export function nativeCommandRoute(o:NativeCommandInput):{dx:number;dy:number;profile:NativeMoveProfile} {
  const forward=o.mirror?-1:1;
  const toward=(x:number,y:number)=>({dx:Math.sign(x-o.x),dy:Math.sign(y-o.y),profile:'pursue' as const});
  if(o.general) {
    if(o.command===0)return {dx:0,dy:0,profile:'hold'};
    return {dx:o.command===1?forward:-forward,dy:0,profile:o.command===8?'generalRetreat':'generalAdvance'};
  }
  const near=o.mirror?o.x<=o.enemyX+3:o.x>=o.enemyX-3;
  switch(o.command) {
    case 0:return {dx:0,dy:0,profile:'hold'};
    case 1:return near?toward(o.enemyX,o.enemyY):{dx:forward,dy:0,profile:o.strict&&o.division===1?'strict':'advance'};
    case 2:return {dx:-forward,dy:0,profile:o.strict&&o.division===1?'lateral':'backward'};
    case 3:return {dx:0,dy:1,profile:'lateral'};
    case 4:return {dx:0,dy:-1,profile:'lateral'};
    case 5:return near?toward(o.enemyX,o.enemyY):{dx:forward,dy:o.y>3&&o.y<10?(o.y<7?-1:1):0,profile:'advance'};
    case 6:return o.y===6?{dx:forward,dy:0,profile:'centerAdvance'}:{dx:0,dy:Math.sign(6-o.y),profile:'gather'};
    case 7:return toward(o.targetX,o.targetY);
    case 8:return {dx:-forward,dy:0,profile:'retreat'};
    case 9:return toward(o.ownX,o.ownY);
    default:throw new Error('原版军令编号无效。');
  }
}
