import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import type {GameContent,GeneralDefinition} from '@sango2/content';
import fixtures from '../fixtures/native-policy-annual.json';
import {nativeApplyItem,nativeCanUseItem,nativeAnnualInventory,nativeItemTable} from './native-items';
import {annualOfficerOrder,nativeAnnualActions,nativeAnnualCatchup,nativeAnnualBalance,ensureDomesticAnnual} from './native-policy-annual';
import {applyOfficerExperience} from './native-progression';
import {beginDomesticYear,nativeAnnualRevenue} from './native-policy';
import {createSession,dispatch,readSession,validateSession,officerDefinition,type GeneralState} from './index';
import {searchDomesticOfficer} from './native-policy-actions';
import {materializeOfficer,unloadOfficerEquipment} from './native-officer-runtime';
import {nativeCityCapacity} from './native-ai-campaign';

describe('annual domestic original x86 differential',()=>{
  for(const [index,c] of fixtures.itemCases.entries())it(`item eligibility, signed effects and removal ${index}`,()=>{
    const state=structuredClone(c.input);expect(nativeCanUseItem(state,c.item,c.ruler)).toBe(c.eligible);
    nativeApplyItem(state,c.item,c.remove);expect(state).toEqual(c.output);
  });
  for(const [index,c] of fixtures.inventoryCases.entries())it(`complete descending inventory pass ${index}`,()=>{
    const officers=structuredClone(c.officers),inventory=structuredClone(c.inventory) as unknown as Record<string,number>,rng:[number,number]=[...c.rng] as [number,number];
    nativeAnnualInventory(annualOfficerOrder(officers,c.leader,true).map(g=>({id:g.id,state:g.state,ruler:g.id===c.leader})),inventory,c.items,rng);
    expect(inventory).toEqual(c.inventoryAfter);expect(Object.fromEntries(officers.map(g=>[g.id,g.state]))).toEqual(c.officersAfter);expect(rng).toEqual(c.rngAfter);
  });
  for(const [index,c] of fixtures.catchupCases.entries())it(`battle EXP catchup, wraparound and RNG ${index}`,()=>{
    const officers=structuredClone(c.officers),rng:[number,number]=[...c.rng] as [number,number];
    nativeAnnualCatchup(officers,c.playerCount,c.playerBattleExperience,c.ownBattleExperience,rng,(id,exp)=>{officers.find(g=>g.id===id)!.experience=exp;});
    expect(officers.map(g=>g.experience)).toEqual(c.experiences);expect(rng).toEqual(c.rngAfter);expect(c.cacheAfter).toBe(c.ownBattleExperience);
  });
  for(const [index,c] of fixtures.balanceCases.entries())it(`ruler promotion before top-roster average ${index}`,()=>{
    const officers=structuredClone(c.officers);
    nativeAnnualBalance(officers,c.player,c.leader,(id,exp)=>{officers.find(g=>g.id===id)!.experience=exp;});
    expect(officers.map(g=>g.experience)).toEqual(c.experiences);
  });
  for(const [index,c] of fixtures.growthCases.entries())it(`ordinary level growth preserves wounded state ${index}`,()=>{
    const state:GeneralState={ownerId:'f',cityId:'c',armyId:null,status:'登',...c.input,troopSlots:{...c.troopSlots},troops:c.troopSlots.active+c.troopSlots.reserve};
    const def={id:'g',name:'g',portrait:'',ownerId:'f',cityId:'c',status:'登',weapon:'',horse:'',item:'',unit:'刀',formations:[],rawSkill:'',rawStrategy:'',sourceLine:1,...c.input} as GeneralDefinition;
    applyOfficerExperience(state,def,c.experience);expect(state).toMatchObject(c.output);
  });
  for(const [index,c] of fixtures.actionCases.entries())it(`stationed snapshot action order ${index}`,()=>{
    const operations:{id:string;action:string}[]=[],rng:[number,number]=[...c.rng] as [number,number];
    nativeAnnualActions(annualOfficerOrder(c.officers,c.leader),rng,(id,action)=>operations.push({id,action}));
    expect(operations).toEqual(c.operations);expect(rng).toEqual(c.rngAfter);
  });
});

const content=JSON.parse(readFileSync(new URL('../../../apps/game/public/assets/content.json',import.meta.url),'utf8')) as GameContent;
const scene=content.scenarios[0],faction=scene.factions[0].id,fresh=()=>createSession(content,scene.id,faction);
function year(s:ReturnType<typeof fresh>){s.policy!.active=false;s.day=360;expect(beginDomesticYear(s,scene,content.items)).toBe(true);return s;}
describe('annual domestic campaign integration',()=>{
  it('executes rivals before annual tax, once, without consuming player actions or leaking search reports',()=>{
    const s=fresh(),money=Object.fromEntries(scene.cities.map(c=>[c.id,s.cities[c.id].money]));year(s);
    expect(s.policy!.annual!.reports.length).toBeGreaterThan(0);
    expect(s.policy!.annual!.reports.some(r=>r.searches>0&&r.developments>0)).toBe(true);
    expect(s.policy!.annual!.reports.every(r=>r.factionId!==faction)).toBe(true);
    expect(s.policy!.results).toEqual([]);expect(s.policy!.search!.reports).toEqual([]);
    expect(s.policy!.acted.every(id=>s.generals[id].ownerId!==faction)).toBe(true);
    for(const c of scene.cities)expect(s.cities[c.id].money-money[c.id]).toBe(nativeAnnualRevenue(s.cities[c.id].population,c.nativeFlags===2));
    const before=structuredClone(s);expect(beginDomesticYear(s,scene,content.items)).toBe(false);expect(s).toEqual(before);
    expect(readSession(JSON.parse(JSON.stringify(s)),content)).toEqual(s);
  });
  it('preserves a wounded rival on ordinary annual upgrades and includes marching officers in EXP passes',()=>{
    const s=fresh(),rival=scene.factions.find(f=>f.id!==faction&&f.leaderId&&s.generals[f.leaderId].ownerId===f.id)!;
    const g=s.generals[rival.leaderId!];g.hp=1;g.mp=1;g.troops=1;g.troopSlots={active:1,reserve:0};
    const d=scene.generals.find(d=>d.id===rival.leaderId)!,oldLevel=g.level!;
    for(const def of scene.generals.filter(def=>s.generals[def.id].ownerId===faction))s.generals[def.id].experience=200000;
    const city=g.cityId!;s.cities[city].troops=scene.generals.filter(d=>s.generals[d.id].cityId===city&&s.generals[d.id].ownerId===rival.id&&s.generals[d.id].status==='登').reduce((n,d)=>n+s.generals[d.id].troops,0);
    const road=scene.roads.find(r=>!r.restricted&&(r.from===city||r.to===city))!,armyId=`army-${s.nextId++}`;
    s.cities[city].troops--;g.cityId=null;g.armyId=armyId;
    s.armies.push({id:armyId,ownerId:rival.id,from:city,to:road.from===city?road.to:road.from,roadId:road.id,generalIds:[rival.leaderId!],troops:1,totalDays:10,remainingDays:10});
    year(s);expect(g.level).toBeGreaterThan(oldLevel);expect(g.hp).toBe(1);expect(g.mp).toBe(1);expect(g.troops).toBe(1);expect(officerDefinition(g,d,content.items).level).toBe(g.level);
    validateSession(s,content);
  });
  it('uses and returns equipment through shared faction inventory and reads new stats in officer views',()=>{
    const s=fresh(),rival=scene.factions.find(f=>f.id!==faction&&f.leaderId&&s.generals[f.leaderId].ownerId===f.id)!,id=rival.leaderId!;
    const g=s.generals[id],def=scene.generals.find(d=>d.id===id)!;g.level=99;
    const items=nativeItemTable(content.items),weapon=items.filter(i=>i.flags&16).sort((a,b)=>b.id-a.id)[0],old=g.weaponId!,before=g.strength!;
    const inventory=s.policy!.search!.inventory[rival.id];inventory[String(weapon.id)]=1;
    nativeAnnualInventory([{id,state:materializeOfficer(g,def,content.items),ruler:true}],inventory,items,s.nativeAI!.rng);
    expect(g.weaponId).toBe(weapon.id);expect(inventory[String(weapon.id)]).toBeUndefined();if(old)expect(inventory[String(old)]).toBe(1);
    expect(g.strength).toBe(before-(items.find(i=>i.id===old)?.strength??0)+weapon.strength);
    const view=officerDefinition(g,def,content.items);expect(view.strength).toBe(g.strength);expect(view.weapon).toBe(content.items.find(i=>Number(i.SEQUENCE)===weapon.id)!.NAME);
    expect(readSession(JSON.parse(JSON.stringify(s)),content)).toEqual(s);
  });
  it('carries runtime equipment, stats and attack appearance into a real campaign encounter',()=>{
    let s=fresh();const from=scene.cities.find(c=>s.cities[c.id].ownerId===faction&&scene.roads.some(r=>!r.restricted&&(r.from===c.id||r.to===c.id)))!;
    const road=scene.roads.find(r=>!r.restricted&&(r.from===from.id||r.to===from.id))!,to=road.from===from.id?road.to:road.from;
    const actor=scene.generals.find(d=>s.generals[d.id].cityId===from.id&&s.generals[d.id].ownerId===faction&&s.generals[d.id].status==='登')!;
    const enemy=scene.generals.find(d=>s.generals[d.id].ownerId&&s.generals[d.id].ownerId!==faction&&s.generals[d.id].status==='登')!;
    const rival=s.generals[enemy.id];s.cities[rival.cityId!].troops-=rival.troops;rival.cityId=to;s.cities[to].ownerId=rival.ownerId;s.cities[to].troops=rival.troops;s.policy!.governors[to]=enemy.id;
    Object.assign(s.generals[actor.id],{strength:155,intelligence:133,speed:17});
    s=dispatch(s,{type:'policy-finish'},content);for(const f of scene.factions)s.nativeAI!.countdowns[f.id]=999;
    s=dispatch(s,{type:'march',from:from.id,to,generalIds:[actor.id],troops:s.generals[actor.id].troops},content);
    for(let i=0;i<20&&!s.battle;i++)s=dispatch(s,{type:'advance',days:30},content);
    expect(s.battle).not.toBeNull();expect(s.battle!.commanders.attacker).toMatchObject({id:actor.id,strength:155,intelligence:133,speed:17});
    expect(s.battle!.commanders.attacker.appearance).toEqual(officerDefinition(s.generals[actor.id],actor,content.items).appearance);validateSession(s,content);
  });
  it('does not subtract never-applied preview bonuses during a legacy save equipment swap',()=>{
    const s=fresh(),d=scene.generals.find(d=>content.items.some(i=>i.NAME===d.weapon&&Number(i.LEVEL)<=d.level!&&Number(i.STR)>0))!,g=s.generals[d.id];
    for(const key of ['strength','intelligence','speed','weaponId','horseId','thingId'] as const)delete g[key];
    const state=materializeOfficer(g,d,content.items),before=state.strength;g.level=99;
    const items=nativeItemTable(content.items),weapon=items.filter(i=>i.flags&16).sort((a,b)=>b.id-a.id)[0],inventory={[weapon.id]:1};
    nativeAnnualInventory([{id:d.id,state,ruler:false}],inventory,items,s.nativeAI!.rng,unloadOfficerEquipment);
    expect(g.strength).toBe(before+weapon.strength);expect(g.legacyEquipment).not.toContain(Number(content.items.find(i=>i.NAME===d.weapon)!.SEQUENCE));
    expect(readSession(JSON.parse(JSON.stringify(s)),content)).toEqual(s);
  });
  it('keeps initial equipment level gates, applies eligible effects exactly once, and preserves legacy numerics',()=>{
    for(const scenario of content.scenarios) {
      const s=createSession(content,scenario.id,scenario.factions[0].id),items=nativeItemTable(content.items);
      for(const d of scenario.generals) {
        const g=s.generals[d.id],initial=[d.weapon,d.horse,d.item].map(name=>content.items.find(i=>i.NAME===name)).filter(row=>row&&Number(row.LEVEL)<=g.level!).map(row=>items.find(i=>i.id===Number(row!.SEQUENCE))!);
        expect(g.strength).toBe(d.strength+initial.reduce((n,i)=>n+i.strength,0));expect(g.intelligence).toBe(d.intelligence+initial.reduce((n,i)=>n+i.intelligence,0));
      }
      validateSession(s,content);
    }
    const s=fresh();delete s.policy!.annual;
    for(const g of Object.values(s.generals))for(const key of ['strength','intelligence','speed','forceMask','battleMask','weaponId','horseId','thingId'] as const)delete g[key];
    const before=structuredClone(s);expect(readSession(JSON.parse(JSON.stringify(s)),content)).toEqual(before);
    ensureDomesticAnnual(s,scene);expect(s.nativeAI!.rng).toEqual(before.nativeAI!.rng);expect(s.cities).toEqual(before.cities);expect(s.generals).toEqual(before.generals);
  });
  it('rejects corrupt annual records and runtime equipment before mutating the source',()=>{
    const source=fresh();
    for(const mutate of [(s:typeof source)=>{s.generals[scene.generals[0].id].strength=32768;},(s:typeof source)=>{s.generals[scene.generals[0].id].weaponId=127;},
      (s:typeof source)=>{s.policy!.annual!.battleExperience[faction]=-1;},(s:typeof source)=>{s.policy!.annual!.rosterOrder[faction].push('missing');}]) {
      const bad=structuredClone(source);mutate(bad);expect(()=>readSession(bad,content)).toThrow();
    }
    validateSession(source,content);
  });
  it('continues deterministically from a saved annual council into the following year',()=>{
    let a=year(fresh()),b=readSession(JSON.parse(JSON.stringify(a)),content);
    const prepare=(s:typeof a)=>{let next=dispatch(s,{type:'policy-finish'},content);next.day=719;for(const f of scene.factions)next.nativeAI!.countdowns[f.id]=999;for(const c of scene.cities)next.nativeAI!.recruitTimers[c.id]=9999;return dispatch(next,{type:'advance',days:1},content);};
    a=prepare(a);b=prepare(b);expect(a).toEqual(b);expect(a.policy!.year).toBe(scene.year+2);validateSession(a,content);
  });
  it('sends AI recruits away from a full city and keeps them out of that years fixed action snapshot',()=>{
    const s=fresh(),rival=scene.factions.find(f=>f.id!==faction&&scene.cities.filter(c=>s.cities[c.id].ownerId===f.id).length>1)!;
    const cities=scene.cities.filter(c=>s.cities[c.id].ownerId===rival.id),city=cities[0],available=cities[1];
    const actor=scene.generals.find(d=>s.generals[d.id].cityId===city.id&&s.generals[d.id].ownerId===rival.id&&s.generals[d.id].status==='登')!;
    const desired=nativeCityCapacity(s.cities[city.id].population);
    const resident=()=>scene.generals.filter(d=>s.generals[d.id].cityId===city.id&&s.generals[d.id].ownerId===rival.id&&s.generals[d.id].status==='登');
    for(const d of scene.generals.filter(d=>s.generals[d.id].status==='未').slice(0,Math.max(0,desired-resident().length)))Object.assign(s.generals[d.id],{status:'登',ownerId:rival.id,cityId:city.id});
    // Search deterministic seeds until the actual original route/persuasion succeeds.
    let found=false;
    for(let seed=1;seed<400&&!found;seed++) {
      const copy=structuredClone(s);copy.nativeAI!.rng=[seed,0x87654321];
      for(const d of scene.generals.filter(d=>copy.generals[d.id].status==='野'))copy.generals[d.id].cityId=city.id;
      const report=searchDomesticOfficer(copy,scene,city.id,actor.id,content.items,false);
      if(report.kind==='officer'&&(report.code===16||report.code===17)) {
        const target=copy.generals[report.candidateId!].cityId!;expect(target).not.toBe(city.id);expect(copy.cities[target].ownerId).toBe(rival.id);
        expect(copy.policy!.acted).toContain(report.candidateId);expect(copy.policy!.acted).not.toContain(actor.id);expect(copy.policy!.search!.reports).toEqual([]);found=true;
      }
    }
    expect(available).toBeDefined();expect(found).toBe(true);
  });
});
