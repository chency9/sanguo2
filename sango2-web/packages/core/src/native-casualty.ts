/** Original casualty initialization and fixed-point flight, separate from the
 * renderer and the Web scheduler. Visual processing consumes the shared RNG. */
import {nativeBelow,type NativeRandomState} from './native-strategic-ai';
import types from './native-casualty-types.json';
export interface NativeFlight {x:number;y:number;z:number;vx:number;vy:number;vz:number}
export interface NativeDetached {object:number;facing:number;heading:number;life:number}
export interface NativeCasualtyInput {
  unit:number;reserve:boolean;general:boolean;enemy:boolean;cellX:number;cellY:number;
  x:number;y:number;z:number;hasAttacker:boolean;attackerX:number;
}
export function nativeDetachedObject(unit:number,enemy:boolean):number {return types[unit]?.objects[enemy?1:0]??0;}
export function nativeCasualty(o:NativeCasualtyInput,rng:NativeRandomState):{detached:NativeDetached|null;flight:NativeFlight&{facing:number}} {
  let detached:NativeDetached|null=null;
  const reserve=o.reserve&&!o.general,object=nativeDetachedObject(o.unit,o.enemy),facing=o.enemy?0x800000:0;
  // 0x43DB0D -> 0x43DA1A. Even the native right-side zero-base mapping
  // returns object 10 (a flag), so do not replace the lookup with mountedness.
  if(!o.general&&o.reserve&&object)detached={object,facing,heading:facing+(o.cellY===6?nativeBelow(rng,0x200000)-0x100000:0),life:object===10?0:2400};
  // 0x43DC56 -> 0x43BE42: x jitter, y jitter, THEN vertical speed.
  const right=o.hasAttacker&&o.attackerX<o.x;
  const dx=(((o.cellX+(right?1:-1))*96+48+nativeBelow(rng,48)-24)<<16)-o.x;
  const dy=((o.cellY*72+36+nativeBelow(rng,36)-18)<<16)-o.y;
  return {detached,flight:{x:o.x,y:o.y,z:(o.z+0x200000+(reserve&&types[o.unit]?.mounted?2228224:0))|0,
    vx:Math.trunc(Math.max(-7864320,Math.min(7864320,dx))/80),vy:Math.trunc(Math.max(-5898240,Math.min(5898240,dy))/80),
    vz:nativeBelow(rng,0x10000)+(reserve?196608:0x40000),facing:right?0x800000:0}};
}
/** 0x43CD48, one original update. Ground-frame advancement/bounce is handled
 * by the caller; this function does not invent animation events. */
export function nativeAdvanceFlight(f:NativeFlight,flags=0,action=32):void {
  if(action===8)return;
  f.x=(f.x+f.vx)|0;f.y=(f.y+f.vy)|0;f.z=(f.z+f.vz)|0;
  if((flags&0x10000)||f.z<=0){if(f.z<0){f.z=0;f.vz=0;}}
  else f.vz=(f.vz-20480)|0;
}
/** Source ForceHorseProcess / OM_WALK, after its two 12-update wait frames. */
export function nativeDetachedWalk(heading:number,rng:NativeRandomState):{vx:number;vy:number} {
  const speed=nativeBelow(rng,4)+4,angle=heading*3.1415926/8388608;
  return {vx:Math.trunc(Math.cos(angle)*speed*65536),vy:Math.trunc(Math.sin(angle)*speed*65536)};
}
