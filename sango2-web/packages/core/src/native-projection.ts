/** Original 640×480 battle projection. Fixed point arithmetic matches x86;
 * viewport scaling belongs to the renderer, never to simulation coordinates. */
export interface NativeCamera {x:number;y:number}
export interface NativeWorldPoint {x:number;y:number;z:number}
export const NATIVE_INITIAL_CAMERA:Readonly<NativeCamera>={x:4000,y:339};
export const NATIVE_PROJECTION=Object.freeze({focal:620,baseY:8,height:238,horizon:-192});

/** 0x441C9A, configured by 0x443B84 and 0x441D75. */
export function nativeProjectionTables():{y:number[];scale:number[]} {
  const {focal,baseY,height,horizon}=NATIVE_PROJECTION;
  const y:number[]=[],scale:number[]=[];
  for(let i=0;i<4096;i++) {
    const depth=focal+i+horizon-1024||1,s=Math.trunc((focal<<16)/depth);
    y.push(s<=0?65536:Math.max(96,baseY+Math.trunc(focal*height/depth)));
    scale.push(s<=0?65536:s);
  }
  return {y,scale};
}
const tables=nativeProjectionTables();
/** 0x43A562. IMUL truncates before SAR; floating division is not equivalent. */
export function nativeProject(point:NativeWorldPoint,camera:NativeCamera):{x:number;y:number;scale:number} {
  const depth=((point.y>>16)-camera.y+1024)&0x3fff;
  if(depth>=4096)return {x:-256,y:-256,scale:65536};
  const scale=tables.scale[depth];
  return {x:(Math.imul(scale,(point.x>>16)-camera.x)>>16)+320,
    y:tables.y[depth]-(Math.imul(scale,point.z>>16)>>16),scale};
}
/** 0x441E07. Camera is view state and consumes no simulation RNG. */
export function nativeClampCamera(camera:NativeCamera):NativeCamera {
  return {x:Math.max(240,Math.min(6560,Math.trunc(camera.x))),y:Math.max(0,Math.min(800,Math.trunc(camera.y)))};
}
/** 0x43FF4E painter key, independent of airborne height. */
export const nativeDepth=(y:number)=>Math.max(1,1024-((y>>17)+128));
/** 0x43FF4E scales truncate separately, then facing zero mirrors the source. */
export const nativeSpriteScale=(scale:number,objectScale:number)=>Math.trunc(scale*objectScale/65536);
export const nativeSpriteFacing=(facing:number)=>facing===0?-1:1;
/** 0x4419A0 scenery layer crop. */
export const nativeSceneryCrop=(width:number,cameraX:number)=>Math.max(0,Math.min(width-640,Math.trunc((cameraX+256)*(width-640)/7072)));

/** Ground scan bands for the source 640x344 viewport. The original renderer
 * feeds 0x46BE10 with cameraX and horizonOffset-cameraY, then expands the
 * projected plane through its scanline state. This helper keeps that state
 * pure and lets Canvas sample a texture in world space. */
export interface NativeGroundBand {screenY:number;screenHeight:number;depth:number;scale:number;worldY:number}
export function nativeGroundBands(camera:NativeCamera,top=96,bottom=344,step=2):NativeGroundBand[] {
  const table=tables.y,scaleTable=tables.scale;
  const bands:NativeGroundBand[]=[];
  for(let screenY=Math.max(96,top);screenY<bottom;screenY+=step) {
    let low=0,high=4095;
    while(low<high) {
      const middle=Math.ceil((low+high)/2);
      if(table[middle]>screenY)low=middle;else high=middle-1;
    }
    const depth=Math.max(0,Math.min(4095,low));
    bands.push({screenY,screenHeight:Math.min(step,bottom-screenY),depth,
      scale:scaleTable[depth],worldY:camera.y+depth-1024});
  }
  return bands;
}
