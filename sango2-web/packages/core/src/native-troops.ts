import formations from './native-troop-formations.json';
export interface TroopSlots {active:number;reserve:number}
/** 0x427A84, city +130: shared by passive recruitment and returned soldiers. */
export const nativeReserveCapacity=(population:number)=>Math.min(600,Math.trunc(population/2500)+110);
export interface TroopTransferInput extends TroopSlots {maxActive:number;maxReserve:number;pool:number;poolCapacity:number}
/** Original 0x416366/0x416415 and slider 0x4164E0. Both directions process
 * active soldiers first. An unreachable target stops at the pool/slot limit. */
export function nativeTransferTroops(input:TroopTransferInput,target:number):TroopSlots&{pool:number} {
  let {active,reserve,pool}=input;
  const difference=target-active-reserve;
  if(difference>0) {
    const moved=Math.min(difference,pool,Math.max(0,input.maxActive-active)+Math.max(0,input.maxReserve-reserve));
    const first=Math.min(moved,Math.max(0,input.maxActive-active));
    active+=first;reserve+=moved-first;pool-=moved;
  } else if(difference<0) {
    const moved=Math.min(-difference,Math.max(0,input.poolCapacity-pool),active+reserve),first=Math.min(moved,active);
    active-=first;reserve-=moved-first;pool+=moved;
  }
  return {active,reserve,pool};
}
/** 0x409FB6 / 0x409FD8, including the native -1-level sentinel behavior. */
export function nativeTroopCapacity(level:number):TroopSlots {
  return {active:level<20?level*5:100,reserve:Math.min(100,Math.max(0,(level-20)*5))};
}
/** Explicit aggregate-Web-save adapter. Overflow is preserved off-field, never
 * treated as native reserves or introduced as automatic reinforcement waves. */
export function allocateBattleTroops(total:number,level:number,saved?:TroopSlots):TroopSlots&{overflow:number} {
  const cap=nativeTroopCapacity(level);
  if(saved&&Number.isInteger(saved.active)&&saved.active>=0&&Number.isInteger(saved.reserve)&&saved.reserve>=0&&saved.active+saved.reserve<=total&&saved.active<=Math.max(0,cap.active)&&saved.reserve<=cap.reserve)
    return {...saved,overflow:total-saved.active-saved.reserve};
  const active=Math.min(total,Math.max(0,cap.active)),reserve=Math.min(total-active,cap.reserve);
  return {active,reserve,overflow:total-active-reserve};
}
/** 0x404A10 / 0x404D18: division IDs 1..5. The remainder is assigned to
 * front for active soldiers, rear for reserve soldiers, not evenly rounded. */
export function nativeTroopDivisions(formation:number,count:number,reserve:boolean):number[] {
  const row=formations[formation];if(!row)return [0,0,0,0,0];
  const order=reserve?[0,2,3,4]:[1,2,3,4],result=[0,0,0,0,0];
  let cumulative=0,assigned=0;
  for(const i of order){cumulative+=row[i];if(row[i]){result[i]=Math.trunc(cumulative*count/200)-assigned;assigned+=result[i];}}
  const remainder=reserve?1:0;if(row[remainder])result[remainder]=count-assigned;
  return result;
}
/** 0x406499 / 0x406501: reserve sprites are 140..152 / 160..172. */
export function nativeSoldierObject(unit:number,reserve:boolean,enemy=false):number {
  return 100+unit+(reserve?40:0)+(enemy?20:0);
}
