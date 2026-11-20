import {nativeBelow,type NativeRandomState} from './native-strategic-ai';
import type {NativeWorldPoint,NativeCamera} from './native-projection';
import type {NativeMagicShootEvent} from './native-magic-shoot';

export interface NativeExplodeDefinition {sequence:number;script:number;count:number;radius:number;object:number}
const DEFINITIONS:NativeExplodeDefinition[]=[{sequence:7,script:508,count:18,radius:160,object:18003},{sequence:16,script:519,count:32,radius:240,object:18003},{sequence:23,script:531,count:48,radius:380,object:18003}];
export function nativeExplodeDefinition(scriptOrSequence:number):NativeExplodeDefinition|undefined {const d=DEFINITIONS.find(d=>d.sequence===scriptOrSequence||d.script===scriptOrSequence);return d&&{...d};}
type ExplodeTask={kind:'main'|'ProduceRound'|'CreateExplodeRound'|'LockTargetTime2'|'FireMan';due:number;step:number;args:number[];object?:number;index?:number;height?:number};
export interface NativeExplodeTarget extends NativeWorldPoint {id:number;general:boolean;alive:boolean;hp?:number;facing?:number}
export interface NativeExplodeObject extends NativeWorldPoint {handle:number;object:number;born:number;facing:number;scaleX:number;scaleY:number;frame:number;vz:number;fade:number;fadeDuration:number;fadeAt:number;fadeInterval:number;shrink:number;flags:number;callback:number;alive:boolean;blend?:number}
export interface NativeMagicExplode {
  sequence:number;script:number;sideFlag:0|1;origin:NativeWorldPoint;age:number;
  phase:'darken'|'pose'|'circle'|'burst'|'after'|'brighten'|'done';brightness:number;palette:number;casterLocked:boolean;camera?:NativeCamera;
  hitDivisor:number;cameraReleased?:boolean;tasks:ExplodeTask[];objects:NativeExplodeObject[];nextHandle:number;targets:NativeExplodeTarget[];
}
export function nativeCreateMagicExplode(scriptOrSequence:number,origin:NativeWorldPoint,sideFlag:0|1):NativeMagicExplode {
  const d=nativeExplodeDefinition(scriptOrSequence);if(!d)throw new Error('Unsupported ExplodeRound script');
  return {sequence:d.sequence,script:d.script,sideFlag,origin:{...origin},age:0,phase:'darken',brightness:16,palette:16,casterLocked:false,hitDivisor:1,tasks:[{kind:'main',due:0,step:0,args:[]}],objects:[],nextHandle:3,targets:[]};
}
const position=(s:NativeMagicExplode,id:number):NativeWorldPoint|undefined=>id===1?s.origin:s.objects.find(o=>o.handle===id)??s.targets.find(o=>o.id===id);
const emitHost=(s:NativeMagicExplode,emit:(e:NativeMagicShootEvent)=>void,host:number,...args:(number|string)[])=>emit({t:s.age,host,args});
/** Host 21 uses the original angle constant and truncates before addition. */
export function nativeExplodeAttach(origin:NativeWorldPoint,angle:number,distance:number,height:number):NativeWorldPoint {
  const r=angle*3.1415926/128;
  return {x:(origin.x+Math.trunc(Math.cos(r)*distance*65536))|0,y:(origin.y+Math.trunc(Math.sin(r)*distance*65536))|0,z:(origin.z+(height<<16))|0};
}
function create(s:NativeMagicExplode,parent:number,id:number,facing:number,z:number,emit:(e:NativeMagicShootEvent)=>void):number {
  const p=position(s,parent)??s.origin,handle=s.nextHandle++;
  s.objects.push({handle,object:id,born:s.age,x:p.x,y:p.y,z:p.z+(z<<16),facing,scaleX:65536,scaleY:65536,frame:0,vz:0,fade:16,fadeDuration:0,fadeAt:0,fadeInterval:1,shrink:0,flags:0,callback:0,alive:true});
  emitHost(s,emit,17,parent,id,facing,z);return handle;
}
function attach(s:NativeMagicExplode,h:number,parent:number,angle:number,distance:number,z:number,emit:(e:NativeMagicShootEvent)=>void) {
  const o=s.objects.find(o=>o.handle===h)!,p=position(s,parent)??s.origin;
  Object.assign(o,nativeExplodeAttach(p,angle,distance,z));emitHost(s,emit,21,h,parent,angle,distance,z);
}
function fade(s:NativeMagicExplode,h:number,duration:number,interval:number,emit:(e:NativeMagicShootEvent)=>void) {
  const o=s.objects.find(o=>o.handle===h)!;o.fadeDuration=duration;o.fadeInterval=interval;o.fadeAt=s.age;o.fade=16-16/duration;emitHost(s,emit,38,h,duration,interval);
}
function spawn(s:NativeMagicExplode,kind:ExplodeTask['kind'],args:number[],emit:(e:NativeMagicShootEvent)=>void) {emit({t:s.age,child:kind,args});s.tasks.push({kind,due:s.age,step:0,args});}

/** ExplodeRound / ProduceAirCircle / ProduceRound / CreateExplodeRound.
 * Child tasks append to the same source-update list. Saved tasks contain only
 * JSON values; renderer cadence never changes waits, objects or RNG order. */
export function nativeAdvanceMagicExplode(s:NativeMagicExplode,rng:NativeRandomState,emit:(e:NativeMagicShootEvent)=>void=()=>{},targets?:readonly NativeExplodeTarget[]):void {
  if(s.phase==='done')return;if(targets)s.targets=targets.map(t=>({...t}));
  const t=s.age,d=nativeExplodeDefinition(s.script)!,host=(h:number,...a:(number|string)[])=>emitHost(s,emit,h,...a),range=(low:number,high:number)=>low+nativeBelow(rng,high-low+1);
  const object=(id:number)=>s.objects.find(o=>o.handle===id)!;
  for(let i=0;i<s.tasks.length;) {
    const c=s.tasks[i];let done=false;if(c.due>t){i++;continue;}
    const wait=(n:number,step:number)=>{c.due=t+n;c.step=step;};
    if(c.kind==='main') {
      if(c.step===0) {
        if(t===0)host(305);if(t>0)host(303,16-t/5);
        if(t<40){s.brightness=16-t/5;wait(5,0);}
        else {s.brightness=16;s.palette=8;host(303,16);s.casterLocked=true;host(296,1,1);s.camera={x:s.origin.x>>16,y:(s.origin.y>>16)-120};host(256,s.camera.x,s.camera.y);host(289,1,2);s.phase='pose';wait(10,1);}
      } else if(c.step===1){host(288,1,32768);wait(10,2);}
      else if(c.step===2) {
        c.object=create(s,1,18002,0,0,emit);attach(s,c.object,1,0,0,0,emit);object(c.object).fade=8;host(39,c.object,8);object(c.object).blend=2;host(49,c.object,2);c.index=1;s.phase='circle';wait(1,3);
      } else if(c.step===3) {
        if(object(c.object!).alive&&c.index!<=40) {
          const scale=65536+12288*c.index!;object(c.object!).scaleX=object(c.object!).scaleY=scale;host(27,c.object!,scale,scale);
          if(c.index===Math.trunc(d.count*3/18))fade(s,c.object!,16,1,emit);
          c.index!++;wait(1,3);
        } else {s.casterLocked=false;host(296,1,0);s.phase='burst';c.index=0;wait(20,4);}
      } else if(c.step===4) {
        spawn(s,'ProduceRound',[1,d.object,range(72,d.radius),8001],emit);wait(range(1,3),5);
      } else if(c.step===5) {
        if(c.index===0)host(769,'m008snd01',255);
        c.index!++;
        if(c.index!<d.count){spawn(s,'ProduceRound',[1,d.object,range(72,d.radius),8001],emit);wait(range(1,3),5);}
        else c.step=6;
      }
      if(c.step===6) {
        if(s.tasks.some(v=>v.kind==='ProduceRound'))c.due=t+1;
        else c.step=7;
      }
      if(c.step===7) {
        if(s.tasks.some(v=>v.kind==='CreateExplodeRound'))c.due=t+1;
        else {s.phase='after';wait(30,8);}
      } else if(c.step===8){s.palette=16;s.brightness=8;host(303,8);s.phase='brighten';c.index=0;wait(5,9);}
      else if(c.step===9) {
        c.index!++;s.brightness=8+c.index!;host(303,s.brightness);
        if(c.index===8){host(303,16);host(272);s.cameraReleased=true;done=true;}else wait(5,9);
      }
    } else if(c.kind==='ProduceRound') {
      if(c.step===0)wait(range(1,30),1);
      else {
        const [parent,id,distance,callback]=c.args,angle=range(0,255),h=create(s,parent,id,angle,0,emit),o=object(h);
        o.callback=callback;host(44,h,callback);o.flags|=0x3000000;host(41,h,0x3000000);attach(s,h,parent,angle,distance,0,emit);
        for(const [low,high] of [[0,1],[2,3],[4,5],[5,6],[7,8],[9,10]])spawn(s,'CreateExplodeRound',[h,range(low,high),0,0],emit);
        done=true;
      }
    } else if(c.kind==='CreateExplodeRound') {
      if(c.step===0){wait(c.args[1],1);if(c.due>t){i++;continue;}}
      const h=create(s,c.args[0],18004,0,0,emit),o=object(h),dx=range(-4,4),dy=range(0,8);
      o.x+=dx*65536;o.y+=dy*65536;host(40,h,dx,dy,0);host(27,h,65536,65536);
      const vz=range(4,5);o.vz=vz*65536;host(23,h,0,vz);o.shrink=2176;host(37,h,2176);fade(s,h,32,1,emit);done=true;
    } else {
      const [target,id,duration]=c.args,p=s.targets.find(p=>p.id===target),parent=position(s,target);
      if(c.step===0) {
        const facing=p?.facing??0;c.height=c.kind==='LockTargetTime2'&&p?.general&&(p.hp??0)>0?40:0;
        c.object=create(s,target,id,facing,0,emit);c.index=0;c.step=1;
      }
      if(c.step===1) {
        if((c.kind==='LockTargetTime2'?c.index!<=duration:c.index!<duration)&&(p?.alive??!!parent)){attach(s,c.object!,target,0,0,c.height??0,emit);c.index!++;wait(1,1);}
        else {fade(s,c.object!,16,1,emit);done=true;}
      }
    }
    if(done)s.tasks.splice(i,1);else i++;
  }
  for(const o of s.objects) {
    if(!o.alive)continue;o.z=(o.z+o.vz)|0;o.frame++;
    o.scaleX=Math.max(0,o.scaleX-o.shrink);o.scaleY=Math.max(0,o.scaleY-o.shrink);
    if(o.fadeDuration&&t>o.fadeAt&&(t-o.fadeAt)%o.fadeInterval===0)o.fade=Math.max(0,o.fade-16/o.fadeDuration);
    if(o.fade===0||o.object===18003&&o.frame>=28||o.object===18004&&o.frame>=18)o.alive=false;
  }
  s.age++;if(!s.tasks.length)s.phase='done';
}

/** Original callback 8001; direct hit arithmetic remains in the world host.
 * The shared global divisor belongs to this cast and survives JSON replay. */
export function nativeExplodeHit(s:NativeMagicExplode,sourceHandle:number,target:NativeExplodeTarget,attack:number,rng:NativeRandomState,emit:(e:NativeMagicShootEvent)=>void=()=>{}):void {
  void rng;const source=s.objects.find(o=>o.handle===sourceHandle);if(!source)return;
  s.targets=s.targets.filter(p=>p.id!==target.id);s.targets.push({...target});
  if(target.general) {
    const damage=Math.trunc(attack/s.hitDivisor);source.flags&=~0x5000000;emitHost(s,emit,43,sourceHandle,0x5000000);
    if(damage>0){emitHost(s,emit,293,target.id,0,damage);s.hitDivisor*=2;spawn(s,'LockTargetTime2',[target.id,10016,60,0],emit);}
  } else {emitHost(s,emit,768,target.id,'Hit01',255);spawn(s,'FireMan',[target.id,10016,60,0],emit);}
}

export function validateNativeMagicExplode(s:NativeMagicExplode,fail:()=>never):void {
  const int=(n:unknown,min:number,max:number)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=min&&n<=max;
  const point=(p:NativeWorldPoint)=>p&&[p.x,p.y,p.z].every(n=>int(n,-2147483648,2147483647));
  const d=s&&nativeExplodeDefinition(s.script);
  if(!d||s.sequence!==d.sequence||![0,1].includes(s.sideFlag)||!point(s.origin)||!int(s.age,0,1600)||!['darken','pose','circle','burst','after','brighten','done'].includes(s.phase)||!int(s.brightness,8,16)||![8,16].includes(s.palette)||typeof s.casterLocked!=='boolean'||s.cameraReleased!==undefined&&typeof s.cameraReleased!=='boolean'||![1,2,4,8,16,32,64,128].includes(s.hitDivisor)||!Array.isArray(s.tasks)||s.tasks.length>400||!Array.isArray(s.objects)||s.objects.length>1000||!Array.isArray(s.targets)||s.targets.length>600||s.nextHandle!==s.objects.length+3)fail();
  if(s.camera!==undefined&&(!int(s.camera.x,-10000,10000)||!int(s.camera.y,-10000,10000)))fail();
  const maxStep={main:9,ProduceRound:1,CreateExplodeRound:1,LockTargetTime2:1,FireMan:1};
  for(const task of s.tasks)if(!task||!(task.kind in maxStep)||!int(task.step,0,maxStep[task.kind])||!int(task.due,0,3000)||!Array.isArray(task.args)||task.args.length>4||!task.args.every(n=>int(n,-2147483648,2147483647))||task.object!==undefined&&!s.objects.some(o=>o.handle===task.object)||task.index!==undefined&&!int(task.index,0,100))fail();
  for(let i=0;i<s.objects.length;i++) {
    const o=s.objects[i];if(!o||o.handle!==i+3||![18002,18003,18004,10016].includes(o.object)||!point(o)||!int(o.born,0,s.age)||!int(o.facing,0,255)||!int(o.scaleX,0,1000000)||!int(o.scaleY,0,1000000)||!int(o.frame,0,2000)||!int(o.vz,-2147483648,2147483647)||typeof o.alive!=='boolean'||!Number.isFinite(o.fade)||o.fade<0||o.fade>16||!int(o.fadeDuration,0,32)||!int(o.fadeAt,0,s.age)||o.fadeInterval!==1||![0,2176].includes(o.shrink)||!int(o.flags,0,0x7fffffff)||![0,8001].includes(o.callback))fail();
  }
  for(const target of s.targets)if(!target||!int(target.id,1,2000000)||!point(target)||typeof target.general!=='boolean'||typeof target.alive!=='boolean')fail();
}
