import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import type {GameContent} from '@sango2/content';
import samples from '../fixtures/native-troop-autofill.json';
import {nativeAutofillTroops} from './native-troops';
import {createSession,dispatch,readSession,type Session} from './index';

describe('original autofill activation, updates, release and flush x86 traces',()=>{
  for(const sample of samples.cases)it(sample.name,()=>{
    let current={active:sample.input.active,reserve:sample.input.reserve,pool:sample.input.pool,pending:sample.input.pending};
    for(const step of sample.steps) {
      expect(current).toEqual(step.before);
      current=nativeAutofillTroops({...sample.input,...current},current.pending,step.event as number|'flush');
      expect(current).toEqual(step.after);
    }
    expect(sample.rngAfter).toEqual(sample.rng);
  });
});

const content=JSON.parse(readFileSync(new URL('../../../apps/game/public/assets/content.json',import.meta.url),'utf8')) as GameContent;
const scene=content.scenarios[0],faction=scene.factions[0];
function setup() {
  const s=createSession(content,scene.id,faction.id),def=scene.generals.find(g=>g.name==='曹操')!,g=s.generals[def.id],city=s.cities[g.cityId!];
  city.troops+=197-g.troops;Object.assign(g,{level:40,troops:197,troopSlots:{active:98,reserve:99}});
  s.nativeAI!.reserves[g.cityId!]=5;
  return {s,def,g,city,command:{type:'policy-troops-fill' as const,cityId:g.cityId!,generalId:def.id,mode:'step' as 'step'|'finish'}};
}

describe('campaign autofill steps and lifecycle finish',()=>{
  it('moves one soldier per update, active first, without changing reports, RNG or unrelated state',()=>{
    const {s,def,g,city,command}=setup(),original=structuredClone(s);
    let after=s;
    for(const [index,slots] of [{active:99,reserve:99},{active:100,reserve:99},{active:100,reserve:100},{active:100,reserve:100}].entries()) {
      after=dispatch(after,command,content);
      const moved=Math.min(index+1,3),expected=structuredClone(original);
      expected.generals[def.id]={...g,troops:197+moved,troopSlots:slots};
      expected.cities[g.cityId!]={...city,troops:city.troops+moved};
      expected.nativeAI!.reserves[g.cityId!]=5-moved;
      expect(after).toEqual(expected);
      expect(readSession(JSON.parse(JSON.stringify(after)),content)).toEqual(after);
    }
    expect(s).toEqual(original);
  });
  it('finishes remaining soldiers in one command and writes one report for the entire operation',()=>{
    const {s,def,g,command}=setup();
    const stepped=dispatch(s,command,content),finished=dispatch(stepped,{...command,mode:'finish'},content);
    expect(finished.generals[def.id]).toMatchObject({troops:200,troopSlots:{active:100,reserve:100}});
    expect(finished.nativeAI!.reserves[g.cityId!]).toBe(2);
    expect(finished.chronicle[0].text).toContain('现役100、预备100，城内预备池2');
    expect(finished.chronicle.slice(1)).toEqual(s.chronicle);expect(finished.nextId).toBe(s.nextId+1);
    expect(finished.policy).toEqual(s.policy);expect(finished.rng).toBe(s.rng);
    expect(finished.nativeAI!.rng).toEqual(s.nativeAI!.rng);
    expect(readSession(JSON.parse(JSON.stringify(finished)),content)).toEqual(finished);
  });
  it('stops at an empty pool and preserves off-field legacy soldiers even after annual actions',()=>{
    const {s,def,g,city,command}=setup();
    s.policy!.active=false;s.policy!.acted=[def.id];s.nativeAI!.reserves[g.cityId!]=1;g.troops+=50;city.troops+=50;
    const after=dispatch(s,{...command,mode:'finish'},content);
    expect(after.generals[def.id]).toMatchObject({troops:248,troopSlots:{active:99,reserve:99}});
    expect(after.nativeAI!.reserves[g.cityId!]).toBe(0);expect(after.policy).toEqual(s.policy);
    const stopped=dispatch(after,command,content);
    expect(stopped).toEqual(after);expect(readSession(JSON.parse(JSON.stringify(stopped)),content)).toEqual(stopped);
  });
  it('adapts old aggregate saves without creating soldiers or serializing UI pending state',()=>{
    const {s,def,g,command}=setup();delete g.troopSlots;
    const after=dispatch(s,command,content);
    expect(after.generals[def.id]).toMatchObject({troops:198,troopSlots:{active:100,reserve:98}});
    expect(after.nativeAI!.reserves[g.cityId!]).toBe(4);
    expect(Object.keys(after)).toEqual(Object.keys(s));
    expect(Object.keys(after.generals[def.id])).toEqual([...Object.keys(g),'troopSlots']);
    expect(readSession(JSON.parse(JSON.stringify(after)),content)).toEqual(after);
  });
  it('rejects invalid modes, other cities, foreign, marching and fighting officers atomically',()=>{
    const {s,command}=setup(),before=structuredClone(s);
    for(const mode of ['',null,undefined,0,'activate','flush'])expect(()=>dispatch(s,{...command,mode:mode as 'step'},content)).toThrow('自动配兵模式');
    expect(()=>dispatch(s,{...command,cityId:'missing'},content)).toThrow('我方城池');
    const other=scene.generals.find(d=>s.generals[d.id].ownerId!==faction.id)!;
    expect(()=>dispatch(s,{...command,generalId:other.id},content)).toThrow('本城');
    const marching=structuredClone(s);marching.generals[command.generalId].armyId='test';
    expect(()=>dispatch(marching,command,content)).toThrow('本城');
    const fighting=structuredClone(s);fighting.battle={} as Session['battle'];
    expect(()=>dispatch(fighting,command,content)).toThrow('当前战斗');expect(s).toEqual(before);
  });
});
