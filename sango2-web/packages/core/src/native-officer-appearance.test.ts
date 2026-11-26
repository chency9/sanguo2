import {describe,it,expect} from 'vitest';
import vectors from '../fixtures/native-officer-appearance.json';
import {nativeAppearancePeriod,nativeApplyOfficerAppearance,runNativeAnnualAppearance,type NativeAppearanceWorld,type NativeAppearanceOfficer} from './native-officer-appearance';
import type {NativeRandomState} from './native-strategic-ai';
import {nativeRecruitExperience} from './native-policy-search';
import {applyRecruitExperience} from './native-progression';
import type {GeneralDefinition} from '@sango2/content';
import type {GeneralState} from './index';

describe('original annual officer appearance machine-code vectors',()=>{
  it.each(vectors.yearCases)('uses original period and force flag at year $year',c=>{
    expect(nativeAppearancePeriod(c.year)).toMatchObject({stage:c.stage,forced:c.forced});
  });
  it.each(vectors.selectionCases.map((c,i)=>({...c,index:i})))('matches original status/location selection and RNG $index',c=>{
    const officers:NativeAppearanceOfficer[]=c.officers.map(g=>({...g,cityId:null,ownerId:null,relativeId:null})),rng:NativeRandomState=[...c.rng] as NativeRandomState;
    const events=runNativeAnnualAppearance(c.year,{officers,cities:[{id:'city',ownerId:null,capacity:5,officerCount:0}],factions:[],playerFactionId:'player'},rng);
    expect(events.map(e=>({id:e.officerId,cityId:e.cityId}))).toEqual(c.operations);expect(rng).toEqual(c.rngAfter);
  });
  it.each(vectors.transitionCases.map((c,i)=>({...c,index:i})))('matches native city/family transitions $index',c=>{
    const child:NativeAppearanceOfficer={id:'child',status:c.status,cityId:c.cityId,ownerId:null,relativeId:c.relative?'parent':null,locations:[]};
    const parent:NativeAppearanceOfficer={id:'parent',status:c.parentStatus,cityId:c.parentCityId,ownerId:'own',relativeId:null,locations:[]};
    const leader:NativeAppearanceOfficer={id:'leader',status:1,cityId:c.leaderCityId,ownerId:'own',relativeId:null,locations:[]};
    const world:NativeAppearanceWorld={officers:[child,parent,leader],cities:c.capacities.map((capacity,i)=>({id:String(i),ownerId:'own',capacity,officerCount:0})),factions:[{id:'own',leaderId:'leader',cityOrder:['0','1','2']}],playerFactionId:c.player?'own':'other'};
    const rng:NativeRandomState=[...c.rng] as NativeRandomState,event=nativeApplyOfficerAppearance(child,c.plannedCityId,world,rng);
    const operations=event?.kind==='family'?['growth',...(event.notify?['dialog']:[])]:[];
    expect({status:child.status,cityId:child.cityId,ownerId:child.ownerId,acted:!!child.acted,operations,notifications:event?.notify?1:0,rng}).toEqual(c.native);
  });
  it('interleaves family growth callbacks and never reconsiders hidden officers',()=>{
    const relatives:NativeAppearanceOfficer[]=[{id:'parent',status:1,cityId:'city',ownerId:'own',relativeId:null,locations:[]},
      {id:'child',status:8192,cityId:null,ownerId:null,relativeId:'parent',locations:['city','city','city','city','city']},
      {id:'hidden',status:4096,cityId:null,ownerId:null,relativeId:null,locations:['city','city','city','city','city']}];
    const world:NativeAppearanceWorld={officers:relatives,cities:[{id:'city',ownerId:'own',capacity:5,officerCount:1}],factions:[{id:'own',leaderId:'parent',cityOrder:['city']}],playerFactionId:'own'},rng:NativeRandomState=[184,0x87654321],before=[...rng];
    const operations:string[]=[];
    const events=runNativeAnnualAppearance(194,world,rng,event=>operations.push(event.officerId));
    expect(events.map(e=>e.kind)).toEqual(['family']);expect(operations).toEqual(['child']);expect(rng).toEqual(before);
    expect(relatives[1]).toMatchObject({status:1,ownerId:'own',cityId:'city'});
    expect(runNativeAnnualAppearance(194,world,rng)).toEqual([]);expect(rng).toEqual(before);
  });
  it.each(vectors.orderedCases.map((c,i)=>({...c,index:i})))('preserves the complete annual appearance/growth/RNG order $index',c=>{
    const officers=structuredClone(c.officers),cities=structuredClone(c.cities);
    const world:NativeAppearanceWorld={officers,cities,factions:[
      {id:'player',leaderId:'ruler',cityOrder:['0','1']},{id:'other',leaderId:'enemy-ruler',cityOrder:['2']}],playerFactionId:'player'};
    const rng:NativeRandomState=[...c.rng] as NativeRandomState,growth:string[]=[],notifications:string[]=[];
    runNativeAnnualAppearance(c.year,world,rng,event=>{
      if(event.kind!=='family')return;
      // 0x4230ED inserts into the faction before 0x426B44 samples the player's
      // roster. Each join and growth therefore affects later annual officers.
      const roster=officers.filter(g=>g.ownerId==='player'&&g.status===1).map(g=>({id:g.id,experience:g.progress.experience}));
      const experience=nativeRecruitExperience(roster,'ruler',rng),g=officers.find(g=>g.id===event.officerId)!;
      applyRecruitExperience(g.progress as GeneralState,g.definition as GeneralDefinition,experience);
      growth.push(g.id);if(event.notify)notifications.push(g.id);
    });
    expect({officers:officers.map(g=>({id:g.id,status:g.status,cityId:g.cityId,ownerId:g.ownerId,acted:!!(g as NativeAppearanceOfficer).acted,
      progress:{level:g.progress.level,experience:g.progress.experience,maxHp:g.progress.maxHp,maxMp:g.progress.maxMp,hp:g.progress.hp,mp:g.progress.mp,troops:g.progress.troops}})),growth,notifications,rng}).toEqual(c.native);
  });
});
