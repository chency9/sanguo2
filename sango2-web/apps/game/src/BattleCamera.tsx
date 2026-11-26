import {useRef,type RefObject} from 'react';
import {battleFocusCamera,battleScenePoints,battleScriptCameraLocked,nativeClampCamera,type BattleState,type NativeCamera} from '@sango2/core';

export interface BattleCameraState extends NativeCamera {
  follow:'attacker'|'defender'|'front'|null;zoom:number;
  scriptView?:{key:string;camera:NativeCamera};
}
export function resolveBattleCamera(b:BattleState,c:BattleCameraState):NativeCamera {
  const script=b.activeScript;
  if(battleScriptCameraLocked(b)&&(script?.kind==='native-shoot'||script?.kind==='native-heal'||script?.kind==='native-reinforce'||script?.kind==='native-explode'||script?.kind==='native-rolltub')) {
    const key=`${b.id}:${b.round}:${script.casterId}:${b.tick*3-script.runtime.age}`;
    // Freeze the current view until the SO's first host-256 write. This is
    // private presentation state: no battle coordinates or RNG are changed.
    if(c.scriptView?.key!==key)c.scriptView={key,camera:resolveNormalCamera(b,c)};
    return script.runtime.camera??c.scriptView.camera;
  }
  delete c.scriptView;
  return resolveNormalCamera(b,c);
}
function resolveNormalCamera(b:BattleState,c:BattleCameraState):NativeCamera {
  if(c.follow==='attacker'||c.follow==='defender')return battleFocusCamera(b,c.follow);
  if(c.follow==='front') {
    const points=battleScenePoints(b),front=b.units.filter(u=>u.side==='attacker'&&u.hp>0&&!u.escaped);
    const target=front.reduce<(typeof b.units)[number]|undefined>((best,u)=>!best||points.get(u.id)!.x>points.get(best.id)!.x?u:best,undefined);
    if(target){const p=points.get(target.id)!;return nativeClampCamera({x:(p.x>>16)+160,y:144});}
  }
  return nativeClampCamera(c);
}

/** Pointer drag and scoped keyboard controls; camera movement never issues
 * army commands or updates battle state. */
export function BattleCameraControls({camera,battle,onChange,toolbar=false}:{camera:RefObject<BattleCameraState>;battle:BattleState;onChange:()=>void;toolbar?:boolean}) {
  const drag=useRef<{id:number;x:number;y:number;camera:NativeCamera}|null>(null);
  const locked=battleScriptCameraLocked(battle);
  const change=(value:Partial<BattleCameraState>)=>{Object.assign(camera.current,value);onChange();};
  const move=(dx:number,dy:number)=>change({...nativeClampCamera({x:resolveBattleCamera(battle,camera.current).x+dx,y:resolveBattleCamera(battle,camera.current).y+dy}),follow:null});
  if(toolbar)return (
    <div className="battle-camera-controls" role="group" aria-label="战场镜头">
      <button type="button" disabled={locked} aria-pressed={camera.current.follow==='attacker'} onClick={()=>change({follow:'attacker'})}>我军主将</button>
      <button type="button" disabled={locked} aria-pressed={camera.current.follow==='defender'} onClick={()=>change({follow:'defender'})}>敌军主将</button>
      <button type="button" disabled={locked} aria-pressed={camera.current.follow==='front'} onClick={()=>change({follow:'front'})}>交锋前线</button>
      <label>视距<select aria-label="战场视距" value={camera.current.zoom} onChange={e=>change({zoom:Number(e.target.value)})}><option value="1">原版</option><option value="0.65">远景</option><option value="1.5">近景</option></select></label>
    </div>);
  return (
    <div className="battle-camera-surface" role="group" aria-label="拖动战场镜头" aria-describedby="battle-camera-help" aria-disabled={locked} tabIndex={locked?-1:0}
      onPointerDown={e=>{if(locked||!e.isPrimary||e.button!==0)return;e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,camera:resolveBattleCamera(battle,camera.current)};}}
      onPointerMove={e=>{const start=drag.current;if(locked||!start||start.id!==e.pointerId)return;const scale=Number(e.currentTarget.parentElement?.querySelector('canvas')?.dataset.cssScale??1)*camera.current.zoom;change({...nativeClampCamera({x:start.camera.x-(e.clientX-start.x)/scale,y:start.camera.y+(e.clientY-start.y)/scale}),follow:null});}}
      onPointerUp={e=>{if(drag.current?.id===e.pointerId){drag.current=null;e.currentTarget.releasePointerCapture(e.pointerId);}}}
      onLostPointerCapture={()=>{drag.current=null;}}
      onPointerCancel={()=>{drag.current=null;}}
      onKeyDown={e=>{if(locked)return;const step=e.shiftKey?160:64,keys:Record<string,[number,number]>={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,step],ArrowDown:[0,-step]};if(keys[e.key]){e.preventDefault();move(...keys[e.key]);}else if(e.key==='Home'){e.preventDefault();change({follow:'attacker',zoom:1});}}}>
      <span id="battle-camera-help">{locked?'武将技施展中 · 镜头自动跟随':'拖动或方向键移动镜头 · Home 返回我军'}</span>
    </div>
  );
}
