import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {nativeRecoverCondition,nativeBattleFatigue,initialConditionTimers,initialOfficerCondition,type NativeOfficerCondition,type NativeConditionTimers} from './native-officer-condition';
import {createBattle,commandBattle,tickBattle,battleGeneral,validateBattle,NATIVE_STRATEGIES} from './battle';
import {createSession,dispatch,readSession,validateSession} from './index';
import {runNativeStrategicCallback} from './native-ai-campaign';
import type {GameContent} from '@sango2/content';

const vectors=JSON.parse(readFileSync(new URL('../fixtures/native-condition-vectors.json',import.meta.url),'utf8')) as {
  recovery:{input:{state:NativeOfficerCondition;timers:NativeConditionTimers;stationed:boolean;defense:number;updates:number};native:{state:NativeOfficerCondition;timers:NativeConditionTimers}}[];
  settlement:{input:{states:NativeOfficerCondition[];entryMorale:number[];enabled:boolean[];modifiers:number[];updates:number;rng:number[]};native:{elapsed:number;states:NativeOfficerCondition[];rng:number[]}}[];
};
describe('native officer recovery and round settlement',()=>{
  it.each(vectors.recovery.map((v,index)=>({...v,index})))('matches native condition and all five clocks $index',({input:o,native})=>{
    const state={...o.state},timers={...o.timers};
    for(let i=0;i<o.updates;i++)nativeRecoverCondition(state,timers,o.stationed,o.defense);
    expect({state,timers}).toEqual(native);
  });
  it.each(vectors.settlement.map((v,index)=>({...v,index})))('matches elapsed-count fatigue and temporary morale restoration $index',({input:o,native})=>{
    expect(Math.trunc(o.updates/120)).toBe(native.elapsed);
    const states=o.states.map((s,i)=>({...s,morale:o.entryMorale[i],fatigue:nativeBattleFatigue(s.fatigue,native.elapsed,o.enabled[i]?o.modifiers[i]:0)}));
    expect(states).toEqual(native.states);expect(o.rng).toEqual(native.rng);
  });
});
const sequence=(execute:number)=>NATIVE_STRATEGIES.find(s=>s.execute===execute)!.sequence;
const commander=(id:string,execute=0)=>({id,name:id,portrait:'portraits/001.png',strength:80,intelligence:90,hp:100,mp:50,unit:'刀',level:20,
  ...initialOfficerCondition(),morale:55,loyalty:90,fatigue:10,
  strategyLearnset:execute?[{level:1,sequence:sequence(execute)}]:[]});
function battle(execute:number,enemy=0) {
  let b=createBattle({id:'condition',attacker:commander('a',execute),defender:commander('d',enemy),attackingTroops:0,defendingTroops:0,seed:184});
  b=commandBattle(b,{type:'strategy',advisorId:'a',sequence:sequence(execute)});
  return commandBattle(b,{type:'start'});
}
describe('condition lifecycle integration',()=>{
  it('restores temporary morale but retains fatigue and enemy loyalty loss after settlement',()=>{
    const b=battle(6,32);
    expect(b.commanders.attacker.morale).toBe(95);expect(b.commanders.attacker.loyalty).toBe(65);
    b.tick=399;battleGeneral(b,'defender').hp=0;tickBattle(b);
    expect(b.rosters.attacker[0].commander).toMatchObject({morale:55,loyalty:65,fatigue:26});
    expect(b.rosters.defender[0].commander.fatigue).toBe(26);validateBattle(b);
    const loaded=JSON.parse(JSON.stringify(b));validateBattle(loaded);tickBattle(loaded);
    expect(loaded).toEqual(b); // completed round cannot apply fatigue twice
  });
  it('combines team fatigue modifiers without mixing them into combat flags',()=>{
    const b=battle(14,10); // own -3, enemy +2 => -1 => 75%
    expect(b.strategies!.effects.attacker.fatigueModifier).toBe(-1);
    expect(b.strategies!.effects.attacker.settlementFlags).toBe(4096);
    expect(b.strategies!.effects.attacker.flags).toBe(0);
    battleGeneral(b,'defender').hp=0;tickBattle(b);
    expect(b.commanders.attacker.fatigue).toBe(21);expect(b.commanders.defender.fatigue).toBe(25);
  });
  it('resumes condition state and rejects invalid clocks and values',()=>{
    const b=battle(3);const loaded=JSON.parse(JSON.stringify(b));validateBattle(loaded);
    tickBattle(b,20);tickBattle(loaded,20);expect(loaded).toEqual(b);
    loaded.commanders.attacker.morale=101;expect(()=>validateBattle(loaded)).toThrow();
    const old=battle(0);delete old.commanders.attacker.morale;delete old.strategies!.entry.attacker.morale;
    delete old.strategies!.effects.attacker.morale;delete old.strategies!.effects.attacker.settlementFlags;
    validateBattle(old);tickBattle(old);validateBattle(old);
  });
});

function content():GameContent {
  return {version:1,id:'conditions',sourceHash:'a'.repeat(64),items:[],skills:[],strategies:[],terrains:[],scenarios:[{
    id:'era',title:'状态回归',year:184,factions:['p','e'].map(id=>({id,name:id,leaderId:null,color:'#fff',select:1,special:false})),
    cities:['home','enemy'].map((id,i)=>({id,name:id,ownerId:i?'e':'p',governorId:null,position:[i*100,100],money:1000,population:10000,defense:999})),
    roads:[{id:'road',from:'home',to:'enemy',length:120,points:[[0,0],[100,0]],restricted:false}],
    generals:['p','e'].map((id,i)=>({...commander(id),loyalty:0,status:'登',cityId:i?'enemy':'home',ownerId:id,weapon:'',horse:'',item:'',formations:[],rawSkill:'',rawStrategy:'',sourceLine:1}))
  }]};
}
describe('campaign condition persistence',()=>{
  it('initializes native values, updates fatigue before morale and morale before loyalty',()=>{
    const c=content(),s=createSession(c,'era','p'),g=s.generals.p;
    expect(g).toMatchObject({morale:80,fatigue:0,loyalty:90}); // LOYAL name is not a numeric score
    Object.assign(g,{fatigue:60,morale:39,loyalty:29});
    runNativeStrategicCallback(s,c.scenarios[0],()=>{});
    expect(g).toMatchObject({fatigue:59,morale:40,loyalty:30});
    expect(s.nativeAI!.recovery.p).toMatchObject({fatigue:45,moraleGain:360,loyaltyGain:450});
    expect(readSession(s,c)).toEqual(s);
    s.nativeAI!.recovery.p.moraleGain=32768;expect(()=>validateSession(s,c)).toThrow();
  });
  it('keeps timers paused during marching and migrates old missing fields on the next city callback',()=>{
    const c=content();let s=createSession(c,'era','p');s.nativeAI!.countdowns.e=900;
    Object.assign(s.generals.p,{fatigue:80,morale:39,loyalty:40});
    s=dispatch(s,{type:'march',from:'home',to:'enemy',generalIds:['p'],troops:80},c);
    const before=structuredClone(s.generals.p),timers=structuredClone(s.nativeAI!.recovery.p);
    runNativeStrategicCallback(s,c.scenarios[0],()=>{});
    expect(s.generals.p).toEqual(before);expect(s.nativeAI!.recovery.p).toEqual(timers);
    const old=createSession(c,'era','p');delete old.generals.p.morale;delete old.generals.p.fatigue;delete old.generals.p.loyalty;
    for(const key of Object.keys(initialConditionTimers()) as (keyof NativeConditionTimers)[])delete old.nativeAI!.recovery.p[key];
    const loaded=readSession(old,c);expect(loaded).toEqual(old);
    runNativeStrategicCallback(loaded,c.scenarios[0],()=>{});expect(loaded.generals.p).toMatchObject(initialOfficerCondition());
  });
  it('passes condition into battle and writes it back after withdrawal',()=>{
    const c=content();let s=createSession(c,'era','p');s.nativeAI!.countdowns.e=900;
    Object.assign(s.generals.p,{fatigue:40,morale:85,loyalty:77});
    s=dispatch(s,{type:'march',from:'home',to:'enemy',generalIds:['p'],troops:80},c);
    s=dispatch(s,{type:'advance',days:2},c);
    expect(s.battle!.commanders.attacker).toMatchObject({fatigue:40,morale:85,loyalty:77});
    s=dispatch(s,{type:'battle-command',command:{type:'start'}},c);
    s=dispatch(s,{type:'battle-command',command:{type:'order',division:'general',order:'retreat'}},c);
    for(let i=0;i<20&&s.battle?.phase==='fighting';i++)s=dispatch(s,{type:'battle-tick',steps:200},c);
    expect(s.battle!.phase).toBe('finished');
    const fatigue=nativeBattleFatigue(40,Math.trunc(s.battle!.tick*3/120));
    s=dispatch(s,{type:'battle-finish'},c);
    expect(s.generals.p).toMatchObject({fatigue,morale:85,loyalty:77});expect(readSession(s,c)).toEqual(s);
  });
});
