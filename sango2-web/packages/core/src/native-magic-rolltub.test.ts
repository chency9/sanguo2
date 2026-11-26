import {describe,it,expect} from 'vitest';
import vectors from '../fixtures/native-magic-rolltub-vectors.json';
import {nativeCreateMagicRollTub,nativeAdvanceMagicRollTub,nativeRollTubHit,validateNativeMagicRollTub,type NativeMagicRollTub,type NativeRollTubObject} from './native-magic-rolltub';
import type {NativeMagicShootEvent} from './native-magic-shoot';
import type {NativeRandomState} from './native-strategic-ai';

function compareEvents(actual:NativeMagicShootEvent[],expected:NativeMagicShootEvent[]) {
  const difference=actual.findIndex((e,i)=>JSON.stringify(e)!==JSON.stringify(expected[i]));
  if(difference!==-1)throw new Error(JSON.stringify({index:difference,actual:actual.slice(Math.max(0,difference-2),difference+3),expected:expected.slice(Math.max(0,difference-2),difference+3)}));
  expect(actual).toHaveLength(expected.length);
}

describe('RollTub original VM coroutine tree',()=>{
  for(const sample of vectors.cases)it(`matches every event sequence ${sample.input.sequence} side ${sample.input.side} enemy ${sample.input.targetX} RNG ${sample.input.rng}`,()=>{
    const s=nativeCreateMagicRollTub(sample.input.sequence,{x:sample.input.x*65536,y:sample.input.y*65536,z:0},sample.input.side as 0|1,{x:sample.input.targetX*65536,y:sample.input.y*65536,z:0}),rng=[...sample.input.rng] as NativeRandomState,events:NativeMagicShootEvent[]=[];
    for(let i=0;i<1800&&s.phase!=='done';i++)nativeAdvanceMagicRollTub(s,rng,e=>events.push(e));
    compareEvents(events,sample.native.events as NativeMagicShootEvent[]);
    expect(s.age).toBe(sample.native.ticks);expect(rng).toEqual(sample.native.rng);
    for(const o of s.objects) {
      const n=(sample.native.objects as unknown as Record<string,Record<string,number>>)[o.handle];
      expect({x:o.x,y:o.y,z:o.z,alive:Number(o.alive),frame:o.frame,fade:o.fade,flags:o.flags,callback:o.callback})
        .toEqual({x:n.x,y:n.y,z:n.z,alive:n.alive,frame:n.frame,fade:n.fade,flags:n.flags,callback:n.callback});
    }
    validateNativeMagicRollTub(s,()=>{throw new Error('Invalid native RollTub');});
  });
  for(const sample of vectors.callbacks)it(`matches original callback target=${sample.input.args[1]} attack=${sample.input.attack} previous-general-hit=${sample.input.generalHit}`,()=>{
    const s=nativeCreateMagicRollTub(6,{x:sample.input.x*65536,y:sample.input.y*65536,z:0},1,{x:sample.input.targetX*65536,y:sample.input.y*65536,z:0}),rng=[...sample.input.rng] as NativeRandomState,events:NativeMagicShootEvent[]=[];
    const object=(handle:number):NativeRollTubObject=>({handle,object:49001,born:0,x:s.origin.x,y:s.origin.y,z:0,facing:0,frame:0,vx:0,vy:0,vz:0,gravity:0,fade:16,fadeDuration:0,fadeAt:0,fadeInterval:1,flags:0x3000000,callback:39001,alive:true});
    s.objects=[object(3),{...object(4),x:sample.input.targetX*65536,facing:128}];s.nextHandle=5;s.phase='rolling';s.tasks=[];s.generalHit=!!sample.input.generalHit;
    nativeRollTubHit(s,3,{id:sample.input.args[1],x:sample.input.targetX*65536,y:s.origin.y,z:0,general:sample.input.args[1]===2,alive:true},sample.input.attack);
    for(let i=0;i<1800&&s.tasks.length;i++)nativeAdvanceMagicRollTub(s,rng,e=>events.push(e));
    compareEvents(events,sample.native.events as NativeMagicShootEvent[]);
    expect(s.age).toBe(sample.native.ticks);expect(Number(s.generalHit)).toBe(sample.native.generalHit);expect(rng).toEqual(sample.native.rng);
  });
  for(const sample of vectors.concurrent)it(`keeps the original shared sound gate and single general damage under overlapping callbacks RNG ${sample.input.rng}`,()=>{
    const s=nativeCreateMagicRollTub(6,{x:sample.input.x*65536,y:sample.input.y*65536,z:0},1,{x:sample.input.targetX*65536,y:sample.input.y*65536,z:0}),rng=[...sample.input.rng] as NativeRandomState,events:NativeMagicShootEvent[]=[];
    const object=(handle:number):NativeRollTubObject=>({handle,object:49001,born:0,x:s.origin.x,y:s.origin.y,z:0,facing:0,frame:0,vx:0,vy:0,vz:0,gravity:0,fade:16,fadeDuration:0,fadeAt:0,fadeInterval:1,flags:0x3000000,callback:39001,alive:true});
    s.objects=[object(3),{...object(4),x:sample.input.targetX*65536,facing:128},object(5),object(6)];s.nextHandle=7;s.phase='rolling';s.tasks=[];
    const hit=(source:number)=>nativeRollTubHit(s,source,{id:2,x:sample.input.targetX*65536,y:s.origin.y,z:0,general:true,alive:true},sample.input.attack);
    let restored:NativeMagicRollTub|undefined,restoredRng:NativeRandomState|undefined;
    hit(3);
    for(let i=0;i<1800&&s.tasks.length;i++) {
      if(s.age===10){restored=JSON.parse(JSON.stringify(s)) as NativeMagicRollTub;restoredRng=[...rng];validateNativeMagicRollTub(restored,()=>{throw new Error('Invalid pending callbacks');});}
      for(const pending of sample.input.callbackSchedule)if(pending.t===s.age){hit(pending.args[0]);if(restored)nativeRollTubHit(restored,pending.args[0],s.targets[0],sample.input.attack);}
      nativeAdvanceMagicRollTub(s,rng,e=>events.push(e));
      if(restored)nativeAdvanceMagicRollTub(restored,restoredRng!);
    }
    compareEvents(events,sample.native.events as NativeMagicShootEvent[]);
    expect(events.filter(e=>e.host===769&&e.args?.[0]==='m039snd02').map(e=>e.t)).toEqual([0,21]);
    expect(events.filter(e=>e.host===293)).toHaveLength(1);
    expect(s.age).toBe(sample.native.ticks);expect(rng).toEqual(sample.native.rng);
    expect(restored).toEqual(s);expect(restoredRng).toEqual(rng);
  });
  for(const sample of vectors.reentrant)it(`retains both callback contexts when the same rolling object hits again during its sound wait RNG ${sample.input.rng}`,()=>{
    const s=nativeCreateMagicRollTub(6,{x:sample.input.x*65536,y:sample.input.y*65536,z:0},1,{x:sample.input.targetX*65536,y:sample.input.y*65536,z:0}),rng=[...sample.input.rng] as NativeRandomState,events:NativeMagicShootEvent[]=[];
    const object=(handle:number):NativeRollTubObject=>({handle,object:49001,born:0,x:s.origin.x,y:s.origin.y,z:0,facing:0,frame:0,vx:0,vy:0,vz:0,gravity:0,fade:16,fadeDuration:0,fadeAt:0,fadeInterval:1,flags:0x3000000,callback:39001,alive:true});
    s.objects=[object(3),{...object(4),x:sample.input.targetX*65536,facing:128}];s.nextHandle=5;s.phase='rolling';s.tasks=[];
    const hit=()=>nativeRollTubHit(s,3,{id:2,general:true,alive:true,x:sample.input.targetX*65536,y:s.origin.y,z:0},sample.input.attack);
    hit();
    for(let i=0;i<1800&&s.tasks.length;i++) {
      for(const pending of sample.input.callbackSchedule)if(pending.t===s.age)hit();
      nativeAdvanceMagicRollTub(s,rng,e=>events.push(e));
    }
    compareEvents(events,sample.native.events as NativeMagicShootEvent[]);
    expect(s.objects.filter(o=>o.object!==49001)).toHaveLength(16);
    expect(events.filter(e=>e.host===293)).toHaveLength(1);
    expect(s.age).toBe(sample.native.ticks);expect(rng).toEqual(sample.native.rng);
  });
  it('preserves rolling objects, camera, waits and RNG through JSON restore',()=>{
    const s=nativeCreateMagicRollTub(35,{x:1488*65536,y:468*65536,z:0},1,{x:5328*65536,y:468*65536,z:0}),rng:NativeRandomState=[1,2];
    while(s.age<150)nativeAdvanceMagicRollTub(s,rng);
    validateNativeMagicRollTub(s,()=>{throw new Error('Invalid native RollTub');});
    const copy=JSON.parse(JSON.stringify(s)),other=[...rng] as NativeRandomState;
    while(s.phase!=='done'){nativeAdvanceMagicRollTub(s,rng);nativeAdvanceMagicRollTub(copy,other);}
    expect(copy).toEqual(s);expect(other).toEqual(rng);
  });
});
