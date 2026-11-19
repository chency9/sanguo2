import {describe,it,expect} from 'vitest';
import vectors from '../fixtures/native-command-vectors.json';
import {nativeAdvanceDivision,nativeCanAdvance,nativeWriteCommand,nativeCommandRoute,nativeChargeTarget} from './native-commands';
import {nativePlanMove,nativeForwardTarget} from './native-movement';
import type {NativeRandomState} from './native-strategic-ai';

describe('original command machine code',()=>{
  it.each(vectors.writes.map((v,i)=>({...v,i})))('slot write $i',({input:o,native})=>{
    const orders=[...o.orders];nativeWriteCommand(orders,o.division,o.command);expect(orders).toEqual(native);
  });
  it.each(vectors.advances.map((v,i)=>({...v,i})))('AI division advance $i',({input:o,native})=>{
    const orders=[...o.orders],rng=[...o.rng] as NativeRandomState;
    expect(nativeCanAdvance(o.formation,orders)).toBe(native.canAdvance);
    nativeAdvanceDivision(o.formation,orders,rng);expect({orders,rng}).toEqual({orders:native.orders,rng:native.rng});
  });
  it.each(vectors.moves.map((v,i)=>({...v,i})))('command movement $i',({input:o,native})=>{
    const target=!o.general&&o.command===7?nativeChargeTarget(o.enemies.map(e=>!e.dead),o.target):o.target;
    const point=target===null||target===-1?{x:o.enemyX,y:o.enemyY}:o.enemies[target];
    const route=nativeCommandRoute({...o,ownY:6,ownX:o.general?o.x:o.ownX,targetX:point.x,targetY:point.y});
    expect(route).toEqual(native.route);
    const rng=[...o.rng] as NativeRandomState;
    const forwardTarget=!!nativeForwardTarget(o.x,o.y,o.facing?-1:1,1,(x,y)=>{const c=o.occupied.find(c=>c.x===x&&c.y===y);return c?(c.ally?'ally':'enemy'):undefined;});
    const plan=nativePlanMove({...o,...route,forwardTarget,retreat:o.retreat,returning:o.general&&o.command===2},rng,(x,y)=>o.occupied.some(c=>c.x===x&&c.y===y));
    const flags=(o.general?1:2)|(o.retreat||o.command===8?0x4000:0)|(o.general&&o.command===2&&!plan.returned?256:0)|(plan.kind==='escape'?0x8000:0);
    // 0x43CF07 hold always stops and restores the general's forward facing.
    const generalHold=o.general&&o.command===0;
    const {route:_,...expected}=native;
    expect({x:plan.kind==='escape'?o.x:plan.x,y:plan.y,vx:generalHold?0:plan.vx,vy:generalHold?0:plan.vy,
      facing:generalHold?(o.mirror?0x800000:0):plan.facing,command:o.command,flags,target,rng}).toEqual(expected);
  });
});
