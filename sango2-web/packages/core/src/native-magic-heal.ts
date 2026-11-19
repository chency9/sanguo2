import {nativeBelow,type NativeRandomState} from './native-strategic-ai';
import type {NativeWorldPoint,NativeCamera} from './native-projection';
import type {NativeMagicShootEvent} from './native-magic-shoot';

type HealTask = {kind:'main'|'RoundHolyBall'|'CreateHolyBall'|'TraceHolyLight'|'IncreaseHP';due:number;step:number;args:number[];object?:number;index?:number;initialHp?:number};
export interface NativeHolyObject extends NativeWorldPoint {
  handle:number;object:number;born:number;facing:number;scaleX:number;scaleY:number;frame:number;
  vz:number;fade:number;fadeDuration:number;fadeAt:number;fadeInterval:number;
  shrink:number;
}
export interface NativeMagicHeal {
  style:0|1;sideFlag:0|1;amount:number;origin:NativeWorldPoint;age:number;
  phase:'darken'|'pose'|'release'|'gather'|'heal'|'after'|'brighten'|'done';
  brightness:number;palette:number;casterLocked:boolean;camera?:NativeCamera;
  tasks:HealTask[];objects:NativeHolyObject[];nextHandle:number;
}
export function nativeCreateMagicHeal(style:0|1,amount:number,origin:NativeWorldPoint,sideFlag:0|1):NativeMagicHeal {
  return {style,sideFlag,amount,origin:{...origin},age:0,phase:'darken',brightness:16,palette:16,casterLocked:false,
    tasks:[{kind:'main',due:0,step:0,args:[]}],objects:[],nextHandle:3};
}

/** Heal / CreateHolyLight and all four child entry functions, translated from
 * SCRIPT_MAGIC.SO 0x1766C..0x180EC. New children run this update; removals keep
 * the next list entry at the current index (EXE 0x465700). No JS generators or
 * wall-clock timers are stored, so every suspended context can be saved.
 * Object hosts retain the original parameters; whole-scene object-list
 * ordering and palette/audio mixing are outside this isolated script adapter. */
export function nativeAdvanceMagicHeal(s:NativeMagicHeal,rng:NativeRandomState,vitals:{hp:number;maxHp:number},emit:(e:NativeMagicShootEvent)=>void=()=>{}):void {
  if(s.phase==='done')return;
  const t=s.age,host=(host:number,...args:(string|number)[])=>emit({t,host,args});
  const range=(low:number,high:number)=>low+nativeBelow(rng,high-low+1);
  const object=(handle:number)=>s.objects.find(o=>o.handle===handle)!;
  const spawn=(kind:HealTask['kind'],args:number[])=>{
    emit({t,child:kind,args});s.tasks.push({kind,due:t,step:0,args});
  };
  const create=(parent:number,id:number,facing:number,z:number)=>{
    const p=parent===1?s.origin:object(parent),handle=s.nextHandle++;
    s.objects.push({...p,handle,object:id,born:t,z:p.z+(z<<16),facing,scaleX:65536,scaleY:65536,frame:0,vz:0,fade:16,fadeDuration:0,fadeAt:0,fadeInterval:1,shrink:0});
    host(17,parent,id,facing,z);return handle;
  };
  const scale=(h:number,x:number,y:number)=>{const o=object(h);if(x)o.scaleX=x;if(y)o.scaleY=y;host(27,h,x,y);};
  const attach=(h:number,parent:number,angle:number,distance:number,z:number)=>{
    const o=object(h),p=parent===1?s.origin:object(parent),r=angle*3.1415926/128;
    o.x=(p.x+Math.trunc(Math.cos(r)*distance*65536))|0;o.y=(p.y+Math.trunc(Math.sin(r)*distance*65536))|0;o.z=p.z+(z<<16);
    host(21,h,parent,angle,distance,z);
  };
  const fade=(h:number,duration:number,interval:number)=>{
    const o=object(h);o.fadeDuration=duration;o.fadeInterval=interval;o.fadeAt=t;o.fade=Math.fround(16-16/duration);host(38,h,duration,interval);
  };
  for(let i=0;i<s.tasks.length;) {
    const c=s.tasks[i];let done=false;
    if(c.due>t){i++;continue;}
    const wait=(n:number,next:number)=>{c.due=t+n;c.step=next;};
    if(c.kind==='main') {
      if(c.step===0) {
        if(t===0)host(305);
        if(t>0)host(303,16-t/5);
        if(t<40) {s.brightness=16-t/5;wait(5,0);}
        else {
          s.brightness=16;s.palette=8;host(303,16);s.casterLocked=true;host(296,1,1);
          s.camera={x:s.origin.x>>16,y:(s.origin.y>>16)-120};host(256,s.camera.x,s.camera.y);host(289,1,5);
          s.phase='pose';wait(20,1);
        }
      } else if(c.step===1) {host(288,1,0x8000);s.phase='release';wait(10,2);}
      else if(c.step===2) {
        host(769,'m016snd01',255);s.phase='gather';
        c.object=create(1,26001+s.style,0,220);scale(c.object,2048,65536);attach(c.object,1,192,16,240);
        const o=object(c.object),dx=s.sideFlag===1?0:-6;o.x+=dx*65536;host(40,c.object,dx,0,0);o.facing=98304;host(29,c.object,98304);
        c.index=0;c.step=3;
      }
      if(c.step===3) {
        if(c.index!<30){spawn('RoundHolyBall',[1,240-c.index!*8,s.sideFlag===1?0:-6,26004+s.style]);c.index!++;wait(1,3);}
        else wait(40,4);
      } else if(c.step===4) {
        spawn('TraceHolyLight',[c.object!,2048,69632,32]);spawn('IncreaseHP',[0,0,0,0]);s.phase='heal';c.index=0;c.step=5;
      }
      if(c.step===5) {
        if(c.index!<8) {
          for(let j=0;j<10;j++)spawn('CreateHolyBall',[1,range(5,40+c.index!*2),26004+s.style,0]);
          c.index!++;wait(range(8,12),5);
        } else c.step=6;
      }
      if(c.step===6) {
        if(s.tasks.some(task=>task.kind==='TraceHolyLight'))c.due=t+1;
        else wait(10,7);
      } else if(c.step===7) {s.casterLocked=false;host(296,1,0);s.phase='after';wait(60,8);}
      else if(c.step===8) {s.palette=16;s.brightness=8;host(303,8);s.phase='brighten';c.index=0;wait(5,9);}
      else if(c.step===9) {
        c.index!++;s.brightness=8+c.index!;host(303,s.brightness);
        if(c.index===8){host(303,16);host(272);done=true;}else wait(5,9);
      }
    } else if(c.kind==='RoundHolyBall') {
      if(c.step===0) {
        const [parent,z,dx,id]=c.args;c.object=create(parent,id,0,z);scale(c.object,81920,81920);attach(c.object,parent,192,16,z);
        object(c.object).x+=dx*65536;host(40,c.object,dx,0,0);wait(2,1);
      } else {fade(c.object!,8,1);done=true;}
    } else if(c.kind==='TraceHolyLight') {
      const [h,from,to,duration]=c.args;
      if(c.step===0) {c.index=1;c.step=1;}
      if(c.step===1) {
        if(c.index!<=duration){scale(h,from+Math.trunc((to-from)/duration)*c.index!,65536);c.index!++;wait(1,1);}
        else wait(60,2);
      } else if(c.step===2) {object(h).shrink=1024;host(37,h,1024);fade(h,48,1);wait(48,3);}
      else done=true;
    } else if(c.kind==='IncreaseHP') {
      if(c.step===0){c.initialHp=vitals.hp;c.index=1;c.step=1;}
      if(c.index!<=s.amount) {
        host(280,s.sideFlag,c.initialHp!+c.index!);vitals.hp=Math.min(vitals.maxHp,c.initialHp!+c.index!);c.index!++;wait(2,1);
      } else done=true;
    } else {
      const [parent,z,id]=c.args;
      if(c.step===0)wait(range(1,8),1);
      else if(c.step===1) {
        c.object=create(parent,id,0,z);const n=range(49152,81920);scale(c.object,n,n);
        const angle=range(0,255),distance=range(8,38);attach(c.object,parent,angle,distance,z);
        host(41,c.object,0x40000);host(39,c.object,0);object(c.object).frame=0;
        const vz=range(1,7);object(c.object).vz=vz*65536;host(23,c.object,0,vz);
        c.index=1;wait(1,2);
      } else if(c.step===2) {
        object(c.object!).frame=c.index!;host(39,c.object!,c.index!);c.index!++;
        if(c.index!<=8)wait(1,2);
        else {const duration=range(16,32);object(c.object!).shrink=256;host(37,c.object!,256);fade(c.object!,duration,1);wait(duration,3);}
      } else done=true;
    }
    if(done)s.tasks.splice(i,1);else i++;
  }
  // Presentation objects retain host values; their mixed-list placement in a
  // real battle is still an explicit boundary of the script differential test.
  for(const o of s.objects) {
    o.z=(o.z+o.vz)|0;
    if(o.object<26004) {if(o.z<0){o.z=0;o.vz=0;}else if(o.z>0)o.vz-=81920;}
    o.scaleX=Math.max(0,o.scaleX-o.shrink);o.scaleY=Math.max(0,o.scaleY-o.shrink);
    if(o.fadeDuration&&t>o.fadeAt&&(t-o.fadeAt)%o.fadeInterval===0)o.fade=Math.max(0,Math.fround(o.fade-16/o.fadeDuration));
  }
  s.age++;if(!s.tasks.length)s.phase='done';
}

/** Reject malformed suspended tasks before a Web save can execute them. */
export function validateNativeMagicHeal(s:NativeMagicHeal,fail:()=>never):void {
  const int=(n:unknown,min:number,max:number)=>typeof n==='number'&&Number.isInteger(n)&&n>=min&&n<=max;
  const point=(p:NativeWorldPoint)=>p&&[p.x,p.y,p.z].every(n=>int(n,-2147483648,2147483647));
  if(!s||![0,1].includes(s.style)||![0,1].includes(s.sideFlag)||!int(s.amount,1,100)||!point(s.origin)||!int(s.age,0,1200)||
    !['darken','pose','release','gather','heal','after','brighten'].includes(s.phase)||!int(s.brightness,8,16)||![8,16].includes(s.palette)||typeof s.casterLocked!=='boolean')fail();
  if(!Array.isArray(s.tasks)||s.tasks.length<1||s.tasks.length>113||!Array.isArray(s.objects)||s.objects.length>111||s.nextHandle!==s.objects.length+3)fail();
  if(s.camera!==undefined&&(!int(s.camera.x,-10000,10000)||!int(s.camera.y,-10000,10000)))fail();
  if((s.phase==='darken')!==!s.camera||s.casterLocked!==['pose','release','gather','heal'].includes(s.phase))fail();
  const steps={main:9,RoundHolyBall:1,CreateHolyBall:3,TraceHolyLight:3,IncreaseHP:1};
  const counts={main:0,RoundHolyBall:4,CreateHolyBall:4,TraceHolyLight:4,IncreaseHP:4};
  const objects=new Set(s.objects.map(o=>o.handle));
  for(const c of s.tasks) {
    if(!c||!(c.kind in steps)||!int(c.step,0,steps[c.kind])||!int(c.due,s.age? s.age-1:0,2000)||!Array.isArray(c.args)||c.args.length!==counts[c.kind]||!c.args.every(n=>int(n,-2147483648,2147483647)))fail();
    if(c.object!==undefined&&!objects.has(c.object)||c.index!==undefined&&!int(c.index,0,101)||c.initialHp!==undefined&&!int(c.initialHp,0,10000))fail();
    if(c.kind==='main'&&c.step===0&&s.phase!=='darken')fail();
  }
  if(s.tasks.filter(c=>c.kind==='main').length!==1)fail();
  for(let i=0;i<s.objects.length;i++) {
    const o=s.objects[i];
    if(!o||o.handle!==i+3||!point(o)||![26001+s.style,26004+s.style].includes(o.object)||!int(o.born,0,s.age)||
      ![0,98304].includes(o.facing)||!int(o.scaleX,0,81920)||!int(o.scaleY,0,81920)||!int(o.frame,0,8)||!int(o.vz,-2147483648,2147483647)||
      !Number.isFinite(o.fade)||o.fade<0||o.fade>16||!int(o.fadeDuration,0,48)||!int(o.fadeAt,0,s.age)||o.fadeInterval!==1||![0,256,1024].includes(o.shrink))fail();
  }
}
