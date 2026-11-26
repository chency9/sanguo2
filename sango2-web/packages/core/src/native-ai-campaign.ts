/** Adapts the native decision kernel to the existing Web campaign.
 * It does not claim native movement, battle resolution or initial troop parity.
 */
import type {ScenarioDefinition} from '@sango2/content';
import type {Session,Command} from './index';
import {allocateBattleTroops,nativeTroopCapacity,nativeReserveCapacity} from './native-troops';
import {initialOfficerCondition,initialConditionTimers,nativeRecoverCondition,type NativeConditionTimers} from './native-officer-condition';
import {policyGovernorId} from './native-policy';
import {officerLevel,officerMaxHp,officerMaxMp} from './native-progression';
import {officerIntelligence,officerStrength} from './native-officer-runtime';
import {nativeStrategyDecision,nativeOfficerReady,nativeCanDispatch,nativeShuffle,nativeBelow,nativeNextDecisionCountdown,
  type NativeRandomState,type NativeOfficerReadiness,type NativeStrategySnapshot,type NativeCandidate} from './native-strategic-ai';

export interface NativeCampaignAI {
  version:1;rng:NativeRandomState;callbacks:number;countdowns:Record<string,number>;
  /** Head insertion order matters to weighted choice and shuffle consumption. */
  cityOrder:Record<string,string[]>;seen:Record<string,string[]>;
  reserves:Record<string,number>;recruitTimers:Record<string,number>;
  recovery:Record<string,{hp:number;mp:number}&Partial<NativeConditionTimers>>;
  trace:{callback:number;owner:string;kind:number;from:string|null;to:string|null;candidates:number;unresolvedCooperationReads:number}[];
}
export function createNativeCampaignAI(s:Session,scene:ScenarioDefinition):NativeCampaignAI {
  return {version:1,rng:[s.rng>>>0,0x87654321],callbacks:0,
    countdowns:Object.fromEntries(scene.factions.map(f=>[f.id,f.flagNumber??0])),
    cityOrder:Object.fromEntries(scene.factions.map(f=>[f.id,scene.cities.filter(c=>s.cities[c.id].ownerId===f.id).map(c=>c.id).reverse()])),
    seen:Object.fromEntries(scene.factions.map(f=>[f.id,[]])),
    reserves:Object.fromEntries(scene.cities.map(c=>[c.id,0])),recruitTimers:Object.fromEntries(scene.cities.map(c=>[c.id,0])),
    recovery:Object.fromEntries(scene.generals.map(g=>[g.id,{hp:0,mp:0,...initialConditionTimers()}])),trace:[]};
}
const roster=(s:Session,city:string)=>Object.keys(s.generals).filter(id=>{const g=s.generals[id];return g.cityId===city&&!g.armyId&&g.ownerId===s.cities[city].ownerId&&g.status==='登';}).reverse();
export function nativeReadiness(s:Session,scene:ScenarioDefinition,id:string):NativeOfficerReadiness {
  const g=s.generals[id],def=scene.generals.find(g=>g.id===id)!;
  const level=officerLevel(g,def),cap=nativeTroopCapacity(level),slots=allocateBattleTroops(g.troops,level,g.troopSlots);
  return {hp:g.hp,maxHp:officerMaxHp(g,def),mp:g.mp,maxMp:officerMaxMp(g,def),troops:slots.active,maxTroops:Math.max(0,cap.active),
    reserve:slots.reserve,maxReserve:cap.reserve};
}
export function nativeCityCapacity(population:number):number {
  return Math.min(15,Math.max(5,population<=30000?5:Math.trunc((population-30000)/70000)+6));
}
function snapshot(s:Session,scene:ScenarioDefinition,owner:string):{input:NativeStrategySnapshot;ids:string[]} {
  const state=s.nativeAI!,order=state.cityOrder[owner];
  // Web saves can retain an owned city with no governor; native ownership lists cannot.
  // Omit such cities from the actor's decision traversal to avoid native divide-by-zero.
  const current=scene.cities.filter(c=>s.cities[c.id].ownerId===owner&&roster(s,c.id).length>0).map(c=>c.id);
  state.cityOrder[owner]=[...current.filter(id=>!order.includes(id)).reverse(),...order.filter(id=>current.includes(id))];
  const ids=[...state.cityOrder[owner],...scene.cities.map(c=>c.id).filter(id=>!current.includes(id))];
  const neighbors=(id:string)=>scene.roads.filter(r=>!r.restricted&&(r.from===id||r.to===id)).map(r=>r.from===id?r.to:r.from);
  // 0x409DC8 accumulates visited adjacency bits. Web restricted routes remain excluded.
  const visible=new Set(state.seen[owner]);
  for(const id of current)for(const next of neighbors(id))visible.add(next);
  state.seen[owner]=[...visible];
  const input:NativeStrategySnapshot={profile:scene.factions.find(f=>f.id===owner)!.aiType??2,rng:[...state.rng],cities:ids.map(id=>{
    const c=s.cities[id],def=scene.cities.find(c=>c.id===id)!,gs=roster(s,id);
    return {owner:c.ownerId===owner?(gs.length?'ai':null):c.ownerId===s.factionId?'player':c.ownerId?'rival':null,visible:visible.has(id),
      capacity:nativeCityCapacity(c.population),money:c.money,kind:def.nativeFlags??0,
      hasGovernor:gs.length>0,generals:gs.map(g=>nativeReadiness(s,scene,g)),neighbors:neighbors(id).map(id=>ids.indexOf(id))};
  })};
  return {input,ids};
}

type March=Extract<Command,{type:'march'}>;
export interface NativeMarchPlan {command:March;money:number}
/** 0x40CE14 / 0x40D03E / 0x40D299 officer shuffle and money carried. */
export function nativeMarchPlan(s:Session,scene:ScenarioDefinition,owner:string,row:NativeCandidate,ids:string[],second=false):NativeMarchPlan|null {
  const state=s.nativeAI!,kind=row[0],from=ids[second?row[3]:row[1]],to=ids[row[2]],count=row[second?5:4];
  if(!from||!to||count<=0)return null;
  const profile=scene.factions.find(f=>f.id===owner)!.aiType??2;
  const all=roster(s,from),eligible=all.filter(id=>kind===9||nativeOfficerReady(nativeReadiness(s,scene,id),profile));
  nativeShuffle(eligible,state.rng);
  // Web safety boundary for a joint plan invalidated by its first dispatched army.
  if(count>eligible.length)return null;
  const selected=eligible.slice(0,count),governor=s.policy?policyGovernorId(s,scene,from):scene.cities.find(c=>c.id===from)!.governorId;
  const gov=selected.indexOf(governor??'');
  if(gov>=0)[selected[0],selected[gov]]=[selected[gov],selected[0]];
  else if(![3,9].includes(kind))for(let i=1;i<selected.length;i++) {
    if(officerIntelligence(s.generals[selected[i]],scene.generals.find(g=>g.id===selected[i])!)>officerIntelligence(s.generals[selected[0]],scene.generals.find(g=>g.id===selected[0])!))[selected[0],selected[i]]=[selected[i],selected[0]];
  }
  const isPass=scene.cities.find(c=>c.id===from)!.nativeFlags===2;
  const money=isPass&&kind!==3?s.cities[from].money:Math.trunc(s.cities[from].money*(nativeBelow(state.rng,[3,9].includes(kind)?10:30)+([3,9].includes(kind)?5:10))/100);
  const troopsByGeneral=Object.fromEntries(selected.map(id=>[id,s.generals[id].troops]));
  const troops=Object.values(troopsByGeneral).reduce((a,b)=>a+b,0);
  if(troops<1||selected.some(id=>s.generals[id].hp<=0))return null;
  return {command:{type:'march',from,to,generalIds:selected,troops,troopsByGeneral},money};
}

/** 0x401910 fills present and reserve troop slots from city's recruit pool. */
function replenish(s:Session,scene:ScenarioDefinition,owner:string) {
  const ordered=scene.generals.filter(g=>s.generals[g.id].ownerId===owner&&s.generals[g.id].status==='登')
    .sort((a,b)=>officerStrength(s.generals[b.id],b)-officerStrength(s.generals[a.id],a));
  const ruler=scene.factions.find(f=>f.id===owner)!.leaderId,index=ordered.findIndex(g=>g.id===ruler);
  if(index>0)ordered.unshift(...ordered.splice(index,1));
  for(const def of ordered) {
    const g=s.generals[def.id];if(!g.cityId||g.armyId)continue;
    const ready=nativeReadiness(s,scene,def.id),missing=Math.max(0,ready.maxTroops+ready.maxReserve-g.troops);
    const amount=Math.min(missing,s.nativeAI!.reserves[g.cityId]);
    if(g.troopSlots&&amount>0) {
      const active=Math.min(amount,ready.maxTroops-ready.troops);
      g.troopSlots={active:ready.troops+active,reserve:ready.reserve+amount-active};
    }
    s.nativeAI!.reserves[g.cityId]-=amount;g.troops+=amount;s.cities[g.cityId].troops+=amount;
  }
}
/** One native strategic callback. Caller chooses Web calendar pacing explicitly. */
export function runNativeStrategicCallback(s:Session,scene:ScenarioDefinition,execute:(plan:NativeMarchPlan,owner:string)=>void):void {
  const state=s.nativeAI??(s.nativeAI=createNativeCampaignAI(s,scene));state.callbacks++;
  for(const faction of scene.factions) {
    if(faction.id===s.factionId||faction.special||!Object.values(s.cities).some(c=>c.ownerId===faction.id))continue;
    if(s.captureRules&&faction.leaderId&&s.generals[faction.leaderId]?.ownerId!==faction.id)continue;
    const previous=state.countdowns[faction.id];
    if(previous>1){state.countdowns[faction.id]--;continue;}
    replenish(s,scene,faction.id);
    let kind:number|undefined;
    if(nativeCanDispatch(s.armies.filter(a=>a.ownerId!==s.factionId).length,s.armies.filter(a=>a.ownerId===faction.id&&a.remainingDays>0).length)) {
      const {input,ids}=snapshot(s,scene,faction.id),decision=nativeStrategyDecision(input);
      state.rng=decision.rngAfterChoice;
      const chosen=decision.candidates[decision.chosen];
      state.trace.unshift({callback:state.callbacks,owner:faction.id,kind:chosen?.[0]??0,
        from:chosen?ids[chosen[1]]:null,to:chosen?ids[chosen[2]]:null,candidates:decision.candidates.length,
        unresolvedCooperationReads:decision.unresolvedCooperationReads});state.trace.length=Math.min(32,state.trace.length);
      if(chosen&&[3,4,5,7,8,9].includes(chosen[0])) {
        for(const second of chosen[0]===7?[false,true]:[false]) {
          const plan=nativeMarchPlan(s,scene,faction.id,chosen,ids,second);
          if(plan){execute(plan,faction.id);kind=chosen[0];}
        }
      }
    }
    state.countdowns[faction.id]=nativeNextDecisionCountdown(previous,kind);
  }
  // Native 0x41AFAB / 0x41AF58 passive recruiting, with the same per-recruit cost.
  for(const def of scene.cities) {
    const city=s.cities[def.id],id=def.id;
    const maximum=nativeReserveCapacity(city.population);
    if(def.nativeFlags!==2&&--state.recruitTimers[id]<=0) {
      if(city.money>=100&&state.reserves[id]<maximum){state.reserves[id]++;city.money-=100;}
      const base=Math.trunc(4980/maximum);
      state.recruitTimers[id]=base+Math.trunc((999-city.defense)*base/2997);
    }
    if(!roster(s,id).length)state.reserves[id]=0;
    state.reserves[id]=Math.min(state.reserves[id],maximum);
  }
  // 0x41B1BF. Condition changes use their own signed-short timers, in source order.
  for(const def of scene.generals) {
    const g=s.generals[def.id];if(!g.cityId||g.armyId)continue;
    const defense=s.cities[g.cityId].defense,timer=state.recovery[def.id];
    for(const [key,base] of [['hp',30],['mp',40]] as const)if(g[key]<(key==='hp'?officerMaxHp(g,def):officerMaxMp(g,def))&&--timer[key]<=0){g[key]++;timer[key]=base+Math.trunc((999-defense)*base/2997);}
    const condition=initialOfficerCondition(g);
    const clocks={...initialConditionTimers(),...timer};
    nativeRecoverCondition(condition,clocks,true,defense);
    Object.assign(g,condition);Object.assign(timer,clocks);
  }
}
