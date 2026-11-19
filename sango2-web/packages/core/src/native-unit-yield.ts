export interface NativeYieldOccupant {id:number;side:number;flags:number;lastUpdate:number}

/** 0x43C20D. Updating a neighbour is not equivalent to vacating its cell.
 * Re-read occupancy after the callback; that callback may update other units. */
export function nativeTryVacateCell(side:number,tick:number,occupant:()=>NativeYieldOccupant|undefined,update:(id:number)=>void):boolean {
  const other=occupant();
  if(!other)return true;
  if(other.lastUpdate===tick||other.side!==side||(other.flags&0x1001)!==0)return false;
  update(other.id);
  return occupant()===undefined;
}
