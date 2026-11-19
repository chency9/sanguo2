import {NativeBattleOrders} from './NativeBattleOrders';
import {BattleCameraControls,resolveBattleCamera,type BattleCameraState} from './BattleCamera';
import { useEffect, useRef, useState } from 'react';
import type { TerrainDefinition } from '@sango2/content';
import { BattleHud } from './BattleHud';
import {battleAttackAction,nativeAttackFrame,nativeProjectileObject,formationLabel,battleScriptCameraLocked} from '@sango2/core';
import {battleScenePoints,battleEffectScenePoints,battleGroundTextureSpans,battleScenerySpans,nativeProject,nativeDepth,nativeSceneryCrop,nativeSpriteScale,nativeSpriteFacing,nativeGroundBands,NATIVE_INITIAL_CAMERA,type NativeWorldPoint} from '@sango2/core';
import {BattleStrategyDialog} from './BattleStrategyDialog';
import { battleStepDuration, SOURCE_TICKS_PER_STEP, NATIVE_MAGIC, commanderMagicSequences, battleSkillUnavailable, battleGeneral, battleSurvivors, battleFieldTroops, battleTroopScale, battleCasualtyPosition, battleDetachedPosition, nativeDetachedObject, battleTeamSurvivors, availableCommanders, availableFormations, isNativeFormation, type BattleState, type BattleCommand, type BattleUnit, type Division, type Formation } from '@sango2/core';

interface Animation { frames:{key:string;ticks:number}[];ticks:number;hitTick?:number|null;hitTicks?:number[];frameTicks?:number[] }
interface Atlas { objects:Record<string,{name:string;nativeScale?:number;whiteLight?:boolean;actions:Record<string,Animation>}>;frames:Record<string,{page:string;x:number;y:number;w:number;h:number;offsetX:number;offsetY:number}> }
interface Props { skills:Record<string,string>[]; terrains:TerrainDefinition[]; battle:BattleState; cityName:string; training:boolean; blocked:boolean; onCommand:(command:BattleCommand)=>void;onTick:(steps:number)=>void;onFinish:()=>void;onSave:()=>void;onLeave:()=>void; music:boolean; onMusic:()=>void }
const forceCode = (unit:string) => ({'刀':100,'槍':101,'關':102,'大':102,'弓':103,'鏈':104,'鍊':104,'飛':105,'武':106,'蠻':107,'鐵':108,'籐':109,'賊':110,'黃':110,'弩':111,'女':112}[unit[0]]??100);

export function BattleView(props:Props) {
  const canvas=useRef<HTMLCanvasElement>(null);const latest=useRef(props);latest.current=props;
  const battleRoot=useRef<HTMLElement>(null);
  const camera=useRef<BattleCameraState>({...NATIVE_INITIAL_CAMERA,follow:'attacker',zoom:1});
  const [,refreshCamera]=useState(0);
  const hud=useRef<HTMLDivElement>(null),orders=useRef<HTMLElement>(null),heading=useRef<HTMLElement>(null);
  const selection=useRef<HTMLDialogElement>(null);
  const strategyButton=useRef<HTMLButtonElement>(null);
  const [showSelection,setShowSelection]=useState(availableCommanders(props.battle,'attacker').length>1);
  const [fullscreenError,setFullscreenError]=useState('');
  const [showRoster,setShowRoster]=useState(false);
  const [showStrategy,setShowStrategy]=useState(false);
  const [ready,setReady]=useState(false),[error,setError]=useState(''),[paused,setPaused]=useState(true),[speed,setSpeed]=useState(1),[division,setDivision]=useState<Division>('all');
  const [generation,setGeneration]=useState(0);const timer=useRef({paused,speed,ready});timer.current={paused:paused||showSelection||showRoster||showStrategy,speed,ready};
  const [chosen,setChosen]=useState(props.battle.commanders.attacker.id);
  const scenery=props.battle.scenery??{terrainId:0,variant:'a' as const};
  const terrain=props.terrains.find(t=>t.id===scenery.terrainId)!;
  const sceneryKey=`${scenery.terrainId}:${scenery.variant}`;
  const [isFullscreen,setIsFullscreen]=useState(false);
  const assetKey=[props.battle.round,...(['attacker','defender'] as const).map(side=>props.battle.commanders[side].id)].join(':');
  useEffect(()=>{setChosen(availableCommanders(props.battle,'attacker')[0]?.commander.id??'');},[props.battle.phase,assetKey]);
  const title=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{title.current?.focus();},[props.battle.id]);
  useEffect(()=>{const hidden=()=>{if(document.hidden)setPaused(true);};document.addEventListener('visibilitychange',hidden);return()=>document.removeEventListener('visibilitychange',hidden);},[]);
  useEffect(()=>{const changed=()=>setIsFullscreen(document.fullscreenElement===battleRoot.current?.closest('.app'));document.addEventListener('fullscreenchange',changed);return()=>document.removeEventListener('fullscreenchange',changed);},[]);
  async function toggleFullscreen() {
    try {
      if(document.fullscreenElement) await document.exitFullscreen();
      else await battleRoot.current?.closest('.app')?.requestFullscreen();
      setFullscreenError('');
    } catch { setFullscreenError('浏览器未允许全屏；可继续在当前窗口作战。'); }
  }
  useEffect(()=>{
    const host=battleRoot.current?.closest('.app');
    return()=>{if(document.fullscreenElement===host)void document.exitFullscreen().catch(()=>{});};
  },[]);
  useEffect(()=>{
    if(props.battle.phase==='intermission')setShowSelection(true);
  },[props.battle.phase]);
  useEffect(()=>{
    const dialog=selection.current;
    if(showSelection&&!dialog?.open)dialog?.showModal();
    else if(!showSelection&&dialog?.open)dialog.close();
  },[showSelection]);
  useEffect(()=>{
    let disposed=false,raf=0;let atlas:Atlas;const images:Record<string,HTMLImageElement>={};
    let scenerySky=scenery.variant==='a'?'#95b6d0':'#9d6c75';
    const node=canvas.current!,ctx=node.getContext('2d')!;
    let previous=performance.now(),accumulator=0;
    const image=async(name:string,url:string)=>{const im=new Image();im.src=url;await im.decode();images[name]=im;};
    function drawSourceFrame(key:string) {
      const f=atlas.frames[key];
      if(f&&images[f.page])ctx.drawImage(images[f.page],f.x,f.y,f.w,f.h,-f.offsetX,-f.offsetY,f.w,f.h);
    }
    function frame(object:number,action:string,sourceAge:number) {
      const animation=atlas.objects[object]?.actions[action]??atlas.objects[object]?.actions.wait;if(!animation)return;
      let key=animation.frames[0].key;
      if(animation.frameTicks)key=animation.frames[nativeAttackFrame({frameTicks:animation.frameTicks},sourceAge)].key;
      else {
        let tick=['death','attack'].includes(action)?Math.min(sourceAge,animation.ticks-1):sourceAge%animation.ticks;
        for(const f of animation.frames){key=f.key;if(tick<f.ticks)break;tick-=f.ticks;}
      }
      drawSourceFrame(key);
    }
    let nativeScene=false,points=new Map<number,NativeWorldPoint>(),viewCamera={...NATIVE_INITIAL_CAMERA};
    let groundBandsKey='',groundBands:{screenY:number;screenHeight:number;depth:number;scale:number;worldY:number}[]=[];
    let sceneBounds={left:0,right:640,top:0,bottom:344};
    const project=(p:NativeWorldPoint)=>{
      const screen=nativeProject(p,viewCamera);
      return {...screen,scale:screen.scale/65536,sourceScale:screen.scale};
    };
    const unitPosition=(u:BattleUnit)=>nativeScene?{...project(points.get(u.id)!),height:0}:{...battleCasualtyPosition(u),scale:1,sourceScale:65536};
    const objectPosition=(p:{x:number;y:number;z?:number;displayOffset?:{x:number;y:number}})=>nativeScene?project({...p,z:p.z??0}):{...battleDetachedPosition(p),scale:1,sourceScale:65536};
    const spriteScale=(object:number,p:{sourceScale:number})=>nativeSpriteScale(p.sourceScale,atlas.objects[object]?.nativeScale??65536)/65536;
    // Legacy scripts still carry display coordinates. When an effect records an
    // actor id, use that actor's native fixed-point anchor first; this preserves
    // the original projection during camera motion and avoids nearest-unit
    // guesses when formations are tightly packed.
    function effectPosition(b:BattleState,x:number,y:number,z=0) {
      if(!nativeScene)return {x,y:y-z,scale:1};
      const anchor=b.units.reduce((best,u)=>(u.x-x)**2+(u.y-y)**2<(best.x-x)**2+(best.y-y)**2?u:best);
      const p=unitPosition(anchor),s=p.scale*48384/65536;
      return {x:p.x+(x-anchor.x)*s,y:p.y+(y-anchor.y-z)*s,scale:s};
    }
    function effectUnitPosition(b:BattleState,id:number|undefined,z=0) {
      // Coordinate-only/legacy battles keep the saved display event rather
      // than moving it with a unit that has since walked away.
      if(!nativeScene||id===undefined)return undefined;
      const world=points.get(id);
      if(!world)return undefined;
      return project({...world,z:world.z+Math.trunc(z*65536)});
    }
    function drawUnit(u:BattleUnit,b:BattleState) {
      if(u.escaped||u.hp<=0&&u.actionTick>=50)return;
      const commander=b.commanders[u.side];
      const position=unitPosition(u);
      if(nativeScene&&(position.x < sceneBounds.left-160||position.x>sceneBounds.right+160||position.y < sceneBounds.top-160||position.y>sceneBounds.bottom+160))return;
      ctx.save();ctx.translate(position.x,position.y);
      ctx.globalAlpha=u.hp<=0?Math.max(.15,1-u.actionTick/65):1;
      if(u.hp>0) {ctx.fillStyle='#100f0f44';ctx.beginPath();ctx.ellipse(0,2,u.general?25:13,4,0,0,Math.PI*2);ctx.fill();}
      // Source sprites face left. Mirror our left-side army to face the enemy.
      const appearance=commander.appearance;
      const bodyObject=u.general?(appearance?.body??600)+(u.side==='defender'?200:0):(appearance?.soldier??forceCode(commander.unit))+(u.nativeReserve?40:0)+(u.side==='defender'?20:0);
      const horseObject=appearance?.horse??900;
      const weaponObject=appearance?.weapon??700;
      const legacyScale=u.general?.64:.5*battleTroopScale(b,u.side);
      const bodyScale=nativeScene?spriteScale(bodyObject,position):legacyScale;
      const horseScale=nativeScene?spriteScale(horseObject,position):legacyScale;
      const weaponScale=nativeScene?spriteScale(weaponObject,position):legacyScale;
      const facing=nativeScene?nativeSpriteFacing(u.casualty?.facing??u.movement?.facing??(u.side==='attacker'?0:0x800000)):(u.casualty?u.casualty.facing===0x800000:u.movement?u.movement.facing===0:u.side==='attacker')?-1:1;
      const age=u.hp>0&&u.movement?.clock?u.movement.clock.actionAge:
        (u.action==='wait'||u.action==='walk'?b.tick+u.id*3:u.actionTick)*SOURCE_TICKS_PER_STEP;
      const action=u.action==='attack'?(battleAttackAction(b,u)?.key??u.action):u.action;
      const drawObject=(object:number,scale:number)=>{ctx.save();ctx.translate(0,-position.height*scale);ctx.scale(facing*scale,scale);frame(object,action,age);ctx.restore();};
      if(u.general){drawObject(horseObject,horseScale);drawObject(bodyObject,bodyScale);if(u.action!=='death')drawObject(weaponObject,weaponScale);}
      else drawObject(bodyObject,bodyScale);
      ctx.restore();
      if(u.general&&u.hp>0&&!u.escaped) {
        const x=position.x,y=position.y-(nativeScene?145*bodyScale:111),labelScale=nativeScene?.75:1;
        ctx.save();ctx.translate(x,y);ctx.scale(labelScale,labelScale);
        ctx.fillStyle='#111b';ctx.fillRect(-31,0,62,19);ctx.fillStyle=u.side==='attacker'?'#a9d6ff':'#ffbdab';ctx.font='14px KaiTi, serif';ctx.textAlign='center';ctx.fillText(commander.name,0,14);
        ctx.fillStyle='#241811';ctx.fillRect(-25,20,50,4);ctx.fillStyle=u.side==='attacker'?'#6eb8de':'#da6046';ctx.fillRect(-25,20,50*u.hp/u.maxHp,4);ctx.restore();
      }
    }
    function draw(b:BattleState) {
      nativeScene=b.deploymentRules==='native-tables-v1';points=battleScenePoints(b);viewCamera=resolveBattleCamera(b,camera.current);
      // Read layout together before writing the scene style or canvas size.
      const rect=node.getBoundingClientRect(),headingRect=heading.current?.getBoundingClientRect(),hudRect=hud.current?.getBoundingClientRect(),ordersRect=orders.current?.getBoundingClientRect(),ratio=Math.min(devicePixelRatio,2);
      const width=Math.max(1,Math.round(rect.width*ratio)),height=Math.max(1,Math.round(rect.height*ratio));
      if(node.width!==width||node.height!==height){node.width=width;node.height=height;}
      ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#231d19';ctx.fillRect(0,0,width,height);
      // Scenery and feet share one camera. A separate cover transform placed the
      // rear ranks in the sky on wide screens and hid the castle behind the HUD.
      const top=(headingRect?.bottom??rect.top)-rect.top;
      const bottom=Math.min(hudRect?.top??rect.bottom,ordersRect?.top??rect.bottom)-rect.top;
      battleRoot.current?.style.setProperty('--scene-top',`${top}px`);battleRoot.current?.style.setProperty('--scene-bottom',`${rect.height-bottom}px`);
      const availableHeight=Math.max(100,bottom-top),sceneWidth=nativeScene?640:1200,sceneHeight=nativeScene?344:510;
      const scale=Math.min(rect.width/sceneWidth,availableHeight/sceneHeight)*ratio;
      const offsetY=(top+(availableHeight-sceneHeight*scale/ratio)/2)*ratio-(nativeScene?0:40*scale);
      // Zoom the entire native scene once. Applying it only in project() left
      // troops magnified against an unchanged ground plane and horizon.
      const zoom=nativeScene?camera.current.zoom:1,sceneScale=scale*zoom;
      const sceneX=(width-sceneWidth*scale)/2+320*scale*(1-zoom),sceneY=offsetY+210*scale*(1-zoom);
      ctx.setTransform(sceneScale,0,0,sceneScale,sceneX,sceneY);
      ctx.imageSmoothingEnabled=false;
      const left=-sceneX/sceneScale,right=(width-sceneX)/sceneScale;
      const worldTop=-sceneY/sceneScale,worldBottom=(height-sceneY)/sceneScale;
      sceneBounds={left,right,top:(top*ratio-sceneY)/sceneScale,bottom:(bottom*ratio-sceneY)/sceneScale};
      const groundY=nativeScene?96:130;
      ctx.fillStyle=nativeScene?scenerySky:(scenery.variant==='a'?'#95b6d0':'#9d6c75');ctx.fillRect(left,worldTop,right-left,worldBottom-worldTop);
      const floor=images.floor;
      if(nativeScene) {
        ctx.save();ctx.imageSmoothingEnabled=false;
        const textureWidth=floor.width,textureHeight=floor.height;
        const groundBottom=Math.ceil(worldBottom),key=`${viewCamera.y}:${groundBottom}`;
        if(groundBandsKey!==key){groundBands=nativeGroundBands(viewCamera,groundY,groundBottom,2);groundBandsKey=key;}
        for(const band of groundBands) {
          const projectedScale=Math.max(.05,band.scale/65536);
          const worldTextureY=Math.floor(band.worldY/4);
          const sy=((worldTextureY%textureHeight)+textureHeight)%textureHeight;
          for(const span of battleGroundTextureSpans(viewCamera.x,projectedScale,left,right,textureWidth)) {
            ctx.drawImage(floor,span.sourceX,sy,span.sourceWidth,1,span.x,band.screenY,span.width,band.screenHeight);
          }
        }
        ctx.restore();
      } else {
        const pattern=ctx.createPattern(floor,'repeat');
        if(pattern){ctx.fillStyle=pattern;ctx.fillRect(left,groundY,right-left,worldBottom-groundY);}
      }
      // Cover the width without stretching or visible repeat seams.
      // FG is the nearest scenic layer,
      // still behind troops, not a strip below their feet.
      for(const key of ['bg','mg','fg']) {
        if(nativeScene){
          const im=images[key],crop=nativeSceneryCrop(im.width,viewCamera.x);
          for(const span of battleScenerySpans(crop,left,right,im.width)) {
            ctx.save();ctx.translate(span.x+(span.mirror?span.width:0),0);ctx.scale(span.mirror?-1:1,1);
            ctx.drawImage(im,span.sourceX,0,span.width,im.height,0,0,span.width,im.height);ctx.restore();
          }
          continue;
        }
        const im=images[key],layerScale=Math.max(1.3,(right-left)/im.width),w=im.width*layerScale,h=im.height*layerScale;
        ctx.drawImage(im,(1200-w)/2,groundY-h,w,h);
      }
      node.dataset.spriteScaleX=String(sceneScale);node.dataset.spriteScaleY=String(sceneScale);
      node.dataset.cssScale=String(scale/ratio);
      node.dataset.projection=nativeScene?'native-perspective-v1':'legacy';node.dataset.cameraX=String(viewCamera.x);node.dataset.cameraY=String(viewCamera.y);node.dataset.cameraZoom=String(camera.current.zoom);
      node.dataset.cameraOwner=battleScriptCameraLocked(b)?'script':'normal';
      node.dataset.scriptCamera=b.activeScript?.kind==='native-shoot'?JSON.stringify(b.activeScript.runtime.camera??null):'null';
      const general=b.units.find(u=>u.side==='attacker'&&u.general)!,gp=unitPosition(general);
      node.dataset.generalScreen=JSON.stringify({x:(sceneX+gp.x*sceneScale)/ratio,y:(sceneY+gp.y*sceneScale)/ratio});
      node.dataset.scenery=sceneryKey;
      node.dataset.groundY=String((sceneY+groundY*sceneScale)/ratio);
      node.dataset.rearFeetY=String((sceneY+(nativeScene?118:150)*sceneScale)/ratio);
      node.dataset.detachedObjects=String(b.detached?.length??0);
      node.dataset.simulationTick=String(b.tick);
      node.dataset.movementRules=b.movementRules??'legacy';
      node.dataset.deploymentRules=b.deploymentRules??'legacy';
      node.dataset.nativeCommands=b.nativeCommands?JSON.stringify(b.nativeCommands.attacker.orders):'legacy';
      node.dataset.attackRules=b.attackRules??'legacy';
      node.dataset.projectileRules=b.projectileRules??'legacy';
      node.dataset.magicRules=b.magicRules??'legacy';
      node.dataset.magicObject=String(b.activeScript?.kind==='native-shoot'?b.activeScript.runtime.weapon?.object??0:0);
      node.dataset.magicWeaponAge=String(b.activeScript?.kind==='native-shoot'?b.activeScript.runtime.weapon?.age??0:0);
      node.dataset.projectiles=String(b.projectiles?.length??0);
      node.dataset.projectileClock=String(b.projectiles?.reduce((sum,p)=>sum+p.age,0)??0);
      // Keep the script state observable for visual regression tests and for
      // save/replay diagnostics. Healing has no native phase field: the
      // IncreaseHP VM loop is exposed as one continuous `heal` phase while
      // `magicScriptAge` advances from the number of completed HP writes.
      node.dataset.magicScriptKind=b.activeScript?.kind??'idle';
      node.dataset.magicScriptPhase=b.activeScript?.kind==='native-shoot'?b.activeScript.runtime.phase:b.activeScript?.kind==='heal'?'heal':
        b.activeScript?.kind==='magic-projectile'||b.activeScript?.kind==='magic-area'||
        b.activeScript?.kind==='magic-reinforce'||b.activeScript?.kind==='magic-status'?b.activeScript.phase:'idle';
      node.dataset.magicScriptAge=String(b.activeScript?.kind==='native-shoot'?b.activeScript.runtime.age:b.activeScript?.kind==='heal'?Math.max(0,b.activeScript.nextPoint-1):
        b.activeScript?.kind==='magic-projectile'||b.activeScript?.kind==='magic-area'||
        b.activeScript?.kind==='magic-reinforce'||b.activeScript?.kind==='magic-status'?b.activeScript.age:0);
      node.dataset.specialAttacks=String(b.units.filter(u=>u.hp>0&&u.action==='attack'&&u.movement?.clock?.special).length);
      node.dataset.movingUnits=String(b.units.filter(u=>u.hp>0&&!u.escaped&&(u.movement?.remaining??0)>0).length);
      node.dataset.casualties=String(b.units.filter(u=>u.casualty).length);
      node.dataset.fieldTroops=String(battleFieldTroops(b,'attacker')+battleFieldTroops(b,'defender'));
      // Ordered by foot position so rear ranks never paint over the front incorrectly.
      ctx.save();if(nativeScene){ctx.beginPath();ctx.rect(left,sceneBounds.top,right-left,sceneBounds.bottom-sceneBounds.top);ctx.clip();}
      const actors=[...b.units.map(u=>({id:u.id,y:nativeScene?nativeDepth(points.get(u.id)!.y):battleCasualtyPosition(u).y,draw:()=>drawUnit(u,b)})),...(b.detached??[]).map(d=>({id:d.id,y:nativeScene?nativeDepth(d.y):battleDetachedPosition(d).y,draw:()=>{
        const p=objectPosition(d),scale=nativeScene?spriteScale(d.object,p):.5*battleTroopScale(b,d.side);
        ctx.save();ctx.translate(p.x,p.y);ctx.scale((nativeScene?nativeSpriteFacing(d.facing):d.facing===0x800000?-1:1)*scale,scale);
        frame(d.object,d.object!==10&&d.age>=24?'walk':'wait',d.age>=24?d.age-24:d.age);ctx.restore();
      }})),...(b.projectiles??[]).map(p=>({id:p.id,y:nativeScene?nativeDepth(p.y):battleDetachedPosition(p).y,draw:()=>{
        const position=objectPosition(p),scale=nativeScene?spriteScale(p.object,position):.5*battleTroopScale(b,p.side);
        const action=atlas.objects[p.object].actions[p.phase==='deflected'?'death':'wait'];
        ctx.save();ctx.translate(position.x,position.y-(nativeScene?0:p.z/65536*scale));
        ctx.globalAlpha=p.phase==='flight'?1:Math.min(16,p.fade)/16;
        ctx.scale((nativeScene?nativeSpriteFacing(p.facing):(p.facing&0x800000)?1:-1)*scale,scale);drawSourceFrame(action.frames[p.frame].key);ctx.restore();
      }}))];
      actors.sort((a,c)=>a.y-c.y||a.id-c.id).forEach(a=>a.draw());
      const magic=b.activeScript;
      if(magic?.kind==='heal') {
        // Magic1 -> Heal -> CreateHolyLight -> IncreaseHP. The original
        // script darkens the scene, emits the holy-light object, then writes
        // HP one point at a time. Keep this layer tied to the saved script
        // cursor so pausing/reloading cannot make the effect advance on its
        // own.
        const target=b.units.find(u=>u.id===magic.targetId&&u.general);
        if(target&&target.hp>0&&!target.escaped) {
          const position=unitPosition(target);
          const completed=Math.max(0,magic.nextPoint-1);
          const progress=Math.min(1,completed/Math.max(1,magic.amount));
          const pulse=.5+.5*Math.sin((b.tick+magic.wait*.35)*.55);
          const radius=18+9*pulse+8*progress;
          ctx.save();
          ctx.translate(position.x,position.y-74*position.scale);ctx.scale(position.scale,position.scale);
          ctx.globalCompositeOperation='screen';
          ctx.globalAlpha=.36+.24*pulse;
          ctx.fillStyle='#fff8c7';ctx.shadowColor='#f9d866';ctx.shadowBlur=24;
          ctx.beginPath();ctx.arc(0,0,radius*.62,0,Math.PI*2);ctx.fill();
          ctx.globalAlpha=.82;
          ctx.strokeStyle='#fff7c2';ctx.lineWidth=3;ctx.shadowBlur=16;
          ctx.beginPath();ctx.arc(0,0,radius,0,Math.PI*2);ctx.stroke();
          ctx.strokeStyle='#ffe994';ctx.lineWidth=2;ctx.shadowBlur=10;
          ctx.beginPath();ctx.moveTo(0,-radius*2.15);ctx.lineTo(0,radius*.55);ctx.stroke();
          ctx.globalAlpha=.65;
          for(let ray=0;ray<8;ray++) {
            const angle=ray*Math.PI/4+(b.tick%32)*.025;
            const inner=radius*.72,outer=radius*(1.35+.18*pulse);
            ctx.beginPath();ctx.moveTo(Math.cos(angle)*inner,Math.sin(angle)*inner);
            ctx.lineTo(Math.cos(angle)*outer,Math.sin(angle)*outer);ctx.stroke();
          }
          ctx.fillStyle='#fffde9';ctx.shadowBlur=8;ctx.globalAlpha=.95;
          ctx.beginPath();ctx.arc(0,0,4+2*pulse,0,Math.PI*2);ctx.fill();
          ctx.restore();
        }
      }
      if(magic?.kind==='magic-projectile') {
        const angle=Math.atan2(magic.toY-magic.fromY,magic.toX-magic.fromX);
        const flight=magic.phase==='windup'?0:Math.min(1,magic.phase==='flight'?magic.phaseAge/Math.max(1,magic.duration):1);
        const tail=magic.phase==='flight'?34+24*flight:18;
        const source=points.get(magic.casterId),target=points.get(magic.targetId);
        const p=nativeScene&&source&&target?project({x:Math.trunc(source.x+(target.x-source.x)*flight),y:Math.trunc(source.y+(target.y-source.y)*flight),z:Math.trunc((48+magic.z)*65536)}):effectPosition(b,magic.x,magic.y,magic.z);
        ctx.save();ctx.translate(p.x,p.y);ctx.scale(p.scale,p.scale);ctx.globalCompositeOperation='screen';
        if(magic.phase==='flight') {
          ctx.strokeStyle='#ffe39a';ctx.shadowColor='#ffbd3e';ctx.shadowBlur=14;ctx.lineWidth=4;
          ctx.beginPath();ctx.moveTo(-Math.cos(angle)*tail,-Math.sin(angle)*tail);ctx.lineTo(0,0);ctx.stroke();
          ctx.strokeStyle='#fff8d5';ctx.shadowBlur=4;ctx.lineWidth=2;
          ctx.beginPath();ctx.moveTo(-Math.cos(angle)*20,-Math.sin(angle)*20);ctx.lineTo(Math.cos(angle)*17,Math.sin(angle)*17);ctx.stroke();
          ctx.fillStyle='#fff8d5';ctx.beginPath();ctx.moveTo(Math.cos(angle)*25,Math.sin(angle)*25);ctx.lineTo(Math.cos(angle+2.65)*12,Math.sin(angle+2.65)*12);ctx.lineTo(Math.cos(angle-2.65)*12,Math.sin(angle-2.65)*12);ctx.closePath();ctx.fill();
        } else if(magic.phase==='windup') {
          const pulse=8+4*Math.sin(magic.phaseAge/Math.max(1,magic.duration)*Math.PI);
          ctx.strokeStyle='#d9b45d';ctx.shadowColor='#f6cf6a';ctx.shadowBlur=12;ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,pulse,0,Math.PI*2);ctx.stroke();
        } else {
          const pulse=18+magic.phaseAge*3;
          ctx.strokeStyle='#ffe8a6';ctx.shadowColor='#ffbd3e';ctx.shadowBlur=18;ctx.lineWidth=5;ctx.beginPath();ctx.arc(0,0,pulse,0,Math.PI*2);ctx.stroke();
          ctx.strokeStyle='#fff8d5';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-pulse,0);ctx.lineTo(pulse,0);ctx.moveTo(0,-pulse);ctx.lineTo(0,pulse);ctx.stroke();
        }
        ctx.restore();
      }
      if(magic?.kind==='magic-area') {
        // Area scripts use the same two-phase cursor as the native VM: a
        // compact charge circle during windup, then a broad shock ring at
        // impact. The radius is derived only from the saved cursor/tick so a
        // paused or reloaded battle renders the same frame.
        const progress=Math.min(1,magic.phaseAge/Math.max(1,magic.duration));
        const impact=magic.phase==='impact';
        const radius=impact?28+118*progress:18+22*progress;
        const p=effectUnitPosition(b,magic.casterId,48)??effectPosition(b,magic.x,magic.y);
        ctx.save();ctx.translate(p.x,p.y);ctx.scale(p.scale,p.scale);ctx.globalCompositeOperation='screen';
        ctx.globalAlpha=impact?.78:.46+.18*Math.sin(magic.phaseAge*.7);
        ctx.strokeStyle=impact?'#f6c86e':'#d5e9ff';ctx.shadowColor=impact?'#f29d36':'#9bc6ff';ctx.shadowBlur=impact?24:14;
        ctx.lineWidth=impact?6:3;ctx.beginPath();ctx.arc(0,0,radius,0,Math.PI*2);ctx.stroke();
        if(impact) {
          ctx.globalAlpha=.62;ctx.lineWidth=2;ctx.shadowBlur=10;
          for(let ray=0;ray<12;ray++) {const angle=ray*Math.PI/6+(b.tick%18)*.08;ctx.beginPath();ctx.moveTo(Math.cos(angle)*radius*.72,Math.sin(angle)*radius*.72);ctx.lineTo(Math.cos(angle)*radius*1.35,Math.sin(angle)*radius*1.35);ctx.stroke();}
        } else {ctx.fillStyle='#dceeff';ctx.globalAlpha=.3;ctx.beginPath();ctx.arc(0,0,7+5*progress,0,Math.PI*2);ctx.fill();}
        ctx.restore();
      }
      if(magic?.kind==='magic-reinforce') {
        const gate=magic.side==='attacker'?40:1160,progress=Math.min(1,magic.phaseAge/Math.max(1,magic.duration));
        const radius=magic.phase==='impact'?18+50*progress:12+18*progress;
        const p=nativeScene?project({x:(magic.side==='attacker'?48:6768)*65536,y:468*65536,z:0}):{x:gate,y:330,scale:1};
        ctx.save();ctx.translate(p.x,p.y);ctx.scale(p.scale,p.scale);ctx.globalCompositeOperation='screen';ctx.globalAlpha=magic.phase==='impact'?.82:.52;
        ctx.strokeStyle='#c8e9ff';ctx.shadowColor='#75b8ff';ctx.shadowBlur=20;ctx.lineWidth=4;ctx.beginPath();ctx.arc(0,0,radius,0,Math.PI*2);ctx.stroke();
        ctx.lineWidth=2;for(let ray=0;ray<8;ray++){const angle=ray*Math.PI/4+(b.tick%24)*.04;ctx.beginPath();ctx.moveTo(Math.cos(angle)*radius*.4,Math.sin(angle)*radius*.4);ctx.lineTo(Math.cos(angle)*radius*1.45,Math.sin(angle)*radius*1.45);ctx.stroke();}
        ctx.restore();
      }
      // Persistent native-style control effects stay above the affected
      // unit until their saved expiry tick, including after the cast script
      // itself has completed.
      for(const unit of b.units) {
        const status=unit.status;if(!status||status.until<=b.tick||unit.hp<=0||unit.escaped)continue;
        const p=unitPosition(unit),pulse=.65+.35*Math.sin((b.tick+unit.id)*.55);
        ctx.save();ctx.translate(p.x,p.y-(unit.general?88:48)*p.scale);ctx.scale(p.scale,p.scale);ctx.globalCompositeOperation='screen';ctx.globalAlpha=.7+.2*pulse;
        if(status.kind==='stunned') {
          ctx.strokeStyle='#ffe37b';ctx.shadowColor='#ffb62d';ctx.shadowBlur=11;ctx.lineWidth=2;
          ctx.beginPath();for(let n=0;n<5;n++){const a=-Math.PI/2+n*Math.PI*2/5;const r=n%2?5:11;const x=Math.cos(a)*r,y=Math.sin(a)*r;n?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();ctx.stroke();
        } else if(status.kind==='silenced') {
          ctx.strokeStyle='#c7d6e9';ctx.shadowColor='#94add0';ctx.shadowBlur=8;ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,8,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(-8,-8);ctx.lineTo(8,8);ctx.stroke();
        } else {
          ctx.strokeStyle='#e87963';ctx.shadowColor='#d23f32';ctx.shadowBlur=10;ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,8,0,Math.PI*2);ctx.stroke();
        }
        ctx.restore();
      }
      for(const effect of b.effects) {
        const anchors=nativeScene?battleEffectScenePoints(effect,points):undefined;
        const from=anchors?.source?project(anchors.source):effectPosition(b,effect.x,effect.y);
        const to=anchors?.target?project(anchors.target):effectPosition(b,effect.toX,effect.toY);
        ctx.strokeStyle=effect.kind==='arrow'?'#eee4be':'#ffcf65';ctx.lineWidth=effect.kind==='arrow'?2:3;
        ctx.beginPath();
        if(effect.kind==='arrow') {const t=1-effect.ticks/7;const x=from.x+(to.x-from.x)*t,y=from.y+(to.y-from.y)*t-35*Math.sin(t*Math.PI);ctx.moveTo(x,y);ctx.lineTo(x+(to.x-from.x)*.07,y+(to.y-from.y)*.07);}
        else {const r=7*to.scale;ctx.moveTo(to.x-r,to.y-r);ctx.lineTo(to.x+r,to.y+r);ctx.moveTo(to.x+r,to.y-r);ctx.lineTo(to.x-r,to.y+r);}
        ctx.stroke();
      }
      if(magic?.kind==='native-shoot') {
        const s=magic.runtime,w=s.weapon;
        // The source script exposes both screen brightness and palette shade.
        // Canvas composes their scene shade here; OF_WHITELIGHT child artwork
        // is drawn afterwards. Exact DirectDraw palette mixing remains separate.
        const dim=1-s.brightness*s.palette/256;
        if(dim>0){ctx.save();ctx.fillStyle=`rgb(0 0 0 / ${dim})`;ctx.fillRect(left,sceneBounds.top,right-left,sceneBounds.bottom-sceneBounds.top);ctx.restore();}
        if(w?.alive) {
          const p=project(w),scale=spriteScale(w.object,p),glow=s.flaming?13007:13002+s.style*2;
          ctx.save();ctx.translate(p.x,p.y);ctx.scale(nativeSpriteFacing(w.facing*65536)*scale,scale);
          ctx.globalAlpha=w.fade/16;
          if(atlas.objects[w.object].whiteLight)ctx.globalCompositeOperation='screen';
          frame(w.object,'wait',w.age);
          ctx.globalCompositeOperation='screen';frame(glow,'wait',w.age);ctx.restore();
        }
      }
      ctx.restore();
    }
    function loop(now:number) {
      if(disposed)return;
      const current=latest.current,control=timer.current;
      const elapsed=Math.min(.15,(now-previous)/1000);previous=now;
      if(control.ready&&!control.paused&&!current.blocked&&current.battle.phase==='fighting'&&!document.hidden) {
        accumulator+=elapsed*control.speed;
        const stepDuration=battleStepDuration(current.battle);
        const steps=Math.min(10,Math.floor(accumulator/stepDuration));
        if(steps){accumulator-=steps*stepDuration;current.onTick(steps);}
      } else accumulator=0;
      if(atlas)draw(current.battle);
      raf=requestAnimationFrame(loop);
    }
    async function load() {
      try {
        const response=await fetch('/assets/battle/animations.json');if(!response.ok)throw new Error('缺少战场动画资料');atlas=await response.json();
        const pages=new Set<string>();
        for(const side of ['attacker','defender'] as const) {
          const c=latest.current.battle.commanders[side],a=c.appearance;
          const battle=latest.current.battle,soldier=(a?.soldier??forceCode(c.unit))+(side==='defender'?20:0);
          const hasReserve=(battle.troopDeployment?.[side].reserve??battle.reserves[side])>0||battle.units.some(u=>u.side===side&&u.nativeReserve);
          const detached=battle.casualtyRules&&hasReserve?nativeDetachedObject(soldier-(side==='defender'?120:100),side==='defender'):0;
          const projectile=battle.projectileRules?nativeProjectileObject(soldier-(side==='defender'?120:100)):0;
          for(const id of [a?.horse??900,a?.weapon??700,(a?.body??600)+(side==='defender'?200:0),soldier,...(hasReserve?[soldier+40]:[]),...(detached?[detached]:[]),...(projectile?[projectile]:[]),...(battle.projectiles??[]).filter(p=>p.side===side).map(p=>p.object),...(battle.detached??[]).filter(d=>d.side===side).map(d=>d.object)]) {
            const obj=atlas.objects[id];if(!obj)throw new Error(`缺少人物动画 ${id}`);
            for(const anim of Object.values(obj.actions))for(const f of anim.frames)pages.add(atlas.frames[f.key].page);
          }
        }
        // All four ShootObject wrappers share these small source resources.
        // Decode them before combat so a cast never advances while art loads.
        if(latest.current.battle.magicRules)for(const id of [13001,13002,13003,13004,13005,13006,13007]) {
          const object=atlas.objects[id];if(!object)throw new Error(`缺少武将技动画 ${id}`);
          for(const animation of Object.values(object.actions))for(const f of animation.frames)pages.add(atlas.frames[f.key].page);
        }
        const variant=terrain.variants.find(v=>v.id===scenery.variant)!;
        await Promise.all([image('bg',`/assets/${variant.background}`),image('mg',`/assets/${variant.midground}`),
          image('fg',`/assets/${variant.foreground}`),image('floor',`/assets/${terrain.floor}`),
          ...[...pages].map(n=>image(n,`/assets/battle/${n}`))]);
        if(disposed)return;
        // Sample the source sky once at load time. A single stretched pixel
        // row creates vertical stripes when remote zoom exposes extra sky.
        const sample=document.createElement('canvas');sample.width=images.bg.width;sample.height=1;
        const sampleContext=sample.getContext('2d')!;sampleContext.drawImage(images.bg,0,0);
        const colors=sampleContext.getImageData(0,0,sample.width,1).data;
        let red=0,green=0,blue=0,alpha=0;
        for(let i=0;i<colors.length;i+=4){const a=colors[i+3];red+=colors[i]*a;green+=colors[i+1]*a;blue+=colors[i+2]*a;alpha+=a;}
        if(alpha)scenerySky=`rgb(${Math.round(red/alpha)} ${Math.round(green/alpha)} ${Math.round(blue/alpha)})`;
        setReady(true);raf=requestAnimationFrame(loop);
      }catch(e){if(!disposed)setError(e instanceof Error?e.message:'战场资源加载失败');}
    }
    timer.current.ready=false;setReady(false);setPaused(true);setError('');void load();
    return()=>{disposed=true;cancelAnimationFrame(raf);};
  },[generation,assetKey,sceneryKey]);
  const b=props.battle;
  const issue=(order:'advance'|'hold'|'retreat')=>props.onCommand({type:'order',division,order});
  const formations=availableFormations(b.commanders.attacker.formations);
  const legacyFormation=!isNativeFormation(b.formation);
  const storedFormation=!formations.some(option=>option.id===b.formation);
  const between=b.phase==='intermission';
  const canCommand=b.phase==='deployment'||b.phase==='fighting';
  const knownSkills=commanderMagicSequences(b.commanders.attacker.rawSkill,b.commanders.attacker.level,b.commanders.attacker.skillLearnset);
  return <main ref={battleRoot} className="battle-screen" data-phase={b.phase}>
    <header ref={heading} className="battle-heading"><div><span>{props.training?'校场演武':b.invasionSide==='defender'?'敌军来袭 · 我军守城':'我军攻城'}</span><h1 ref={title} tabIndex={-1}>{props.cityName}之战</h1></div><div><button onClick={()=>setPaused(p=>!p)} disabled={b.phase!=='fighting'||!ready}>{paused?'继续战斗':'暂停战斗'}</button><select aria-label="战场速度" value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value="1">正常速度</option><option value="2">二倍速</option><option value="4">四倍速</option></select><button disabled={props.training} onClick={()=>{setPaused(true);props.onSave();}}>战中存档</button><button type="button" disabled={!document.fullscreenEnabled} onClick={()=>void toggleFullscreen()}>{isFullscreen?'退出全屏':'全屏战场'}</button><button type="button" aria-pressed={props.music} onClick={props.onMusic}>{props.music?'音乐开':'音乐关'}</button><button type="button" aria-expanded={showRoster} onClick={()=>{setPaused(true);setShowRoster(v=>!v);}}>两军名册</button>{props.training&&<button onClick={props.onLeave}>返回地图</button>}</div>{b.deploymentRules==='native-tables-v1'&&ready&&<BattleCameraControls toolbar camera={camera} battle={b} onChange={()=>refreshCamera(n=>n+1)}/>}</header>
    <div ref={hud} className="battle-hud-wrap"><BattleHud battle={b} camera={resolveBattleCamera(b,camera.current)} onLocate={battleScriptCameraLocked(b)?undefined:(x,y)=>{Object.assign(camera.current,{x,y,follow:null});refreshCamera(n=>n+1);}}/></div>
    {fullscreenError&&<p className="fullscreen-notice" role="status">{fullscreenError}<button onClick={()=>setFullscreenError('')} aria-label="关闭全屏提示">×</button></p>}
    {showRoster&&<section className="battle-rosters" aria-label="两军出阵名册">
      {(['attacker','defender'] as const).map(side=><div key={side} role="region" aria-label={side==='attacker'?'我军兵员':'敌军兵员'}><h3>{side==='attacker'?'我军':'敌军'} · 第 {b.round} 阵 <span>全队余兵 {battleTeamSurvivors(b,side)}</span></h3>{b.troopDeployment&&<p>在场 {battleFieldTroops(b,side)} · 现役 {b.units.filter(u=>u.side===side&&!u.general&&u.hp>0&&!u.escaped&&!u.nativeReserve).length} · 预备 {b.units.filter(u=>u.side===side&&!u.general&&u.hp>0&&!u.escaped&&u.nativeReserve).length}{b.reserves[side]>0?` · 超编留营 ${b.reserves[side]}`:''}</p>}<div className="battle-roster-list">{b.rosters[side].map(m=>{
        const active=m.commander.id===b.commanders[side].id;
        const hp=active?battleGeneral(b,side).hp:m.commander.hp;
        return <div key={m.commander.id} className={`battle-roster-member ${m.withdrawn?'withdrawn':active?'active':''}`}><img src={`/assets/${m.commander.portrait}`} alt="" width="40" height="48"/><div><strong>{m.commander.name}</strong><small>{m.withdrawn?'已退阵':hp===0?'重伤':active?'本阵主将':'候阵'} · 体 {Math.ceil(hp)} · 兵 {active?battleSurvivors(b,side):m.troops}</small></div></div>;
      })}</div></div>)}
    </section>}
    <dialog ref={selection} className="round-dialog" aria-label="点将出阵" onCancel={e=>{if(between)e.preventDefault();else setShowSelection(false);}} onClose={()=>{if(!between)setShowSelection(false);}}><form className="round-selection" onSubmit={e=>{e.preventDefault();props.onCommand({type:between?'next-round':'select-commander',commanderId:chosen});setShowSelection(false);}}>
      <div><span className="eyebrow">{between?`第 ${b.round} 阵已毕`:'点将出阵'}</span><h2>{between?b.reason:'择一员上将，领本部兵马出战'}</h2><p>体力与余兵随将延续。{between?'可换将再战，也可收兵撤回。':'确认出阵武将后，布阵并擂鼓开战。'}</p></div>
      <fieldset><legend>{between?'下一阵出战武将':'本阵出战武将'}</legend><div className="round-choices">{availableCommanders(b,'attacker').map(m=><label key={m.commander.id}><input type="radio" name="commander" value={m.commander.id} checked={chosen===m.commander.id} onChange={()=>setChosen(m.commander.id)}/><img src={`/assets/${m.commander.portrait}`} alt="" width="50" height="60"/><span><strong>{m.commander.name}</strong><small>体 {m.commander.hp} · 技 {m.commander.mp} · 兵 {m.troops}</small><small>{m.commander.unit}兵 · 武 {m.commander.strength}</small></span></label>)}</div></fieldset>
      <div className="round-actions"><button className="primary" disabled={!chosen}>{between?'出战下一阵':'确认出阵'}</button>{between?<button type="button" onClick={()=>{props.onCommand({type:'withdraw'});setShowSelection(false);}}>全军收兵</button>:<button type="button" onClick={()=>setShowSelection(false)}>返回布阵</button>}</div>
    </form></dialog>
    {showStrategy&&b.phase==='deployment'&&<BattleStrategyDialog battle={b} onCommand={props.onCommand} onClose={()=>{setShowStrategy(false);requestAnimationFrame(()=>strategyButton.current?.focus());}}/>}
    <div className={`battle-stage ${between?'between-rounds':''}`}><canvas ref={canvas} aria-label="实时战场画面" role="img"/>
      {b.deploymentRules==='native-tables-v1'&&ready&&<BattleCameraControls camera={camera} battle={b} onChange={()=>refreshCamera(n=>n+1)}/>}
      {!ready&&!error&&<div className="battle-loading">旌旗列阵，战场载入中…</div>}
      {error&&<div className="battle-loading" role="alert">{error}<button onClick={()=>setGeneration(x=>x+1)}>重新载入战场</button></div>}
      {b.phase==='finished'&&<div className="battle-result" role="status"><span>此 战 已 定 · 共 {b.history.length} 阵</span><h2>{b.winner==='attacker'?'大 获 全 胜':'收 兵 回 营'}</h2><p>{b.reason}</p><p>我方余兵 {battleTeamSurvivors(b,'attacker')} · 敌方余兵 {battleTeamSurvivors(b,'defender')}</p><button className="primary" onClick={props.onFinish}>{props.training?'结束演武':'收兵 · 返回天下'}</button></div>}
      {paused&&b.phase==='fighting'&&<div className="battle-pause">战场暂停</div>}
    </div>
    <section ref={orders} className="battle-orders" aria-label="战场军令">{b.nativeCommands?<NativeBattleOrders battle={b} onCommand={props.onCommand} enabled={canCommand}/>:<><div className="command-selection"><h2>军 令</h2><div role="group" aria-label="选择部队">{(['all','front','rear','general'] as const).map(d=><button key={d} aria-pressed={division===d} onClick={()=>setDivision(d)}>{({all:'全军',front:'前军',rear:'后军',general:'主将'})[d]}</button>)}</div></div><div className="command-actions"><button disabled={!canCommand} onClick={()=>issue('advance')}>前进迎敌</button><button disabled={!canCommand} onClick={()=>issue('hold')}>原地待命</button><button disabled={!canCommand} onClick={()=>issue('retreat')}>撤离战场</button></div></>}{knownSkills.length>0&&<div className="skill-actions" aria-label="武将技">{knownSkills.map(sequence=>{const source=props.skills.find(s=>Number(s.SEQUENCE)===sequence);const magic=NATIVE_MAGIC[sequence]??{sequence,name:source?.NAME??'武将技',mp:Number(source?.MP??0),power:0,attack:0,script:0,attrib:'',active:'',flags:0,effectType:'area' as const,evidenceLevel:'inferred' as const};const unavailable=battleSkillUnavailable(b,sequence);const state=unavailable?'unavailable':'available';const evidence=magic.evidenceLevel==='verified'?'已核实':'脚本推断';return <button key={sequence} data-sequence={sequence} data-effect-type={magic.effectType} data-evidence-level={magic.evidenceLevel} data-skill-state={state} className={'skill-'+magic.effectType} disabled={!!unavailable} title={magic.name+' · '+(magic.active||'目标由脚本决定')+' · '+evidence} onClick={()=>props.onCommand({type:'skill',sequence})}><span className="skill-name">{magic.name}</span><small>{String(sequence).padStart(2,'0')} · {magic.mp}技</small><small className="skill-state">{unavailable??'可施展'}</small></button>;})}</div>}<div className="formation-control">{props.training&&b.phase==='deployment'&&<div className="scenery-control"><label htmlFor="drill-terrain">演武地形</label><select id="drill-terrain" name="terrain" value={scenery.terrainId} onChange={e=>props.onCommand({type:'scenery',terrainId:Number(e.target.value),variant:scenery.variant})}>{props.terrains.map(t=><option key={t.id} value={t.id}>{t.name}{t.name==='城'?` · ${t.id+1}`:''}</option>)}</select><label htmlFor="drill-light">景色</label><select id="drill-light" name="variant" value={scenery.variant} onChange={e=>props.onCommand({type:'scenery',terrainId:scenery.terrainId,variant:e.target.value as 'a'|'b'})}><option value="a">景色一</option><option value="b">景色二</option></select></div>}<label className="formation-picker">阵形<select aria-label="战场阵形" aria-describedby="battle-formation-hint" disabled={b.phase!=='deployment'} value={b.formation} onChange={e=>props.onCommand({type:'formation',formation:e.target.value as Formation})}>{storedFormation&&<option value={b.formation} disabled>{legacyFormation?({line:"横列阵",wedge:"锥形阵",square:"方阵"} as Record<string,string>)[b.formation]:formationLabel(b.formation)}（存档阵形）</option>}{formations.map(option=><option key={option.id} value={option.id} title={option.description}>{option.label}</option>)}</select></label><small id="battle-formation-hint" className="formation-hint">{storedFormation?"存档布阵，可改选已习得阵形":`${b.commanders.attacker.name} · 已习得 ${formations.length} 阵`}</small>{b.phase==='deployment'&&b.rosters.attacker.length>1&&<button onClick={()=>setShowSelection(true)}>点将出阵</button>}{b.phase==='deployment'&&<button ref={strategyButton} type="button" onClick={()=>setShowStrategy(true)}>军师献策</button>}{b.phase==='deployment'&&<button className="primary" disabled={!ready} onClick={()=>{props.onCommand({type:'start'});setPaused(false);}}>擂鼓开战</button>}</div></section>
    {showRoster&&b.history.length>0&&<details className="round-history"><summary>交锋记录 · {b.history.length} 阵</summary><ol>{b.history.map(r=><li key={r.round}>第 {r.round} 阵 · {r.reason}</li>)}</ol></details>}
    <footer className="battle-footer"><div><span>军情</span><p aria-live="polite">{b.log[0]}</p></div><p>{props.training?'演武不影响战役进度。':'全军交锋结束后，武将体力、技力和余兵写回战役。'}</p></footer>
  </main>;
}
