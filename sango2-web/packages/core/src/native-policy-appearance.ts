/** Campaign adapter for the annual appearance pass. These are POS/BLOOD
 * transitions, not a substitute for the separate historical System.SO events. */
import type {ScenarioDefinition} from '@sango2/content';
import type {Session} from './index';
import {runNativeAnnualAppearance,type NativeAppearanceWorld,type NativeAppearanceEvent} from './native-officer-appearance';
import {nativeCityCapacity} from './native-ai-campaign';
import {ensureDomesticAnnual} from './native-policy-annual';
import {ensureDomesticSearch} from './native-policy-actions';
import {nativeRecruitExperience} from './native-policy-search';
import {applyRecruitExperience,officerExperience} from './native-progression';

export function runAnnualOfficerAppearances(s:Session,scene:ScenarioDefinition,items:readonly Record<string,string>[]=[]):NativeAppearanceEvent[] {
  // Legacy data/saves have no source schedule or no shared native RNG. Preserve
  // those saves rather than inventing an appearance schedule or random stream.
  if(!s.policy||!s.nativeAI||!scene.generals.some(g=>g.appearanceCities))return [];
  const annual=ensureDomesticAnnual(s,scene),search=ensureDomesticSearch(s,scene,items),defs=new Map(scene.generals.map(g=>[g.id,g]));
  const world:NativeAppearanceWorld={
    // 0x4068EB appends initial officers, so global iteration uses source order.
    officers:scene.generals.map(def=>{const g=s.generals[def.id];return {id:def.id,
      status:g.status==='登'?1:g.status==='死'||g.appearanceHidden||!def.appearanceCities?4096:g.status==='野'?8:8192,
      cityId:g.cityId,ownerId:g.ownerId,relativeId:def.relativeId??null,locations:def.appearanceCities??[]};}),
    cities:scene.cities.map(def=>({id:def.id,ownerId:s.cities[def.id].ownerId,capacity:nativeCityCapacity(s.cities[def.id].population),hidden:def.nativeFlags===1,
      officerCount:scene.generals.filter(g=>{const state=s.generals[g.id];return state.status==='登'&&!state.armyId&&state.cityId===def.id&&state.ownerId===s.cities[def.id].ownerId;}).length})),
    factions:scene.factions.map(f=>{
      const current=scene.cities.filter(c=>s.cities[c.id].ownerId===f.id).map(c=>c.id),old=s.nativeAI!.cityOrder[f.id]??[];
      return {id:f.id,leaderId:f.leaderId,cityOrder:[...current.filter(id=>!old.includes(id)).reverse(),...old.filter(id=>current.includes(id))]};
    }),playerFactionId:s.factionId,
  };
  return runNativeAnnualAppearance(s.policy.year,world,s.nativeAI.rng,event=>{
    const g=s.generals[event.officerId],def=defs.get(event.officerId)!;
    Object.assign(g,{cityId:event.cityId,ownerId:event.ownerId,armyId:null,status:event.kind==='family'?'登':event.kind==='appear'?'野':'未'});
    if(event.kind==='disappear')g.appearanceHidden=true;
    else delete g.appearanceHidden;
    if(event.kind!=='family')return;
    if(g.ownerId)annual.rosterOrder[g.ownerId]=[def.id,...(annual.rosterOrder[g.ownerId]??[]).filter(id=>id!==def.id)];
    search.residentOrder[event.cityId!]=[def.id,...search.residentOrder[event.cityId!].filter(id=>id!==def.id)];
    if(!s.policy!.acted.includes(def.id))s.policy!.acted.push(def.id);
    // The new officer already belongs to the faction when 0x426B44 computes
    // the player's top-third EXP. Growth draws must precede the next officer.
    const roster=(annual.rosterOrder[s.factionId]??[]).filter(id=>s.generals[id].ownerId===s.factionId&&s.generals[id].status==='登')
      .map(id=>({id,experience:officerExperience(s.generals[id],defs.get(id)!)}));
    const experience=nativeRecruitExperience(roster,scene.factions.find(f=>f.id===s.factionId)?.leaderId??null,s.nativeAI!.rng);
    applyRecruitExperience(g,def,experience);s.cities[event.cityId!].troops+=g.troops;
    if(event.notify) {
      const relative=defs.get(event.relativeId!)!,city=scene.cities.find(c=>c.id===event.cityId)!;
      s.chronicle.unshift({id:s.nextId++,day:s.day,kind:'info',text:`${s.policy!.year}年，${def.name}前来投奔${relative.name}，已于${city.name}加入我方。`});
      s.chronicle.length=Math.min(100,s.chronicle.length);
    }
  });
}
