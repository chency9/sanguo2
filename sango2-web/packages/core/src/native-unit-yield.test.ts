import {describe,it,expect} from 'vitest';
import vectors from '../fixtures/native-yield-vectors.json';
import {nativeTryVacateCell} from './native-unit-yield';
import {nativePlanMove,nativeForwardTarget} from './native-movement';
import type {NativeRandomState} from './native-strategic-ai';

describe('original ally update eligibility',()=>{
  it.each(vectors.vectors.map((v,index)=>({...v,index})))('matches original event dispatch and occupancy result $index',({input,native})=>{
    const messages:number[][]=[];
    const vacated=nativeTryVacateCell(0,input.tick,()=>input.occupied?{id:1,side:input.ally?0:1,flags:input.flags,lastUpdate:input.lastUpdate}:undefined,()=>messages.push([2,0]));
    expect({vacated,messages}).toEqual(native);
  });
  it.each(vectors.chains.map((v,index)=>({...v,index})))('matches original soldier callbacks across a chain of occupied cells $index',({input,native})=>{
    const rng=[...input.rng] as NativeRandomState,dispatch:number[]=[],active=new Set<number>();
    const units=Array.from({length:input.length},(_,id)=>({id,x:35+id,y:6,vx:0,vy:0,lastUpdate:id===input.length-1&&input.end==='updated'?17:16,
      flags:id===input.length-1?(input.end==='general'?1:input.end==='guard'?0x1002:2):2,side:id===input.length-1&&input.end==='enemy'?0:1}));
    const at=(x:number,y:number)=>units.find(u=>u.x===x&&u.y===y);
    function move(id:number) {
      const u=units[id];active.add(id);
      const plan=nativePlanMove({x:u.x,y:u.y,px:(96*u.x+48)*65536,py:(72*u.y+36)*65536,dx:1,dy:0,profile:'strict',retreat:false,facing:0,enemyX:70,
        forwardTarget:()=>!!nativeForwardTarget(u.x,u.y,1,1,(x,y)=>{const other=at(x,y);return other?(other.side===u.side?'ally':'enemy'):undefined;})},rng,
        (x,y)=>!!at(x,y),(x,y)=>nativeTryVacateCell(u.side,17,()=>{
          const other=at(x,y);return other?{...other,flags:other.flags|(active.has(other.id)?0x1000:0)}:undefined;
        },other=>{
          dispatch.push(other);
          // Fixtures suppress attack search with cooldown=100. A waiting tail
          // takes the original non-decision update and does not vacate its cell.
          if(other===input.length-1&&input.end==='waiting')units[other].lastUpdate=17;else move(other);
        }));
      Object.assign(u,{x:plan.x,y:plan.y,vx:plan.vx,vy:plan.vy,lastUpdate:17});active.delete(id);
    }
    move(0);
    expect({units:units.map(({x,y,vx,vy,lastUpdate})=>({x,y,vx,vy,lastUpdate})),dispatch,rng}).toEqual(native);
  });
});
