import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import type {GameContent} from '@sango2/content';
import samples from '../fixtures/native-troop-transfer.json';
import {nativeTransferTroops,nativeReserveCapacity} from './native-troops';
import {createSession,dispatch,readSession,type Session} from './index';

describe('original +/- soldiers, slider and pending-fill x86 differential',()=>{
  for(const [index,sample] of samples.cases.entries())it(`${sample.mode} reproduces source soldier slots and city pool ${index}`,()=>{
    expect(nativeTransferTroops(sample.input,sample.target)).toEqual(sample.output);
    expect(sample.rngAfter).toEqual(sample.rng);
  });
});

const content=JSON.parse(readFileSync(new URL('../../../apps/game/public/assets/content.json',import.meta.url),'utf8')) as GameContent;
const scene=content.scenarios[0],faction=scene.factions[0];
function setup() {
  const s=createSession(content,scene.id,faction.id),def=scene.generals.find(g=>g.name==='曹操')!,g=s.generals[def.id],city=s.cities[g.cityId!];
  city.troops+=130-g.troops;Object.assign(g,{level:40,troops:130,troopSlots:{active:60,reserve:70}});
  s.nativeAI!.reserves[g.cityId!]=10;
  return {s,def,g,city,command:{type:'policy-troops' as const,cityId:g.cityId!,generalId:def.id,target:0}};
}

describe('bidirectional campaign troop allocation',()=>{
  it('returns active soldiers first, stops at a full city pool and preserves all other state',()=>{
    const {s,def,g,city,command}=setup(),cap=nativeReserveCapacity(city.population);
    s.nativeAI!.reserves[g.cityId!]=cap-3;const before=structuredClone(s),after=dispatch(s,command,content);
    expect(after.generals[def.id]).toEqual({...g,troops:127,troopSlots:{active:57,reserve:70}});
    expect(after.cities[g.cityId!]).toEqual({...city,troops:city.troops-3});
    expect(after.nativeAI).toEqual({...s.nativeAI,reserves:{...s.nativeAI!.reserves,[g.cityId!]:cap}});
    expect(after.policy).toEqual(s.policy);expect(after.rng).toBe(s.rng);expect(s).toEqual(before);
    const full=dispatch(after,command,content);expect(full.generals).toEqual(after.generals);expect(full.nativeAI).toEqual(after.nativeAI);
    expect(readSession(JSON.parse(JSON.stringify(after)),content)).toEqual(after);
  });
  it('fills active then reserve, permits a partial target and conserves soldiers across multiple officers',()=>{
    const {s,def,g,city,command}=setup(),before=city.troops+s.nativeAI!.reserves[g.cityId!];
    let after=dispatch(s,{...command,target:200},content);
    expect(after.generals[def.id]).toMatchObject({troops:140,troopSlots:{active:70,reserve:70}});expect(after.nativeAI!.reserves[g.cityId!]).toBe(0);
    after=dispatch(after,{...command,target:100},content);
    expect(after.generals[def.id].troopSlots).toEqual({active:30,reserve:70});
    const other=scene.generals.find(d=>d.id!==def.id&&s.generals[d.id].cityId===g.cityId&&s.generals[d.id].ownerId===faction.id&&s.generals[d.id].status==='登')!;
    after=dispatch(after,{...command,generalId:other.id,target:0},content);
    expect(after.cities[g.cityId!].troops+after.nativeAI!.reserves[g.cityId!]).toBe(before);
    expect(after.cities[g.cityId!].money).toBe(city.money);expect(after.policy).toEqual(s.policy);
    expect(readSession(JSON.parse(JSON.stringify(after)),content)).toEqual(after);
  });
  it('returns remaining reserves after active reaches zero and works after annual actions are spent',()=>{
    const {s,def,g,command}=setup();s.policy!.active=false;s.policy!.acted=[def.id];
    const after=dispatch(s,{...command,target:50},content);
    expect(after.generals[def.id]).toMatchObject({troops:50,troopSlots:{active:0,reserve:50}});
    expect(after.nativeAI!.reserves[g.cityId!]).toBe(90);expect(after.policy).toEqual(s.policy);
  });
  it('preserves legacy off-field overflow and old aggregate-only saves',()=>{
    const {s,def,g,city,command}=setup();city.troops+=170;g.troops=300;g.troopSlots={active:60,reserve:70};
    const after=dispatch(s,command,content);
    expect(after.generals[def.id]).toMatchObject({troops:170,troopSlots:{active:0,reserve:0}});
    expect(after.nativeAI!.reserves[g.cityId!]).toBe(140);expect(readSession(JSON.parse(JSON.stringify(after)),content)).toEqual(after);
    const overfull=setup();overfull.s.nativeAI!.reserves[overfull.g.cityId!]=600;
    const stopped=dispatch(overfull.s,overfull.command,content);
    expect(stopped.generals).toEqual(overfull.s.generals);expect(stopped.nativeAI!.reserves[overfull.g.cityId!]).toBe(600);
    const old=setup();delete old.g.troopSlots;
    const restored=dispatch(old.s,{...old.command,target:120},content);
    expect(restored.generals[old.def.id]).toMatchObject({troops:120,troopSlots:{active:90,reserve:30}});
  });
  it('rejects illegal targets, other cities, marching and in-battle changes atomically',()=>{
    const {s,g,command}=setup(),before=structuredClone(s);
    for(const target of [-1,201,0.5,NaN,Infinity,'1',null])expect(()=>dispatch(s,{...command,target:target as number},content)).toThrow('目标兵数');
    expect(()=>dispatch(s,{...command,cityId:'missing'},content)).toThrow('我方城池');
    const other=scene.generals.find(d=>s.generals[d.id].ownerId!==faction.id)!;
    expect(()=>dispatch(s,{...command,generalId:other.id},content)).toThrow('本城');
    const marching=structuredClone(s);marching.generals[command.generalId].armyId='test';expect(()=>dispatch(marching,command,content)).toThrow('本城');
    const fighting=structuredClone(s);fighting.battle={} as Session['battle'];expect(()=>dispatch(fighting,command,content)).toThrow('当前战斗');
    expect(s).toEqual(before);expect(g.troops).toBe(130);
  });
  it('carries an active-slot gap through a real march into battle and save recovery',()=>{
    const {s:initial,def,g,command}=setup(),from=g.cityId!,road=scene.roads.find(r=>!r.restricted&&(r.from===from||r.to===from))!,to=road.from===from?road.to:road.from;
    const enemy=scene.generals.find(d=>initial.generals[d.id].ownerId&&initial.generals[d.id].ownerId!==faction.id&&initial.generals[d.id].status==='登')!,rival=initial.generals[enemy.id];
    initial.cities[rival.cityId!].troops-=rival.troops;rival.cityId=to;initial.cities[to].ownerId=rival.ownerId;initial.cities[to].troops=rival.troops;initial.policy!.governors[to]=enemy.id;
    let s=dispatch(initial,{...command,target:120},content);
    s=dispatch(s,{type:'policy-finish'},content);for(const f of scene.factions)s.nativeAI!.countdowns[f.id]=999;
    s=dispatch(s,{type:'march',from,to,generalIds:[def.id],troops:120},content);
    for(let i=0;i<20&&!s.battle;i++)s=dispatch(s,{type:'advance',days:30},content);
    expect(s.battle).toBeTruthy();const soldiers=s.battle!.units.filter(u=>u.side==='attacker'&&!u.general);
    expect(soldiers.filter(u=>!u.nativeReserve)).toHaveLength(50);expect(soldiers.filter(u=>u.nativeReserve)).toHaveLength(70);
    expect(readSession(JSON.parse(JSON.stringify(s)),content)).toEqual(s);
  });
});
