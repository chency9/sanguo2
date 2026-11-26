import {describe,it,expect} from 'vitest';
import type {GameContent,GeneralDefinition} from '@sango2/content';
import {createSession,dispatch,readSession,validateSession,type Session} from './index';
import {battleGeneral,type BattleSide} from './battle';
import {nativeExperienceThreshold,nativeLevelVitals} from './native-progression';

const startingExperience=nativeExperienceThreshold(28)-100;
const fixture=(playerCount=1,enemyCount=1):GameContent=>{
  const officer=(id:string,ownerId:string,cityId:string):GeneralDefinition=>{
    const level=27,strength=80,intelligence=70,vitals=nativeLevelVitals(80,40,strength,intelligence,level);
    return {id,name:id,portrait:'portraits/001.png',strength,intelligence,hp:vitals.hp,mp:vitals.mp,
      baseHp:80,baseMp:40,level,baseExperience:startingExperience,constancy:6,loyalty:90,status:'登',ownerId,cityId,
      weapon:'',horse:'',item:'',unit:'刀',forceMask:8191,formations:['方'],rawSkill:'',rawStrategy:'',sourceLine:1,
      skillLearnset:[],strategyLearnset:[]};
  };
  return {version:1,id:'campaign-battle-experience',sourceHash:'e'.repeat(64),items:[],skills:[],strategies:[],terrains:[],
    scenarios:[{id:'era',title:'战后经验闭环',year:184,initialization:'native-105plus',
      factions:['p','e'].map(id=>({id,name:id,leaderId:`${id}1`,color:'#fff',select:1,special:false})),
      cities:['p-home','e-home','p-back','e-back'].map((id,i)=>({id,name:id,ownerId:id[0],governorId:id.endsWith('home')?`${id[0]}1`:`${id[0]}-off`,
        position:[i*100,100] as [number,number],money:1000,population:100000,defense:0})),
      roads:[{id:'road',from:'p-home',to:'e-home',length:120,points:[[0,100],[100,100]],restricted:false}],
      generals:[...Array.from({length:playerCount},(_,i)=>officer(`p${i+1}`,'p','p-home')),
        ...Array.from({length:enemyCount},(_,i)=>officer(`e${i+1}`,'e','e-home')),
        officer('p-off','p','p-back'),officer('e-off','e','e-back')]
    }]};
};

/** Use real policy, march, arrival and battle commands. Only the time of a
 * casualty is supplied by the test; all settlement and save code runs normally. */
function encounter(c:GameContent,invader:'p'|'e'='p'):Session {
  let s=dispatch(createSession(c,'era',invader),{type:'policy-finish'},c);
  for(const id of Object.keys(s.nativeAI!.countdowns))s.nativeAI!.countdowns[id]=900;
  for(const id of Object.keys(s.generals)) {
    Object.assign(s.generals[id],{hp:41,mp:17,morale:80,fatigue:5,loyalty:90,troops:26,troopSlots:{active:17,reserve:9}});
    Object.assign(s.nativeAI!.recovery[id],{hp:30000,mp:30000,fatigue:30000,moraleLoss:30000,moraleGain:30000,loyaltyLoss:30000,loyaltyGain:30000});
  }
  for(const id of Object.keys(s.cities)) {
    s.cities[id].troops=Object.values(s.generals).filter(g=>g.cityId===id).reduce((sum,g)=>sum+g.troops,0);
    s.nativeAI!.recruitTimers[id]=30000;
  }
  s.policy!.annual!.battleExperience={p:100,e:200};
  const generalIds=c.scenarios[0].generals.filter(g=>g.cityId===`${invader}-home`).map(g=>g.id);
  s=dispatch(s,{type:'march',from:`${invader}-home`,to:invader==='p'?'e-home':'p-home',generalIds,
    troops:generalIds.length*26,troopsByGeneral:Object.fromEntries(generalIds.map(id=>[id,26]))},c);
  s.factionId='p';
  s=dispatch(s,{type:'advance',days:2},c);
  expect(s.battle?.phase).toBe('deployment');expect(s.battle?.experienceRules).toBe('native-merit-v1');
  validateSession(s,c);
  return s;
}
const start=(s:Session,c:GameContent)=>dispatch(s,{type:'battle-command',command:{type:'start'}},c);
const nextRound=(s:Session,c:GameContent,commanderId:string)=>start(dispatch(s,{type:'battle-command',command:{type:'next-round',commanderId}},c),c);
function knockDown(s:Session,c:GameContent,side:BattleSide):Session {
  battleGeneral(s.battle!,side).hp=0;
  return dispatch(s,{type:'battle-tick',steps:1},c);
}
function casualties(s:Session,side:BattleSide,active:number,reserve:number) {
  for(const [nativeReserve,count] of [[false,active],[true,reserve]] as const) {
    const units=s.battle!.units.filter(u=>u.side===side&&!u.general&&u.hp>0&&!!u.nativeReserve===nativeReserve);
    expect(units.length).toBeGreaterThanOrEqual(count);
    for(const unit of units.slice(0,count))unit.hp=0;
  }
}
function restored(s:Session,c:GameContent):Session {
  const copy=readSession(JSON.parse(JSON.stringify(s)),c);expect(copy).toEqual(s);return copy;
}

describe('campaign battle merit and experience settlement',()=>{
  it.each([
    {invader:'p',winner:'p'},{invader:'p',winner:'e'},
    {invader:'e',winner:'p'},{invader:'e',winner:'e'},
  ] as const)('settles original roster order when $invader invades and $winner wins',({invader,winner})=>{
    const c=fixture();let s=start(encounter(c,invader),c);
    expect(s.battle!.invasionSide).toBe(invader==='p'?'attacker':'defender');
    const winningSide=winner==='p'?'attacker':'defender',losingSide=winner==='p'?'defender':'attacker';
    s=knockDown(s,c,losingSide);expect(s.battle!.phase).toBe('finished');expect(s.battle!.winner).toBe(winningSide);
    const loser=winner==='p'?'e':'p',winningOfficer=`${winner}1`,losingOfficer=`${loser}1`;
    expect(s.battle!.rosters[winningSide][0].merit).toBe(1377); // 51 * level 27
    s=dispatch(restored(s,c),{type:'battle-finish'},c);
    expect(s.generals[winningOfficer].experience).toBe(startingExperience+4482); // 2 * (1377 + 32*27)
    expect(s.generals[losingOfficer].experience).toBe(startingExperience);
    expect(s.policy!.annual!.battleExperience).toEqual({p:100+(winner==='p'?4482:0),e:200+(winner==='e'?4482:0)});
    expect(s.generals[winningOfficer]).toMatchObject({morale:86,loyalty:94,battleRecord:{wins:1,losses:0,streak:1,bestStreak:1}});
    // Participant loss is 4 for the city roster and 8 for the invading roster,
    // followed by the faction's loss of 1 loyalty. Screen position is irrelevant.
    expect(s.generals[losingOfficer]).toMatchObject({morale:68,loyalty:loser===invader?81:85,battleRecord:{wins:0,losses:1,streak:0,bestStreak:0}});
    expect(s.generals[`${winner}-off`]).toMatchObject({morale:81,loyalty:91,experience:startingExperience});
    expect(s.generals[`${loser}-off`]).toMatchObject({morale:78,loyalty:89,experience:startingExperience});
    expect(s.cities[invader==='p'?'e-home':'p-home'].ownerId).toBe(winner);
    expect(s.battle).toBeNull();expect(s.armies).toHaveLength(0);validateSession(s,c);restored(s,c);
    expect(()=>dispatch(s,{type:'battle-finish'},c)).toThrow('当前没有进行中的战斗');
  });

  it('awards withdrawn and unused winners, retains wounds and slots through growth, and resumes every round',()=>{
    const c=fixture(3,2);let s=start(encounter(c),c);
    const firstEnemy=s.battle!.commanders.defender.id;
    casualties(s,'attacker',3,2);casualties(s,'defender',1,0);
    s=knockDown(s,c,'attacker');expect(s.battle!.phase).toBe('intermission');
    expect(s.battle!.rosters.attacker.find(m=>m.commander.id==='p1')).toMatchObject({merit:3,withdrawn:true,battleStatus:3});
    expect(s.battle!.rosters.defender.find(m=>m.commander.id===firstEnemy)!.merit).toBe(1419);
    s=nextRound(restored(s,c),c,'p2');let copy=restored(s,c);
    s=knockDown(s,c,'defender');copy=knockDown(copy,c,'defender');expect(copy).toEqual(s);
    expect(s.battle!.phase).toBe('intermission');
    s=nextRound(restored(s,c),c,'p2');copy=restored(s,c);
    s=knockDown(s,c,'defender');copy=knockDown(copy,c,'defender');expect(copy).toEqual(s);
    expect(s.battle!.phase).toBe('finished');expect(s.battle!.rosters.attacker.map(m=>m.merit)).toEqual([3,2754,0]);
    const before=s.battle!.rosters.attacker.find(m=>m.commander.id==='p2')!;
    expect(before).toMatchObject({troops:26,troopSlots:{active:17,reserve:9},commander:{hp:41,mp:17}});
    const result=dispatch(restored(s,c),{type:'battle-finish'},c),copyResult=dispatch(copy,{type:'battle-finish'},c);
    expect(copyResult).toEqual(result);
    expect(result.generals.p1.experience).toBe(startingExperience+1158); // (3 + 576) * 2
    expect(result.generals.p2.experience).toBe(startingExperience+6660); // (2754 + 576) * 2
    expect(result.generals.p3.experience).toBe(startingExperience+1152); // full bonus, never selected
    expect(result.generals[firstEnemy].experience).toBe(startingExperience+2838);
    expect(result.policy!.annual!.battleExperience).toEqual({p:9070,e:3038});
    expect(result.generals.p2.level).toBeGreaterThan(27);
    expect(result.generals.p2.maxHp).toBeGreaterThan(c.scenarios[0].generals.find(g=>g.id==='p2')!.hp);
    expect(result.generals.p2).toMatchObject({hp:41,mp:17,troops:26,troopSlots:{active:17,reserve:9}});
    expect(result.generals.p1.hp).toBe(0); // an experience level never revives a fallen officer
    expect(result.generals.p3).toMatchObject({hp:41,mp:17,troops:26,troopSlots:{active:17,reserve:9}});
    validateSession(result,c);restored(result,c);
  });

  it.each(['p','e'] as const)('keeps a final dusk draw neutral when %s is the strategic invader',invader=>{
    const c=fixture();let s=start(encounter(c,invader),c);
    s.battle!.tick=3959;s=dispatch(restored(s,c),{type:'battle-tick',steps:1},c);
    expect(s.battle!).toMatchObject({phase:'finished',drawn:true});
    expect(s.battle!.rosters.attacker[0]).toMatchObject({merit:459,withdrawn:true,battleStatus:2});
    expect(s.battle!.rosters.defender[0]).toMatchObject({merit:459,withdrawn:true,battleStatus:2});
    s=dispatch(restored(s,c),{type:'battle-finish'},c);
    for(const id of ['p1','e1'])expect(s.generals[id]).toMatchObject({experience:startingExperience+918,morale:80,loyalty:90});
    for(const id of ['p-off','e-off'])expect(s.generals[id]).toMatchObject({experience:startingExperience,morale:80,loyalty:90});
    expect(s.policy!.annual!.battleExperience).toEqual({p:1018,e:1118});
    expect(s.cities['p-home'].ownerId).toBe('p');expect(s.cities['e-home'].ownerId).toBe('e');
    validateSession(s,c);restored(s,c);
  });

  it('preserves legacy missing merit markers across rounds and awards no invented experience',()=>{
    const c=fixture(2,2);let s=encounter(c);
    delete s.battle!.experienceRules;
    for(const members of Object.values(s.battle!.rosters))for(const m of members){delete m.merit;delete m.battleStatus;}
    s=start(restored(s,c),c);s=knockDown(s,c,'defender');
    s=nextRound(restored(s,c),c,'p1');expect(s.battle!.experienceRules).toBeUndefined();
    s=knockDown(s,c,'defender');
    expect(s.battle!.rosters.attacker.every(m=>m.merit===undefined)).toBe(true);
    s=dispatch(restored(s,c),{type:'battle-finish'},c);
    expect(s.policy!.annual!.battleExperience).toEqual({p:100,e:200});
    for(const g of Object.values(s.generals))expect(g.experience).toBe(startingExperience);
    expect(s.generals.p1).toMatchObject({morale:80,loyalty:90});expect(s.generals['p-off']).toMatchObject({morale:80,loyalty:90});
    validateSession(s,c);restored(s,c);
  });
});
