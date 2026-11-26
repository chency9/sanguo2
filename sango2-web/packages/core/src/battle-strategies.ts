import type {BattleState,BattleSide,BattleCommander} from './battle';
import {commanderMagicSequences} from './native-battle-rules';
import {nativeChooseStrategy,nativeStrategistIndex,nativeStrategySucceeds} from './native-strategist-ai';
import {nativeApplyStrategy,nativeStrategySupported,nativeStrategyRecovery,nativeRestoreStrategyVitals,type NativeStrategyCombat} from './native-strategy-effects';
import table from './native-ai-strategies.json';

/** Three independent Windows startup captures, same hash-pinned 1.05+ EXE.
 * Rate is the observed stale-stack return address 0x405071, NOT config Level. */
export const NATIVE_STRATEGIES=table;
type Choice={advisorId:string;sequence:number;slot:number;status:'selected'|'applied'|'cancelled'|'pending'};
type Vitals=Pick<NativeStrategyCombat,'hp'|'mp'|'maxHp'|'maxMp'|'morale'>;
export interface BattleStrategies {
  version:1;applied:boolean;choices:Record<BattleSide,Choice>;
  effects:Record<BattleSide,NativeStrategyCombat>;entry:Record<BattleSide,Vitals>;
}
const sides=['attacker','defender'] as const;
const general=(b:BattleState,s:BattleSide)=>b.units.find(u=>u.general&&u.side===s)!;
const learned=(c:BattleCommander)=>commanderMagicSequences(c.rawStrategy,c.level,c.strategyLearnset);
export function battleStrategyOptions(c:BattleCommander) {
  return learned(c).map(id=>table.find(s=>s.sequence===id)).filter((s):s is typeof table[number]=>!!s)
    .map(s=>({...s,supported:nativeStrategySupported(s.execute)}));
}
const vitals=(c:BattleCommander):Vitals=>({hp:c.hp,mp:c.mp,maxHp:c.maxHp??c.hp,maxMp:c.maxMp??c.mp,morale:c.morale??80});
function blank(c:BattleCommander,troops:number):NativeStrategyCombat {
  return {...vitals(c),troops:Math.min(100,troops),reserve:Math.max(0,troops-100),flags:0,parameter:0,recoveryClock:0,chargeModifier:0,soldierPower:150,generalHitBonus:0,loyalty:c.loyalty??90,settlementFlags:0,fatigueModifier:0,experienceModifier:0};
}
export function createBattleStrategies(b:BattleState):BattleStrategies {
  const choices={} as Record<BattleSide,Choice>;
  for(const side of sides) {
    const members=b.rosters[side],advisor=members[nativeStrategistIndex(members.map(m=>m.commander.intelligence))].commander;
    const troops=b.troopDeployment?b.troopDeployment[side].active+b.troopDeployment[side].reserve:b.initial[side];
    const draw=side==='defender'||b.attackerAI?nativeChooseStrategy(battleStrategyOptions(advisor),troops,b.opponentAI!.rng):{slot:-1,sequence:0};
    choices[side]={advisorId:advisor.id,slot:draw.slot,sequence:draw.sequence,status:'selected'};
  }
  return {version:1,applied:false,choices,
    effects:{attacker:blank(b.commanders.attacker,b.initial.attacker),defender:blank(b.commanders.defender,b.initial.defender)},
    entry:{attacker:vitals(b.commanders.attacker),defender:vitals(b.commanders.defender)}};
}
export function selectBattleStrategy(b:BattleState,advisorId:string,sequence:number):void {
  if(b.phase!=='deployment')throw new Error('只能在战前选择军师技。');
  const advisor=b.rosters.attacker.find(m=>m.commander.id===advisorId)?.commander;
  if(!advisor)throw new Error('请选择本军武将担任军师。');
  const slots=learned(advisor),slot=slots.indexOf(sequence),skill=table.find(s=>s.sequence===sequence);
  if(sequence!==0&&(slot===-1||!skill))throw new Error('军师尚未习得此计策。');
  if(skill&&!nativeStrategySupported(skill.execute))throw new Error('此军师技暂不可用。');
  // Old deployment saves acquire a player choice without rerolling enemy RNG.
  if(!b.strategies) {
    b.opponentAI??={rng:[b.rng,0x87654321],countdown:10,flags:0,entryHp:general(b,'defender').hp,chargeTick:0,lastAction:0,lastSkill:0};
    const rng=[...b.opponentAI!.rng] as [number,number];b.strategies=createBattleStrategies(b);b.opponentAI!.rng=rng;
    b.strategies.choices.defender.sequence=0;b.strategies.choices.defender.slot=-1;
  }
  b.strategies.choices.attacker={advisorId,sequence,slot:sequence===0?-1:slot,status:'selected'};
}
export function applyBattleStrategies(b:BattleState):void {
  const s=b.strategies;if(!s||s.applied)return;s.applied=true;
  for(const side of sides) {
    const c=b.commanders[side],g=general(b,side),entry={...c,hp:g.hp,maxHp:g.maxHp};
    s.entry[side]=vitals(entry);s.effects[side]=blank(entry,0);
    s.effects[side].troops=b.units.filter(u=>u.side===side&&!u.general&&u.hp>0&&!u.escaped&&(!b.troopDeployment||!u.nativeReserve)).length;
    s.effects[side].reserve=b.troopDeployment?b.units.filter(u=>u.side===side&&!u.general&&u.hp>0&&!u.escaped&&u.nativeReserve).length:b.reserves[side];
  }
  for(const side of sides) {
    const enemy=side==='attacker'?'defender':'attacker',choice=s.choices[side],other=s.choices[enemy];
    const skill=table[choice.sequence],opponent=table[other.sequence];
    const advisor=b.rosters[side].find(m=>m.commander.id===choice.advisorId)!.commander;
    const enemyAdvisor=b.rosters[enemy].find(m=>m.commander.id===other.advisorId)!.commander;
    if(!nativeStrategySucceeds({...skill,intelligence:advisor.intelligence},{...opponent,intelligence:enemyAdvisor.intelligence}))choice.status='cancelled';
    else choice.status=nativeApplyStrategy(skill.execute,s.effects[side],s.effects[enemy],b.opponentAI!.rng)?'applied':'pending';
    if(choice.sequence)b.log.unshift(`${advisor.name}：${skill.name}${skill.level?['','（初）','（中）','（高）'][skill.level]:''}${choice.status==='cancelled'?'，计策被识破。':choice.status==='pending'?'，此计暂不可用。':'。'}`);
  }
  for(const side of sides) {
    const effect=s.effects[side],c=b.commanders[side],g=general(b,side);
    c.hp=effect.hp;c.maxHp=effect.maxHp;c.mp=effect.mp;c.maxMp=effect.maxMp;
    c.morale=effect.morale;c.loyalty=effect.loyalty;
    g.hp=effect.hp;g.maxHp=effect.maxHp;
    let count=0,reserveCount=0;
    b.units=b.units.filter(u=>u.general||u.side!==side||u.hp<=0||u.escaped||(b.troopDeployment&&u.nativeReserve?++reserveCount<=effect.reserve:++count<=effect.troops));
    if(!b.troopDeployment)b.reserves[side]=effect.reserve;
  }
  if(b.opponentAI)b.opponentAI.entryHp=s.effects.defender.hp;
  if(b.attackerAI)b.attackerAI.entryHp=s.effects.attacker.hp;
  b.log.length=Math.min(8,b.log.length);
}
export function recoverBattleStrategy(b:BattleState,side:BattleSide,updates:number):void {
  if(!b.strategies?.applied)return;
  const effect=b.strategies.effects[side],g=general(b,side),c=b.commanders[side];
  if(g.hp<=0||g.escaped||g.order==='retreat'||b.activeScript?.side===side)return;
  effect.hp=g.hp;effect.maxHp=g.maxHp;effect.mp=c.mp;effect.maxMp=c.maxMp??c.mp;
  nativeStrategyRecovery(effect,updates);g.hp=effect.hp;c.mp=effect.mp;
}
export function restoreBattleStrategy(b:BattleState,side:BattleSide):void {
  const s=b.strategies;if(!s?.applied)return;
  const c=b.commanders[side],g=general(b,side),state={hp:g.hp,maxHp:g.maxHp,mp:c.mp,maxMp:c.maxMp??c.mp};
  nativeRestoreStrategyVitals(state,s.entry[side]);
  Object.assign(c,state);g.hp=state.hp;g.maxHp=state.maxHp;
  if(s.entry[side].morale!==undefined)c.morale=s.entry[side].morale;
}
export function validateBattleStrategies(b:BattleState,fail:()=>never):void {
  const s=b.strategies;if(s===undefined)return;
  const int=(v:unknown,max=10000):v is number=>typeof v==='number'&&Number.isInteger(v)&&v>=0&&v<=max;
  if(!s||s.version!==1||typeof s.applied!=='boolean'||!s.choices||!s.effects||!s.entry||s.applied!==(b.phase!=='deployment'))fail();
  for(const side of sides) {
    const ch=s.choices[side],ef=s.effects[side],entry=s.entry[side];
    const advisor=b.rosters[side]?.find(m=>m.commander.id===ch?.advisorId)?.commander;
    if(!ch||!advisor||!int(ch.sequence,67)||!Number.isInteger(ch.slot)||ch.slot< -1||ch.slot>7||!['selected','applied','cancelled','pending'].includes(ch.status))fail();
    if(ch.sequence===0?ch.slot!==-1:learned(advisor)[ch.slot]!==ch.sequence)fail();
    if(!s.applied&&ch.status!=='selected'||s.applied&&ch.status==='selected')fail();
    if(!entry||![entry.hp,entry.maxHp,entry.mp,entry.maxMp].every(n=>int(n))||entry.hp>entry.maxHp||entry.mp>entry.maxMp)fail();
    if(!ef||![ef.hp,ef.maxHp,ef.mp,ef.maxMp,ef.parameter,ef.recoveryClock].every(n=>int(n))||ef.hp>ef.maxHp||ef.mp>ef.maxMp||!int(ef.flags,1023)||!int(ef.troops,100)||!int(ef.reserve,1000000)||!Number.isInteger(ef.chargeModifier)||Math.abs(ef.chargeModifier)>3)fail();
    if(ef.soldierPower!==undefined&&(!Number.isInteger(ef.soldierPower)||ef.soldierPower<105||ef.soldierPower>195))fail();
    if(ef.generalHitBonus!==undefined&&![0,10,15,20].includes(ef.generalHitBonus))fail();
    if([ef.morale,ef.loyalty,entry.morale].some(n=>n!==undefined&&!int(n,100)))fail();
    if(ef.settlementFlags!==undefined&&![0,4096,8192,12288].includes(ef.settlementFlags))fail();
    if(ef.fatigueModifier!==undefined&&(!Number.isInteger(ef.fatigueModifier)||Math.abs(ef.fatigueModifier)>6))fail();
    if(ef.experienceModifier!==undefined&&![0,30,50,100].includes(ef.experienceModifier))fail();
  }
}
