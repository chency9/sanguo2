import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import type {GameContent} from '@sango2/content';
import fixtures from '../fixtures/native-policy-search.json';
import {nativeAutonomy,nativeRecruitDisposition,nativeRecruitExperience,nativeSearchItem,nativeSearchRoute,type AutonomyMode} from './native-policy-search';
import {applyRecruitExperience,officerLevel} from './native-progression';
import {createSession,dispatch,readSession,validateSession,nativeTroopCapacity} from './index';
import {nativeReadiness} from './native-ai-campaign';

describe('original x86 policy search differential',()=>{
  for(const [index,c] of fixtures.itemCases.entries())it(`item weights, unique flags, level and RNG ${index}`,()=>{
    const rng:[number,number]=[c.rng[0],c.rng[1]],item=nativeSearchItem(c.items,c.found,c.level,rng);
    expect(item).toBe(c.item);expect([...new Set([...c.found,...(item>=0?[item]:[])])].sort((a,b)=>a-b)).toEqual(c.foundAfter);expect(rng).toEqual(c.rngAfter);
  });
  for(const [index,c] of fixtures.routeCases.entries())it(`original neighbor and wild roster selection ${index}`,()=>{
    const rng:[number,number]=[c.rng[0],c.rng[1]],route=nativeSearchRoute(c.area,rng);
    expect(route).toEqual(c.route);
    if(route.kind==='item')nativeSearchItem([{id:2,flags:0,searchType:0,rate:100,level:1}],[],10,rng);
    expect(rng).toEqual(c.rngAfter);
  });
  for(const [index,c] of fixtures.recruitCases.entries())it(`persuasion branch and RNG ${index}`,()=>{
    const rng:[number,number]=[c.rng[0],c.rng[1]];
    expect(nativeRecruitDisposition(c.owner,c.loyalFaction,c.loyalLeaderOwner,c.intelligence,rng)).toBe(c.code);expect(rng).toEqual(c.rngAfter);
  });
  for(const [index,c] of fixtures.growthCases.entries())it(`original player EXP roster and level-up loop ${index}`,()=>{
    const rng:[number,number]=[c.rng[0],c.rng[1]],state={ownerId:'p',cityId:'home',armyId:null,status:'登',...c.input};
    const def={id:'g',name:'g',portrait:'',loyalty:90,ownerId:'p',cityId:'home',status:'登',weapon:'',horse:'',item:'',unit:'刀',formations:[],rawSkill:'',rawStrategy:'',sourceLine:1,...c.input};
    const experience=nativeRecruitExperience(c.roster,c.ruler,rng);applyRecruitExperience(state,def,experience);
    expect(state).toMatchObject(c.output);expect(rng).toEqual(c.rngAfter);
  });
  for(const [index,c] of fixtures.autonomyCases.entries())it(`original autonomy traversal and RNG ${index}`,()=>{
    const rng:[number,number]=[c.rng[0],c.rng[1]],operations:unknown[]=[];
    nativeAutonomy(c.cities.map(city=>({...city,mode:city.mode as AutonomyMode})),new Set(c.acted),rng,(cityId,generalId,action)=>operations.push({cityId,generalId,action}));
    expect(operations).toEqual(c.operations);expect(rng).toEqual(c.rngAfter);
  });
});

const content=JSON.parse(readFileSync(new URL('../../../apps/game/public/assets/content.json',import.meta.url),'utf8')) as GameContent;
const scene=content.scenarios[0],faction=scene.factions[0].id;
const fresh=()=>createSession(content,scene.id,faction);
function owned(s:ReturnType<typeof fresh>){return scene.cities.find(c=>s.cities[c.id].ownerId===faction&&scene.generals.some(g=>s.generals[g.id].cityId===c.id&&s.generals[g.id].status==='登'))!;}

describe('search, autonomy and growth campaign integration',()=>{
  it('initializes original level-derived troop slots in all five scenarios and restarts cleanly',()=>{
    for(const scenario of content.scenarios) {
      const s=createSession(content,scenario.id,scenario.factions[0].id);
      for(const g of scenario.generals) {const cap=nativeTroopCapacity(g.level!);expect(s.generals[g.id].troopSlots).toEqual(cap);expect(s.generals[g.id].troops).toBe(cap.active+cap.reserve);}
      for(const c of scenario.cities)expect(s.cities[c.id].troops).toBe(scenario.generals.filter(g=>s.generals[g.id].status==='登'&&s.generals[g.id].cityId===c.id&&s.generals[g.id].ownerId===s.cities[c.id].ownerId).reduce((n,g)=>n+s.generals[g.id].troops,0));
      validateSession(s,content);
    }
    const s=fresh();s.policy!.search!.found.push(127);s.policy!.search!.inventory[faction]['1']=2;
    expect(fresh().policy!.search!.inventory[faction]).toEqual({});expect(fresh().policy!.search!.found).not.toContain(127);
  });
  it('marks initial equipment as found even when the officer is not yet present or below item level',()=>{
    const s=fresh(),named=new Map(content.items.map(item=>[item.NAME,Number(item.SEQUENCE)]));
    const expected=[...new Set(scene.generals.flatMap(g=>[g.weapon,g.horse,g.item]).filter(name=>named.has(name)).map(name=>named.get(name)!))].sort((a,b)=>a-b);
    expect(s.policy!.search!.found).toEqual(expected);expect(scene.generals.every(g=>g.loyalFactionId===null)).toBe(true);
  });
  it('shares the annual action between develop and search, with batch prevalidation and save roundtrip',()=>{
    const s=fresh(),city=owned(s),ids=scene.generals.filter(g=>s.generals[g.id].cityId===city.id&&s.generals[g.id].status==='登').map(g=>g.id);
    const before=structuredClone(s);
    expect(()=>dispatch(s,{type:'policy-search',cityId:city.id,generalIds:[ids[0],'missing']},content)).toThrow();expect(s).toEqual(before);
    const searched=dispatch(s,{type:'policy-search',cityId:city.id,generalIds:[ids[0]]},content);
    expect(searched.policy!.acted).toContain(ids[0]);expect(searched.policy!.search!.reports).toHaveLength(1);
    expect(()=>dispatch(searched,{type:'policy-develop',cityId:city.id,generalIds:[ids[0]]},content)).toThrow('已行动');
    expect(()=>dispatch(searched,{type:'policy-search',cityId:city.id,generalIds:[ids[0]]},content)).toThrow('已行动');
    expect(readSession(JSON.parse(JSON.stringify(searched)),content)).toEqual(searched);
  });
  it('persists explicit autonomy settings, uses only unused officers, and keeps configuration next year',()=>{
    let s=fresh();const city=owned(s),id=scene.generals.find(g=>s.generals[g.id].cityId===city.id&&s.generals[g.id].status==='登')!.id;
    s=dispatch(s,{type:'policy-develop',cityId:city.id,generalIds:[id]},content);
    const initial=s.policy!.results.filter(r=>r.generalId===id).length;
    s=dispatch(s,{type:'policy-autonomy-set',cityId:city.id,mode:4},content);
    const saved=readSession(JSON.parse(JSON.stringify(s)),content);expect(saved.policy!.search!.autonomy[city.id]).toBe(4);
    s=dispatch(saved,{type:'policy-autonomy-run'},content);
    expect(s.policy!.results.filter(r=>r.generalId===id)).toHaveLength(initial);
    const total=s.policy!.results.length+s.policy!.search!.reports.length;
    const rng=[...s.nativeAI!.rng];s=dispatch(s,{type:'policy-autonomy-run'},content);
    expect(s.policy!.results.length+s.policy!.search!.reports.length).toBe(total);expect(s.nativeAI!.rng).not.toEqual(rng);
    s=dispatch(s,{type:'policy-finish'},content);s.day=359;for(const key of Object.keys(s.cities))s.nativeAI!.recruitTimers[key]=9999;
    for(const f of scene.factions)s.nativeAI!.countdowns[f.id]=999;
    s=dispatch(s,{type:'advance',days:1},content);expect(s.policy!.acted.filter(id=>s.generals[id].ownerId===faction)).toEqual([]);expect(s.policy!.search!.autonomy[city.id]).toBe(4);validateSession(s,content);
  });
  it('finds actual wild officers, transfers their full state once and feeds live level to AI and saves',()=>{
    const city=owned(fresh());let recruited=false;
    for(let seed=1;seed<=200&&!recruited;seed++) {
      let s=createSession(content,scene.id,faction,seed);const actor=scene.generals.find(g=>s.generals[g.id].cityId===city.id&&s.generals[g.id].status==='登')!.id;
      // Guarantee a local target while retaining native route/persuasion/RNG.
      const candidate=scene.generals.find(g=>g.status==='野')!;s.generals[candidate.id].cityId=city.id;
      const ruler=scene.factions[0].leaderId!;s.generals[ruler].experience=200000;
      s=dispatch(s,{type:'policy-search',cityId:city.id,generalIds:[actor]},content);
      const report=s.policy!.search!.reports[0];if(report.candidateId!==candidate.id||![16,17].includes(report.code!))continue;
      recruited=true;const g=s.generals[candidate.id];expect(g).toMatchObject({ownerId:faction,cityId:city.id,status:'登',armyId:null});expect(s.policy!.acted).toContain(candidate.id);
      expect(officerLevel(g,candidate)).toBeGreaterThan(candidate.level!);expect(nativeReadiness(s,scene,candidate.id).maxHp).toBe(g.maxHp);
      expect(s.cities[city.id].troops).toBe(scene.generals.filter(d=>s.generals[d.id].cityId===city.id&&s.generals[d.id].status==='登'&&s.generals[d.id].ownerId===faction).reduce((n,d)=>n+s.generals[d.id].troops,0));
      expect(readSession(JSON.parse(JSON.stringify(s)),content)).toEqual(s);validateSession(s,content);
      const road=scene.roads.find(r=>!r.restricted&&(r.from===city.id||r.to===city.id)&&s.cities[r.from===city.id?r.to:r.from].ownerId!==faction)!;
      for(const f of scene.factions)s.nativeAI!.countdowns[f.id]=999;
      s=dispatch(s,{type:'policy-finish'},content);
      s=dispatch(s,{type:'march',from:city.id,to:road.from===city.id?road.to:road.from,generalIds:[candidate.id],troops:g.troops},content);
      for(let day=0;day<30&&!s.battle;day++)s=dispatch(s,{type:'advance',days:1},content);
      expect(s.battle).not.toBeNull();expect(s.battle!.commanders.attacker).toMatchObject({id:candidate.id,level:g.level,maxHp:g.maxHp,maxMp:g.maxMp});validateSession(s,content);
    }
    expect(recruited).toBe(true);
  });
  it('limits stored items to99 and removes a found unique item from every later search',()=>{
    for(const unique of [false,true]) {
      const testContent={...content,items:[{SEQUENCE:'127',NAME:'试验物品',ATTRIB:unique?'ONLYONE':'USED',SEARCHTYPE:'0',RATE:'100',LEVEL:'1'}]};
      let found=false;
      for(let seed=1;seed<=100&&!found;seed++) {
        let s=createSession(testContent,scene.id,faction,seed);const city=owned(s),ids=scene.generals.filter(g=>s.generals[g.id].cityId===city.id&&s.generals[g.id].status==='登').map(g=>g.id);
        for(const g of scene.generals)if(s.generals[g.id].status==='野')s.generals[g.id].status='未';
        if(!unique)s.policy!.search!.inventory[faction]['127']=99;
        s=dispatch(s,{type:'policy-search',cityId:city.id,generalIds:ids},testContent);
        const items=s.policy!.search!.reports.filter(r=>r.kind==='item');if(!items.length)continue;
        found=true;expect(s.policy!.search!.inventory[faction]['127']).toBe(unique?1:99);
        if(unique)expect(items).toHaveLength(1);validateSession(s,testContent);
      }
      expect(found).toBe(true);
    }
  });
  it('keeps legacy allocations, RNG and already-used actions when adding optional search data',()=>{
    let s=fresh();delete s.policy!.search;delete s.generals[scene.generals[1].id].level;
    const city=owned(s),id=scene.generals.find(g=>s.generals[g.id].cityId===city.id&&s.generals[g.id].status==='登')!.id;
    s.policy!.acted=[id];const before=structuredClone(s);s=readSession(JSON.parse(JSON.stringify(s)),content);expect(s).toEqual(before);
    const set=dispatch(s,{type:'policy-autonomy-set',cityId:city.id,mode:2},content);expect(set.nativeAI).toEqual(s.nativeAI);expect(set.generals).toEqual(s.generals);expect(set.policy!.acted).toEqual([id]);
  });
  it('rejects invalid inventory, autonomy, reports and runtime growth',()=>{
    const mutations=[(s:ReturnType<typeof fresh>)=>s.policy!.search!.found.push(s.policy!.search!.found[0]),
      (s:ReturnType<typeof fresh>)=>{s.policy!.search!.inventory[faction]['1']=100;},
      (s:ReturnType<typeof fresh>)=>{s.policy!.search!.autonomy[scene.cities[0].id]=5 as AutonomyMode;},
      (s:ReturnType<typeof fresh>)=>{s.generals[scene.generals[1].id].level=100;},
      (s:ReturnType<typeof fresh>)=>{s.generals[scene.generals[1].id].maxHp=-1;},
      (s:ReturnType<typeof fresh>)=>{s.policy!.search!.reports.push({year:184,cityId:'missing',generalId:'missing',kind:'none'});}];
    for(const mutate of mutations){const s=fresh();mutate(s);expect(()=>validateSession(s,content)).toThrow('存档');}
  });
});
