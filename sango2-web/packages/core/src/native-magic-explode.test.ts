import {describe,it,expect} from 'vitest';
import vectors from '../fixtures/native-magic-explode-vectors.json';
import {nativeCreateMagicExplode,nativeAdvanceMagicExplode,nativeExplodeHit,validateNativeMagicExplode,type NativeExplodeObject} from './native-magic-explode';
import type {NativeMagicShootEvent} from './native-magic-shoot';
import type {NativeRandomState} from './native-strategic-ai';

describe('ExplodeRound original VM coroutine tree',()=>{
  for(const sample of vectors.cases)it(`matches every original creation event sequence ${sample.input.sequence} side ${sample.input.side} x ${sample.input.x} RNG ${sample.input.rng}`,()=>{
    const s=nativeCreateMagicExplode(sample.input.sequence,{x:sample.input.x*65536,y:sample.input.y*65536,z:0},sample.input.side as 0|1),rng=[...sample.input.rng] as NativeRandomState,events:NativeMagicShootEvent[]=[];
    for(let i=0;i<1600&&s.phase!=='done';i++)nativeAdvanceMagicExplode(s,rng,e=>events.push(e));
    const expected=sample.native.events as NativeMagicShootEvent[];
    const difference=events.findIndex((e,i)=>JSON.stringify(e)!==JSON.stringify(expected[i]));
    if(difference!==-1)throw new Error(JSON.stringify({index:difference,actual:events.slice(Math.max(0,difference-2),difference+3),expected:expected.slice(Math.max(0,difference-2),difference+3)}));
    expect(events).toHaveLength(expected.length);expect(s.age).toBe(sample.native.ticks);expect(rng).toEqual(sample.native.rng);
    for(const o of s.objects) {
      const n=(sample.native.objects as unknown as Record<string,Record<string,number>>)[o.handle];
      expect({x:o.x,y:o.y,z:o.z,facing:o.facing,alive:Number(o.alive),scaleX:o.scaleX,scaleY:o.scaleY,fade:o.fade,flags:o.flags,callback:o.callback,frame:o.frame}).toEqual({x:n.x,y:n.y,z:n.z,facing:n.facing,alive:n.alive,scaleX:n.scaleX,scaleY:n.scaleY,fade:n.fade,flags:n.flags,callback:n.callback,frame:n.frame});
    }
  });
  for(const sample of vectors.callbacks)it(`matches original callback general=${sample.input.args[1]===2} attack=${sample.input.attack} divisor=${sample.input.divisor} HP=${sample.input.hp}`,()=>{
    const s=nativeCreateMagicExplode(7,{x:sample.input.x*65536,y:sample.input.y*65536,z:0},1),rng=[...sample.input.rng] as NativeRandomState,events:NativeMagicShootEvent[]=[];
    s.tasks=[];s.phase='burst';s.hitDivisor=sample.input.divisor;
    const obj=(handle:number):NativeExplodeObject=>({handle,object:18003,born:0,x:s.origin.x,y:s.origin.y,z:0,facing:0,scaleX:65536,scaleY:65536,frame:0,vz:0,fade:16,fadeDuration:0,fadeAt:0,fadeInterval:1,shrink:0,flags:0x3000000,callback:8001,alive:true});
    s.objects=[obj(3),{...obj(4),x:5000*65536,facing:128}];s.nextHandle=5;
    const target={id:sample.input.args[1],x:5000*65536,y:s.origin.y,z:0,facing:sample.input.args[1]===2?0:128,general:sample.input.args[1]===2,hp:sample.input.hp,alive:true};
    nativeExplodeHit(s,3,target,sample.input.attack,rng,e=>events.push(e));
    for(let i=0;i<200&&(s.phase as string)!=='done';i++)nativeAdvanceMagicExplode(s,rng,e=>events.push(e),[target]);
    const expected=sample.native.events as NativeMagicShootEvent[];
    const difference=events.findIndex((e,i)=>JSON.stringify(e)!==JSON.stringify(expected[i]));
    if(difference!==-1)throw new Error(JSON.stringify({index:difference,actual:events.slice(Math.max(0,difference-2),difference+3),expected:expected.slice(Math.max(0,difference-2),difference+3)}));
    expect(events).toHaveLength(expected.length);expect(s.age).toBe(sample.native.ticks);expect(s.hitDivisor).toBe(sample.native.divisor);expect(rng).toEqual(sample.native.rng);
  });
  it('replays suspended children without consuming a different RNG stream',()=>{
    const s=nativeCreateMagicExplode(23,{x:1488*65536,y:468*65536,z:0},1),rng:NativeRandomState=[1,2];
    while(s.age<147)nativeAdvanceMagicExplode(s,rng);
    validateNativeMagicExplode(s,()=>{throw new Error('invalid');});const copy=JSON.parse(JSON.stringify(s)),copyRng=[...rng] as NativeRandomState;
    while(s.phase!=='done'){nativeAdvanceMagicExplode(s,rng);nativeAdvanceMagicExplode(copy,copyRng);}
    expect(copy).toEqual(s);expect(copyRng).toEqual(rng);
  });
});
