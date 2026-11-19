import {describe,it,expect} from 'vitest';
import vectors from '../fixtures/native-movement-vectors.json';
import {nativeMovementCandidates,nativePlanMove,nativeForwardTarget,nativeMovementRange,type NativeMoveProfile} from './native-movement';
import type {NativeRandomState} from './native-strategic-ai';

describe('original movement candidate lottery',()=>{
  it.each(vectors.scans.map((v,index)=>({...v,index})))('matches original range and ally-blocked forward scan $index',({input,native})=>{
    const range=nativeMovementRange(input.unit,input.reserve,input.general);
    const distance=nativeForwardTarget(input.x,input.y,input.direction,range,(x,y)=>{
      const c=input.occupied.find(c=>c.x===x&&c.y===y);return c?(c.dead?'dead':c.ally?'ally':'enemy'):undefined;
    });
    expect({range,distance}).toEqual(native);
  });
  it.each(vectors.vectors.map((v,index)=>({...v,index})))('matches 8 candidate offsets and RNG $index',({input,native})=>{
    const rng=[...input.rng] as NativeRandomState;
    expect(nativeMovementCandidates(input.dx,input.dy,input.weights,rng)).toEqual(native.candidates);
    expect(rng).toEqual(native.rng);
  });
  it.each(vectors.steps.map((v,index)=>({...v,index})))('matches original blocked movement, fallback and exit $index',({input,native})=>{
    const rng=[...input.rng] as NativeRandomState;
    const forwardTarget=!!nativeForwardTarget(input.x,input.y,1,1,(x,y)=>{const c=input.occupied.find(c=>c.x===x&&c.y===y);return c?(c.ally?'ally':'enemy'):undefined;});
    const result=nativePlanMove({...input,profile:input.profile as NativeMoveProfile,facing:0,enemyX:0,forwardTarget},rng,(x,y)=>input.occupied.some(c=>c.x===x&&c.y===y));
    const escaped=result.kind==='escape';
    expect({x:escaped?input.x:result.x,y:escaped?input.y:result.y,previousX:input.x,previousY:input.y,
      vx:result.vx,vy:result.vy,facing:result.facing,escaped,rng}).toEqual(native);
  });
});
