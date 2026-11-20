import type {NativeRandomState} from './native-strategic-ai';
import {nativeCreateMoveCamera,nativeAdvanceMagicCamera,type NativeMoveCamera} from './native-magic-camera';

export type NativeReinforceFamily='more'|'back';
export interface NativeReinforceDefinition {sequence:number;script:number;back:boolean;family:NativeReinforceFamily;amount:number}
const DEFINITIONS:Readonly<Record<number,NativeReinforceDefinition>>={
  5:{sequence:5,script:509,back:false,family:'more',amount:17},17:{sequence:17,script:523,back:false,family:'more',amount:32},57:{sequence:57,script:565,back:false,family:'more',amount:25},81:{sequence:81,script:584,back:false,family:'more',amount:42},
  19:{sequence:19,script:524,back:true,family:'back',amount:25},31:{sequence:31,script:533,back:true,family:'back',amount:35},37:{sequence:37,script:541,back:true,family:'back',amount:45},
};
const BY_SCRIPT:Readonly<Record<number,NativeReinforceDefinition>>=Object.fromEntries(Object.values(DEFINITIONS).map(d=>[d.script,d]));
export function nativeReinforceDefinition(scriptOrSequence:number):NativeReinforceDefinition|undefined {const d=DEFINITIONS[scriptOrSequence]??BY_SCRIPT[scriptOrSequence];return d&&{...d};}
export interface NativeReinforceSpawn {t:number;side:0|1;x:number;y:number;handle:number;back:boolean}
export interface NativeMagicReinforceEvent {t:number;host?:number;child?:string;args:(string|number)[]}
export interface NativeReinforceVisual {id:number;x:number;y:number;alpha:number;flags:number;step:number;born?:number}
export interface NativeMagicReinforce {sequence:number;script:number;back:boolean;family:NativeReinforceFamily;sideFlag:0|1;origin:{x:number;y:number;z:number};level:number;amount:number;requested:number;age:number;phase:'darken'|'pose'|'spawn'|'move'|'return'|'brighten'|'done';phaseAge:number;brightness:number;palette:number;casterLocked:boolean;camera?:{x:number;y:number};cameraTrack?:NativeMoveCamera;returnAt?:number;brightenAt?:number;visuals:NativeReinforceVisual[];spawns:NativeReinforceSpawn[];materialized:number;nextHandle:number}
export interface NativeReinforceWorld {level:number;living:number;occupant:(x:number,y:number)=>number|boolean;spawn:(x:number,y:number,back?:boolean)=>number}

export function nativeCreateMagicReinforce(scriptOrSequence:number,origin:{x:number;y:number;z?:number},sideFlag:0|1,level=40,living=0):NativeMagicReinforce {
  const d=nativeReinforceDefinition(scriptOrSequence);if(!d)throw new Error('Unsupported reinforce script');
  return {sequence:d.sequence,script:d.script,back:d.back,family:d.family,sideFlag,origin:{x:origin.x,y:origin.y,z:origin.z??0},level,amount:d.amount,requested:0,age:0,phase:'darken',phaseAge:0,brightness:16,palette:16,casterLocked:false,visuals:[],spawns:[],materialized:0,nextHandle:1000};
}
// Produce* visits the two middle rows twice before moving outward. The
// inclusive x sentinel is observable when all real cells are occupied.
const scanY=[7,6,6,7,5,8,4,9,3,10,2,11,1,12];
function scanX(back:boolean,side:0|1){const from=back===(side===0)?0:70,step=from===0?1:-1;return Array.from({length:72},(_,i)=>from+i*step);}
const event=(s:NativeMagicReinforce,emit:(e:NativeMagicReinforceEvent)=>void,host:number,...args:(string|number)[])=>emit({t:s.age,host,args});
function moveCamera(s:NativeMagicReinforce,target:{x:number;y:number},duration:number,emit:(e:NativeMagicReinforceEvent)=>void) {
  event(s,emit,273);event(s,emit,274);
  s.cameraTrack=nativeCreateMoveCamera(s.camera!,target,duration);
}
function advanceCamera(s:NativeMagicReinforce,emit:(e:NativeMagicReinforceEvent)=>void) {
  const track=s.cameraTrack;if(!track)return;
  if(track.remaining===0){delete s.cameraTrack;return;}
  nativeAdvanceMagicCamera(track,s.camera!,{x:0,y:0,alive:true},{x:0,y:0});
  event(s,emit,256,s.camera!.x,s.camera!.y);
}
function showSoldiers(s:NativeMagicReinforce,emit:(e:NativeMagicReinforceEvent)=>void) {
  // StepShow waits 20 updates, then waits ten before each of 16 writes.
  // It remains independent of the parent's return-camera phase.
  for(const v of s.visuals) {
    const age=s.age-(v.born??s.spawns.find(p=>p.handle===v.id)?.t??60);
    if(age>=30&&age<=180&&age%10===0) {
      v.alpha=v.step=(age-20)/10;event(s,emit,39,v.id,v.alpha);
      if(v.alpha===16){v.flags&=~0x40000;event(s,emit,43,v.id,0x40000);}
    }
  }
}

/** MoreSoldier/BackSoldier, Produce* and StepShow source coroutine boundary.
 * The emitted object handles remain world-provided; no fixture is executed. */
export function nativeAdvanceMagicReinforce(s:NativeMagicReinforce,rng:NativeRandomState,world:NativeReinforceWorld,emit:(e:NativeMagicReinforceEvent)=>void=()=>{}):void {
  void rng;if(s.phase==='done')return;const t=s.age;
  // Snapshots written before the StepShow fix could already be past its last
  // write with alpha 15, or retain the CastFail lock. Repair only saved state;
  // normal source events at the original write update still execute below.
  for(const v of s.visuals)if(t-(v.born??s.spawns.find(p=>p.handle===v.id)?.t??60)>180){v.alpha=v.step=16;v.flags&=~0x40000;}
  if(s.requested===0&&t>60)s.casterLocked=false;
  if(t===0)event(s,emit,305);
  if(s.phase==='darken') {
    if(t>0&&t%5===0){s.brightness=16-t/5;event(s,emit,303,s.brightness);}
    if(t===40) {
      s.brightness=16;s.palette=8;s.casterLocked=true;s.camera={x:s.origin.x>>16,y:(s.origin.y>>16)-120};
      event(s,emit,303,16);event(s,emit,296,1,1);event(s,emit,256,s.camera.x,s.camera.y);event(s,emit,289,1,2);
      s.phase='pose';s.phaseAge=0;
    }
  } else if(s.phase==='pose'&&t===60) {
    const wanted=Math.max(0,Math.min(s.amount,Math.min(world.level,40)*5-world.living));s.requested=wanted;
    event(s,emit,278,s.sideFlag);event(s,emit,268,s.sideFlag);
    if(wanted===0) {
      // CastFail: face follows the caster side, unlock immediately, wait 60
      // plus the caller's final eight updates before restoring brightness.
      event(s,emit,17,1,10017,s.sideFlag===0?128:0,256);event(s,emit,41,3,67108864);event(s,emit,44,3,1000);
      event(s,emit,288,1,32768);event(s,emit,296,1,0);s.casterLocked=false;
      s.phase='return';s.phaseAge=0;s.brightenAt=t+68;
    } else {
      emit({t,child:s.back?'ProduceBackSoldier':'ProduceSoldier',args:[s.sideFlag,wanted,0,0]});event(s,emit,288,1,32768);event(s,emit,301);event(s,emit,302);
      let attempted=0;
      scan:for(const x of scanX(s.back,s.sideFlag))for(const y of scanY) {
        event(s,emit,275,x,y);const occupied=world.occupant(x,y);if(occupied!==0&&occupied!==false)continue;
        event(s,emit,281,s.sideFlag,x,y);const handle=world.spawn(x,y,s.back);
        emit({t,child:'StepShow',args:[handle,10,0,0]});
        if(handle!==0)s.spawns.push({t,side:s.sideFlag,x,y,handle,back:s.back});
        s.visuals.push({id:handle,x,y,alpha:0,flags:0x40000,step:0,born:t});
        // The VM increments its request counter even if allocation returns 0.
        if(++attempted>=wanted)break scan;
      }
      s.amount=s.spawns.length;
      for(const v of s.visuals){event(s,emit,41,v.id,0x40000);event(s,emit,39,v.id,0);}
      s.phase='move';s.phaseAge=0;
    }
  } else if(s.phase==='move') {
    let showed=false;
    if(t===84){event(s,emit,288,1,65536);event(s,emit,296,1,0);s.casterLocked=false;}
    if(t===90) {
      event(s,emit,769,'m002snd01',255);event(s,emit,769,'m002snd03',255);
      const target={x:s.back?(s.sideFlag===1?6576:240):(s.sideFlag===0?6576:240),y:0};
      if(s.back)emit({t,child:'MoveCamera',args:[target.x,target.y,40,0]});
      // BackSoldier appends a child after the already existing StepShows;
      // MoreSoldier calls MoveCamera directly from its parent context.
      if(s.back){showSoldiers(s,emit);showed=true;}
      moveCamera(s,target,40,emit);
    } else if(s.back&&s.cameraTrack){showSoldiers(s,emit);showed=true;}
    if(s.cameraTrack) {
      if(s.cameraTrack.remaining===0) {
        delete s.cameraTrack;s.returnAt=t+(s.back?101:100);
      } else advanceCamera(s,emit);
    }
    if(s.returnAt===undefined&&t>130)s.returnAt=s.back?231:230; // pre-fix snapshots
    if(t===s.returnAt) {
      s.phase='return';s.phaseAge=0;
      moveCamera(s,{x:s.origin.x>>16,y:(s.origin.y>>16)-120},20,emit);advanceCamera(s,emit);
    }
    if(!showed)showSoldiers(s,emit);
  } else if(s.phase==='return') {
    // Older snapshots did not retain the MoveCamera coroutine; retain their
    // total source duration while allowing new snapshots to store each step.
    if(s.brightenAt===undefined&&!s.cameraTrack)s.brightenAt=s.requested===0?128:(s.back?259:258);
    if(s.cameraTrack) {
      if(s.cameraTrack.remaining===0){delete s.cameraTrack;s.brightenAt=t+8;}
      else advanceCamera(s,emit);
    }
    showSoldiers(s,emit);
    if(t===s.brightenAt){s.brightness=8;event(s,emit,303,8);s.phase='brighten';s.phaseAge=0;}
  } else if(s.phase==='brighten') {
    if(s.phaseAge>0&&s.phaseAge%5===0){s.brightness=Math.min(16,8+s.phaseAge/5);event(s,emit,303,s.brightness);}
    if(s.phaseAge===40){s.brightness=16;event(s,emit,303,16);event(s,emit,272);s.phase='done';}
  }
  s.age++;s.phaseAge++;
}
export function validateNativeMagicReinforce(s:NativeMagicReinforce,fail:()=>never):void {
  const definition=nativeReinforceDefinition(s.script);
  const integer=(n:unknown,min:number,max:number)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=min&&n<=max;
  if(!definition||s.sequence!==definition.sequence||s.back!==definition.back||![0,1].includes(s.sideFlag)||!integer(s.age,0,400)||!integer(s.phaseAge,0,400)||!['darken','pose','spawn','move','return','brighten','done'].includes(s.phase)||!Array.isArray(s.spawns)||s.spawns.length>200)fail();
  if(!integer(s.level,1,99)||!integer(s.amount,0,200)||!integer(s.requested,0,200)||!integer(s.brightness,0,16)||![8,16].includes(s.palette)||typeof s.casterLocked!=='boolean'||!s.origin||![s.origin.x,s.origin.y,s.origin.z].every(n=>integer(n,-2147483648,2147483647))||s.origin.z<0||!Array.isArray(s.visuals)||s.visuals.length>200||!integer(s.materialized,0,200)||!integer(s.nextHandle,0,1000000))fail();
  if(s.visuals.some(v=>!integer(v.id,0,1000000)||!integer(v.x,-1,71)||!integer(v.y,1,12)||!integer(v.alpha,0,16)||!integer(v.flags,0,0x7fffffff)||!integer(v.step,0,16)))fail();
  if(s.returnAt!==undefined&&!integer(s.returnAt,0,400)||s.brightenAt!==undefined&&!integer(s.brightenAt,0,400))fail();
  if(s.camera!==undefined&&(!s.camera||!integer(s.camera.x,-10000,10000)||!integer(s.camera.y,-10000,10000)))fail();
  if(s.cameraTrack) {
    const c=s.cameraTrack;
    if(!s.camera||c.kind!=='move'||![c.x,c.y,c.dx,c.dy,c.targetX,c.targetY].every(n=>integer(n,-2147483648,2147483647))||!integer(c.remaining,0,40)||!['move','return'].includes(s.phase))fail();
  }
  if(s.visuals.some(v=>v.born!==undefined&&!integer(v.born,0,s.age)))fail();
  if(s.spawns.some(sp=>!Number.isInteger(sp.handle)||sp.handle<0||!Number.isInteger(sp.x)||sp.x<-1||sp.x>71||!Number.isInteger(sp.y)||sp.y<1||sp.y>12))fail();
}
