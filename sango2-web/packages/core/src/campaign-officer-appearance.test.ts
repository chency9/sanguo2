import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import type {GameContent,GeneralDefinition} from '@sango2/content';
import {createSession,readSession,validateSession} from './index';
import {beginDomesticYear,nativeAnnualRevenue} from './native-policy';
import {runAnnualOfficerAppearances} from './native-policy-appearance';

const officer=(id:string,cityId:string|null,ownerId:string|null,extra:Partial<GeneralDefinition>={}):GeneralDefinition=>({
  id,name:id,portrait:'',cityId,ownerId,status:ownerId?'登':'未',hp:81,mp:41,baseHp:80,baseMp:40,level:1,baseExperience:0,
  strength:80,intelligence:80,loyalty:100,weapon:'',horse:'',item:'',unit:'朴刀兵',formations:['方'],rawSkill:'',rawStrategy:'',sourceLine:1,
  appearanceCities:['home','home','home','home','home'],...extra});
const fixture=():GameContent=>({version:1,id:'annual-appearance',sourceHash:'e'.repeat(64),skills:[],strategies:[],items:[],terrains:[],scenarios:[{
  id:'era',title:'年度出场',year:193,initialization:'native-105plus',factions:[{id:'own',name:'己方',leaderId:'ruler',color:'#fff',select:1,special:false}],
  cities:[{id:'home',name:'都城',ownerId:'own',governorId:'ruler',position:[100,100],money:1000,population:10000,defense:0}],roads:[],
  generals:[officer('ruler','home','own',{baseExperience:60000}),officer('veteran','home','own',{baseExperience:30000}),
    officer('child',null,null,{relativeId:'ruler'}),officer('grandchild',null,null,{relativeId:'child'}),
    officer('traveller','home',null,{status:'野',appearanceCities:[null,null,null,null,null]}),officer('hidden',null,null)],
}]});

describe('annual officer appearances in campaign sessions',()=>{
  it('joins a same-year family chain before resetting council actions and writing annual revenue',()=>{
    const content=fixture(),scene=content.scenarios[0],s=createSession(content,'era','own');
    s.generals.hidden.appearanceHidden=true;s.policy!.active=false;s.policy!.acted=['ruler'];s.day=360;
    expect(beginDomesticYear(s,scene)).toBe(true);
    for(const id of ['child','grandchild']) {
      expect(s.generals[id]).toMatchObject({ownerId:'own',cityId:'home',status:'登',armyId:null});
      expect(s.generals[id].level).toBeGreaterThan(1);expect(s.generals[id].hp).toBe(s.generals[id].maxHp);
      expect(s.generals[id].troops).toBeGreaterThan(5);
    }
    expect(s.generals.traveller).toMatchObject({status:'未',cityId:null,appearanceHidden:true});
    expect(s.generals.hidden).toMatchObject({status:'未',cityId:null,appearanceHidden:true});
    expect(s.policy!.acted).toEqual([]);expect(s.policy!.year).toBe(194);expect(s.policy!.active).toBe(true);
    expect(s.policy!.annual!.rosterOrder.own.slice(0,2)).toEqual(['grandchild','child']);
    expect(s.policy!.search!.residentOrder.home.slice(0,2)).toEqual(['grandchild','child']);
    expect(s.chronicle[0].text).toContain('grandchild前来投奔child');expect(s.chronicle[1].text).toContain('child前来投奔ruler');
    expect(s.cities.home.money).toBe(1000+nativeAnnualRevenue(10000,false));
    expect(s.cities.home.troops).toBe(['ruler','veteran','child','grandchild'].reduce((sum,id)=>sum+s.generals[id].troops,0));
    validateSession(s,content);const saved=readSession(JSON.parse(JSON.stringify(s)),content);expect(saved).toEqual(s);
    const before=structuredClone(s);expect(beginDomesticYear(s,scene)).toBe(false);expect(s).toEqual(before);
  });
  it('keeps disappearance distinct from not-yet-appeared and consumes no future selection RNG',()=>{
    const content=fixture(),scene=content.scenarios[0],s=createSession(content,'era','own');s.policy!.year=194;
    s.generals.hidden.appearanceHidden=true;
    runAnnualOfficerAppearances(s,scene);const rng=[...s.nativeAI!.rng];
    // A later POS entry cannot resurrect the native 4096 state.
    scene.generals.find(g=>g.id==='traveller')!.appearanceCities=['home','home','home','home','home'];s.policy!.year=195;
    expect(runAnnualOfficerAppearances(s,scene)).toEqual([]);expect(s.nativeAI!.rng).toEqual(rng);
    const saved=readSession(JSON.parse(JSON.stringify({...s,day:720})),content);expect(saved.generals.traveller.appearanceHidden).toBe(true);
  });
  it('does not invent source schedules for old content or a native random stream for legacy saves',()=>{
    const content=fixture(),scene=content.scenarios[0],s=createSession(content,'era','own');s.policy!.year=194;
    for(const def of scene.generals)delete def.appearanceCities;
    const old=structuredClone(s);expect(runAnnualOfficerAppearances(s,scene)).toEqual([]);expect(s).toEqual(old);
    scene.generals.find(g=>g.id==='child')!.appearanceCities=['home','home','home','home','home'];delete s.nativeAI;
    const legacy=structuredClone(s);expect(runAnnualOfficerAppearances(s,scene)).toEqual([]);expect(s).toEqual(legacy);
  });
  it('skips missing schedules within a partially upgraded content pack',()=>{
    const content=fixture(),scene=content.scenarios[0];delete scene.generals.find(g=>g.id==='traveller')!.appearanceCities;
    const s=createSession(content,'era','own');s.policy!.year=194;runAnnualOfficerAppearances(s,scene);
    expect(s.generals.traveller).toMatchObject({status:'野',cityId:'home'});expect(s.generals.traveller.appearanceHidden).toBeUndefined();
  });
});

const original=JSON.parse(readFileSync(new URL('../../../apps/game/public/assets/content.json',import.meta.url),'utf8')) as GameContent;
describe('all five original scenarios preserve annual appearances through save/restore',()=>{
  it.each(original.scenarios.map(scene=>({id:scene.id,title:scene.title})))('$title',({id})=>{
    const scene=original.scenarios.find(scene=>scene.id===id)!,faction=scene.factions.find(f=>!f.special&&scene.cities.some(c=>c.ownerId===f.id))!.id;
    const s=createSession(original,id,faction),loaded=readSession(JSON.parse(JSON.stringify(s)),original);
    s.policy!.active=loaded.policy!.active=false;s.day=loaded.day=360;
    expect(beginDomesticYear(s,scene,original.items)).toBe(true);expect(beginDomesticYear(loaded,scene,original.items)).toBe(true);expect(loaded).toEqual(s);
    expect(scene.generals.every(g=>g.appearanceCities?.length===5)).toBe(true);
    expect(scene.generals.every(g=>['登','野','未'].includes(s.generals[g.id].status))).toBe(true);
    validateSession(s,original);expect(readSession(JSON.parse(JSON.stringify(s)),original)).toEqual(s);
  });
  it.each(original.scenarios.slice(0,4).map((scene,index)=>({id:scene.id,title:scene.title,year:[187,195,205,214][index]})))('activates later source POS periods in $title',({id,year})=>{
    const scene=original.scenarios.find(scene=>scene.id===id)!,faction=scene.factions.find(f=>!f.special&&scene.cities.some(c=>c.ownerId===f.id))!.id;
    let changes=0;
    for(let seed=1;seed<=8;seed++) {
      const s=createSession(original,id,faction,seed);s.day=(year-scene.year)*360;s.policy!.year=year;
      const loaded=readSession(JSON.parse(JSON.stringify(s)),original);
      const events=runAnnualOfficerAppearances(s,scene,original.items);
      expect(runAnnualOfficerAppearances(loaded,scene,original.items)).toEqual(events);expect(loaded).toEqual(s);
      changes+=events.filter(e=>e.kind==='appear'||e.kind==='family').length;
      validateSession(s,original);
    }
    expect(changes).toBeGreaterThan(0);
  });
});
