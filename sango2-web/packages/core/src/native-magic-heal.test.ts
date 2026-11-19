import {describe,it,expect} from 'vitest';
import vectors from '../fixtures/native-magic-heal-vectors.json';
import {nativeCreateMagicHeal,nativeAdvanceMagicHeal} from './native-magic-heal';
import type {NativeRandomState} from './native-strategic-ai';
import type {NativeMagicShootEvent} from './native-magic-shoot';

describe('complete Heal script tree against original x86 VM',()=>{
  it.each(vectors.cases.map((c,i)=>({i,...c})))('matches events, HP, RNG and task count for case $i',({input,native})=>{
    const s=nativeCreateMagicHeal(input.name==='Magic1'?0:1,input.attack,{x:input.x*65536,y:input.y*65536,z:0},input.side as 0|1);
    const rng=[...input.rng] as NativeRandomState,vitals={hp:input.hp,maxHp:input.maxHp},events:NativeMagicShootEvent[]=[],trace:number[][]=[];
    for(let i=0;i<1200&&s.phase!=='done';i++) {
      nativeAdvanceMagicHeal(s,rng,vitals,e=>events.push(e));trace.push([vitals.hp,...rng,s.tasks.length]);
    }
    const first=events.findIndex((e,i)=>JSON.stringify(e)!==JSON.stringify(native.events[i]));
    expect({first,event:events[first],expected:native.events[first]}).toEqual({first:-1,event:undefined,expected:undefined});
    expect(events.length).toBe(native.events.length);expect(trace).toEqual(native.trace);expect(s.age).toBe(native.ticks);
    expect(rng).toEqual(native.rng);expect(vitals.hp).toBe(native.hp);
  });
});
