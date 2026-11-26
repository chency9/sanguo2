import {describe,it,expect} from 'vitest';
import vectors from '../fixtures/native-magic-arrow-support-vectors.json';
import objectVectors from '../fixtures/native-arrow-object-host-vectors.json';
import {nativeArrowSupportDefinition,nativeCreateMagicArrowSupport,nativeAdvanceMagicArrowSupport,nativeArrowSupportObjectEvent,nativeArrowSupportObjectFrame,nativeArrowSupportCollision,validateNativeMagicArrowSupport,type NativeArrowSupportObject,type NativeArrowSupportTarget} from './native-magic-arrow-support';
import {nativeBelow,type NativeRandomState} from './native-strategic-ai';
import type {NativeMagicShootEvent} from './native-magic-shoot';
function compare(actual:NativeMagicShootEvent[],expected:NativeMagicShootEvent[]) {
  const at=actual.findIndex((e,i)=>JSON.stringify(e)!==JSON.stringify(expected[i]));
  if(at!==-1)throw new Error(JSON.stringify({at,actual:actual.slice(Math.max(0,at-2),at+3),expected:expected.slice(Math.max(0,at-2),at+3)}));
  expect(actual).toHaveLength(expected.length);
}
describe('ArrowSupport original SO instruction tree',()=>{
  for(const sample of vectors.cases)it(`matches skill${sample.input.sequence} side${sample.input.side} troops${sample.input.soldiers} RNG${sample.input.rng}`,()=>{
    const s=nativeCreateMagicArrowSupport(sample.input.sequence,{x:sample.input.x*65536,y:sample.input.y*65536,z:0},sample.input.side as 0|1,{x:sample.input.targetX*65536,y:sample.input.y*65536,z:0}),rng=[...sample.input.rng] as NativeRandomState,events:NativeMagicShootEvent[]=[];
    s.targets=Array.from({length:sample.input.soldiers},(_,i):NativeArrowSupportTarget=>({id:100000+i,x:(3408+i*96)*65536,y:(180+i%8*72)*65536,z:0,general:false,alive:true,hp:1,facing:0}));
    if('occupied' in sample.input&&sample.input.occupied)s.occupancy=Array.from({length:71*14},(_,i)=>({x:i%71,y:Math.trunc(i/71),handle:1}));
    for(let i=0;i<2400&&s.phase!=='done';i++)nativeAdvanceMagicArrowSupport(s,rng,e=>events.push(e));
    compare(events,sample.native.events as NativeMagicShootEvent[]);expect(rng).toEqual(sample.native.rng);expect(s.age).toBe(sample.native.ticks);
    expect(s.statics[8]).toBe(sample.native.divisor);
    validateNativeMagicArrowSupport(s,()=>{throw new Error('Invalid ArrowSupport state');});
    for(const o of s.objects) {
      const n=(sample.native.objects as unknown as Record<string,Record<string,number>>)[o.handle];
      expect({x:o.x,y:o.y,z:o.z,alive:Number(o.alive),frame:o.frame,flags:o.flags,callback:o.callback,fade:o.fade,scaleX:o.scaleX,scaleY:o.scaleY})
        .toEqual({x:n.x,y:n.y,z:n.z,alive:n.alive,frame:n.frame,flags:n.flags,callback:n.callback,fade:n.fade,scaleX:n.scaleX,scaleY:n.scaleY});
    }
  });
  for(const sample of objectVectors.cases)it(`keeps original parsed draw frame timing for object${sample.object}`,()=>{
    sample.native.trace.forEach((frame,age)=>expect(nativeArrowSupportObjectFrame(sample.object,age)).toBe(frame));
  });
  for(const [index,sample] of objectVectors.collisions.entries())it(`matches original MagicObjectProcess collision/bomb gate ${index}`,()=>{
    const o={alive:true,flags:sample.input.flags,z:sample.input.z,deathAt:sample.input.action===32?0:undefined} as NativeArrowSupportObject;
    expect(nativeArrowSupportCollision(o,sample.input.occupied?{general:sample.input.general,ally:sample.input.ally}:undefined)).toBe(sample.native.events[0]??0);
  });
  for(const [index,sample] of objectVectors.selections.entries())it(`matches original random live-slot selection ${index}`,()=>{
    const rng=[...sample.input.rng] as NativeRandomState,slots=sample.input.slots.filter(h=>h!==0);
    const actual=Array.from({length:20},()=>slots.length?slots[nativeBelow(rng,slots.length)]:0);
    expect(actual).toEqual(sample.native.handles);expect(rng).toEqual(sample.native.rng);
  });
  for(const sample of vectors.callbacks)it(`matches ${sample.input.name} target${sample.input.args[1]} attack${sample.input.attack} divisor${sample.input.divisor}`,()=>{
    const s=nativeCreateMagicArrowSupport(4,{x:sample.input.x*65536,y:sample.input.y*65536,z:0},1,{x:sample.input.targetX*65536,y:sample.input.y*65536,z:0},sample.input.attack),rng=[...sample.input.rng] as NativeRandomState,events:NativeMagicShootEvent[]=[];
    const object=(handle:number):NativeArrowSupportObject=>({handle,object:16004,born:0,x:s.origin.x,y:s.origin.y,z:0,facing:0,frame:0,vx:0,vy:0,vz:0,gravity:0,flags:0x3000000,callback:6001,scaleX:65536,scaleY:65536,fade:16,fadeDuration:0,fadeAt:0,fadeInterval:1,alive:true});
    s.objects=[object(3),{...object(4),x:sample.input.targetX*65536,facing:128}];s.nextHandle=5;s.tasks=[];s.statics[8]=sample.input.divisor;s.nativeObjects=false;
    const target={id:sample.input.args[1],general:sample.input.args[1]===2,alive:true,x:sample.input.targetX*65536,y:s.origin.y,z:0,hp:100,facing:sample.input.args[1]===2?0:128};
    nativeArrowSupportObjectEvent(s,3,sample.input.name==='ArrowCallback1'?6001:6002,target);
    for(let i=0;i<2400&&s.tasks.length;i++)nativeAdvanceMagicArrowSupport(s,rng,e=>events.push(e));
    compare(events,sample.native.events as NativeMagicShootEvent[]);expect(rng).toEqual(sample.native.rng);expect(s.age).toBe(sample.native.ticks);expect(s.statics[8]).toBe(sample.native.divisor);
    validateNativeMagicArrowSupport(s,()=>{throw new Error('Invalid callback state');});
  });
  it.each([1,21,71,172,280])('preserves script frames, coroutines and RNG through JSON at update%s',at=>{
    const s=nativeCreateMagicArrowSupport(30,{x:1488*65536,y:468*65536,z:0},1,{x:5328*65536,y:468*65536,z:0}),rng:NativeRandomState=[1,2];
    for(let i=0;i<at;i++)nativeAdvanceMagicArrowSupport(s,rng);
    const copy=JSON.parse(JSON.stringify(s)),other=[...rng] as NativeRandomState;validateNativeMagicArrowSupport(copy,()=>{throw new Error('Invalid restored frame');});
    for(let i=0;i<2400&&s.phase!=='done';i++){nativeAdvanceMagicArrowSupport(s,rng);nativeAdvanceMagicArrowSupport(copy,other);}
    expect(copy).toEqual(s);expect(other).toEqual(rng);
  });
  it('keeps skill sequence, script entry and source wrapper arguments distinct',()=>{
    expect(nativeArrowSupportDefinition(4)).toEqual({sequence:4,script:503,entry:'Magic3',count:17,fire:1});
    expect(nativeArrowSupportDefinition(590)).toEqual({sequence:87,script:590,entry:'Magic90',count:56,fire:0});
  });
});
