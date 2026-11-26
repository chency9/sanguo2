import {describe,it,expect} from 'vitest';
import type {GameContent} from '@sango2/content';
import {createSession,dispatch,readSession,validateSession,strategicArmyPosition,type Session,battleGeneral} from './index';

function fixture():GameContent {
  return {version:1,id:'road-dispatch',sourceHash:'b'.repeat(64),skills:[],strategies:[],items:[],terrains:[],scenarios:[{
    id:'era',title:'道路相遇',year:184,initialization:'native-105plus',
    factions:['p','e','r'].map(id=>({id,name:id,leaderId:null,color:'#fff',select:1,special:false})),
    cities:['home','enemy','rear'].map((id,i)=>({id,name:id,ownerId:['p','e','r'][i],governorId:null,position:[100+i*80,100],money:0,population:10000,defense:99})),
    roads:[{id:'r1',from:'home',to:'enemy',length:80,points:[[100,100],[140,100],[180,100]],restricted:false}],
    generals:['p1','e1','p2','e2'].map((id,i)=>({id,name:id,portrait:'',strength:80,intelligence:80,hp:100,mp:40,level:20,
      status:'登',ownerId:id[0],cityId:i%2?'enemy':'home',loyalty:90,constancy:5,weapon:'',horse:'',item:'',unit:'刀',formations:['方'],rawSkill:'',rawStrategy:'',sourceLine:1})),
  }]};
}
function marchBoth(c:GameContent,player='p') {
  let s=dispatch(createSession(c,'era','p'),{type:'policy-finish'},c);delete s.captureRules;
  for(const id of Object.keys(s.nativeAI!.countdowns))s.nativeAI!.countdowns[id]=999;
  for(const [owner,from,to,id] of [['p','home','enemy','p1'],['e','enemy','home','e1']]) {
    s.factionId=owner;s=dispatch(s,{type:'march',from,to,generalIds:[id],troops:60},c);
  }
  s.factionId=player;return s;
}
function restore(s:Session,c:GameContent){validateSession(s,c);return readSession(JSON.parse(JSON.stringify(s)),c);}

describe('source movement through the actual dispatch entry',()=>{
  it('walks slowly on source updates, encounters on the road, and preserves a frozen partial day across JSON',()=>{
    const c=fixture(),scene=c.scenarios[0];let s=marchBoth(c);
    expect(s.armies.every(a=>!!a.nativeMovement)).toBe(true);
    s=dispatch(s,{type:'advance',days:1},c);
    expect(strategicArmyPosition(scene,s.armies[0])![0]).toBeGreaterThan(100);
    expect(strategicArmyPosition(scene,s.armies[0])![0]).toBeLessThan(103);
    s=dispatch(s,{type:'advance',days:30},c);
    expect(s.battle?.roadEncounter).toBeDefined();expect(s.battle!.cityId).toBeNull();expect(s.battle!.fortifications).toBeUndefined();
    expect(s.armies).toHaveLength(2);expect(s.nativeMovementClock!.callbackInDay).toBeGreaterThan(0);
    const saved=restore(s,c),clock=structuredClone(s.nativeMovementClock),positions=s.armies.map(a=>strategicArmyPosition(scene,a));
    s=dispatch(s,{type:'battle-command',command:{type:'start'}},c);
    const replay=dispatch(saved,{type:'battle-command',command:{type:'start'}},c);expect(s).toEqual(replay);
    battleGeneral(s.battle!,'defender').hp=0;s=dispatch(s,{type:'battle-tick',steps:1},c);
    s=dispatch(s,{type:'battle-finish'},c);
    expect(s.battle).toBeNull();expect(s.nativeMovementClock).toEqual(clock);expect(s.armies.map(a=>strategicArmyPosition(scene,a))).toEqual(positions);
    expect(s.armies.some(a=>(a.nativeMovement!.flags&4)!==0)).toBe(true);expect(s.armies.some(a=>(a.nativeMovement!.flags&2)!==0)).toBe(true);
    s=restore(s,c);const day=s.day,callbacks=s.nativeAI!.callbacks;
    s=dispatch(s,{type:'advance',days:1},c);expect(s.day).toBe(day+1);expect(s.nativeAI!.callbacks-callbacks).toBe(20-clock!.callbackInDay);
    expect(s.nativeMovementClock).toBeUndefined();restore(s,c);
  });
  it('resolves actual computer armies synchronously and keeps surviving armies in transit',()=>{
    const c=fixture();let s=marchBoth(c,'r');s=dispatch(s,{type:'advance',days:30},c);
    expect(s.battle).toBeNull();expect(s.chronicle.some(e=>e.text.includes('道路交战'))).toBe(true);
    expect(s.armies.every(a=>a.generalIds.every(id=>s.generals[id].armyId===a.id))).toBe(true);restore(s,c);
  });
  it('keeps legacy armies on the saved daily model and uses source motion only for new native sessions',()=>{
    const c=fixture();let s=dispatch(createSession(c,'era','p'),{type:'policy-finish'},c);delete s.movementRules;delete s.captureRules;
    s=dispatch(s,{type:'march',from:'home',to:'enemy',generalIds:['p1'],troops:60},c);expect(s.armies[0].nativeMovement).toBeUndefined();
    s=dispatch(s,{type:'advance',days:2},c);expect(s.battle).not.toBeNull();expect(s.battle!.roadEncounter).toBeUndefined();restore(s,c);
  });
});
