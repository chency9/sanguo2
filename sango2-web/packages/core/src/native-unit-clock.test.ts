import {describe,it,expect} from 'vitest';
import vectors from '../fixtures/native-unit-clock-vectors.json';
import {nativeUnitDecision,nativeSearchTarget,nativeAttackCooldown,nativePrepareAttack} from './native-unit-clock';
import type {NativeRandomState} from './native-strategic-ai';

describe('original decision clock and target search',()=>{
  it.each(vectors.clocks.map((v,index)=>({...v,index})))('matches decision/deferred/retreat clock $index',({input,native})=>{
    const c={decision:input.decision,deferred:input.deferred,attack:0};
    const {ready}=nativeUnitDecision(c,input);
    expect({ready,decision:c.decision,deferred:c.deferred}).toEqual(native);
  });
  it.each(vectors.searches.map((v,index)=>({...v,index})))('matches search direction, blocked rows, cooldown and RNG $index',({input,native})=>{
    const c={decision:0,deferred:0,attack:input.attack},rng=[...input.rng] as NativeRandomState;
    const distance=nativeSearchTarget(c,input,rng,(x,y)=>{const other=input.occupied.find(p=>p.x===x&&p.y===y);return other?(other.dead?'dead':other.ally?'ally':'enemy'):undefined;});
    expect({distance,attack:c.attack,rng}).toEqual(native);
  });
  it.each(vectors.cooldowns.map((v,index)=>({...v,index})))('matches original per-class attack cooldown $index',({input,native})=>{
    expect(nativeAttackCooldown(input.unit,input.reserve,input.special)).toBe(native);
  });
  it.each(vectors.decisions.map((v,index)=>({...v,index})))('matches the original full soldier decision branch and special-attack draw $index',({input,native})=>{
    const c={decision:1,attack:0,deferred:0},rng=[...input.rng] as NativeRandomState;
    const o={...input,x:35,y:6,general:false};nativeUnitDecision(c,{...o,speed:0,enemySpeed:0});
    const distance=nativeSearchTarget(c,o,rng,(x,y)=>input.distance&&x===35+input.distance&&y===6?'enemy':undefined);
    const attack=nativePrepareAttack(c,o,distance,rng);
    expect({messages:attack.attack?[{distance,special:attack.special}]:[],decision:c.decision,attack:c.attack,rng}).toEqual(native);
  });
});
