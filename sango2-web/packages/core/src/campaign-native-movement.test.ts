import {describe,it,expect} from 'vitest';
import type {GameContent} from '@sango2/content';
import vectors from '../fixtures/native-strategic-movement.json';
import {createSession} from './index';
import {initNativeCampaignMovement,nativeCampaignArmyPosition,nativeCampaignNextCity,runNativeCampaignMovement,settleNativeArmyAftermath,retargetNativeCampaignArmy,validateNativeCampaignMovement,nativeDefeatedCityRetreat,type NativeCampaignArmy} from './campaign-native-movement';

const fixture=():GameContent=>({version:1,id:'native-march',sourceHash:'f'.repeat(64),skills:[],strategies:[],items:[],terrains:[],scenarios:[{
  id:'era',title:'行军',year:184,factions:[{id:'a',name:'甲',leaderId:'g1',color:'#fff',select:1,special:false},{id:'b',name:'乙',leaderId:'g2',color:'#aaa',select:1,special:false}],
  cities:['home','middle','enemy'].map((id,i)=>({id,name:id,ownerId:i===2?'b':'a',governorId:i===0?'g1':i===2?'g2':null,position:[100+40*i,100] as [number,number],money:0,population:10000,defense:0})),
  roads:[{id:'r1',from:'home',to:'middle',length:40,points:[[100,100],[120,100],[140,100]],restricted:false},
    {id:'r2',from:'middle',to:'enemy',length:40,points:[[140,100],[160,100],[180,100]],restricted:false}],
  generals:['g1','g2'].map((id,i)=>({id,name:id,portrait:'',strength:80,intelligence:80,hp:80,mp:40,loyalty:90,status:'登',cityId:i?'enemy':'home',ownerId:i?'b':'a',weapon:'',horse:'',item:'',unit:'刀',formations:['方'],rawSkill:'',rawStrategy:'',sourceLine:1})),
}]});
function fresh(){const content=fixture(),scene=content.scenarios[0],s=createSession(content,scene.id,'a');s.policy!.active=false;return {content,scene,s};}
function depart(ctx:ReturnType<typeof fresh>,id:string,from:string,to:string):NativeCampaignArmy {
  const {s,scene}=ctx,g=s.generals[id],army:NativeCampaignArmy={id:`army-${s.nextId++}`,ownerId:g.ownerId!,from,to,roadId:'r1',generalIds:[id],troops:g.troops,totalDays:1,remainingDays:1};
  s.cities[from].troops-=g.troops;g.cityId=null;g.armyId=army.id;s.armies.push(army);expect(initNativeCampaignMovement(scene,army)).toBe(true);return army;
}

describe('campaign source movement adapter',()=>{
  it.each(vectors.pathCases.map((c,index)=>({...c,index})))('uses original city/road relaxation ordering and next hop $index',c=>{
    const scene={...fixture().scenarios[0],cities:c.cities.map(id=>({...fixture().scenarios[0].cities[0],id})),
      roads:c.roads.map(r=>({id:r.id,from:r.fromCity,to:r.toCity,length:r.length,points:[[0,0],[1,0]] as [number,number][],restricted:false}))};
    expect(nativeCampaignNextCity(scene,c.start,c.end)).toEqual(c.native);
  });
  it('walks one pixel per six callbacks and reaches a friendly city without teleporting',()=>{
    const ctx=fresh(),army=depart(ctx,'g1','home','middle'),start=nativeCampaignArmyPosition(army)!;
    for(let i=0;i<5;i++)runNativeCampaignMovement(ctx.s,ctx.scene,{encounter:()=>{throw new Error('unexpected battle');}});
    expect(nativeCampaignArmyPosition(army)).toEqual(start);
    runNativeCampaignMovement(ctx.s,ctx.scene,{encounter:()=>{}});expect(nativeCampaignArmyPosition(army)![0]).toBeGreaterThan(start[0]);
    expect(ctx.s.generals.g1.armyId).toBe(army.id);
    for(let i=0;i<300&&ctx.s.armies.length;i++)runNativeCampaignMovement(ctx.s,ctx.scene,{encounter:()=>{}});
    expect(ctx.s.armies).toHaveLength(0);expect(ctx.s.generals.g1.cityId).toBe('middle');expect(ctx.s.cities.middle.troops).toBe(160);
  });
  it('queues actual opposed armies mid-road, after movement and before any city arrival',()=>{
    const ctx=fresh(),a=depart(ctx,'g1','home','enemy'),b=depart(ctx,'g2','enemy','home');
    const operations:string[]=[],encounters:unknown[]=[];
    for(let i=0;i<600&&!encounters.length;i++)runNativeCampaignMovement(ctx.s,ctx.scene,{afterMovement:()=>operations.push('policy'),encounter:entry=>{operations.push('battle');encounters.push(entry);}});
    expect(encounters).toHaveLength(1);expect(encounters[0]).toMatchObject({kind:'armies'});expect(operations.at(-2)).toBe('policy');
    const positionA=nativeCampaignArmyPosition(a)!,positionB=nativeCampaignArmyPosition(b)!;
    expect(Math.abs(positionA[0]-positionB[0])).toBeLessThanOrEqual(8);expect(positionA[0]).toBeGreaterThan(100);expect(positionA[0]).toBeLessThan(180);
    expect(ctx.s.generals.g1.armyId).toBe(a.id);expect(ctx.s.generals.g2.armyId).toBe(b.id);
  });
  it('runs cooldown before queue dispatch and keeps defeated armies travelling on a selected retreat route',()=>{
    const ctx=fresh(),army=depart(ctx,'g1','home','enemy');army.treasury=1000;
    for(let i=0;i<80;i++)runNativeCampaignMovement(ctx.s,ctx.scene,{encounter:()=>{}});
    const before=nativeCampaignArmyPosition(army)!,rng=[...ctx.s.nativeAI!.rng];
    settleNativeArmyAftermath(ctx.s,ctx.scene,army,4);
    expect(army.nativeMovement).toMatchObject({flags:4,cooldown:60});expect(army.nativeMovement!.timer).toBeGreaterThanOrEqual(120);
    expect(army.treasury).toBeGreaterThanOrEqual(400);expect(army.treasury).toBeLessThan(600);expect(ctx.s.nativeAI!.rng).not.toEqual(rng);
    expect(ctx.s.armies).toContain(army);expect(ctx.s.generals.g1.cityId).toBeNull();expect(nativeCampaignArmyPosition(army)).toEqual(before);
    expect(army.to).toBe('home');expect(army.nativeMovement!.direction).toBe(0);
    const saved=JSON.parse(JSON.stringify(ctx.s)) as typeof ctx.s;
    for(let i=0;i<6;i++){runNativeCampaignMovement(ctx.s,ctx.scene,{encounter:()=>{}});runNativeCampaignMovement(saved,ctx.scene,{encounter:()=>{}});}
    expect(ctx.s.armies).toContain(army);expect(ctx.s.generals.g1.cityId).toBeNull();
    expect(nativeCampaignArmyPosition(army)![0]).toBeLessThan(before[0]);
    expect(nativeCampaignArmyPosition(army)![0]).toBeGreaterThan(100);
    expect(saved).toEqual(ctx.s);
  });
  it('victory pauses travel, expires in source updates, and does not consume RNG',()=>{
    const ctx=fresh(),army=depart(ctx,'g1','home','enemy'),before=nativeCampaignArmyPosition(army),rng=[...ctx.s.nativeAI!.rng];
    settleNativeArmyAftermath(ctx.s,ctx.scene,army,2);
    expect(army.nativeMovement).toMatchObject({flags:2,cooldown:20,timer:240});expect(ctx.s.nativeAI!.rng).toEqual(rng);
    expect(army.remainingDays).toBe(72); // 48 route days plus 24 source-clock halt days.
    for(let i=0;i<240;i++)runNativeCampaignMovement(ctx.s,ctx.scene,{encounter:()=>{}});
    expect(nativeCampaignArmyPosition(army)).toEqual(before);expect(army.nativeMovement!.flags&2).toBe(0);
    for(let i=0;i<6;i++)runNativeCampaignMovement(ctx.s,ctx.scene,{encounter:()=>{}});
    expect(nativeCampaignArmyPosition(army)).not.toEqual(before);
  });
  it('estimates the current three-pixel retreat speed without treating collision cooldown as a halt',()=>{
    const ctx=fresh(),army=depart(ctx,'g1','home','enemy');
    expect(army.remainingDays).toBe(48);
    Object.assign(army.nativeMovement!,{flags:4,timer:120,cooldown:60});
    runNativeCampaignMovement(ctx.s,ctx.scene,{encounter:()=>{}});
    expect(nativeCampaignArmyPosition(army)).toEqual([100,100]);expect(army.remainingDays).toBe(16);
  });
  it('builds migrated officers at city coordinates and preserves legacy armies without a marker',()=>{
    const ctx=fresh(),army=depart(ctx,'g1','home','enemy');expect(retargetNativeCampaignArmy(ctx.scene,army,'middle')).toBe(true);
    expect(army.to).toBe('middle');expect(nativeCampaignNextCity(ctx.scene,'enemy','home')).toEqual({next:'middle',distance:80});
    expect(initNativeCampaignMovement(ctx.scene,army,{cityId:'middle',position:[141,99],destinationId:'enemy'})).toBe(true);
    expect(nativeCampaignArmyPosition(army)).toEqual([141,99]);expect(army.nativeMovement!.nextCityId).toBe('enemy');
    delete army.nativeMovement;const saved=structuredClone(army);runNativeCampaignMovement(ctx.s,ctx.scene,{encounter:()=>{}});expect(army).toEqual(saved);
  });
  it('leaves armies outside a full friendly city and retains their treasury',()=>{
    const ctx=fresh(),army=depart(ctx,'g1','home','middle');army.treasury=70;
    for(let i=0;i<5;i++)ctx.s.generals[`extra-${i}`]={...ctx.s.generals.g1,cityId:'middle',armyId:null,troops:0};
    for(let i=0;i<300;i++)runNativeCampaignMovement(ctx.s,ctx.scene,{encounter:()=>{}});
    expect(ctx.s.armies).toContain(army);expect(ctx.s.generals.g1.armyId).toBe(army.id);expect(ctx.s.cities.middle.money).toBe(0);expect(army.treasury).toBe(70);
  });
  it('validates persistent motion state and uses a genuine original city-retreat choice',()=>{
    const ctx=fresh(),army=depart(ctx,'g1','home','middle'),fail=()=>{throw new Error('bad movement');};
    expect(()=>validateNativeCampaignMovement(ctx.scene,army,fail)).not.toThrow();army.nativeMovement!.nextPoint=99;
    expect(()=>validateNativeCampaignMovement(ctx.scene,army,fail)).toThrow('bad movement');
    expect(nativeDefeatedCityRetreat(ctx.s,ctx.scene,'home')).toBe('middle');
  });
});
