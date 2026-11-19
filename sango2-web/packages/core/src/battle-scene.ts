import type {BattleEffect,BattleState,BattleUnit} from './battle';
import {battleDeploymentCells} from './battle-movement';
import {nativeProject,nativeClampCamera,type NativeCamera,type NativeWorldPoint} from './native-projection';

/** A pure snapshot shared by the scene and minimap. Never prepare movement
 * during rendering: changing formation, generals or strategist effects must
 * still work before the simulation initializes. */
export function battleScenePoints(b:BattleState):Map<number,NativeWorldPoint> {
  const deployment=battleDeploymentCells(b);
  return new Map(b.units.map(u=>{
    const cell=deployment.get(u.id),m=u.movement;
    const point=u.casualty?{x:u.casualty.flight.x,y:u.casualty.flight.y,z:u.casualty.flight.z}:
      m?{x:m.px,y:m.py,z:0}:cell?{x:(cell.x*96+48)*65536,y:(cell.y*72+36)*65536,z:0}:
      {x:Math.trunc(u.x/1200*71*96*65536),y:Math.trunc((36+(u.y-150)/360*13*72)*65536),z:0};
    return [u.id,point];
  }));
}
export function battleUnitScenePosition(b:BattleState,u:BattleUnit,camera:NativeCamera) {
  return nativeProject(battleScenePoints(b).get(u.id)!,camera);
}
/** Web effect adapter, not evidence of original skill-script placement. Heights
 * are captured with the event, so distinct skills keep their own attachment
 * points even after the display-only unit spacing changes. */
export function battleEffectScenePoints(effect:BattleEffect,points:ReadonlyMap<number,NativeWorldPoint>) {
  const anchor=(id:number|undefined,height:number)=>{
    const point=id===undefined?undefined:points.get(id);
    return point?{...point,z:point.z+height*65536}:effect.point?{...effect.point}:undefined;
  };
  return {source:anchor(effect.sourceId,effect.sourceZ??25),target:anchor(effect.targetId,effect.targetZ??(effect.kind==='arrow'?23:24))};
}
/** Canvas texture adapter: a texel spans four source-world units. Sampling
 * uses the projected viewport width, so zooming reveals more of the same
 * ground instead of stretching one texture strip to fit the screen. */
export function battleGroundTextureSpans(cameraX:number,projectionScale:number,left:number,right:number,textureWidth:number) {
  const spans:{sourceX:number;sourceWidth:number;x:number;width:number}[]=[];
  if(!Number.isFinite(projectionScale)||projectionScale<=0||textureWidth<=0||right<=left)return spans;
  const texelWidth=projectionScale*4;
  let sourceX=((cameraX/4+(left-320)/texelWidth)%textureWidth+textureWidth)%textureWidth;
  if(sourceX>=textureWidth-1e-9)sourceX=0;
  let x=left;
  while(right-x>1e-7) {
    const sourceWidth=Math.min(textureWidth-sourceX,(right-x)/texelWidth),width=sourceWidth*texelWidth;
    spans.push({sourceX,sourceWidth,x,width});
    x+=width;sourceX=0;
  }
  return spans;
}
/** Preserve the original panorama crop in its native viewport. Mirror only
 * outside the supplied artwork for wider Web views, without smearing its edge
 * pixel into a horizontal stripe. This is a Web presentation extension. */
export function battleScenerySpans(crop:number,left:number,right:number,imageWidth:number) {
  const spans:{sourceX:number;width:number;x:number;mirror:boolean}[]=[];
  if(imageWidth<=0||right<=left)return spans;
  const first=Math.floor((crop+left)/imageWidth),last=Math.floor((crop+right)/imageWidth);
  for(let tile=first;tile<=last;tile++) {
    const start=tile*imageWidth-crop,x=Math.max(left,start),width=Math.min(right,start+imageWidth)-x,offset=x-start,mirror=tile%2!==0;
    if(width<=1e-7)continue;
    spans.push({sourceX:mirror?imageWidth-offset-width:offset,width,x,mirror});
  }
  return spans;
}
/** Portrait focus from 0x441E61 (world y minus 144). */
export function battleFocusCamera(b:BattleState,side:'attacker'|'defender'):NativeCamera {
  const general=b.units.find(u=>u.side===side&&u.general)!;
  const point=battleScenePoints(b).get(general.id)!;
  return nativeClampCamera({x:point.x>>16,y:(point.y>>16)-144});
}
