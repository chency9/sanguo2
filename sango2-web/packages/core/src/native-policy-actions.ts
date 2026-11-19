import type {ScenarioDefinition} from '@sango2/content';
import type {Session} from './index';
import {nativeAutonomy,nativeRecruitDisposition,nativeRecruitExperience,nativeSearchItem,nativeSearchRoute,type AutonomyMode,type SearchItem,type RecruitmentCode} from './native-policy-search';
import {nativeDevelop,policyGovernorId} from './native-policy';
import {applyRecruitExperience,officerExperience,officerLevel} from './native-progression';
import {officerStrength,officerIntelligence} from './native-officer-runtime';
import {nativeCityCapacity} from './native-ai-campaign';
import {ensureDomesticAnnual} from './native-policy-annual';

export interface SearchReport {year:number;cityId:string;generalId:string;kind:'none'|'item'|'officer';itemId?:number;candidateId?:string;code?:RecruitmentCode;levels?:number}
export interface DomesticSearchState {
  version:1;inventory:Record<string,Record<string,number>>;found:number[];
  autonomy:Record<string,AutonomyMode>;reports:SearchReport[];
  residentOrder:Record<string,string[]>;
}
export function searchItemTable(items:readonly Record<string,string>[]):SearchItem[] {
  const numeric=(value:string|undefined,fallback=0)=>value?.trim()&&Number.isFinite(Number(value))?Number(value):fallback;
  return items.map(item=>({id:numeric(item.SEQUENCE),flags:(item.ATTRIB??'').includes('ONLYONE')?2:(item.ATTRIB??'').includes('USED')?1:0,
    searchType:numeric(item.SEARCHTYPE),rate:numeric(item.RATE,100),level:numeric(item.LEVEL,1)})).filter(item=>item.id>0&&item.id<128);
}
const residents=(s:Session,id:string)=>Object.keys(s.generals).filter(key=>{const g=s.generals[key];return g.cityId===id&&!g.armyId&&g.status==='登'&&g.ownerId===s.cities[id].ownerId;});
export function createDomesticSearch(s:Session,scene:ScenarioDefinition,items:readonly Record<string,string>[]):DomesticSearchState {
  const names=new Map(items.map(item=>[item.NAME,Number(item.SEQUENCE)]));
  // 0x42D05D / 0x42D100 / 0x42CFBA mark even level-gated equipment as found.
  const found=[...new Set(scene.generals.flatMap(g=>[g.weapon,g.horse,g.item].map(name=>names.get(name)).filter((id):id is number=>id!==undefined&&id>0&&id<128)))].sort((a,b)=>a-b);
  return {version:1,inventory:Object.fromEntries(scene.factions.map(f=>[f.id,{}])),found,
    autonomy:Object.fromEntries(scene.cities.map(c=>[c.id,0])),reports:[],
    residentOrder:Object.fromEntries(scene.cities.map(c=>[c.id,residents(s,c.id).reverse()]))};
}
export function ensureDomesticSearch(s:Session,scene:ScenarioDefinition,items:readonly Record<string,string>[]):DomesticSearchState {
  const state=s.policy!.search??(s.policy!.search=createDomesticSearch(s,scene,items));
  for(const city of scene.cities) {
    const current=residents(s,city.id),previous=state.residentOrder[city.id];
    // Reconcile campaign movement; explicit joins below preserve original head insertion.
    state.residentOrder[city.id]=[...current.filter(id=>!previous.includes(id)).reverse(),...previous.filter(id=>current.includes(id))];
  }
  return state;
}
export function developDomesticOfficer(s:Session,scene:ScenarioDefinition,cityId:string,id:string,publish=true) {
  const city=s.cities[cityId],def=scene.cities.find(c=>c.id===cityId)!,actor=scene.generals.find(g=>g.id===id)!;
  const governor=policyGovernorId(s,scene,cityId);if(!governor||!s.nativeAI)throw new Error('当前城池缺少太守或征战状态。');
  const result=nativeDevelop({population:city.population,defense:city.defense,isPass:def.nativeFlags===2,
    strength:officerStrength(s.generals[id],actor),intelligence:officerIntelligence(s.generals[id],actor),
    governorIntelligence:officerIntelligence(s.generals[governor],scene.generals.find(g=>g.id===governor)!)},s.nativeAI.rng);
  const population=result.population-city.population,defense=result.defense-city.defense;
  city.population=result.population;city.defense=result.defense;
  if(publish) {
    s.policy!.results.unshift({year:s.policy!.year,cityId,generalId:id,population,defense,reportedPopulation:result.reportedPopulation,reportedDefense:result.reportedDefense});
    s.policy!.results.length=Math.min(100,s.policy!.results.length);
    if(!s.policy!.acted.includes(id))s.policy!.acted.push(id);
  }
  return {population,defense};
}
export function searchDomesticOfficer(s:Session,scene:ScenarioDefinition,cityId:string,id:string,items:readonly Record<string,string>[],publish=true):SearchReport {
  const p=s.policy!,state=ensureDomesticSearch(s,scene,items),rng=s.nativeAI!.rng,actor=scene.generals.find(g=>g.id===id)!;
  // 0x4010C6 accepts every affiliation; hidden cities (FLAGS==1) are skipped.
  // Long/restricted paths remain neighbors for searching in the original.
  const neighbors=scene.roads.filter(r=>r.from===cityId||r.to===cityId).map(r=>r.from===cityId?r.to:r.from)
    .filter(next=>scene.cities.find(c=>c.id===next)?.nativeFlags!==1).slice(0,9);
  const wild=Object.fromEntries([cityId,...neighbors].map(city=>[city,scene.generals.filter(g=>s.generals[g.id].cityId===city&&s.generals[g.id].status==='野').map(g=>g.id)]));
  const route=nativeSearchRoute({home:cityId,category:scene.cities.find(c=>c.id===cityId)?.searchCategory??3,neighbors,wild},rng);
  const report:SearchReport={year:p.year,cityId,generalId:id,kind:'none'};
  if(route.kind==='item') {
    const item=nativeSearchItem(searchItemTable(items),state.found,officerLevel(s.generals[id],actor),rng);
    if(item>=0&&!state.found.includes(item))state.found.push(item);
    if(item>0) {
      const inventory=state.inventory[s.generals[id].ownerId!]!;
      inventory[String(item)]=Math.min(99,(inventory[String(item)]??0)+1);
      Object.assign(report,{kind:'item',itemId:item});
    }
  } else if(route.kind==='officer') {
    const candidate=scene.generals.find(g=>g.id===route.generalId)!,g=s.generals[candidate.id],owner=s.generals[id].ownerId!;
    const loyal=candidate.loyalFactionId??null,leader=scene.factions.find(f=>f.id===loyal)?.leaderId;
    const code=nativeRecruitDisposition(owner,loyal,leader?s.generals[leader].ownerId:null,officerIntelligence(g,candidate),rng);
    Object.assign(report,{kind:'officer',candidateId:candidate.id,code});
    if(code===16||code===17) {
      // 0x4230ED relocates AI recruits from a full city to the first owned,
      // visible city with room; if all are full, the source city still accepts.
      const target=owner!==s.factionId&&residents(s,cityId).length>=nativeCityCapacity(s.cities[cityId].population)?
        scene.cities.find(c=>c.nativeFlags!==1&&s.cities[c.id].ownerId===owner&&residents(s,c.id).length<nativeCityCapacity(s.cities[c.id].population))?.id??cityId:cityId;
      Object.assign(g,{ownerId:owner,cityId:target,armyId:null,status:'登'});
      state.residentOrder[target].unshift(candidate.id);
      const annual=ensureDomesticAnnual(s,scene);
      annual.rosterOrder[owner]=[candidate.id,...annual.rosterOrder[owner].filter(id=>id!==candidate.id)];
      // 0x406F3F marks a newly joined officer as already used this year.
      if(!p.acted.includes(candidate.id))p.acted.push(candidate.id);
      const roster=scene.generals.filter(d=>s.generals[d.id].ownerId===s.factionId&&s.generals[d.id].status==='登')
        .map(d=>({id:d.id,experience:officerExperience(s.generals[d.id],d)}));
      const experience=nativeRecruitExperience(roster,scene.factions.find(f=>f.id===s.factionId)?.leaderId??null,rng);
      report.levels=applyRecruitExperience(g,candidate,experience);
      s.cities[target].troops+=g.troops;
    }
  }
  if(publish) {
    if(!p.acted.includes(id))p.acted.push(id);
    state.reports.unshift(report);state.reports.length=Math.min(100,state.reports.length);
  }
  return report;
}
export function domesticSearchMessage(report:SearchReport,scene:ScenarioDefinition,items:readonly Record<string,string>[]):string {
  const actor=scene.generals.find(g=>g.id===report.generalId)!.name;
  if(report.kind==='item')return `${actor}搜索得到${items.find(i=>Number(i.SEQUENCE)===report.itemId)?.NAME??'物品'}，已收入物品库。`;
  if(report.kind==='officer') {
    const name=scene.generals.find(g=>g.id===report.candidateId)!.name;
    if(report.code===19)return `${actor}寻得${name}，但其情义君主仍在位，未能登用。`;
    if(report.code===18)return `${actor}寻得${name}，但其拒绝出仕。`;
    return `${actor}寻得${name}，${report.code===17?'故主相逢，':''}现已加入我方${report.levels?`，提升${report.levels}级`:''}。`;
  }
  return `${actor}此次搜索未有发现。`;
}
export function runDomesticAutonomy(s:Session,scene:ScenarioDefinition,items:readonly Record<string,string>[]):number {
  const state=ensureDomesticSearch(s,scene,items),acted=new Set(s.policy!.acted);
  const initial=s.nativeAI!.cityOrder[s.factionId],owned=scene.cities.filter(c=>s.cities[c.id].ownerId===s.factionId).map(c=>c.id);
  const order=[...owned.filter(id=>!initial.includes(id)).reverse(),...initial.filter(id=>owned.includes(id))];
  const count=nativeAutonomy(order.map(id=>({id,mode:state.autonomy[id],officers:[...state.residentOrder[id]]})),acted,s.nativeAI!.rng,(city,id,action)=>{
    if(action==='develop')developDomesticOfficer(s,scene,city,id);else searchDomesticOfficer(s,scene,city,id,items);
    for(const used of s.policy!.acted)acted.add(used);
  });
  s.policy!.acted=[...acted];return count;
}
