/** Domestic rules from the pinned 1.05+ executable. The Web world adapter does
 * not yet reproduce SearchTalk, autonomy, historical events or native lists. */
import type {ScenarioDefinition} from '@sango2/content';
import type {Session} from './index';
import {nativeBelow,type NativeRandomState} from './native-strategic-ai';
import {allocateBattleTroops,nativeTroopCapacity} from './native-troops';

export interface DomesticResult {year:number;cityId:string;generalId:string;population:number;defense:number;reportedPopulation:number;reportedDefense:number}
export interface DomesticState {
  version:1;year:number;active:boolean;acted:string[];
  governors:Record<string,string|null>;results:DomesticResult[];
}
export type DomesticCommand =
  | {type:'policy-enable'}
  | {type:'policy-finish'}
  | {type:'policy-develop';cityId:string;generalIds:string[]}
  | {type:'policy-governor';cityId:string;generalId:string}
  | {type:'policy-recruit';cityId:string;generalId:string;amount:number};
export interface DevelopmentInput {population:number;defense:number;isPass:boolean;strength:number;intelligence:number;governorIntelligence:number}

/** 0x427A84 then 0x427947. Full cities/forts skip population RNG. The reported
 * gain is the raw result before the cap, not the actual increment. No gold cost. */
export function nativeDevelop(input:DevelopmentInput,rng:NativeRandomState) {
  let population=input.population,defense=input.defense,reportedPopulation=0,reportedDefense=0;
  if(!input.isPass&&population<1000000) {
    const base=Math.trunc(1000*input.intelligence/10)+nativeBelow(rng,3000);
    reportedPopulation=Math.trunc(2*(input.governorIntelligence-70)*base/300)+base;
    population=Math.min(1000000,population+reportedPopulation);
  }
  if(defense<999) {
    const base=Math.trunc(4*input.strength/10)+nativeBelow(rng,12);
    reportedDefense=Math.trunc(2*(input.governorIntelligence-70)*base/300)+base;
    defense=Math.min(999,defense+reportedDefense);
  }
  return {population,defense,reportedPopulation,reportedDefense};
}
/** 0x423824. Called once on the annual transition, not every month. */
export const nativeAnnualRevenue=(population:number,isPass:boolean)=>isPass?0:Math.trunc(75*population/10000)+2250;

function stationed(s:Session,cityId:string) {
  return Object.keys(s.generals).filter(id=>{const g=s.generals[id];return g.cityId===cityId&&!g.armyId&&g.status==='登'&&g.ownerId===s.cities[cityId].ownerId;});
}
/** Retain an appointed resident. Fallback for the Web's governorless cities is
 * explicit; original automatic succession/list ordering is still unverified. */
export function policyGovernorId(s:Session,scene:ScenarioDefinition,cityId:string):string|null {
  const ids=stationed(s,cityId),appointed=s.policy?.governors[cityId];
  if(appointed&&ids.includes(appointed))return appointed;
  const original=scene.cities.find(c=>c.id===cityId)?.governorId;
  return original&&ids.includes(original)?original:ids[ids.length-1]??null;
}
export function refreshPolicyGovernors(s:Session,scene:ScenarioDefinition) {
  if(s.policy)for(const c of scene.cities)s.policy.governors[c.id]=policyGovernorId(s,scene,c.id);
}
export function createDomesticState(s:Session,scene:ScenarioDefinition):DomesticState {
  return {version:1,year:scene.year+Math.floor(s.day/360),active:true,acted:[],results:[],
    governors:Object.fromEntries(scene.cities.map(c=>[c.id,policyGovernorId(s,scene,c.id)]))};
}
/** Do not migrate legacy sessions silently: this marker also selects native
 * development, reserve transfer and annual tax instead of old preview rules. */
export function beginDomesticYear(s:Session,scene:ScenarioDefinition):boolean {
  if(!s.policy||s.policy.year>=scene.year+Math.floor(s.day/360))return false;
  s.policy.year=scene.year+Math.floor(s.day/360);s.policy.active=true;s.policy.acted=[];
  refreshPolicyGovernors(s,scene);
  for(const def of scene.cities)s.cities[def.id].money+=nativeAnnualRevenue(s.cities[def.id].population,def.nativeFlags===2);
  return true;
}
export function executeDomestic(s:Session,scene:ScenarioDefinition,command:DomesticCommand):string {
  if(command.type==='policy-enable') {
    if(s.policy)throw new Error('此局已启用年度内政。');
    s.policy=createDomesticState(s,scene);
    return '已启用年度内政，现有资源、兵员和进度已保留。';
  }
  const p=s.policy;if(!p)throw new Error('请先启用年度内政。');
  if(command.type==='policy-finish') {
    if(!p.active)throw new Error('本年内政已经结束。');
    p.active=false;return `${p.year}年内政終了，返回征战。`;
  }
  const city=s.cities[command.cityId],def=scene.cities.find(c=>c.id===command.cityId);
  if(!city||!def||city.ownerId!==s.factionId)throw new Error('只能在我方城池执行此命令。');
  const ids=stationed(s,command.cityId);
  if(!ids.length)throw new Error('城中须有我方在任武将。');
  if(command.type==='policy-recruit') {
    if(!ids.includes(command.generalId))throw new Error('请选择本城在任武将。');
    const g=s.generals[command.generalId],officer=scene.generals.find(g=>g.id===command.generalId)!;
    const cap=nativeTroopCapacity(officer.level??20),maximum=Math.max(0,cap.active)+cap.reserve;
    if(!Number.isInteger(command.amount)||command.amount<1||command.amount>maximum-g.troops)throw new Error('配兵数量超出武将统兵上限。');
    if(!s.nativeAI||command.amount>s.nativeAI.reserves[command.cityId])throw new Error('城中预备兵不足，请等待城内征募。');
    const slots=allocateBattleTroops(g.troops,officer.level??20,g.troopSlots),active=Math.min(command.amount,Math.max(0,cap.active)-slots.active);
    g.troopSlots={active:slots.active+active,reserve:slots.reserve+command.amount-active};
    g.troops+=command.amount;city.troops+=command.amount;s.nativeAI.reserves[command.cityId]-=command.amount;
    return `${def.name}为${officer.name}补充${command.amount}兵，取自城内预备池。`;
  }
  if(!p.active)throw new Error('本年内政已经结束，下一年度可再执行。');
  if(command.type==='policy-governor') {
    if(!ids.includes(command.generalId))throw new Error('太守必须是本城在任武将。');
    p.governors[command.cityId]=command.generalId;
    return `${def.name}任命${scene.generals.find(g=>g.id===command.generalId)!.name}为太守。`;
  }
  if(!Array.isArray(command.generalIds)||!command.generalIds.length||new Set(command.generalIds).size!==command.generalIds.length||command.generalIds.some(id=>!ids.includes(id)))throw new Error('请选择本城尚未行动的武将。');
  if(command.generalIds.some(id=>p.acted.includes(id)))throw new Error('所选武将本轮已行动，请选择尚未行动的武将。');
  const governor=policyGovernorId(s,scene,command.cityId);
  if(!governor||!s.nativeAI)throw new Error('当前城池缺少太守或征战状态。');
  let people=0,wall=0;
  // Caller selection is normalized to roster order; checkbox click order cannot
  // alter which officer consumes each RNG draw. Native list reconstruction is pending.
  for(const id of ids.filter(id=>command.generalIds.includes(id))) {
    const actor=scene.generals.find(g=>g.id===id)!;
    const result=nativeDevelop({population:city.population,defense:city.defense,isPass:def.nativeFlags===2,
      strength:actor.strength,intelligence:actor.intelligence,governorIntelligence:scene.generals.find(g=>g.id===governor)!.intelligence},s.nativeAI.rng);
    const population=result.population-city.population,defense=result.defense-city.defense;
    city.population=result.population;city.defense=result.defense;people+=population;wall+=defense;
    p.acted.push(id);p.results.unshift({year:p.year,cityId:command.cityId,generalId:id,population,defense,reportedPopulation:result.reportedPopulation,reportedDefense:result.reportedDefense});
  }
  p.results.length=Math.min(100,p.results.length);
  return `${def.name}${command.generalIds.length}将完成开发：人口增加${people}，城防增加${wall}。`;
}
