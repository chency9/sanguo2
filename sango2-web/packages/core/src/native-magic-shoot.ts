import {nativeBelow,type NativeRandomState} from './native-strategic-ai';
import type {NativeMagicCamera} from './native-magic-camera';

/** SCRIPT_MAGIC.SO ShootObject, not the skill sequence or resource directory. */
export function nativeShootDefinition(script:number):{style:0|1|2;flaming:0|1}|undefined {
  switch(script) {
    case 502:return {style:0,flaming:1}; // Magic2
    case 514:return {style:1,flaming:0}; // Magic14
    case 552:return {style:0,flaming:0}; // Magic52
    case 558:return {style:2,flaming:0}; // Magic58
  }
}
export interface NativeMagicWeapon {
  object:number;x:number;y:number;z:number;vx:number;vy:number;facing:number;
  flags:number;age:number;alive:boolean;fade:number;fadePeriod:number;fadeWait:number;
}
export interface NativeMagicShoot {
  style:0|1|2;flaming:0|1;
  /** Original global 5 chooses direction: 1 travels right, 0 travels left. */
  sideFlag:0|1;origin:{x:number;y:number;z:number};age:number;
  phase:'darken'|'pose'|'release'|'flight'|'after'|'brighten'|'done';
  phaseAge:number;brightness:number;palette:number;cameraJitter:number;
  camera?:{x:number;y:number};
  cameraTrack?:NativeMagicCamera;
  casterLocked:boolean;weapon?:NativeMagicWeapon;
}
export interface NativeMagicShootEvent {t:number;host?:number;child?:string;args:(string|number)[]}
export function nativeCreateMagicShoot(script:number,origin:NativeMagicShoot['origin'],sideFlag:0|1):NativeMagicShoot {
  const definition=nativeShootDefinition(script);if(!definition)throw new Error('Unsupported ShootObject script');
  return {...definition,sideFlag,origin:{...origin},age:0,phase:'darken',phaseAge:0,brightness:16,palette:16,cameraJitter:0,casterLocked:false};
}
/** Translated main coroutine. Waits use EXE 0x467E70/0x467320: wait(N)
 * resumes N source updates later, including its first immediate countdown.
 * Child visual coroutines are an explicit boundary, not a complete magic VM. */
export function nativeAdvanceMagicShoot(s:NativeMagicShoot,rng:NativeRandomState,emit:(event:NativeMagicShootEvent)=>void=()=>{}):void {
  if(s.phase==='done')return;
  const host=(host:number,...args:(string|number)[])=>emit({t:s.age,host,args});
  const phase=(value:NativeMagicShoot['phase'])=>{s.phase=value;s.phaseAge=0;};
  const launch=()=>{
    const facing=s.sideFlag===1?0:128,angle=facing*3.1415926/128;
    const height=s.style===2?69:80,distance=s.style===2?36:80;
    const object=13001+s.style*2;
    s.weapon={object,x:s.origin.x+Math.trunc(Math.cos(angle)*distance*65536),
      y:s.origin.y+Math.trunc(Math.sin(angle)*distance*65536),z:s.origin.z+(height<<16),
      vx:Math.trunc(Math.cos(angle)*16*65536),vy:Math.trunc(Math.sin(angle)*16*65536),facing,
      flags:0x10000|0x1000000|(s.style===2?0x2000000:0),age:0,alive:true,fade:16,fadePeriod:0,fadeWait:0};
    host(768,1,`m003snd0${s.style+1}`,255);
    host(17,1,object,facing,0);host(46,3,0,s.style);host(46,3,1,s.flaming);
    host(21,3,1,facing,distance,height);host(24,3,facing,0,16);
    host(41,3,0x1000000|(s.style===2?0x2000000:0));host(44,3,3001);
    if(s.flaming===0)host(784,'FlyLight',3,13002+s.style*2,9999,s.flaming,s.style);
    else host(784,'FlyLight',3,13007,9999,s.flaming,s.style);
    emit({t:s.age,child:'LockCamera',args:[3,180,-120+s.cameraJitter,s.sideFlag]});
    phase('flight');
  };
  if(s.age===0)host(305);
  if(s.phase==='darken') {
    if(s.phaseAge>0&&s.phaseAge%5===0){s.brightness=16-s.phaseAge/5;host(303,s.brightness);}
    if(s.phaseAge===40) {
      s.brightness=16;s.palette=8;host(303,16);
      s.cameraJitter=nativeBelow(rng,4)===3?nativeBelow(rng,91):0;
      s.casterLocked=true;host(296,1,1);
      s.camera={x:(s.origin.x>>16)+(s.sideFlag===1?180:-180),y:(s.origin.y>>16)-120+s.cameraJitter};
      host(256,s.camera.x,s.camera.y);
      phase('pose');
    }
  } else if(s.phase==='pose'&&s.phaseAge===15) {
    host(288,1,s.style===0?0x20000:0x40000);s.casterLocked=false;host(296,1,0);phase('release');
  } else if(s.phase==='release'&&s.phaseAge===15)launch();
  else if(s.phase==='after'&&s.phaseAge===60) {
    s.palette=16;s.brightness=8;host(303,8);phase('brighten');
  } else if(s.phase==='brighten'&&s.phaseAge>0&&s.phaseAge%5===0) {
    s.brightness=8+s.phaseAge/5;host(303,s.brightness);
    if(s.phaseAge===40){host(303,16);host(272);phase('done');}
  }
  // The SO checks the newly created weapon before its first wait(1), too.
  if(s.phase==='flight') {
    const w=s.weapon!;
    if(!w.alive||(w.x>>16)<=0||(w.x>>16)>=6816) {
      if(w.alive){w.alive=false;host(19,3);}
      phase('after');
    }
  }
  s.age++;s.phaseAge++;
}
/** Native generic motion/fade, 0x422AB1 and 0x40A8CC, before cell lookup. */
export function nativeAdvanceMagicWeapon(w:NativeMagicWeapon):void {
  if(!w.alive)return;
  w.x=(w.x+w.vx)|0;w.y=(w.y+w.vy)|0;w.age++;
  if(w.fadePeriod&&--w.fadeWait<=0) {
    w.fade=Math.max(0,w.fade-16/w.fadePeriod);
    w.fadeWait=w.fadePeriod===16?8:1;
    if(Math.trunc(w.fade)===0)w.alive=false;
  }
}
/** 0x40A878 classification and 0x40A8CC height/mask gate. */
export function nativeMagicCollision(flags:number,general:boolean,ally:boolean,z:number):0|65539|65540 {
  if(z>=96*65536)return 0;
  const category=ally?(general?0x4000000:0x8000000):(general?0x1000000:0x2000000);
  return flags&category?general?65540:65539:0;
}
/** Host 295 then Hurt -> host 293 with a null source: the skill's ATTACK
 * value is direct damage; caster intelligence does not multiply it. */
export function nativeMagicDirectHit(hp:number,charge:number,damage:number,locked:boolean,percent=0) {
  return {hp:locked?hp:Math.max(0,hp-damage),charge:Math.max(0,charge-Math.trunc(120000*percent/100)),actions:locked?[]:[16]};
}
/** ShootObjectCallback -> Hurt. General hit removes general collision bits;
 * ghost halberds retain their enemy-soldier bit while fading. */
export function nativeMagicWeaponHit(w:NativeMagicWeapon,style:0|1|2):void {
  w.flags&=~0x5000000;w.flags|=0x40000;
  w.fadePeriod=style===2?16:2;w.fadeWait=style===2?8:1;
  w.fade=style===2?15:8;
}
