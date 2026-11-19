import {nativeBelow,type NativeRandomState} from './native-strategic-ai';
import profiles from './native-movement-profiles.json';
import commandProfiles from './native-command-profiles.json';
import ranges from './native-movement-ranges.json';
import {nativeGridIndex} from './native-battle-grid';
const movementProfiles={...profiles,...commandProfiles};
export type NativeMoveProfile=keyof typeof movementProfiles;
export function nativeMovementRange(unit:number,reserve:boolean,general=false):number {return general?1:(ranges[unit]?.[reserve?1:0]??1);}

/** 0x43C2A5's 8-neighbour candidate lottery and 0x48E560 direction table. */
const directionMap=[3,2,1,4,-1,0,5,6,7];
const relativeDirections=[0,-1,1,-2,2,-3,3,-4];
const offsets:[number,number][]= [[1,0],[1,-1],[0,-1],[-1,-1],[-1,0],[-1,1],[0,1],[1,1]];
export function nativeMovementCandidates(dx:number,dy:number,weights:readonly number[],rng:NativeRandomState):[number,number][] {
  const index=3*(dy+1)+dx+1;
  if(dx<-1||dx>1||dy<-1||dy>1||directionMap[index]===-1)return Array.from({length:8},()=>[0,0] as [number,number]);
  const rotation=directionMap[index],remaining=weights.slice(0,8).map(v=>Math.max(0,Math.trunc(v)));
  let total=remaining.reduce((a,v)=>a+v,0);const result:[number,number][]=[];
  for(let i=0;i<8;i++) {
    if(total<=0){result.push([0,0]);continue;}
    const draw=nativeBelow(rng,total);let selected=0,at=draw;
    for(;selected<8;selected++){if(at<remaining[selected])break;at-=remaining[selected];}
    if(selected>=8)selected=7;
    total-=remaining[selected];remaining[selected]=0;
    const o=offsets[(relativeDirections[selected]+rotation)&7];result.push(o);
  }
  return result;
}
/** 0x43BBE6: scan one row, stop at an ally, ignore dead occupants. */
export function nativeForwardTarget(x:number,y:number,direction:number,range:number,occupant:(x:number,y:number)=>'ally'|'enemy'|'dead'|undefined):number {
  for(let distance=1;distance<=range;distance++) {
    const at=x+direction*distance;if(nativeGridIndex(at,y)<0)return 0;
    const unit=occupant(at,y);if(unit==='enemy')return direction*distance;if(unit==='ally')return 0;
  }
  return 0;
}
export interface NativeMoveInput {x:number;y:number;dx:number;dy:number;px:number;py:number;profile:NativeMoveProfile;retreat:boolean;facing:number;enemyX:number;general?:boolean;returning?:boolean;forwardTarget?:boolean|(()=>boolean)}
export interface NativeMovePlan {kind:'move'|'escape'|'hold';x:number;y:number;vx:number;vy:number;facing:number;returned?:boolean}
/** 0x43C4C0 / 0x43BF26 / 0x43BE42. First try empty cells; only on failure
 * draw a second list and attempt to vacate eligible allies via the caller.
 * The caller owns occupancy/list-order and must reserve the chosen cell. */
export function nativePlanMove(o:NativeMoveInput,rng:NativeRandomState,occupied:(x:number,y:number)=>boolean,vacate:(x:number,y:number)=>boolean=()=>false):NativeMovePlan {
  const profile=movementProfiles[o.profile];
  const commit=(x:number,y:number,escape=false):NativeMovePlan=>{
    const jitter=profile[0]===0||escape;
    const px=((96*x+48+(jitter?nativeBelow(rng,48)-24:0))*65536)|0;
    const py=((72*y+36+(jitter?nativeBelow(rng,36)-18:0))*65536)|0;
    return {kind:escape?'escape':'move',x,y,vx:Math.trunc(Math.max(-7864320,Math.min(7864320,(px-o.px)|0))/40),
      vy:Math.trunc(Math.max(-5898240,Math.min(5898240,(py-o.py)|0))/40),facing:x>o.x?0:x<o.x?0x800000:o.facing};
  };
  for(const [dx,dy] of nativeMovementCandidates(o.dx,o.dy,profile.slice(1,9),rng)) {
    if(!dx&&!dy)break;const x=o.x+dx,y=o.y+dy;
    if(nativeGridIndex(x,y)>=0&&!occupied(x,y))return commit(x,y);
  }
  for(const [dx,dy] of nativeMovementCandidates(o.dx,o.dy,profile.slice(9,17),rng)) {
    if(!dx&&!dy)break;const x=o.x+dx,y=o.y+dy;
    if(nativeGridIndex(x,y)>=0){if(!occupied(x,y)||vacate(x,y))return commit(x,y);}
    else if(o.retreat&&(x<0||x>=71))return commit(x,o.y,true);
    else if(o.general&&o.returning&&(x<0||x>=71))return {kind:'hold',x:o.x,y:o.y,vx:0,vy:0,facing:o.dx<0?0:0x800000,returned:true};
  }
  // 0x43C084 deliberately tests signed components, not absolute magnitudes.
  let vx=Math.trunc((((96*o.x+48)*65536-o.px)|0)/40),vy=Math.trunc((((72*o.y+36)*65536-o.py)|0)/40),facing=o.facing;
  if(vx<256&&vy<256){vx=0;vy=0;if(!o.retreat&&!o.general&&!(typeof o.forwardTarget==='function'?o.forwardTarget():o.forwardTarget))facing=o.x<=o.enemyX?0:0x800000;}
  return {kind:'hold',x:o.x,y:o.y,vx,vy,facing};
}
