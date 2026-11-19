import type {NativeCamera} from './native-projection';

export interface NativeMoveCamera {
  kind:'move';x:number;y:number;dx:number;dy:number;targetX:number;targetY:number;remaining:number;
}
export interface NativeLockCamera {
  kind:'lock';side:0|1;offsetX:number;offsetY:number;drift:number;previousX:number;waiting:boolean;
}
export type NativeMagicCamera=NativeLockCamera|NativeMoveCamera;
export interface NativeCameraObject {x:number;y:number;alive:boolean}

/** SCRIPT_MAGIC.SO 0x1390. Multiplication and subtraction are signed int32;
 * the final wait remains pending even when the last camera write is complete. */
export function nativeCreateMoveCamera(camera:NativeCamera,target:NativeCamera,duration:number):NativeMoveCamera {
  const x=Math.imul(camera.x,1000),y=Math.imul(camera.y,1000),targetX=Math.imul(target.x,1000),targetY=Math.imul(target.y,1000);
  return {kind:'move',x,y,targetX,targetY,dx:Math.trunc(((targetX-x)|0)/duration)|0,dy:Math.trunc(((targetY-y)|0)/duration)|0,remaining:duration};
}
export function nativeCreateLockCamera(side:0|1,offsetX=180,offsetY=-120):NativeLockCamera {
  return {kind:'lock',side,offsetX,offsetY,drift:0,previousX:0,waiting:false};
}
/** SCRIPT_MAGIC.SO 0x1C0C. Return the next coroutine, or undefined on return.
 * A newly appended MoveCamera runs in this source update (EXE 0x465700).
 * Host 256 writes raw coordinates; normal camera clamps do not apply here. */
export function nativeAdvanceMagicCamera(s:NativeMagicCamera,camera:NativeCamera,object:NativeCameraObject,enemy:NativeCamera):NativeMagicCamera|undefined {
  if(s.kind==='lock') {
    const crossed=s.waiting&&(s.side===0?s.previousX<=enemy.x:s.previousX>=enemy.x);
    if(!object.alive||crossed) {
      const move=nativeCreateMoveCamera(camera,{x:enemy.x,y:enemy.y-120},30);
      return nativeAdvanceMagicCamera(move,camera,object,enemy);
    }
    s.previousX=camera.x;
    let base=camera.x;
    if(s.side===0) {
      if(((camera.x-object.x)|0)>=s.offsetX){base=(object.x+s.offsetX)|0;s.drift=(s.drift-1)|0;}
    } else if(((object.x-camera.x)|0)>=s.offsetX){base=(object.x-s.offsetX)|0;s.drift=(s.drift+1)|0;}
    camera.x=(base+s.drift)|0;camera.y=(object.y+s.offsetY)|0;s.waiting=true;
  } else {
    if(s.remaining<=0)return;
    s.x=(s.x+s.dx)|0;s.y=(s.y+s.dy)|0;
    camera.x=Math.trunc(s.x/1000)|0;camera.y=Math.trunc(s.y/1000)|0;
    if(Math.trunc(s.x/100)===Math.trunc(s.targetX/100)&&Math.trunc(s.y/100)===Math.trunc(s.targetY/100))s.remaining=1;
    s.remaining--;
  }
  return s;
}
