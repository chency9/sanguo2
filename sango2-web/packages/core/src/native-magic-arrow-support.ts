import program from './native-magic-arrow-support-program.json';
import {nativeBelow,type NativeRandomState} from './native-strategic-ai';
import type {NativeWorldPoint,NativeCamera} from './native-projection';
import type {NativeMagicShootEvent} from './native-magic-shoot';
import {nativeMagicCollision} from './native-magic-shoot';

export interface NativeArrowSupportDefinition {sequence:number;script:number;entry:string;count:number;fire:0|1}
const definitions:NativeArrowSupportDefinition[]=[
  {sequence:4,script:503,entry:'Magic3',count:17,fire:1},{sequence:15,script:515,entry:'Magic15',count:29,fire:1},
  {sequence:30,script:534,entry:'Magic34',count:66,fire:1},{sequence:45,script:545,entry:'Magic45',count:8,fire:0},
  {sequence:72,script:572,entry:'Magic72',count:33,fire:0},{sequence:87,script:590,entry:'Magic90',count:56,fire:0},
];
export function nativeArrowSupportDefinition(scriptOrSequence:number):NativeArrowSupportDefinition|undefined {
  const d=definitions.find(d=>d.script===scriptOrSequence||d.sequence===scriptOrSequence);return d&&{...d};
}
type Value=number|string;
export interface NativeArrowSupportTask {entry:string;ip:number;base:number;stack:Value[];due:number;namedWait?:string;self:number}
export interface NativeArrowSupportTarget extends NativeWorldPoint {id:number;general:boolean;alive:boolean;hp:number;facing:number}
export interface NativeArrowSupportObject extends NativeWorldPoint {
  handle:number;object:number;born:number;frame:number;facing:number;alive:boolean;
  vx:number;vy:number;vz:number;gravity:number;flags:number;callback:number;
  scaleX:number;scaleY:number;fade:number;fadeDuration:number;fadeAt:number;fadeInterval:number;
  deathAt?:number;
}
export interface NativeMagicArrowSupport {
  sequence:number;script:number;sideFlag:0|1;attack:number;origin:NativeWorldPoint;target:NativeWorldPoint;
  age:number;phase:'darken'|'pose'|'volley'|'brighten'|'done';brightness:number;palette:number;casterLocked:boolean;
  camera?:NativeCamera;cameraReleased:boolean;statics:Value[];tasks:NativeArrowSupportTask[];
  targets:NativeArrowSupportTarget[];objects:NativeArrowSupportObject[];nextHandle:number;
  nativeObjects:boolean;
  occupancy:{x:number;y:number;handle:number}[];
}
const symbols=program.symbols as Record<string,{offset:number;args:number}>;
const instructions=program.instructions as Record<string,(number|string)[]>;
const objectDefinitions=program.objects as Record<string,{flags:number;frameTicks:number[];messages:{t:number;event:number;arg:number}[];loop:boolean;deathAt:number|null}>;
const recorded=new Set([11,17,19,20,21,23,24,27,29,37,38,39,40,41,43,44,46,49,256,259,263,264,265,268,269,272,273,274,275,280,288,289,293,295,296,297,301,303,305,307,768,769,784]);
function task(entry:string,args:number[],self=1):NativeArrowSupportTask {
  const symbol=symbols[entry];if(!symbol)throw new Error(`Unsupported ArrowSupport entry ${entry}`);
  return {entry,ip:symbol.offset,base:symbol.args+1,stack:[...Array.from({length:symbol.args},(_,i)=>args[i]??0),0,0],due:0,self};
}
export function nativeCreateMagicArrowSupport(scriptOrSequence:number,origin:NativeWorldPoint,sideFlag:0|1,target:NativeWorldPoint,attack=0):NativeMagicArrowSupport {
  const d=nativeArrowSupportDefinition(scriptOrSequence);if(!d)throw new Error('Unsupported ArrowSupport script');
  return {sequence:d.sequence,script:d.script,sideFlag,attack,origin:{...origin},target:{...target},age:0,phase:'darken',brightness:16,palette:16,casterLocked:false,
    cameraReleased:false,statics:Array(128).fill(0),tasks:[task(d.entry,[])],targets:[],objects:[],nextHandle:3,nativeObjects:true,occupancy:[]};
}

/** Original collision6001/6002 and draw-node6003/6004 create independent
 * contexts; a waiting callback never suppresses another native event. */
export function nativeArrowSupportObjectEvent(s:NativeMagicArrowSupport,sourceHandle:number,event:6001|6002|6003|6004,target?:NativeArrowSupportTarget):void {
  const source=s.objects.find(o=>o.handle===sourceHandle);if(!source)return;
  if(target){s.targets=s.targets.filter(p=>p.id!==target.id);s.targets.push({...target});}
  const entry={6001:'ArrowCallback1',6002:'ArrowCallback2',6003:'FlyArrowLU',6004:'FlyArrowRU'}[event];
  const c=task(entry,event<6003?[sourceHandle,target?.id??0]:[],sourceHandle);c.due=s.age;s.tasks.push(c);
  if(s.phase==='done')s.phase='volley';
}

/** 0x40A8CC checks bomb landing/death action before the common point gate. */
export function nativeArrowSupportCollision(o:NativeArrowSupportObject,target?:{general:boolean;ally:boolean}):0|65539|65540 {
  return !o.alive||o.deathAt!==undefined||o.flags&0x400000&&o.z<=0||!target?0:nativeMagicCollision(o.flags,target.general,target.ally,o.z);
}
export function nativeArrowSupportObjectFrame(object:number,age:number):number {
  const d=objectDefinitions[object];if(!d)return 0;
  const ticks=d.frameTicks.reduce((a,b)=>a+b,0);let remaining=d.loop?Math.max(0,age)%ticks:Math.max(0,age);
  for(let i=0;i<d.frameTicks.length;i++){if(remaining<d.frameTicks[i])return i;remaining-=d.frameTicks[i];}
  return d.frameTicks.length-1;
}

/** This bounded interpreter accepts only the 28 exported ArrowSupport symbols.
 * It keeps the original integer control flow instead of replacing the arrow
 * placement, target queries or random stream with a sampled damage pulse. */
export function nativeAdvanceMagicArrowSupport(s:NativeMagicArrowSupport,rng:NativeRandomState,emit:(e:NativeMagicShootEvent)=>void=()=>{},targets?:readonly NativeArrowSupportTarget[],occupancy?:readonly {x:number;y:number;handle:number}[]):void {
  if(s.phase==='done')return;if(targets)s.targets=targets.map(p=>({...p}));if(occupancy)s.occupancy=occupancy.map(c=>({...c}));
  const t=s.age,globals=[0,0,1,2,s.attack,s.sideFlag];
  const position=(h:number)=>h===1?s.origin:h===2?s.target:s.objects.find(o=>o.handle===h)??s.targets.find(o=>o.id===h);
  const object=(h:number)=>s.objects.find(o=>o.handle===h)!;
  const append=(entry:string,args:number[],self=1,child=true)=>{
    if(child)emit({t,child:entry,args});const c=task(entry,args,self);c.due=t;s.tasks.push(c);
  };
  const host=(c:NativeArrowSupportTask,h:number,a:Value[]):number=>{
    if(recorded.has(h))emit({t,host:h,args:a});
    const n=a.map(Number),o=object(n[0]);
    if(h===11)return c.self;
    if(h===17) {
      const p=position(n[0])??s.origin,handle=s.nextHandle++;
      s.objects.push({handle,object:n[1],born:t,frame:0,facing:n[2],alive:true,x:p.x,y:p.y,z:p.z+n[3]*65536,
        vx:0,vy:0,vz:0,gravity:0,flags:s.nativeObjects?(objectDefinitions[n[1]]?.flags??0):0,callback:0,scaleX:65536,scaleY:65536,fade:16,fadeDuration:0,fadeAt:0,fadeInterval:1});return handle;
    }
    if(h===18)return Number(n[0]===1||n[0]===2||o?.alive||s.targets.find(p=>p.id===n[0])?.alive);
    if(h===19){if(o)o.alive=false;return 0;}
    if(h===20)Object.assign(o,{x:n[1]*65536,y:n[2]*65536,z:n[3]*65536});
    if(h===21) {
      const p=position(n[1])??s.origin,angle=n[2]*3.1415926/128;
      Object.assign(o,{x:(p.x+Math.trunc(Math.cos(angle)*n[3]*65536))|0,y:(p.y+Math.trunc(Math.sin(angle)*n[3]*65536))|0,z:(p.z+n[4]*65536)|0});
    }
    if(h===24) {
      const angle=n[1]*3.1415926/128,elevation=n[2]*3.1415926/128;
      o.vx=Math.trunc(Math.cos(angle)*Math.cos(elevation)*n[3]*65536)|0;o.vy=Math.trunc(Math.sin(angle)*Math.cos(elevation)*n[3]*65536)|0;o.vz=Math.trunc(Math.sin(elevation)*n[3]*65536)|0;
    }
    if(h===26)return o?.facing??s.targets.find(p=>p.id===n[0])?.facing??0;
    if(h===27){if(n[1])o.scaleX=n[1];if(n[2])o.scaleY=n[2];}
    if(h===29)o.gravity=n[1];
    if(h===38){o.fadeDuration=n[1];o.fadeInterval=n[2];o.fadeAt=t;o.fade=16-16/n[1];o.flags|=0x40000;}
    if(h===39)o.fade=n[1];
    if(h===40){o.x=(o.x+n[1]*65536)|0;o.y=(o.y+n[2]*65536)|0;o.z=(o.z+n[3]*65536)|0;}
    if(h===41)o.flags|=n[1];if(h===43)o.flags&=~n[1];if(h===44)o.callback=n[1];
    if(h===256)s.camera={x:n[0],y:n[1]};
    if(h===259)return Math.imul(n[0],96)+48|0;if(h===261)return (position(n[0])?.x??0)>>16;if(h===262)return (position(n[0])?.y??0)>>16;if(h===263)return (position(n[0])?.z??0)>>16;
    if(h===264)return Math.trunc(n[0]/96);if(h===265)return Math.trunc(n[0]/72);
    const soldiers=s.targets.filter(p=>!p.general&&p.alive);
    if(h===268)return soldiers.length;if(h===269)return soldiers.length?soldiers[nativeBelow(rng,soldiers.length)].id:0;
    if(h===272)s.cameraReleased=true;if(h===273)return s.camera?.x??0;if(h===274)return s.camera?.y??0;
    if(h===275)return s.occupancy.find(c=>c.x===n[0]&&c.y===n[1])?.handle??0;
    if(h===279)return s.targets.find(p=>p.id===n[0])?.hp??100;
    if(h===296){s.casterLocked=!!n[1];if(n[1])s.phase='pose';}
    if(h===297)return 2;if(h===301)return 71;
    if(h===303){s.brightness=n[0];if(t===20&&n[0]===16)s.palette=12;if(t>20&&n[0]===12){s.phase='brighten';s.palette=16;}}
    if(h===304)return s.brightness;if(h===307)return 1008;
    if(h===771)return n[0]+nativeBelow(rng,n[1]-n[0]+1);
    if(h===784){append(String(a[0]),n.slice(1),c.self,false);return 0;}
    return 0;
  };
  for(let i=0;i<s.tasks.length;) {
    const c=s.tasks[i];if(c.due>t||c.namedWait&&s.tasks.some(v=>v.entry===c.namedWait)){i++;continue;}
    delete c.namedWait;let finished=false,yielded=false;
    const pop=()=>c.stack.pop()??0,number=()=>Number(pop())|0,push=(v:Value)=>c.stack.push(typeof v==='number'?v|0:v);
    for(let count=0;count<200000&&!finished&&!yielded;count++) {
      const instruction=instructions[c.ip];if(!instruction)throw new Error(`ArrowSupport instruction outside whitelist ${c.ip}`);
      const [raw,next,...args]=instruction,op=Number(raw),arg=Number(args[0]);c.ip=Number(next);
      if(op===2){c.stack.length=c.base+1;c.base=number();const address=number();c.stack.length-=arg;if(address)c.ip=address;else finished=true;}
      else if(op===3)for(let j=0;j<arg;j++)push(0);
      else if(op===4){push(c.ip);push(c.base);c.base=c.stack.length-1;c.ip=arg;}
      else if(op===5){const desc=Number(args[1]),a=c.stack.splice(c.stack.length-(desc&0xffff));const result=host(c,arg,a);if(desc>>>16)push(result);}
      else if(op===6||op===7)push(args[0]);
      else if(op===8)push(c.stack[c.base+arg]??0);
      else if(op===9)push(s.statics[arg]??0);
      else if(op===10)push(globals[arg]??0);
      else if(op===11)c.stack[c.base+arg]=pop();
      else if(op===12)s.statics[arg]=pop();
      else if(op===29||op===32)c.stack[c.base+arg]=(Number(c.stack[c.base+arg])+(op===29?1:-1))|0;
      else if(op===33)s.statics[arg]=(Number(s.statics[arg])-1)|0;
      else if(op===26)push(-number());
      else if(op===56)push(Number(!number()));
      else if(op===59)c.ip=arg;
      else if(op===60){if(number())c.ip=arg;}
      else if(op===61){if(!number())c.ip=arg;}
      else if(op===66){const delay=number();c.due=t+delay;yielded=delay>0;}
      else if(op===69){const name=String(pop());if(s.tasks.some(v=>v.entry===name)){c.namedWait=name;yielded=true;}}
      else if(op===71){const a=c.stack.splice(c.stack.length-4).map(Number),name=String(pop());append(name,a,c.self);}
      else {
        const right=number(),left=number();let result:number;
        if(op===15)result=(left+right)|0;else if(op===18)result=(left-right)|0;else if(op===20)result=Math.imul(left,right);else if(op===22)result=Math.trunc(left/right)|0;
        else if(op===35)result=left&right;else if(op===37)result=left^right;else if(op===38)result=Number(left===right);else if(op===41)result=Number(left!==right);
        else if(op===44)result=Number(left>right);else if(op===47)result=Number(left>=right);else if(op===50)result=Number(left<right);else if(op===53)result=Number(left<=right);
        else if(op===57)result=Number(!!left&&!!right);else if(op===58)result=Number(!!left||!!right);else throw new Error(`Unsupported ArrowSupport opcode ${op}`);
        push(result);
      }
      if(count===199999)throw new Error('ArrowSupport instruction budget exceeded');
    }
    if(finished)s.tasks.splice(i,1);else i++;
  }
  for(const o of s.objects)if(o.alive) {
    o.x=(o.x+o.vx)|0;o.y=(o.y+o.vy)|0;o.z=(o.z+o.vz)|0;
    if(o.z<0){o.z=0;o.vz=0;}else if(o.z>0&&o.gravity)o.vz-=2*o.gravity;
    o.frame++;
    if(o.fadeDuration&&t>o.fadeAt&&(t-o.fadeAt)%o.fadeInterval===0)o.fade=Math.max(0,o.fade-16/o.fadeDuration);
    if(o.fadeDuration&&o.fade===0)o.alive=false;
    if(s.nativeObjects) {
      const definition=objectDefinitions[o.object];
      if(definition) {
        for(const message of definition.messages)if(o.frame===message.t) {
          if(message.event===3)o.alive=false;
          else if(message.event===0x80000000)nativeArrowSupportObjectEvent(s,o.handle,message.arg as 6003|6004);
        }
        if(!definition.loop&&o.frame>=definition.frameTicks.reduce((a,b)=>a+b,0))o.alive=false;
        if(o.deathAt!==undefined) {if(t-o.deathAt>=(definition.deathAt??0))o.alive=false;}
        else if(o.flags&0x400000&&o.z<=0){o.deathAt=t;if(definition.deathAt===0)o.alive=false;}
      }
    }
  }
  if(s.age>=70&&s.phase!=='brighten')s.phase='volley';s.age++;if(!s.tasks.length)s.phase='done';
}

export function validateNativeMagicArrowSupport(s:NativeMagicArrowSupport,fail:()=>never):void {
  const int=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
  const point=(p:NativeWorldPoint)=>p&&[p.x,p.y,p.z].every(n=>int(n,-2147483648,2147483647));
  const d=s&&nativeArrowSupportDefinition(s.script);
  if(!d||s.sequence!==d.sequence||![0,1].includes(s.sideFlag)||!int(s.attack,0,10000)||!point(s.origin)||!point(s.target)||!int(s.age,0,3000)||
    !['darken','pose','volley','brighten','done'].includes(s.phase)||!int(s.brightness,12,16)||![12,16].includes(s.palette)||
    typeof s.casterLocked!=='boolean'||typeof s.cameraReleased!=='boolean'||typeof s.nativeObjects!=='boolean'||s.camera!==undefined&&![s.camera.x,s.camera.y].every(n=>int(n,-20000,20000))||
    !Array.isArray(s.objects)||s.objects.length>3000||s.nextHandle!==s.objects.length+3||!Array.isArray(s.tasks)||s.tasks.length>1024||
    !Array.isArray(s.targets)||s.targets.length>600||!Array.isArray(s.occupancy)||s.occupancy.length>994||!Array.isArray(s.statics)||s.statics.length!==128||!s.statics.every(v=>typeof v==='string'||int(v,-2147483648,2147483647)))fail();
  const literalStrings=new Set(Object.values(instructions).filter(v=>v[0]===7).map(v=>String(v[2])));
  for(const c of s.tasks)if(!c||!symbols[c.entry]||!instructions[c.ip]||!int(c.base,0,4095)||!Array.isArray(c.stack)||c.stack.length>4096||c.base>=c.stack.length||
    !c.stack.every(v=>typeof v==='string'?literalStrings.has(v):int(v,-2147483648,2147483647))||!int(c.due,0,4000)||
    !int(c.self,1,2000000)||c.namedWait!==undefined&&!symbols[c.namedWait])fail();
  for(let i=0;i<s.objects.length;i++) {
    const o=s.objects[i];if(!o||o.handle!==i+3||!([10015,7045].includes(o.object)||int(o.object,16001,16018))||!point(o)||!int(o.born,0,s.age)||!int(o.frame,0,3000)||
      !int(o.facing,0,255)||typeof o.alive!=='boolean'||![o.vx,o.vy,o.vz].every(n=>int(n,-2147483648,2147483647))||!int(o.gravity,0,65536)||
      !int(o.flags,0,0x7fffffff)||![0,6001,6002].includes(o.callback)||![o.scaleX,o.scaleY].every(n=>int(n,0,1000000))||
      !Number.isFinite(o.fade)||o.fade<0||o.fade>16||!int(o.fadeDuration,0,32)||!int(o.fadeAt,0,s.age)||![1,2].includes(o.fadeInterval)||o.deathAt!==undefined&&!int(o.deathAt,o.born,s.age))fail();
  }
  for(const p of s.targets)if(!p||!int(p.id,1,2000000)||!point(p)||typeof p.general!=='boolean'||typeof p.alive!=='boolean'||!int(p.hp,0,10000)||!int(p.facing,0,255))fail();
  for(const c of s.occupancy)if(!c||!int(c.x,0,70)||!int(c.y,0,13)||!int(c.handle,1,2000000))fail();
}
