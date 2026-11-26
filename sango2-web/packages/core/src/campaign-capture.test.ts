import {describe,it,expect} from 'vitest';
import type {GameContent,GeneralDefinition} from '@sango2/content';
import {createSession,dispatch,readSession,validateSession,type Session} from './index';
import {battleGeneral} from './battle';
import {runNativeStrategicCallback} from './native-ai-campaign';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {refreshPolicyGovernors} from './native-policy';
import {ensureDomesticSearch} from './native-policy-actions';
import {nativeBelow,type NativeRandomState} from './native-strategic-ai';

function content(enemies=2):GameContent {
  const officer=(id:string,ownerId:string,cityId:string):GeneralDefinition=>({id,name:id,portrait:'portraits/001.png',strength:80,intelligence:80,hp:100,mp:50,
    level:27,baseHp:70,baseMp:30,baseExperience:0,constancy:id==='e1'?10:6,loyalFactionId:id==='e1'?'e':null,
    loyalty:90,status:'登',ownerId,cityId,weapon:'',horse:'',item:'',unit:'刀',formations:['方'],forceMask:8191,rawSkill:'',rawStrategy:'',skillLearnset:[],strategyLearnset:[],sourceLine:1});
  return {version:1,id:'capture-campaign',sourceHash:'c'.repeat(64),items:[],skills:[],strategies:[],terrains:[],scenarios:[{
    id:'era',title:'俘将闭环',year:184,initialization:'native-105plus',
    factions:[{id:'p',name:'我军',leaderId:'p-ruler',color:'#f00',select:1,special:false},{id:'e',name:'敌军',leaderId:'e-ruler',color:'#00f',select:1,special:false},{id:'bandit',name:'盗贼',leaderId:null,color:'#777',select:0,special:true}],
    cities:['p-home','e-home','p-back','e-back'].map((id,i)=>({id,name:id,ownerId:id[0],governorId:id.endsWith('home')?`${id[0]}1`:`${id[0]}-ruler`,position:[i*10,0],money:1000,population:100000,defense:0})),
    roads:[{id:'main',from:'p-home',to:'e-home',length:10,points:[[0,0],[10,0]],restricted:false},
      {id:'p-road',from:'p-home',to:'p-back',length:20,points:[[0,0],[20,0]],restricted:false},
      {id:'e-road',from:'e-home',to:'e-back',length:20,points:[[10,0],[30,0]],restricted:false}],
    generals:[officer('p1','p','p-home'),...Array.from({length:enemies},(_,i)=>officer(`e${i+1}`,'e','e-home')),officer('p-ruler','p','p-back'),officer('e-ruler','e','e-back')],
  }]};
}
function entered(c:GameContent,invader:'p'|'e'='p'):Session {
  let s=dispatch(createSession(c,'era',invader),{type:'policy-finish'},c);
  for(const id of Object.keys(s.nativeAI!.countdowns))s.nativeAI!.countdowns[id]=900;
  for(const [id,g] of Object.entries(s.generals)) {
    Object.assign(g,{hp:41,mp:17,troops:26,troopSlots:{active:17,reserve:9},morale:80,fatigue:5,loyalty:id==='e1'?100:20});
    Object.assign(s.nativeAI!.recovery[id],{hp:30000,mp:30000,moraleGain:30000,moraleLoss:30000,fatigue:30000,loyaltyGain:30000,loyaltyLoss:30000});
  }
  for(const id of Object.keys(s.cities)){s.cities[id].troops=Object.values(s.generals).filter(g=>g.cityId===id).reduce((n,g)=>n+g.troops,0);s.nativeAI!.recruitTimers[id]=30000;}
  const ids=c.scenarios[0].generals.filter(g=>g.cityId===`${invader}-home`).map(g=>g.id);
  s=dispatch(s,{type:'march',from:`${invader}-home`,to:invader==='p'?'e-home':'p-home',generalIds:ids,troops:ids.length*26,troopsByGeneral:Object.fromEntries(ids.map(id=>[id,26]))},c);
  s.factionId='p';for(let i=0;i<30&&!s.battle;i++)s=dispatch(s,{type:'advance',days:1},c);expect(s.battle).not.toBeNull();return s;
}
function winPlayer(s:Session,c:GameContent):Session {
  for(let round=0;round<8;round++) {
    s=dispatch(s,{type:'battle-command',command:{type:'start'}},c);battleGeneral(s.battle!,'defender').hp=0;
    s=dispatch(s,{type:'battle-tick',steps:1},c);
    if(s.battle!.phase==='finished')return s;
    s=dispatch(s,{type:'battle-command',command:{type:'next-round',commanderId:s.battle!.commanders.attacker.id}},c);
  }
  throw new Error('Fixture did not finish');
}
const restore=(s:Session,c:GameContent)=>{validateSession(s,c);const loaded=readSession(JSON.parse(JSON.stringify(s)),c);expect(loaded).toEqual(s);return loaded;};
function finishCurrentScript(s:Session,c:GameContent):Session {
  for(let step=0;step<100&&s.pendingCaptive?.script;step++) {
    s=restore(s,c);
    if(s.pendingCaptive!.script!.phase==='dialogue')s=dispatch(s,{type:'capture-dialogue-next'},c);
    else s=dispatch(s,{type:'capture-script-tick',steps:1},c);
  }
  expect(s.pendingCaptive?.script).toBeUndefined();return s;
}
const finishChoice=(s:Session,c:GameContent,choice:'yield'|'kill'|'free')=>finishCurrentScript(dispatch(s,{type:'capture-choice',choice},c),c);

describe('source campaign prisoners',()=>{
  it('prepares in roster order, persists refusal without rerolls, and completes recruit/execute after all choices',()=>{
    const c=content();let s=winPlayer(entered(c),c);
    const before=s.generals.p1.experience;s=dispatch(s,{type:'battle-finish'},c);
    expect(s.pendingCaptive).toMatchObject({side:'defender',winnerFactionId:'p',current:{id:'e1',index:0,accepted:false,reason:16}});
    expect(s.battle!.rosters.defender[0].commander).toMatchObject({morale:60,loyalty:100});
    expect(s.generals.p1.experience).toBe(before);const rng=[...s.battle!.opponentAI!.rng] as NativeRandomState,pending=structuredClone(s.pendingCaptive);
    for(let i=0;i<3;i++) {
      // Each repeated refusal runs the original two dialogue lotteries, while
      // the one prepared 404344 decision stays cached and cannot be rerolled.
      nativeBelow(rng,17);nativeBelow(rng,9);
      s=finishChoice(restore(s,c),c,'yield');expect(s.pendingCaptive).toEqual(pending);expect(s.battle!.opponentAI!.rng).toEqual(rng);
    }
    s=dispatch(s,{type:'battle-finish'},c);expect(s.battle!.opponentAI!.rng).toEqual(rng);
    s=finishChoice(s,c,'kill');
    expect(s.pendingCaptive!.current).toMatchObject({id:'e2',index:1,accepted:true});
    expect(s.generals.e1.ownerId).toBe('e'); // native ownership changes follow all choices
    const copy=restore(s,c);s=finishChoice(s,c,'yield');
    expect(finishChoice(copy,c,'yield')).toEqual(s);
    expect(s.pendingCaptive).toBeUndefined();expect(s.battle).toBeNull();
    expect(s.generals.e1).toMatchObject({ownerId:null,status:'死',hp:0,mp:17,troops:26,troopSlots:{active:17,reserve:9}});
    expect(s.generals.e2).toMatchObject({ownerId:'p',status:'登',hp:0,mp:17,troops:26,troopSlots:{active:17,reserve:9},cityId:null});
    expect(s.armies.find(a=>a.generalIds.includes('e2'))).toMatchObject({ownerId:'p',from:'e-home',to:'e-home',troops:26,nativeMovement:{version:1}});
    expect(s.cities['e-home'].troops).toBe(26);expect(s.generals.p1.experience).toBeGreaterThan(before!);restore(s,c);
    s=dispatch(s,{type:'advance',days:1},c);
    expect(s.generals.e2).toMatchObject({ownerId:'p',cityId:'e-home',armyId:null});expect(s.cities['e-home'].troops).toBe(52);restore(s,c);
  });
  it('releases defeated city officers into a travelling retreat army, retaining their soldier slots',()=>{
    const c=content();let s=dispatch(winPlayer(entered(c),c),{type:'battle-finish'},c);
    while(s.pendingCaptive)s=finishChoice(restore(s,c),c,'free');
    const retreat=s.armies.find(a=>a.ownerId==='e')!;
    expect(retreat.generalIds).toEqual(['e1','e2']);expect(retreat).toMatchObject({from:'e-home',to:'e-back',troops:52,nativeMovement:{flags:4,cooldown:60,retreats:1}});
    for(const id of retreat.generalIds)expect(s.generals[id]).toMatchObject({cityId:null,armyId:retreat.id,ownerId:'e',hp:0,troopSlots:{active:17,reserve:9}});
    expect(s.cities['e-home'].ownerId).toBe('p');expect(s.cities['e-back'].troops).toBe(26);restore(s,c);
  });
  it('does not synthesize capture decisions for an older in-flight save',()=>{
    const c=content();let s=entered(c);delete s.captureRules;delete s.battle!.captureRules;
    s=dispatch(winPlayer(restore(s,c),c),{type:'battle-finish'},c);
    expect(s.pendingCaptive).toBeUndefined();expect(s.battle).toBeNull();expect(s.generals.e1.status).toBe('登');restore(s,c);
  });
  it('ends a player ruler loss and excludes a faction whose designated ruler changed ownership',()=>{
    const c=content(1),scene=c.scenarios[0];scene.factions.find(f=>f.id==='p')!.leaderId='p1';
    let s=entered(c);s=dispatch(s,{type:'battle-command',command:{type:'start'}},c);
    battleGeneral(s.battle!,'attacker').hp=0;s=dispatch(s,{type:'battle-tick',steps:1},c);s=dispatch(s,{type:'battle-finish'},c);
    expect(s.generals.p1).toMatchObject({ownerId:null,status:'死'});expect(s.endgame).toEqual({result:'defeat',day:s.day,reason:'ruler-lost'});restore(s,c);
    expect(()=>dispatch(s,{type:'advance',days:1},c)).toThrow('此局已经结束');
    const other=entered(content());other.generals['e-ruler'].ownerId='p';other.nativeAI!.countdowns.e=1;
    let actions=0;runNativeStrategicCallback(other,content().scenarios[0],()=>{actions++;});expect(actions).toBe(0);expect(other.nativeAI!.countdowns.e).toBe(1);
  });
  it('lets a defeated enemy ruler escape with another city and never fabricates an heir',()=>{
    const c=content(1),scene=c.scenarios[0];scene.factions.find(f=>f.id==='e')!.leaderId='e1';
    let s=dispatch(winPlayer(entered(c),c),{type:'battle-finish'},c);
    expect(s.pendingCaptive).toBeUndefined();expect(s.generals.e1.ownerId).toBe('e');expect(s.generals.e1.status).toBe('登');
    expect(s.endgame).toBeUndefined();expect(scene.factions.find(f=>f.id==='e')!.leaderId).toBe('e1');
    expect(s.generals.e1.cityId==='e-back'||s.armies.some(a=>a.ownerId==='e'&&a.generalIds.includes('e1'))).toBe(true);restore(s,c);
  });
  it('recruits a ruler with no remaining city and marks the original faction defeated',()=>{
    const c=content(1),scene=c.scenarios[0];scene.factions.find(f=>f.id==='e')!.leaderId='e1';
    let s=entered(c);s.cities['e-back'].ownerId='p';s.generals['e-ruler'].ownerId='p';
    s.policy!.governors['e-back']='e-ruler';
    // Recruitment is guaranteed by original loyalty<25 before any RNG branch.
    s.battle!.rosters.defender[0].commander.loyalty=0;
    s.battle!.commanders.defender.loyalty=0;
    s=dispatch(winPlayer(s,c),{type:'battle-finish'},c);expect(s.pendingCaptive!.current.accepted).toBe(true);
    s=finishChoice(s,c,'yield');
    expect(s.generals.e1).toMatchObject({ownerId:'p',status:'登',hp:0});
    expect(s.endgame).toEqual({result:'victory',day:s.day,reason:'unification'});restore(s,c);
  });
  it('keeps a live script on its original target, blocks other choices, and never advances RNG behind dialogue',()=>{
    const c=content();let s=dispatch(winPlayer(entered(c),c),{type:'battle-finish'},c),target=s.pendingCaptive!.current.id;
    s=dispatch(s,{type:'capture-choice',choice:'yield'},c);expect(s.pendingCaptive!.script!.phase).toBe('dialogue');
    expect(s.pendingCaptive!.script!.dialogue).toMatchObject({speakerId:'p-ruler'});
    expect(s.pendingCaptive!.script!.dialogue!.rawText).toMatch(/%[Kk]%/);
    const rng=[...s.battle!.opponentAI!.rng],state=structuredClone(s);
    expect(()=>dispatch(s,{type:'capture-choice',choice:'kill'},c)).toThrow('请先完成当前俘将对白');
    const polled=dispatch(restore(s,c),{type:'capture-script-tick',steps:200},c);expect(polled).toEqual(state);expect(polled.battle!.opponentAI!.rng).toEqual(rng);
    s=dispatch(s,{type:'capture-dialogue-next'},c);expect(s.pendingCaptive!.script!.phase).toBe('ready');expect(s.battle!.opponentAI!.rng).toEqual(rng);
    s=dispatch(restore(s,c),{type:'capture-script-tick',steps:200},c);
    expect(s.pendingCaptive!.current.id).toBe(target);expect(s.pendingCaptive!.script!.phase).toBe('dialogue');
    expect(s.pendingCaptive!.script!.dialogue!.speakerId).toBe(target);expect(s.battle!.rosters.defender[0].battleStatus).toBe(3);
    const before=structuredClone(s);s=finishCurrentScript(s,c);const replay=finishCurrentScript(restore(before,c),c);
    expect(replay).toEqual(s);expect(s.pendingCaptive!.current.id).toBe(target);expect(s.pendingCaptive!.current.accepted).toBe(false);
  });
});

it.skipIf(process.env.CAPTURE_ARTIFACT!=='1')('exports a real-content pending captive UI replay',()=>{
  const c=JSON.parse(readFileSync(new URL('../../../apps/game/public/assets/content.json',import.meta.url),'utf8')) as GameContent,scene=c.scenarios[0];
  const rulers=new Set(scene.factions.map(f=>f.leaderId));
  const player=scene.factions.find(f=>!f.special&&scene.roads.some(road=>{
    const a=scene.cities.find(city=>city.id===road.from)!,b=scene.cities.find(city=>city.id===road.to)!;
    const enemy=a.ownerId===f.id?b.ownerId:b.ownerId===f.id?a.ownerId:null;
    return !road.restricted&&!!enemy&&enemy!==f.id&&scene.cities.filter(city=>city.ownerId===enemy).length>1;
  }))!;
  let s=dispatch(createSession(c,scene.id,player.id),{type:'policy-finish'},c);
  const road=scene.roads.find(road=>!road.restricted&&[road.from,road.to].some(id=>s.cities[id].ownerId===player.id)&&[road.from,road.to].some(id=>s.cities[id].ownerId&&s.cities[id].ownerId!==player.id&&scene.cities.filter(city=>city.ownerId===s.cities[id].ownerId).length>1))!;
  const from=s.cities[road.from].ownerId===player.id?road.from:road.to,to=road.from===from?road.to:road.from,enemy=s.cities[to].ownerId!;
  const back=scene.cities.find(city=>city.id!==to&&city.ownerId===enemy)!.id;
  const attackers=scene.generals.filter(g=>s.generals[g.id].ownerId===player.id&&s.generals[g.id].status==='登'&&!rulers.has(g.id));
  const prisoners=scene.generals.filter(g=>s.generals[g.id].ownerId===enemy&&s.generals[g.id].status==='登'&&!rulers.has(g.id)).slice(0,2);
  expect(prisoners).toHaveLength(2);const actor=attackers[0];expect(actor).toBeDefined();
  for(const g of Object.values(s.generals))if(g.cityId===to)g.cityId=back;
  s.generals[actor.id].cityId=from;
  for(const [i,def] of prisoners.entries())Object.assign(s.generals[def.id],{cityId:to,loyalty:i===0?100:0,hp:Math.min(80,def.hp)});
  for(const city of scene.cities)s.cities[city.id].troops=Object.values(s.generals).filter(g=>g.cityId===city.id&&!g.armyId&&g.ownerId===s.cities[city.id].ownerId&&g.status==='登').reduce((n,g)=>n+g.troops,0);
  for(const id of Object.keys(s.nativeAI!.countdowns))s.nativeAI!.countdowns[id]=999;
  ensureDomesticSearch(s,scene,c.items);refreshPolicyGovernors(s,scene);
  s=dispatch(s,{type:'march',from,to,generalIds:[actor.id],troops:s.generals[actor.id].troops},c);
  for(let i=0;i<30&&!s.battle;i++)s=dispatch(s,{type:'advance',days:30},c);
  s=winPlayer(s,c);const finished=s;
  finished.battle!.rosters.defender[0].commander.loyalty=100;
  finished.battle!.rosters.defender[1].commander.loyalty=0;
  let pending:Session|undefined;
  for(let seed=1;seed<200;seed++) {
    const attempt=structuredClone(finished);attempt.battle!.opponentAI!.rng=[seed,0x87654321];
    const result=dispatch(attempt,{type:'battle-finish'},c);
    if(result.pendingCaptive&&!result.pendingCaptive.current.accepted){pending=result;break;}
  }
  expect(pending).toBeDefined();restore(pending!,c);
  mkdirSync(new URL('../../../test-results/',import.meta.url),{recursive:true});
  const path=new URL('../../../test-results/captive-fixture.json',import.meta.url);writeFileSync(path,JSON.stringify(pending));
  let ended=dispatch(createSession(c,scene.id,player.id),{type:'policy-finish'},c);
  const ruler=player.leaderId!;
  ended.generals[ruler].cityId=from;
  for(const city of scene.cities)ended.cities[city.id].troops=Object.values(ended.generals).filter(g=>g.cityId===city.id&&!g.armyId&&g.ownerId===ended.cities[city.id].ownerId&&g.status==='登').reduce((n,g)=>n+g.troops,0);
  for(const id of Object.keys(ended.nativeAI!.countdowns))ended.nativeAI!.countdowns[id]=999;
  refreshPolicyGovernors(ended,scene);
  ended=dispatch(ended,{type:'march',from,to,generalIds:[ruler],troops:ended.generals[ruler].troops},c);
  for(let i=0;i<30&&!ended.battle;i++)ended=dispatch(ended,{type:'advance',days:30},c);
  ended=dispatch(ended,{type:'battle-command',command:{type:'start'}},c);battleGeneral(ended.battle!,'attacker').hp=0;
  ended=dispatch(ended,{type:'battle-tick',steps:1},c);ended=dispatch(ended,{type:'battle-finish'},c);
  expect(ended.endgame).toMatchObject({result:'defeat',reason:'ruler-lost'});restore(ended,c);
  writeFileSync(new URL('../../../test-results/captive-endgame-fixture.json',import.meta.url),JSON.stringify(ended));
  expect(pending!.battle!.rosters.defender.filter(m=>m.battleStatus===3)).toHaveLength(2);
});
