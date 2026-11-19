import data from './native-projectile-types.json';
import {nativeBelow,type NativeRandomState} from './native-strategic-ai';

export interface NativeProjectile {
  object:number;x:number;y:number;z:number;vx:number;vy:number;vz:number;
  facing:number;flags:number;life:number;phase:'flight'|'hit'|'deflected';
  frame:number;remaining:number;fade:number;alive:boolean;
}
const objects=data.objects as Record<number,{wait:number[];death:number[];life:number}>;
export const nativeProjectileObject=(unit:number):number=>data.units[unit]??0;
function velocity(p:NativeProjectile,speed:number):void {
  const angle=p.facing*3.1415926/8388608;
  p.vx=Math.trunc(Math.cos(angle)*speed*65536);p.vy=Math.trunc(Math.sin(angle)*speed*65536);p.vz=0;
}
/** 0x43D5BF / 0x4217FE. Creation does not jitter the initial WAIT duration. */
export function nativeLaunchProjectile(unit:number,origin:{x:number;y:number;z:number;facing:number}):NativeProjectile|undefined {
  const object=nativeProjectileObject(unit);if(!object)return;
  const p:NativeProjectile={object,x:((origin.x>>16)+(origin.facing?-30:30))<<16,y:((origin.y>>16)+2)<<16,z:((origin.z>>16)+48)<<16,
    vx:0,vy:0,vz:0,facing:origin.facing,flags:0x30040,life:objects[object].life,phase:'flight',frame:0,remaining:objects[object].wait[0],fade:0,alive:true};
  velocity(p,12);return p;
}
/** 0x43E28B / 65539. A miss/ally block uses five draws, including the
 * nonsynchronous DEATH selection and then the random frame advance. */
export function nativeProjectileImpact(p:NativeProjectile,deflected:boolean,rng:NativeRandomState):void {
  if(deflected) {
    p.facing=(((p.facing>>16)+nativeBelow(rng,96)+80)&255)<<16;p.flags&=~0x10000;
    velocity(p,nativeBelow(rng,3)+2);p.vz=nativeBelow(rng,0x40000)+0x80000;
    p.phase='deflected';p.frame=0;p.remaining=objects[p.object].death[0]+nativeBelow(rng,5);
    const skip=nativeBelow(rng,6);
    for(let i=0;i<skip;i++){p.frame=(p.frame+1)%objects[p.object].death.length;p.remaining=objects[p.object].death[p.frame];}
    p.fade=24;
  } else {velocity(p,1);p.phase='hit';p.fade=8;}
  p.flags|=0x40000;
}
export type ProjectileCollision='empty'|'self'|'ally'|'hit'|'miss';
/** Original generic motion precedes the current-cell collision lookup. The
 * collide callback performs enemy hit/damage before deflection draws occur. */
export function nativeAdvanceProjectile(p:NativeProjectile,rng:NativeRandomState,collide:(x:number,y:number)=>ProjectileCollision):void {
  if(!p.alive)return;
  p.x=(p.x+p.vx)|0;p.y=(p.y+p.vy)|0;p.z=(p.z+p.vz)|0;
  if((p.flags&0x10000)||p.z<=0){if(p.z<0){p.z=0;p.vz=0;}}
  else p.vz=(p.vz-81920)|0;
  if(--p.remaining===0) {const durations=objects[p.object][p.phase==='deflected'?'death':'wait'];p.frame=(p.frame+1)%durations.length;p.remaining=durations[p.frame];}
  if(p.life!==0&&--p.life===0)p.alive=false;
  if(p.phase!=='flight') {if(--p.fade<=0)p.alive=false;return;}
  const collision=collide(Math.trunc((p.x>>16)/96),Math.trunc((p.y>>16)/72));
  if(collision!=='empty'&&collision!=='self')nativeProjectileImpact(p,collision!=='hit',rng);
}
