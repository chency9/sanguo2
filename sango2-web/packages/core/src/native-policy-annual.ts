/** The four annual AI passes at 0x402711, in native call order. */
import type {ScenarioDefinition} from '@sango2/content';
import type {Session} from './index';
import {nativeBelow,nativeRandom,type NativeRandomState} from './native-strategic-ai';
import {applyOfficerExperience,officerExperience} from './native-progression';
import {materializeOfficer,officerStrength,officerIntelligence,unloadOfficerEquipment} from './native-officer-runtime';
import {nativeAnnualInventory,nativeItemTable} from './native-items';
import {developDomesticOfficer,searchDomesticOfficer,ensureDomesticSearch} from './native-policy-actions';

export interface AnnualOfficer {id:string;experience:number}
export function annualOfficerOrder<T extends AnnualOfficer>(officers:readonly T[],leader:string|null,sorted=false):T[] {
  const order=sorted?officers.toSorted((a,b)=>(b.experience|0)-(a.experience|0)):Array.from(officers);
  const at=order.findIndex(g=>g.id===leader);if(at>0)order.unshift(...order.splice(at,1));return order;
}
/** 0x402004: action effects consume RNG between successive officers. */
export function nativeAnnualActions(officers:readonly {id:string;stationed:boolean;strength:number;intelligence:number}[],rng:NativeRandomState,run:(id:string,action:'search'|'develop')=>void) {
  for(const g of officers) {
    if(!g.stationed)continue;
    const action=g.strength>=0?(g.intelligence>=0?2-(nativeRandom(rng)&1):1):(g.intelligence>=0?2:0);
    if(action)run(g.id,action===1?'search':'develop');
  }
}
/** 0x402128 uses a separate cumulative battle-EXP field, not roster EXP.
 * Every IMUL wraps before its following signed/unsigned division. */
export function nativeAnnualCatchup(officers:readonly AnnualOfficer[],playerCount:number,playerBattleExperience:number,ownBattleExperience:number,rng:NativeRandomState,award:(id:string,experience:number)=>void) {
  if(!playerCount||!officers.length)return;
  const base=Math.trunc(Math.imul(officers.length,playerBattleExperience)/playerCount);
  const target=(Math.trunc((Math.imul(base,nativeBelow(rng,35)+100)>>>0)/100))|0;
  if((ownBattleExperience|0)>=target)return;
  const each=Math.trunc(((target-ownBattleExperience)|0)/officers.length);
  for(const g of officers) {
    const extra=Math.trunc((Math.imul(each,nativeBelow(rng,40)+80)>>>0)/100);
    award(g.id,(g.experience+extra)>>>0);
  }
}
/** 0x40221F: EXP sort first, then move the ruler to slot zero, then sample. */
export function nativeAnnualBalance(officers:readonly AnnualOfficer[],player:readonly AnnualOfficer[],leader:string|null,award:(id:string,experience:number)=>void) {
  if(!player.length)return; // Web boundary: native would dereference a null list.
  const ranked=annualOfficerOrder(player,leader,true),count=Math.min(10,Math.max(1,Math.trunc(player.length/2)));
  const average=Math.trunc(ranked.slice(0,count).reduce((total,g)=>(total+g.experience)|0,0)/count);
  for(const g of officers)if((g.experience|0)<average)award(g.id,(g.experience+Math.trunc(((average-(g.experience|0))|0)/2))>>>0);
}
export interface AnnualAIReport {year:number;factionId:string;searches:number;developments:number;recruits:number;levels:number;items:number}
export interface DomesticAnnualState {
  version:1;rosterOrder:Record<string,string[]>;
  /** 0x4091C0 zeroes +44; 0x40FA92 adds awarded battle EXP. It is not recomputed. */
  battleExperience:Record<string,number>;reports:AnnualAIReport[];
}
export function ensureDomesticAnnual(s:Session,scene:ScenarioDefinition):DomesticAnnualState {
  const state=s.policy!.annual??(s.policy!.annual={version:1,rosterOrder:{},battleExperience:Object.fromEntries(scene.factions.map(f=>[f.id,0])),reports:[]});
  for(const f of scene.factions) {
    const current=scene.generals.filter(d=>s.generals[d.id].ownerId===f.id).map(d=>d.id),old=state.rosterOrder[f.id]??[];
    state.rosterOrder[f.id]=[...current.filter(id=>!old.includes(id)).reverse(),...old.filter(id=>current.includes(id))];
  }
  return state;
}
export function runAnnualDomesticAI(s:Session,scene:ScenarioDefinition,items:readonly Record<string,string>[]) {
  if(!s.nativeAI||!s.policy)return;
  const state=ensureDomesticAnnual(s,scene),search=ensureDomesticSearch(s,scene,items),rng=s.nativeAI.rng,defs=new Map(scene.generals.map(g=>[g.id,g]));
  const roster=(owner:string)=>state.rosterOrder[owner].filter(id=>s.generals[id].status==='登')
    .map(id=>({id,experience:officerExperience(s.generals[id],defs.get(id)!)}));
  for(const f of scene.factions) {
    // 0x4237A6 / 0x40975E tests that the designated leader still owns this faction.
    if(f.id===s.factionId||!f.leaderId||s.generals[f.leaderId]?.ownerId!==f.id)continue;
    const report:AnnualAIReport={year:s.policy.year,factionId:f.id,searches:0,developments:0,recruits:0,levels:0,items:0};
    const snapshot=annualOfficerOrder(roster(f.id),f.leaderId);
    nativeAnnualActions(snapshot.map(({id})=>({id,stationed:!!s.generals[id].cityId&&!s.generals[id].armyId,
      strength:officerStrength(s.generals[id],defs.get(id)!),intelligence:officerIntelligence(s.generals[id],defs.get(id)!)})),rng,(id,action)=>{
      const city=s.generals[id].cityId!;
      if(action==='develop'){developDomesticOfficer(s,scene,city,id,false);report.developments++;}
      else {
        const result=searchDomesticOfficer(s,scene,city,id,items,false);report.searches++;
        if(result.kind==='officer'&&(result.code===16||result.code===17)) {report.recruits++;report.levels+=result.levels??0;}
      }
    });
    // Search can prepend newly recruited officers. They participate in the next
    // three passes, but not the fixed action list above.
    ensureDomesticAnnual(s,scene);
    const award=(id:string,experience:number)=>{const g=s.generals[id],before=g.troops;
      report.levels+=applyOfficerExperience(g,defs.get(id)!,experience);
      if(g.cityId&&!g.armyId)s.cities[g.cityId].troops+=g.troops-before;
      if(g.armyId){const army=s.armies.find(a=>a.id===g.armyId);if(army)army.troops+=g.troops-before;}
    };
    nativeAnnualCatchup(roster(f.id),roster(s.factionId).length,state.battleExperience[s.factionId],state.battleExperience[f.id],rng,award);
    nativeAnnualBalance(roster(f.id),roster(s.factionId),scene.factions.find(f=>f.id===s.factionId)?.leaderId??null,award);
    report.items=nativeAnnualInventory(annualOfficerOrder(roster(f.id),f.leaderId,true).map(({id})=>({id,state:materializeOfficer(s.generals[id],defs.get(id)!,items),ruler:id===f.leaderId})),search.inventory[f.id],nativeItemTable(items),rng,unloadOfficerEquipment).length;
    state.reports.unshift(report);state.reports.length=Math.min(100,state.reports.length);
  }
}
