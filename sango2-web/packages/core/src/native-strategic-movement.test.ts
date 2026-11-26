import {describe,it,expect} from 'vitest';
import vectors from '../fixtures/native-strategic-movement.json';
import {nativeStrategicCollisions,nativeStrategicDispatch,nativeStrategicRouteGate,nativeStrategicSpeed,nativeStrategicHeading,nativeStrategicAftermath,nativeStrategicRetreatDestination,nativeStrategicSpriteUpdate} from './native-strategic-movement';
import type {NativeRandomState} from './native-strategic-ai';

describe('native strategic movement, collision queue and aftermath x86 boundaries',()=>{
  it.each(vectors.collisionCases.map((c,index)=>({...c,index})))('proposed movement collision and 16-pair frame queue $index',c=>{
    const rng=[...c.rng],pairs=nativeStrategicCollisions(c.actors,'0',c.delta[0],c.delta[1],c.existing.map(([first,second])=>({first,second})));
    expect({canMove:1,pairs:pairs.map(p=>[p.first,p.second]),rng}).toEqual(c.native);
  });
  it.each(vectors.dispatchCases.map((c,index)=>({...c,index})))('queue dispatch lifetime and final-player selection $index',c=>{
    expect(nativeStrategicDispatch(c.entries as Parameters<typeof nativeStrategicDispatch>[0],0,c.auto)).toEqual(c.native.operations);
    expect(c.native.queueCount).toBe(0);expect(c.native.rng).toEqual(c.rng);
  });
  it.each(vectors.routeCases.map((c,caseIndex)=>({...c,caseIndex})))('integer route gate and city transition $caseIndex',c=>{
    expect(nativeStrategicRouteGate({...c,path:c.path as [number,number][]})).toEqual(c.native);
  });
  it.each(vectors.stateCases.map((c,index)=>({...c,index})))('postbattle flag, cooldown, money and RNG order $index',c=>{
    const rng:NativeRandomState=[...c.rng] as NativeRandomState;
    expect({...nativeStrategicAftermath(c,c.kind as 2|4|8|16,rng),rng}).toEqual(c.native);
  });
  it.each(vectors.headingCases.map((c,index)=>({...c,index})))('native angle lookup and speed flags $index',c=>{
    expect({heading:nativeStrategicHeading(c.x,c.y,c.targetX,c.targetY),speed:nativeStrategicSpeed(c.flags)}).toEqual(c.native);
  });
  it.each(vectors.retreatRouteCases.map((c,index)=>({...c,index})))('retreat destination priority and exact RNG $index',c=>{
    const rng:NativeRandomState=[...c.rng] as NativeRandomState;
    expect({destination:nativeStrategicRetreatDestination(c,rng),rng}).toEqual(c.native);
  });
  it.each(vectors.updateCases.map((c,index)=>({...c,index})))('source sprite six-update movement and short timers $index',c=>{
    expect({...nativeStrategicSpriteUpdate(c),rng:c.rng}).toEqual(c.native);
  });
});
