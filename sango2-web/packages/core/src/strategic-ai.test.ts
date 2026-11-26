import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import type {GameContent} from '@sango2/content';
import {createSession as createNativeSession,dispatch,readSession,validateSession,battleGeneral,createBattle,commandBattle,tickBattle,type Session} from './index';
import {nativeReadiness} from './native-ai-campaign';

function fixture():GameContent {
  return {version:1,id:'ai-test',sourceHash:'b'.repeat(64),skills:[],strategies:[],items:[],terrains:[],scenarios:[{
    id:'era',title:'AI',year:184,
    factions:['p','e','r'].map(id=>({id,name:id,leaderId:null,color:'#fff',select:1,special:false})),
    cities:['home','enemy','empty','rival','rear'].map((id,i)=>({id,name:id,ownerId:['p','e',null,'r','e'][i],governorId:null,position:[i*100,100] as [number,number],money:1000,population:10000,defense:50})),
    roads:[['enemy','home'],['enemy','empty'],['enemy','rival'],['rear','enemy']].map(([from,to],i)=>({id:`r${i}`,from,to,length:120,points:[[0,0],[100,0]] as [number,number][],restricted:false})),
    generals:['p1','e1','e2','e3','r1','e4','e5'].map((id,i)=>({id,name:id,portrait:'portraits/001.png',strength:id[0]==='e'?90:50,intelligence:70,hp:100,mp:40,loyalty:100,status:'登',cityId:['home','enemy','enemy','enemy','rival','rear','rear'][i],ownerId:id[0],weapon:'',horse:'',item:'',unit:'刀',formations:[],rawSkill:'',rawStrategy:'',sourceLine:1}))
  }]};
}
const advance=(s:Session,n:number,c:GameContent)=>dispatch(s,{type:'advance',days:n},c);
function invasion(extraDefender=false) {
  const c=fixture();c.scenarios[0].roads=c.scenarios[0].roads.filter(r=>r.to==='home');
  if(extraDefender) {
    c.scenarios[0].generals.push({...c.scenarios[0].generals[0],id:'p2',name:'p2'});
    c.scenarios[0].cities[0].governorId='p1';
  }
  let s=createSession(c,'era','e');
  s=dispatch(s,{type:'march',from:'enemy',to:'home',generalIds:['e1','e2'],troops:160},c);s.factionId='p';
  // Settlement regression setup is independent of the native weighted decision draw.
  s=advance(s,2,c);expect(s.battle?.invasionSide).toBe('defender');return {c,s};
}
describe('rival strategy and player defense',()=>{
  it('uses deployable class counts for AI and preserves them through battle, save and a second encounter',()=>{
    const c=fixture(),scene=c.scenarios[0];scene.generals.forEach(g=>g.level=40);
    let s=createSession(c,'era','p');s.nativeAI!.countdowns.e=900;s.nativeAI!.countdowns.r=900;
    s.generals.p1.troopSlots={active:30,reserve:40};
    expect(nativeReadiness(s,scene,'p1')).toMatchObject({troops:30,reserve:40,maxTroops:100,maxReserve:100});
    s=dispatch(s,{type:'march',from:'home',to:'enemy',generalIds:['p1'],troops:80},c);s=advance(s,2,c);
    expect(s.battle!.troopDeployment!.attacker).toEqual({active:30,reserve:40});
    s=dispatch(s,{type:'battle-command',command:{type:'start'}},c);
    const soldier=s.battle!.units.find(u=>u.side==='attacker'&&!u.general&&!u.nativeReserve)!;soldier.hp=0;soldier.action='death';
    s=dispatch(s,{type:'battle-command',command:{type:'order',division:'all',order:'retreat'}},c);
    for(let i=0;i<20&&s.battle?.phase==='fighting';i++)s=dispatch(s,{type:'battle-tick',steps:200},c);
    expect(s.battle!.phase).toBe('finished');
    s=dispatch(s,{type:'battle-finish'},c);
    expect(s.generals.p1.troopSlots).toEqual({active:29,reserve:40});expect(s.generals.p1.troops).toBe(79);
    s=readSession(JSON.parse(JSON.stringify(s)),c);
    s=dispatch(s,{type:'march',from:'home',to:'enemy',generalIds:['p1'],troops:79},c);s=advance(s,2,c);
    expect(s.battle!.troopDeployment!.attacker).toEqual({active:29,reserve:40});expect(s.battle!.reserves.attacker).toBe(10);
    validateSession(s,c);
  });
  it('excludes overcapacity totals from AI reserves and rejects corrupt campaign slots',()=>{
    const c=fixture();c.scenarios[0].generals[0].level=2;const s=createSession(c,'era','p');
    expect(nativeReadiness(s,c.scenarios[0],'p1')).toMatchObject({troops:10,reserve:0,maxTroops:10,maxReserve:0});
    s.generals.p1.troopSlots={active:10,reserve:1};expect(()=>validateSession(s,c)).toThrow();
  });
  it('assigns fortifications to the city defender on either player screen side',()=>{
    const defensive=invasion();
    expect(defensive.s.battle!.fortifications).toEqual({attacker:50,defender:0});
    const c=fixture();let s=createSession(c,'era','p');
    s.nativeAI!.countdowns.e=900;s.nativeAI!.countdowns.r=900;s.cities.enemy.defense=749;
    s=dispatch(s,{type:'march',from:'home',to:'enemy',generalIds:['p1'],troops:80},c);
    s=advance(s,2,c);
    expect(s.battle!.fortifications).toEqual({attacker:0,defender:749});
    expect(readSession(s,c)).toEqual(s);
  });
  it('uses the appointed governor to lead a defensive encounter after loading the campaign', () => {
    const content = fixture();
    const scene = content.scenarios[0];
    scene.cities.find(city => city.id === 'enemy')!.governorId = 'e2';

    let campaign = createNativeSession(content, 'era', 'e');
    campaign = dispatch(campaign, { type: 'policy-governor', cityId: 'enemy', generalId: 'e1' }, content);
    campaign = dispatch(campaign, { type: 'policy-finish' }, content);
    campaign.factionId = 'p';
    campaign = dispatch(campaign, { type: 'march', from: 'home', to: 'enemy', generalIds: ['p1'], troops: 80 }, content);
    campaign.factionId = 'e';
    campaign.nativeAI!.countdowns.p = 900;
    campaign.nativeAI!.countdowns.r = 900;

    const restored = readSession(JSON.parse(JSON.stringify(campaign)), content);
    const legacy = structuredClone(restored);
    delete legacy.policy;
    const defending = advance(restored, 2, content).battle!;
    const legacyDefending = advance(legacy, 2, content).battle!;

    expect(defending.invasionSide).toBe('defender');
    expect(defending.rosters.attacker.map(member => member.commander.id)).toEqual(['e1', 'e2', 'e3']);
    expect(defending.commanders.attacker.id).toBe('e1');
    expect(legacyDefending.commanders.attacker.id).toBe('e2');
  });
  it('keeps officer allocations when reinforcements enter a friendly city',()=>{
    const c=fixture();let s=createSession(c,'era','e');
    s.nativeAI!.countdowns.p=900;s.nativeAI!.countdowns.r=900;
    s.generals.e4.troops=10;s.generals.e5.troops=150;
    s=dispatch(s,{type:'march',from:'enemy',to:'rear',generalIds:['e1','e2'],troops:160,troopsByGeneral:{e1:15,e2:145}},c);
    s=advance(s,2,c);
    expect(['e1','e2','e4','e5'].map(id=>s.generals[id].troops)).toEqual([15,145,10,150]);
    expect(s.cities.rear.troops).toBe(320);expect(()=>validateSession(s,c)).not.toThrow();
    expect(readSession(s,c)).toEqual(s);
  });
  it('preserves defending officer soldiers and wounded reserves through battle entry',()=>{
    const c=fixture();c.scenarios[0].cities.find(city=>city.id==='enemy')!.governorId='e2';
    let s=createSession(c,'era','p');
    s.nativeAI!.countdowns.e=900;s.nativeAI!.countdowns.r=900;
    s.generals.e1.troops=10;s.generals.e2.troops=150;s.generals.e3.troops=80;
    s=dispatch(s,{type:'march',from:'home',to:'enemy',generalIds:['p1'],troops:80},c);
    s=advance(s,1,c);s.generals.e3.hp=0;
    s.nativeAI!.recovery.e3.hp=100;
    s=advance(s,1,c);
    const roster=s.battle!.rosters.defender;
    expect(roster.map(m=>m.commander.id)).toEqual(['e2','e3','e1']);
    expect(Object.fromEntries(roster.map(m=>[m.commander.id,m.troops]))).toEqual({e1:10,e2:150,e3:80});
    expect(roster.find(m=>m.commander.id==='e3')!.withdrawn).toBe(true);
    expect(s.battle!.commanders.defender.id).not.toBe('e3');
    expect(s.battle!.totalInitial.defender).toBe(240);
    expect(readSession(s,c)).toEqual(s);
    s=dispatch(s,{type:'battle-command',command:{type:'start'}},c);
    battleGeneral(s.battle!,'attacker').hp=0;
    s=dispatch(s,{type:'battle-tick',steps:1},c);
    s=dispatch(s,{type:'battle-finish'},c);
    expect(['e1','e2','e3'].map(id=>s.generals[id].troops)).toEqual([10,150,80]);
    expect(()=>validateSession(s,c)).not.toThrow();
  });
  it('uses native weighted expansion, leaves an officer and spends real money on recruits',()=>{
    const c=fixture();c.scenarios[0].roads=c.scenarios[0].roads.filter(r=>r.to==='empty');
    const initial=createSession(c,'era','p');let s=initial;
    for(let day=0;day<120&&!s.armies.some(a=>a.ownerId==='e');day++)s=advance(s,1,c);
    const army=s.armies.find(a=>a.ownerId==='e')!;
    expect(army.to).toBe('empty');expect(army.generalIds.length).toBeLessThanOrEqual(5);
    expect(s.cities.enemy.money).toBeLessThan(initial.cities.enemy.money);expect(s.cities.enemy.population).toBe(10000);
    expect(army.treasury).toBeGreaterThanOrEqual(0);
    expect(s.nativeAI!.trace.some(t=>t.kind===8)).toBe(true);
    expect(s.cities.enemy.troops).toBeGreaterThan(0);
    expect(Object.values(s.generals).some(g=>g.cityId==='enemy'&&g.ownerId==='e')).toBe(true);
    s=advance(s,2,c);expect(s.cities.empty.ownerId).toBe('e');expect(s.battle).toBeNull();
    expect(s.chronicle.some(e=>e.text.includes('此城归属e'))).toBe(true);
    expect(()=>validateSession(s,c)).not.toThrow();expect(initial.day).toBe(0);
  });
  it('does not bypass road restrictions or recruit without money',()=>{
    const c=fixture(),scene=c.scenarios[0],s=createSession(c,'era','p');
    for(const id of ['enemy','rear']){s.cities[id].money=0;s.cities[id].population=0;}
    scene.roads.forEach(r=>r.restricted=true);
    const after=advance(s,30,c);expect(after.armies).toEqual([]);
    expect(after.nativeAI!.reserves.enemy).toBe(0);expect(after.cities.enemy.money).toBe(0);
    expect(()=>dispatch(s,{type:'recruit',cityId:'enemy'},c)).toThrow('我方');
  });
  it('migrates old saves and rejects corrupt native RNG/cooldowns',()=>{
    const c=fixture(),s=createSession(c,'era','p');delete s.nativeAI;
    const restored=readSession(s,c);expect(restored.nativeAI!.version).toBe(1);
    const badRng=structuredClone(restored);badRng.nativeAI!.rng[0]=-1;expect(()=>readSession(badRng,c)).toThrow();
    const badTimer=structuredClone(restored);badTimer.nativeAI!.countdowns.e=NaN;expect(()=>readSession(badTimer,c)).toThrow();
    expect(readSession(restored,c)).toEqual(restored);
  });
  it('computer-versus-computer battles resolve without interrupting the player and conserve survivors',()=>{
    const c=fixture();c.scenarios[0].roads=c.scenarios[0].roads.filter(r=>r.to==='rival');
    let s=createSession(c,'era','e');const before=s.cities.enemy.troops+s.cities.rival.troops;
    const beforeAiRng=[...s.nativeAI!.rng];
    s=dispatch(s,{type:'march',from:'enemy',to:'rival',generalIds:['e1','e2'],troops:160},c);s.factionId='p';
    s=advance(s,2,c);expect(s.battle).toBeNull();expect(s.cities.rival.ownerId).toBe('e');
    expect(s.cities.enemy.troops+s.cities.rival.troops).toBeLessThan(before+100);
    expect(s.nativeAI!.rng).not.toEqual(beforeAiRng);
    expect(s.reports).toEqual([]);expect(s.chronicle.some(e=>e.text.includes('诸侯战报'))).toBe(true);
    expect(()=>validateSession(s,c)).not.toThrow();
  });
  it('keeps the player in control of defenders, supports save/reload and settles a defensive victory once',()=>{
    let {c,s}=invasion();expect(s.battle!.commanders.attacker.id).toBe('p1');
    expect(()=>validateSession(s,c)).not.toThrow();s=readSession(s,c);
    s=dispatch(s,{type:'battle-command',command:{type:'order',division:'all',order:'hold'}},c);
    expect(s.battle!.units.filter(u=>u.side==='attacker').every(u=>u.order==='hold')).toBe(true);
    const enemyIds=s.battle!.rosters.defender.map(m=>m.commander.id);
    // Defeat every invading commander through the existing round state machine.
    while(s.battle!.phase!=='finished') {
      s=dispatch(s,{type:'battle-command',command:s.battle!.phase==='intermission'?{type:'next-round',commanderId:'p1'}:{type:'start'}},c);
      if(s.battle!.phase==='deployment')s=dispatch(s,{type:'battle-command',command:{type:'start'}},c);
      battleGeneral(s.battle!,'defender').hp=0;
      s=dispatch(s,{type:'battle-tick',steps:1},c);
    }
    s=dispatch(s,{type:'battle-finish'},c);
    expect(s.cities.home.ownerId).toBe('p');expect(s.reports[0].won).toBe(true);
    expect(enemyIds.every(id=>s.generals[id].cityId==='enemy')).toBe(true);
    expect(()=>validateSession(s,c)).not.toThrow();expect(()=>dispatch(s,{type:'battle-finish'},c)).toThrow();
  });
  it('losing the last defended city never deposits the invaders into another owner army',()=>{
    let {c,s}=invasion();s=dispatch(s,{type:'battle-command',command:{type:'start'}},c);
    battleGeneral(s.battle!,'attacker').hp=0;s=dispatch(s,{type:'battle-tick',steps:1},c);
    s=dispatch(s,{type:'battle-finish'},c);
    expect(s.cities.home.ownerId).toBe('e');expect(s.reports[0].won).toBe(false);
    expect(s.generals.p1.ownerId).toBeNull();expect(()=>validateSession(s,c)).not.toThrow();
  });
  it('withdraws both commanders at dusk and keeps the strategic role for the next pair',()=>{
    let {c,s}=invasion(true);s=dispatch(s,{type:'battle-command',command:{type:'start'}},c);
    s.battle!.tick=3959;s=dispatch(s,{type:'battle-tick',steps:1},c);
    expect(s.battle!.history[0].winner).toBe('attacker');
    expect(s.battle!.rosters.attacker.find(m=>m.commander.id==='p1')!.withdrawn).toBe(true);
    expect(s.battle!.rosters.defender.find(m=>m.commander.id===s.battle!.commanders.defender.id)!.withdrawn).toBe(true);
    expect(()=>dispatch(s,{type:'battle-command',command:{type:'next-round',commanderId:'p1'}},c)).toThrow();
    s=dispatch(s,{type:'battle-command',command:{type:'next-round',commanderId:'p2'}},c);
    expect(s.battle!.invasionSide).toBe('defender');
  });
  it('does not return a defeated army to its captured origin',()=>{
    let {c,s}=invasion();const ids=s.battle!.rosters.defender.map(m=>m.commander.id);
    s.cities.enemy.ownerId='r';const capturedTroops=s.cities.enemy.troops;
    while(s.battle!.phase!=='finished') {
      if(s.battle!.phase==='intermission')s=dispatch(s,{type:'battle-command',command:{type:'next-round',commanderId:'p1'}},c);
      s=dispatch(s,{type:'battle-command',command:{type:'start'}},c);
      battleGeneral(s.battle!,'defender').hp=0;s=dispatch(s,{type:'battle-tick',steps:1},c);
    }
    s=dispatch(s,{type:'battle-finish'},c);
    expect(ids.every(id=>s.generals[id].cityId==='rear')).toBe(true);
    expect(s.cities.enemy.troops).toBe(capturedTroops);expect(()=>validateSession(s,c)).not.toThrow();
  });
  it('a city whose officers are all wounded still offers a playable garrison defense',()=>{
    const c=fixture();c.scenarios[0].roads=c.scenarios[0].roads.filter(r=>r.to==='home');
    let s=createSession(c,'era','e');s=dispatch(s,{type:'march',from:'enemy',to:'home',generalIds:['e1','e2'],troops:160},c);s.factionId='p';
    s=advance(s,1,c);s.generals.p1.hp=0;s=advance(s,1,c);
    expect(s.battle!.commanders.attacker.id).toBe('garrison');expect(s.battle!.totalInitial.attacker).toBe(80);
    expect(()=>validateSession(s,c)).not.toThrow();expect(()=>readSession(s,c)).not.toThrow();
  });
  it('real five-era AI remains deterministic and valid across 60 days and defensive settlements',()=>{
    const pack=JSON.parse(readFileSync(new URL('../../../apps/game/public/assets/content.json',import.meta.url),'utf8')) as GameContent;
    for(const scene of pack.scenarios) {
      let s=createSession(pack,scene.id,scene.factions.find(f=>!f.special&&scene.cities.some(c=>c.ownerId===f.id))!.id);
      let marches=0;
      for(let day=0;day<60;day++) {
        const same=readSession(s,pack),a=advance(s,1,pack),b=advance(same,1,pack);expect(a).toEqual(b);s=a;
        marches+=s.armies.filter(a=>a.ownerId!==s.factionId).length;
        let guard=0;
        while(s.battle) {
          expect(++guard).toBeLessThan(100);
          if(s.battle.phase==='deployment')s=dispatch(s,{type:'battle-command',command:{type:'start'}},pack);
          if(s.battle?.phase==='fighting') {battleGeneral(s.battle,'attacker').hp=0;s=dispatch(s,{type:'battle-tick',steps:1},pack);}
          if(s.battle?.phase==='intermission')s=dispatch(s,{type:'battle-command',command:{type:'withdraw'}},pack);
          if(s.battle?.phase==='finished')s=dispatch(s,{type:'battle-finish'},pack);
        }
        expect(()=>validateSession(s,pack)).not.toThrow();
      }
      expect(marches).toBeGreaterThan(0);
      // Native six-update movement can leave all expeditions on the road in
      // this window; marching no longer promises a city capture in 60 days.
      expect(s.nativeAI!.callbacks).toBeGreaterThan(0);
    }
  },60000);
});

describe('opponent tactical decisions',()=>{
  it('uses native healing weights and pays only when the lottery chooses an affordable learned skill',()=>{
    const base=fixture().scenarios[0].generals[0];
    let casts=0;
    for(let seed=1;seed<=32;seed++) {
      let b=createBattle({id:'heal-ai',attacker:base,defender:{...base,id:'enemy',hp:5,maxHp:100,level:1,skillLearnset:[{level:1,sequence:1}]},attackingTroops:0,defendingTroops:0,seed});
      b=commandBattle(b,{type:'start'});b.commanders.defender.charge=120000;
      tickBattle(b,4);
      if(b.activeScript){casts++;expect(b.commanders.defender.mp).toBe(20);expect(b.activeScript.side).toBe('defender');
        expect(b.activeScript.kind).toBe('native-heal');
        tickBattle(b,140);expect(battleGeneral(b,'defender').hp).toBe(35);expect(b.commanders.attacker.mp).toBe(40);}
      else expect(b.commanders.defender.mp).toBe(40);
    }
    expect(casts).toBeGreaterThan(0);expect(casts).toBeLessThan(32);
  });
  it('withdraws through the native lottery rather than a mandatory low-HP threshold',()=>{
    const base=fixture().scenarios[0].generals[0];let retreats=0;
    for(let seed=1;seed<=64;seed++) {
      let b=createBattle({id:'retreat-ai',attacker:base,defender:{...base,id:'enemy',hp:5,maxHp:100},attackingTroops:100,defendingTroops:0,seed});
      b=commandBattle(b,{type:'start'});tickBattle(b,4);
      if(b.opponentAI!.lastAction===6){retreats++;expect(battleGeneral(b,'defender').order).toBe('retreat');}
    }
    expect(retreats).toBeGreaterThan(0);expect(retreats).toBeLessThan(64);
  });
  it('executes a learned non-healing skill selected by the native tactical lottery',()=>{
    const base=fixture().scenarios[0].generals[0];let casts=0;
    for(let seed=1;seed<=64;seed++) {
      let b=createBattle({id:'area-ai',attacker:{...base,id:'attacker',hp:100,maxHp:100},defender:{...base,id:'enemy',hp:100,maxHp:100,level:1,rawSkill:'1, 3',skillLearnset:[{level:1,sequence:3}]},attackingTroops:100,defendingTroops:100,seed});
      b=commandBattle(b,{type:'start'});b.commanders.defender.charge=120000;
      tickBattle(b,4);
      if(b.opponentAI!.lastSkill===3) {
        casts++;expect(b.activeScript?.kind).toBe('magic-area');expect(b.activeScript?.side).toBe('defender');
      }
    }
    expect(casts).toBeGreaterThan(0);
  });
});

function createSession(...args:Parameters<typeof createNativeSession>) {
  return dispatch(createNativeSession(...args),{type:"policy-finish"},args[0]);
}
