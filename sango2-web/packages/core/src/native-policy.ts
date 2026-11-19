/** Domestic rules from the pinned 1.05+ executable. System.SO presentation
 * and annual historical appearance events remain separate. */
import type {ScenarioDefinition} from '@sango2/content';
import type {Session} from './index';
import {nativeBelow,type NativeRandomState} from './native-strategic-ai';
import {allocateBattleTroops,nativeTroopCapacity,nativeTransferTroops,nativeAutofillTroops,nativeReserveCapacity} from './native-troops';
import {createDomesticSearch,ensureDomesticSearch,developDomesticOfficer,searchDomesticOfficer,domesticSearchMessage,runDomesticAutonomy,type DomesticSearchState} from './native-policy-actions';
import {officerLevel} from './native-progression';
import {officerForceMask,nativeForceNames} from './native-officer-runtime';
import type {AutonomyMode} from './native-policy-search';
import {ensureDomesticAnnual,runAnnualDomesticAI,type DomesticAnnualState} from './native-policy-annual';
import {previewPlayerItem} from './native-player-items';

export interface DomesticResult {year:number;cityId:string;generalId:string;population:number;defense:number;reportedPopulation:number;reportedDefense:number}
export interface DomesticState {
  version:1;year:number;active:boolean;acted:string[];
  governors:Record<string,string|null>;results:DomesticResult[];
  search?:DomesticSearchState;
  annual?:DomesticAnnualState;
}
export type DomesticCommand =
  | {type:'policy-enable'}
  | {type:'policy-finish'}
  | {type:'policy-develop';cityId:string;generalIds:string[]}
  | {type:'policy-search';cityId:string;generalIds:string[]}
  | {type:'policy-autonomy-set';cityId:string;mode:AutonomyMode}
  | {type:'policy-autonomy-run'}
  | {type:'policy-governor';cityId:string;generalId:string}
  | {type:'policy-item';cityId:string;generalId:string;itemId:number}
  | {type:'policy-unit';cityId:string;generalId:string;unit:string}
  | {type:'policy-troops';cityId:string;generalId:string;target:number}
  | {type:'policy-troops-fill';cityId:string;generalId:string;mode:'step'|'finish'}
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
export function createDomesticState(s:Session,scene:ScenarioDefinition,items:readonly Record<string,string>[]=[]):DomesticState {
  return {version:1,year:scene.year+Math.floor(s.day/360),active:true,acted:[],results:[],
    search:createDomesticSearch(s,scene,items),
    governors:Object.fromEntries(scene.cities.map(c=>[c.id,policyGovernorId(s,scene,c.id)]))};
}
/** Do not migrate legacy sessions silently: this marker also selects native
 * development, reserve transfer and annual tax instead of old preview rules. */
export function beginDomesticYear(s:Session,scene:ScenarioDefinition,items:readonly Record<string,string>[]=[]):boolean {
  if(!s.policy||s.policy.year>=scene.year+Math.floor(s.day/360))return false;
  s.policy.year=scene.year+Math.floor(s.day/360);s.policy.active=true;s.policy.acted=[];
  refreshPolicyGovernors(s,scene);
  runAnnualDomesticAI(s,scene,items);
  for(const def of scene.cities)s.cities[def.id].money+=nativeAnnualRevenue(s.cities[def.id].population,def.nativeFlags===2);
  return true;
}
export function executeDomestic(s:Session,scene:ScenarioDefinition,command:DomesticCommand,items:readonly Record<string,string>[]=[]):string {
  if(command.type==='policy-enable') {
    if(s.policy)throw new Error('此局已启用年度内政。');
    s.policy=createDomesticState(s,scene,items);
    ensureDomesticAnnual(s,scene);
    return '已启用年度内政，现有资源、兵员和进度已保留。';
  }
  const p=s.policy;if(!p)throw new Error('请先启用年度内政。');
  if(command.type==='policy-finish') {
    if(!p.active)throw new Error('本年内政已经结束。');
    p.active=false;return `${p.year}年内政終了，返回征战。`;
  }
  if(command.type==='policy-autonomy-run') {
    if(!p.active)throw new Error('本年内政已经结束，下一年度可再执行。');
    if(!s.nativeAI)throw new Error('当前缺少征战状态。');
    const search=ensureDomesticSearch(s,scene,items);
    if(!scene.cities.some(c=>s.cities[c.id].ownerId===s.factionId&&search.autonomy[c.id]!==0))throw new Error('请先为城池设置自治方针。');
    const count=runDomesticAutonomy(s,scene,items);return `自治施行完毕，共${count}将执行开发或搜索。`;
  }
  const city=s.cities[command.cityId],def=scene.cities.find(c=>c.id===command.cityId);
  if(!city||!def||city.ownerId!==s.factionId)throw new Error('只能在我方城池执行此命令。');
  const ids=stationed(s,command.cityId);
  if(command.type==='policy-autonomy-set') {
    if(!p.active)throw new Error('本年内政已经结束，下一年度可再执行。');
    if(!Number.isInteger(command.mode)||command.mode<0||command.mode>4)throw new Error('自治方针无效。');
    ensureDomesticSearch(s,scene,items).autonomy[command.cityId]=command.mode;
    return `${def.name}自治方针已保存。`;
  }
  if(!ids.length)throw new Error('城中须有我方在任武将。');
  if(command.type==='policy-item') {
    if(!ids.includes(command.generalId))throw new Error('请选择本城在任武将。');
    const officer=scene.generals.find(g=>g.id===command.generalId)!,search=ensureDomesticSearch(s,scene,items);
    const preview=previewPlayerItem(s.generals[officer.id],officer,items,search.inventory[s.factionId],scene.factions.find(f=>f.id===s.factionId)?.leaderId===officer.id,command.itemId);
    if(preview.reason)throw new Error(preview.reason);
    Object.assign(s.generals[officer.id],preview.after);search.inventory[s.factionId]=preview.inventory;
    const name=(id:number)=>items.find(i=>Number(i.SEQUENCE)===id)?.NAME??String(id);
    return command.itemId===0?`${officer.name}卸下${name(preview.returnedId)}，已归还物品库。`:
      `${officer.name}${preview.consumable?'使用':'装备'}${name(command.itemId)}。${preview.returnedId?`${name(preview.returnedId)}已归还物品库。`:''}`;
  }
  if(command.type==='policy-unit') {
    if(!ids.includes(command.generalId))throw new Error('请选择本城在任武将。');
    if(!nativeForceNames.includes(command.unit as typeof nativeForceNames[number]))throw new Error('兵种无效。');
    const officer=scene.generals.find(g=>g.id===command.generalId)!;
    const index=nativeForceNames.indexOf(command.unit as typeof nativeForceNames[number]);
    if((officerForceMask(s.generals[officer.id],officer)&(1<<index))===0)throw new Error('该兵种尚未学会。');
    // Original choice callback 0x41719C, event 4: learned +135 gates the sole
    // write to current force +139. No soldier conversion, resource cost or RNG.
    s.generals[officer.id].currentUnit=command.unit;
    return `${officer.name}当前兵种已切换为${command.unit}。`;
  }
  if(command.type==='policy-recruit'||command.type==='policy-troops'||command.type==='policy-troops-fill') {
    if(!ids.includes(command.generalId))throw new Error('请选择本城在任武将。');
    const g=s.generals[command.generalId],officer=scene.generals.find(g=>g.id===command.generalId)!;
    const level=officerLevel(g,officer),cap=nativeTroopCapacity(level),maximum=Math.max(0,cap.active)+cap.reserve;
    if(!s.nativeAI)throw new Error('当前缺少征战状态。');
    const slots=allocateBattleTroops(g.troops,level,g.troopSlots);
    if(command.type==='policy-recruit') {
      if(!Number.isInteger(command.amount)||command.amount<1||command.amount>maximum-g.troops)throw new Error('配兵数量超出武将统兵上限。');
      if(command.amount>s.nativeAI.reserves[command.cityId])throw new Error('城中预备兵不足，请等待城内征募。');
    } else if(command.type==='policy-troops-fill') {
      if(command.mode!=='step'&&command.mode!=='finish')throw new Error('自动配兵模式无效。');
    } else if(!Number.isInteger(command.target)||command.target<0||command.target>maximum)throw new Error('目标兵数超出武将统兵上限。');
    const target=command.type==='policy-recruit'?slots.active+slots.reserve+command.amount:command.type==='policy-troops'?command.target:maximum;
    const input={...slots,maxActive:Math.max(0,cap.active),maxReserve:cap.reserve,
      pool:s.nativeAI.reserves[command.cityId],poolCapacity:nativeReserveCapacity(city.population)};
    const after=command.type==='policy-troops-fill'?nativeAutofillTroops(input,1,command.mode==='step'?8:'flush'):nativeTransferTroops(input,target);
    const delta=after.active+after.reserve-slots.active-slots.reserve;
    g.troopSlots={active:after.active,reserve:after.reserve};
    g.troops+=delta;city.troops+=delta;s.nativeAI.reserves[command.cityId]=after.pool;
    return command.type==='policy-recruit'?`${def.name}为${officer.name}补充${delta}兵，取自城内预备池。`:
      `${officer.name}兵力已调整：现役${after.active}、预备${after.reserve}，城内预备池${after.pool}。${command.type!=='policy-troops-fill'&&after.active+after.reserve!==target?'受兵槽或预备池限制，已调整到可达到的人数。':''}`;
  }
  if(!p.active)throw new Error('本年内政已经结束，下一年度可再执行。');
  if(command.type==='policy-governor') {
    if(!ids.includes(command.generalId))throw new Error('太守必须是本城在任武将。');
    p.governors[command.cityId]=command.generalId;
    return `${def.name}任命${scene.generals.find(g=>g.id===command.generalId)!.name}为太守。`;
  }
  if(!Array.isArray(command.generalIds)||!command.generalIds.length||new Set(command.generalIds).size!==command.generalIds.length||command.generalIds.some(id=>!ids.includes(id)))throw new Error('请选择本城尚未行动的武将。');
  if(command.generalIds.some(id=>p.acted.includes(id)))throw new Error('所选武将本轮已行动，请选择尚未行动的武将。');
  if(command.type==='policy-search') {
    if(!s.nativeAI)throw new Error('当前缺少征战状态。');
    const order=ensureDomesticSearch(s,scene,items).residentOrder[command.cityId].filter(id=>command.generalIds.includes(id));
    const messages=order.map(id=>domesticSearchMessage(searchDomesticOfficer(s,scene,command.cityId,id,items),scene,items));
    return messages.length<=3?messages.join(' '):`${def.name}${messages.length}将完成搜索，详见搜索报告。`;
  }
  const governor=policyGovernorId(s,scene,command.cityId);
  if(!governor||!s.nativeAI)throw new Error('当前城池缺少太守或征战状态。');
  let people=0,wall=0;
  // The original city list uses head insertion (0x4056B7). Normalize click
  // selection to that order, including officers joined during this council.
  for(const id of ensureDomesticSearch(s,scene,items).residentOrder[command.cityId].filter(id=>command.generalIds.includes(id))) {
    const result=developDomesticOfficer(s,scene,command.cityId,id);people+=result.population;wall+=result.defense;
  }
  return `${def.name}${command.generalIds.length}将完成开发：人口增加${people}，城防增加${wall}。`;
}
