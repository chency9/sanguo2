import {nativeBelow,type NativeRandomState} from './native-strategic-ai';
import {nativeCreateMoveCamera,nativeAdvanceMagicCamera,type NativeMoveCamera} from './native-magic-camera';
import type {NativeWorldPoint,NativeCamera} from './native-projection';
import type {NativeMagicShootEvent} from './native-magic-shoot';

export interface NativeRollTubDefinition {sequence:number;script:number;waves:number}
const DEFINITIONS:NativeRollTubDefinition[]=[{sequence:6,script:506,waves:1},{sequence:20,script:518,waves:2},{sequence:35,script:535,waves:4}];
export function nativeRollTubDefinition(scriptOrSequence:number):NativeRollTubDefinition|undefined {
  const d=DEFINITIONS.find(d=>d.sequence===scriptOrSequence||d.script===scriptOrSequence);return d&&{...d};
}
export interface NativeRollTubTarget extends NativeWorldPoint {id:number;general:boolean;alive:boolean}
export interface NativeRollTubObject extends NativeWorldPoint {
  handle:number;object:number;born:number;facing:number;frame:number;vx:number;vy:number;vz:number;
  gravity:number;fade:number;fadeDuration:number;fadeAt:number;fadeInterval:number;
  flags:number;callback:number;alive:boolean;
}
export interface NativeRollTubTask {
  kind:'main'|'CreateRollTub'|'CreateRollTubBreak'|'RollTubCallback';due:number;step:number;args:number[];
  object?:number;index?:number;
}
export interface NativeMagicRollTub {
  sequence:number;script:number;sideFlag:0|1;origin:NativeWorldPoint;target?:NativeWorldPoint;age:number;
  phase:'darken'|'pose'|'rolling'|'after'|'brighten'|'done';brightness:number;palette:number;
  casterLocked:boolean;camera?:NativeCamera;cameraTrack?:NativeMoveCamera;cameraReleased?:boolean;
  generalHit:boolean;ambientPending:boolean;wave:number;tasks:NativeRollTubTask[];
  objects:NativeRollTubObject[];targets:NativeRollTubTarget[];nextHandle:number;
}

export function nativeCreateMagicRollTub(scriptOrSequence:number,origin:NativeWorldPoint,sideFlag:0|1,target?:NativeWorldPoint):NativeMagicRollTub {
  const d=nativeRollTubDefinition(scriptOrSequence);if(!d)throw new Error('Unsupported RollTub script');
  return {sequence:d.sequence,script:d.script,sideFlag,origin:{...origin},target:target&&{...target},age:0,
    phase:'darken',brightness:16,palette:16,casterLocked:false,generalHit:false,ambientPending:false,wave:0,
    tasks:[{kind:'main',due:0,step:0,args:[]}],objects:[],targets:[],nextHandle:3};
}

const position=(s:NativeMagicRollTub,id:number):NativeWorldPoint|undefined=>id===1?s.origin:id===2?s.target:s.objects.find(o=>o.handle===id)??s.targets.find(t=>t.id===id);
const event=(s:NativeMagicRollTub,emit:(e:NativeMagicShootEvent)=>void,host:number,...args:(number|string)[])=>emit({t:s.age,host,args});
function spawn(s:NativeMagicRollTub,kind:NativeRollTubTask['kind'],args:number[],emit:(e:NativeMagicShootEvent)=>void) {
  emit({t:s.age,child:kind,args});s.tasks.push({kind,due:s.age,step:0,args});
}
function create(s:NativeMagicRollTub,id:number,x:number,y:number,z:number,facing:number):NativeRollTubObject {
  const o:NativeRollTubObject={handle:s.nextHandle++,object:id,x,y,z,facing,born:s.age,frame:0,vx:0,vy:0,vz:0,gravity:0,
    fade:16,fadeDuration:0,fadeAt:0,fadeInterval:1,flags:0,callback:0,alive:true};s.objects.push(o);return o;
}
function velocity(o:NativeRollTubObject,angle:number,elevation:number,speed:number) {
  const a=angle*3.1415926/128,e=elevation*3.1415926/128;
  o.vx=Math.trunc(Math.cos(a)*Math.cos(e)*speed*65536)|0;o.vy=Math.trunc(Math.sin(a)*Math.cos(e)*speed*65536)|0;o.vz=Math.trunc(Math.sin(e)*speed*65536)|0;
}
function fade(s:NativeMagicRollTub,o:NativeRollTubObject,duration:number,interval:number,emit:(e:NativeMagicShootEvent)=>void) {
  o.fadeDuration=duration;o.fadeInterval=interval;o.fadeAt=s.age;o.fade=16-16/duration;o.flags|=0x40000;
  event(s,emit,38,o.handle,duration,interval);
}

/** RollTub and its children keep source-update waits and append ordering.
 * Each wave rolls nineteen separate objects through point-grid collisions.
 * No sampling pulse or army-wide random damage substitutes for those objects. */
export function nativeAdvanceMagicRollTub(s:NativeMagicRollTub,rng:NativeRandomState,emit:(e:NativeMagicShootEvent)=>void=()=>{},targets?:readonly NativeRollTubTarget[]):void {
  if(s.phase==='done')return;if(targets)s.targets=targets.map(t=>({...t}));
  const t=s.age,d=nativeRollTubDefinition(s.script)!,range=(low:number,high:number)=>low+nativeBelow(rng,high-low+1),host=(id:number,...a:(number|string)[])=>event(s,emit,id,...a);
  const object=(id:number)=>s.objects.find(o=>o.handle===id);
  const wave=()=>{
    const x=(s.target??s.origin).x>>16;
    for(let column=-9;column<=9;column++)spawn(s,'CreateRollTub',[x+column*96,1048,range(s.wave===0?52:2,s.wave===0?57:3),0],emit);
  };
  for(let i=0;i<s.tasks.length;) {
    const c=s.tasks[i];if(c.due>t){i++;continue;}let done=false;
    const wait=(n:number,step:number)=>{c.due=t+n;c.step=step;};
    if(c.kind==='main') {
      if(c.step===0) {
        if(t===0)host(305);if(t>0)host(303,16-t/5);
        if(t<20){s.brightness=16-t/5;wait(5,0);}
        else {s.brightness=16;s.palette=12;host(303,16);s.casterLocked=true;host(296,1,1);
          s.camera={x:s.origin.x>>16,y:(s.origin.y>>16)-120};host(256,s.camera.x,s.camera.y);host(289,1,2);s.phase='pose';wait(15,1);}
      } else if(c.step===1){host(288,1,32768);wait(20,2);}
      else if(c.step===2){s.casterLocked=false;host(296,1,0);host(297,1-s.sideFlag);host(307);s.phase='rolling';wave();wait(4,3);}
      else if(c.step===3) {
        if(s.wave===0){const target=s.target??s.origin;s.camera={x:(target.x>>16)-864,y:848};host(256,s.camera.x,s.camera.y);wait(15,4);}
        else {if(s.wave===2)host(769,'m039snd01',255);wait(range(10,12),6);}
      } else if(c.step===4) {
        host(273);host(274);const target=s.target??s.origin;
        s.cameraTrack=nativeCreateMoveCamera(s.camera!,{x:target.x>>16,y:(target.y>>16)-140},40);c.step=5;
      }
      if(c.step===5) {
        if(s.cameraTrack!.remaining>0){nativeAdvanceMagicCamera(s.cameraTrack!,s.camera!,{x:0,y:0,alive:true},{x:0,y:0});host(256,s.camera!.x,s.camera!.y);c.due=t+1;}
        else {s.cameraTrack=undefined;host(769,'m039snd01',255);wait(range(10,12),6);}
      } else if(c.step===6&&c.due<=t) {
        s.wave++;
        if(s.wave<d.waves){wave();wait(4,3);}else c.step=7;
      }
      if(c.step===7) {
        if(s.tasks.some(v=>v.kind==='CreateRollTub'||v.kind==='CreateRollTubBreak'))c.due=t+1;
        else {s.phase='after';wait(60,8);}
      } else if(c.step===8){s.palette=16;s.brightness=12;host(303,12);s.phase='brighten';c.index=0;wait(5,9);}
      else if(c.step===9){c.index!++;s.brightness=12+c.index!;host(303,s.brightness);if(c.index===4){host(303,16);host(272);s.cameraReleased=true;done=true;}else wait(5,9);}
    } else if(c.kind==='CreateRollTub') {
      if(c.step===0){wait(c.args[2],1);if(c.due>t){i++;continue;}}
      if(c.step===1) {
        const o=create(s,49001,c.args[0]*65536,c.args[1]*65536,0,0);c.object=o.handle;
        host(16,c.args[0],c.args[1],0,0,49001);o.flags=0x3000000;host(41,o.handle,0x3000000);o.callback=39001;host(44,o.handle,39001);
        const speed=range(4,6);velocity(o,192,0,speed);host(24,o.handle,192,0,speed);o.flags|=0x40000;host(41,o.handle,0x40000);
        o.fade=0;host(39,o.handle,0);c.index=0;wait(2,2);
      } else if(c.step===2) {
        const o=object(c.object!)!;c.index!++;
        if(c.index!<=16){o.fade=c.index!;host(39,o.handle,c.index!);wait(2,2);}
        else {o.flags&=~0x40000;host(43,o.handle,0x40000);wait(1,3);}
      } else if(c.step===3) {
        const o=object(c.object!)!;
        if(!o.alive)done=true;
        else if((o.y>>16)<80){fade(s,o,16,1,emit);done=true;}
        else c.due=t+1;
      }
    } else if(c.kind==='CreateRollTubBreak') {
      if(c.step===0) {
        const parent=position(s,c.args[0])??s.origin,angle=range(0,255),id=range(49002,49008);
        const o=create(s,id,(parent.x>>16)*65536,(parent.y>>16)*65536,(parent.z>>16)*65536+20*65536,angle);c.object=o.handle;
        host(17,c.args[0],id,angle,20);o.gravity=16384;host(29,o.handle,16384);
        const height=range(20,30),rad=angle*3.1415926/128;
        o.x=parent.x+Math.trunc(Math.cos(rad)*4*65536);o.y=parent.y+Math.trunc(Math.sin(rad)*4*65536);o.z=parent.z+height*65536;
        host(21,o.handle,c.args[0],angle,4,height);
        const elevation=range(36,60),speed=range(8,12);velocity(o,angle,elevation,speed);host(24,o.handle,angle,elevation,speed);wait(8,1);
      } else {fade(s,object(c.object!)!,16,2,emit);done=true;}
    } else {
      if(c.step===0) {
        if(!s.ambientPending){s.ambientPending=true;c.index=1;host(769,'m039snd02',255);wait(20,1);}
        else c.step=1;
      }
      if(c.step===1&&c.due<=t) {
        if(c.index===1)s.ambientPending=false;
        for(let j=0;j<8;j++)spawn(s,'CreateRollTubBreak',[c.args[0],0,0,0],emit);
        const o=object(c.args[0])!;o.flags|=128;host(41,o.handle,128);o.flags&=~0xf000000;host(43,o.handle,0xf000000);wait(1,2);
      } else if(c.step===2) {
        const o=object(c.args[0])!,target=c.args[1],general=target===2;
        const damage=general&&!s.generalHit?c.args[2]:0;if(general&&!s.generalHit)s.generalHit=true;
        if(general){o.flags&=~0x5000000;host(43,o.handle,0x5000000);if(damage>0)host(293,target,0,damage);}
        else host(768,target,'Hit01',255);
        o.alive=false;host(19,o.handle);done=true;
      }
    }
    if(done)s.tasks.splice(i,1);else i++;
  }
  for(const o of s.objects) {
    if(!o.alive)continue;
    o.x=(o.x+o.vx)|0;o.y=(o.y+o.vy)|0;o.z=(o.z+o.vz)|0;
    if(o.z<0){o.z=0;o.vz=0;}else if(o.z>0&&o.gravity)o.vz-=2*o.gravity;
    o.frame++;
    if(o.fadeDuration&&t>o.fadeAt&&(t-o.fadeAt)%o.fadeInterval===0)o.fade=Math.max(0,o.fade-16/o.fadeDuration);
    if(o.fadeDuration&&o.fade===0)o.alive=false;
  }
  s.age++;if(!s.tasks.length)s.phase='done';
}

/** Append the original callback; the first enemy-general hit in one cast
 * receives ATTACK, subsequent tubes still break but deal no general damage. */
export function nativeRollTubHit(s:NativeMagicRollTub,sourceHandle:number,target:NativeRollTubTarget,attack:number):void {
  const source=s.objects.find(o=>o.handle===sourceHandle);if(!source||!source.alive||source.callback!==39001)return;
  // 0x41F740 -> 0x4650E0 allocates a new context for every collision. A
  // previous callback may still be waiting for the shared sound gate.
  s.targets=s.targets.filter(t=>t.id!==target.id);s.targets.push({...target});
  s.tasks.push({kind:'RollTubCallback',due:s.age,step:0,args:[sourceHandle,target.id,attack]});
}

export function validateNativeMagicRollTub(s:NativeMagicRollTub,fail:()=>never):void {
  const int=(n:unknown,min:number,max:number)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=min&&n<=max;
  const point=(p:NativeWorldPoint)=>p&&[p.x,p.y,p.z].every(n=>int(n,-2147483648,2147483647));
  const d=s&&nativeRollTubDefinition(s.script);
  if(!d||s.sequence!==d.sequence||![0,1].includes(s.sideFlag)||!point(s.origin)||s.target!==undefined&&!point(s.target)||!int(s.age,0,2000)||!['darken','pose','rolling','after','brighten','done'].includes(s.phase)||!int(s.brightness,12,16)||![12,16].includes(s.palette)||typeof s.casterLocked!=='boolean'||s.cameraReleased!==undefined&&typeof s.cameraReleased!=='boolean'||typeof s.generalHit!=='boolean'||typeof s.ambientPending!=='boolean'||!int(s.wave,0,d.waves)||!Array.isArray(s.tasks)||s.tasks.length>1000||!Array.isArray(s.objects)||s.objects.length>2000||!Array.isArray(s.targets)||s.targets.length>600||s.nextHandle!==s.objects.length+3)fail();
  if(s.camera!==undefined&&(!int(s.camera.x,-10000,10000)||!int(s.camera.y,-10000,10000)))fail();
  if(s.cameraTrack!==undefined&&(s.cameraTrack.kind!=='move'||!s.camera||!int(s.cameraTrack.remaining,0,40)||![s.cameraTrack.x,s.cameraTrack.y,s.cameraTrack.dx,s.cameraTrack.dy,s.cameraTrack.targetX,s.cameraTrack.targetY].every(n=>int(n,-2147483648,2147483647))))fail();
  const steps={main:9,CreateRollTub:3,CreateRollTubBreak:1,RollTubCallback:2};
  const argumentCounts={main:0,CreateRollTub:4,CreateRollTubBreak:4,RollTubCallback:3};
  for(const task of s.tasks)if(!task||!(task.kind in steps)||!int(task.step,0,steps[task.kind])||!int(task.due,0,4000)||!Array.isArray(task.args)||task.args.length!==argumentCounts[task.kind]||!task.args.every(n=>int(n,-2147483648,2147483647))||task.object!==undefined&&!s.objects.some(o=>o.handle===task.object)||task.index!==undefined&&!int(task.index,0,100))fail();
  for(let i=0;i<s.objects.length;i++) {
    const o=s.objects[i];if(!o||o.handle!==i+3||!int(o.object,49001,49008)||!point(o)||!int(o.born,0,s.age)||!int(o.facing,0,255)||!int(o.frame,0,2500)||![o.vx,o.vy,o.vz].every(n=>int(n,-2147483648,2147483647))||![0,16384].includes(o.gravity)||typeof o.alive!=='boolean'||!Number.isFinite(o.fade)||o.fade<0||o.fade>16||!int(o.fadeDuration,0,16)||!int(o.fadeAt,0,s.age)||![1,2].includes(o.fadeInterval)||!int(o.flags,0,0x7fffffff)||![0,39001].includes(o.callback))fail();
  }
  for(const target of s.targets)if(!target||!int(target.id,1,2000000)||!point(target)||typeof target.general!=='boolean'||typeof target.alive!=='boolean')fail();
}
