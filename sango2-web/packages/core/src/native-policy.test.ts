import {describe,it,expect} from 'vitest';
import type {GameContent} from '@sango2/content';
import cases from '../fixtures/native-policy.json';
import {nativeDevelop,nativeAnnualRevenue} from './native-policy';
import {createSession,dispatch,readSession,validateSession,policyGovernorId} from './index';

const content:GameContent={version:1,id:'policy',sourceHash:'c'.repeat(64),skills:[],strategies:[],items:[],terrains:[],scenarios:[{
  id:'era',title:'内政',year:184,factions:[{id:'p',name:'甲',leaderId:'a',color:'#fff',select:1,special:false,flagNumber:999}],roads:[{id:'r',from:'home',to:'other',length:120,points:[[0,0],[100,100]],restricted:false}],
  cities:['home','other','pass'].map((id,i)=>({id,name:id,ownerId:'p',governorId:i===0?'a':i===1?'c':null,position:[i*100,0],money:5000,population:100000,defense:200,nativeFlags:i===2?2:0})),
  generals:['a','b','c'].map((id,i)=>({id,name:id,portrait:'',strength:90-i*30,intelligence:40+i*30,hp:100,mp:40,loyalty:90,status:'登',cityId:i<2?'home':'other',ownerId:'p',weapon:'',horse:'',item:'',unit:'刀',formations:[],rawSkill:'',rawStrategy:'',sourceLine:1,level:30}))
}]};
const fresh=()=>createSession(content,'era','p');
const finish=(s:ReturnType<typeof fresh>)=>dispatch(s,{type:'policy-finish'},content);

describe('unmodified native development differential',()=>{
  it.each(cases.cases)('reproduces original population, defense and RNG: %j',sample=>{
    const rng:[number,number]=[sample.rng[0],sample.rng[1]];
    expect(nativeDevelop(sample.input,rng)).toEqual(sample.output);expect(rng).toEqual(sample.rngAfter);
    expect(nativeAnnualRevenue(sample.input.population,sample.input.isPass)).toBe(sample.annualRevenue);
  });
});
describe('annual domestic integration',()=>{
  it('opens an independent phase and prevents world movement until finished',()=>{
    const s=fresh();expect(s.policy).toMatchObject({active:true,year:184,acted:[]});validateSession(s,content);
    expect(()=>dispatch(s,{type:'advance',days:1},content)).toThrow('内政阶段');
    expect(()=>dispatch(s,{type:'march',from:'home',to:'other',generalIds:['a'],troops:60},content)).toThrow('内政阶段');
    expect(dispatch(finish(s),{type:'advance',days:1},content).day).toBe(1);
  });
  it('allows several officers per city with no gold cost and records actual and reported results',()=>{
    const original=fresh(),s=dispatch(original,{type:'policy-develop',cityId:'home',generalIds:['a']},content);
    expect(original.policy!.acted).toEqual([]);expect(s.cities.home.money).toBe(original.cities.home.money);
    expect(s.cities.home.population).toBeGreaterThan(original.cities.home.population);expect(s.policy!.acted).toEqual(['a']);
    const next=dispatch(s,{type:'policy-develop',cityId:'home',generalIds:['b']},content);
    expect(next.policy!.results).toHaveLength(2);expect(next.policy!.results[0].population).toBe(next.cities.home.population-s.cities.home.population);
    expect(()=>dispatch(next,{type:'policy-develop',cityId:'home',generalIds:['a']},content)).toThrow('本轮已行动');validateSession(next,content);
  });
  it('prevalidates a whole batch without spending RNG, money or an action on failure',()=>{
    const s=dispatch(fresh(),{type:'policy-develop',cityId:'home',generalIds:['a']},content),before=structuredClone(s);
    expect(()=>dispatch(s,{type:'policy-develop',cityId:'home',generalIds:['b','a']},content)).toThrow('已行动');expect(s).toEqual(before);
    for(const ids of [[],['b','b'],['c'],['unknown']])expect(()=>dispatch(s,{type:'policy-develop',cityId:'home',generalIds:ids},content)).toThrow();
    const reverse=dispatch(fresh(),{type:'policy-develop',cityId:'home',generalIds:['b','a']},content);
    expect(reverse).toEqual(dispatch(fresh(),{type:'policy-develop',cityId:'home',generalIds:['a','b']},content));
  });
  it('uses the live appointed governor without resetting used actions',()=>{
    let s=dispatch(fresh(),{type:'policy-develop',cityId:'home',generalIds:['a']},content);
    s=dispatch(s,{type:'policy-governor',cityId:'home',generalId:'b'},content);
    expect(policyGovernorId(s,content.scenarios[0],'home')).toBe('b');expect(s.policy!.acted).toEqual(['a']);
    expect(()=>dispatch(s,{type:'policy-governor',cityId:'home',generalId:'c'},content)).toThrow('本城');
    const read=readSession(JSON.parse(JSON.stringify(s)),content);expect(read).toEqual(s);
    const changed=dispatch(read,{type:'policy-develop',cityId:'home',generalIds:['b']},content);
    const baseline=dispatch(dispatch(fresh(),{type:'policy-develop',cityId:'home',generalIds:['a']},content),{type:'policy-develop',cityId:'home',generalIds:['b']},content);
    expect(changed.cities.home.population).toBeGreaterThan(baseline.cities.home.population);
    s=dispatch(finish(changed),{type:'march',from:'home',to:'other',generalIds:['b'],troops:60},content);
    expect(s.policy!.governors.home).toBe('a');validateSession(s,content);
  });
  it('consumes a city reserve pool once, with active and reserve slots and no extra fee',()=>{
    let s=fresh();s.nativeAI!.reserves.home=200;const money=s.cities.home.money,total=s.cities.home.troops;
    s=dispatch(s,{type:'policy-recruit',cityId:'home',generalId:'a',amount:70},content);
    expect(s.generals.a.troopSlots).toEqual({active:100,reserve:50});expect(s.generals.a.troops).toBe(150);
    expect(s.nativeAI!.reserves.home).toBe(130);expect(s.cities.home).toMatchObject({troops:total+70,money});
    expect(()=>dispatch(s,{type:'policy-recruit',cityId:'home',generalId:'a',amount:1},content)).toThrow('统兵上限');
    s=finish(s);s=dispatch(s,{type:'policy-recruit',cityId:'home',generalId:'b',amount:1},content);expect(s.nativeAI!.reserves.home).toBe(129);
    s.nativeAI!.reserves.home=0;expect(()=>dispatch(s,{type:'policy-recruit',cityId:'home',generalId:'b',amount:1},content)).toThrow('预备兵不足');validateSession(s,content);
  });
  it('stops a multi-day advance at the annual phase, taxes once, and resets officer actions',()=>{
    let s=dispatch(fresh(),{type:'policy-develop',cityId:'home',generalIds:['a']},content);s=finish(s);s.day=359;
    for(const id of Object.keys(s.cities))s.nativeAI!.recruitTimers[id]=9999;
    const money=s.cities.home.money,pop=s.cities.home.population,passMoney=s.cities.pass.money;
    s=dispatch(s,{type:'advance',days:30},content);
    expect(s.day).toBe(360);expect(s.policy).toMatchObject({year:185,active:true,acted:[]});
    expect(s.cities.home.money).toBe(money+nativeAnnualRevenue(pop,false));expect(s.cities.pass.money).toBe(passMoney);
    const loaded=readSession(JSON.parse(JSON.stringify(s)),content);expect(loaded).toEqual(s);
    const next=dispatch(finish(loaded),{type:'advance',days:30},content);expect(next.cities.home.money).toBe(s.cities.home.money);validateSession(next,content);
    expect(()=>dispatch(next,{type:'policy-develop',cityId:'home',generalIds:['a']},content)).toThrow('本年内政已经结束');
    expect(()=>dispatch(next,{type:'policy-finish'},content)).toThrow('已经结束');
  });
  it('does not silently rewrite an old save economy and enables domestic rules explicitly',()=>{
    const old=fresh();delete old.policy;old.day=42;
    const loaded=readSession(JSON.parse(JSON.stringify(old)),content);expect(loaded.policy).toBeUndefined();
    const enabled=dispatch(loaded,{type:'policy-enable'},content);expect(enabled.day).toBe(42);expect(enabled.cities).toEqual(old.cities);expect(enabled.generals).toEqual(old.generals);expect(enabled.nativeAI).toEqual(old.nativeAI);
    expect(enabled.policy).toMatchObject({active:true,year:184});validateSession(enabled,content);
  });
  it('rejects corrupted phase, action, governor and result state',()=>{
    const edits=[(s:ReturnType<typeof fresh>)=>{s.policy!.year=183;},(s:ReturnType<typeof fresh>)=>{s.policy!.acted=['a','a'];},(s:ReturnType<typeof fresh>)=>{s.policy!.governors.home='c';},(s:ReturnType<typeof fresh>)=>{delete s.policy!.governors.other;},(s:ReturnType<typeof fresh>)=>{s.policy!.results.push({year:184,cityId:'home',generalId:'a',population:-1,defense:1,reportedPopulation:1,reportedDefense:1});}];
    for(const edit of edits){const s=fresh();edit(s);expect(()=>validateSession(s,content)).toThrow('存档');}
  });
});
