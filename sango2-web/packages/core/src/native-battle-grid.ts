/** 0x43AF54 / 0x43AF7A / 0x402920: original occupancy bounds/query. */
export const NATIVE_GRID_WIDTH=71,NATIVE_GRID_HEIGHT=14;
export interface NativeGridCell {x:number;y:number;side:number}
export function nativeGridIndex(x:number,y:number):number {
  return Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&x<71&&y>=0&&y<14?71*y+x:-1;
}
export function nativeGridOccupancy(cells:NativeGridCell[]):Map<number,number> {
  const grid=new Map<number,number>();
  for(const c of cells){const index=nativeGridIndex(c.x,c.y);if(index>=0)grid.set(index,c.side);}
  return grid;
}
export function nativeGridCount(grid:Map<number,number>,side:number,x1:number,y1:number,x2:number,y2:number):number {
  let total=0;
  for(let y=Math.max(0,Math.min(y1,y2));y<=Math.min(13,Math.max(y1,y2));y++)
    for(let x=Math.max(0,Math.min(x1,x2));x<=Math.min(70,Math.max(x1,x2));x++)if(grid.get(71*y+x)===side)total++;
  return total;
}
/** Web deployment and legacy-position projection. New battle movement reserves
 * cells explicitly; source formations and linked-list order remain separate work. */
export function projectBattleCell(x:number,y:number):{x:number;y:number} {
  return {x:Math.max(0,Math.min(70,Math.floor(x/1200*71))),y:Math.max(0,Math.min(13,Math.floor((y-150)/360*13)))};
}
