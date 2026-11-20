import { scenarioById, type GameContent, type ScenarioDefinition } from '@sango2/content';
import { createBattle, commandBattle, tickBattle, validateBattle, battleTeamSurvivors, upgradeBattle, chooseOpponentCommander, availableCommanders, type BattleState, type BattleCommand, type BattleCommander, type BattleMember } from './battle';
export * from './battle';
export * from './native-projection';
export * from './battle-scene';
export {battleScriptCameraLocked} from './battle-native-magic';
import {type StrategicAction} from './strategic-ai';
import {createNativeCampaignAI,runNativeStrategicCallback,type NativeCampaignAI} from './native-ai-campaign';
import {initialOfficerCondition,initialConditionTimers,type NativeOfficerCondition} from './native-officer-condition';
import {nativeTroopCapacity,type TroopSlots} from './native-troops';
import {officerLevel,officerMaxHp,officerMaxMp,type OfficerProgress} from './native-progression';
import {initializeOfficerEquipment,officerDefinition,officerForceMask,officerFormations,nativeForceNames,type OfficerEquipment} from './native-officer-runtime';
import {ensureDomesticAnnual} from './native-policy-annual';
import {createDomesticState,executeDomestic,beginDomesticYear,policyGovernorId,refreshPolicyGovernors,type DomesticState,type DomesticCommand} from './native-policy';
export {policyGovernorId,nativeDevelop,nativeAnnualRevenue} from './native-policy';
export * from './native-progression';
export {officerDefinition,officerStrength,officerIntelligence,officerSpeed,officerForceMask,officerFormations,officerUnit,nativeForceNames,nativeForceLabels} from './native-officer-runtime';
export {domesticSearchMessage} from './native-policy-actions';
export {previewPlayerItem} from './native-player-items';
export {allocateBattleTroops,nativeTransferTroops,nativeAutofillTroops,nativeReserveCapacity} from './native-troops';
export {nativeReinforceDefinition,nativeCreateMagicReinforce,nativeAdvanceMagicReinforce} from './native-magic-reinforce';
export {nativeExplodeDefinition,nativeCreateMagicExplode,nativeAdvanceMagicExplode} from './native-magic-explode';
export type {AutonomyMode} from './native-policy-search';

// Explicit prototype rules. These numbers are not a reconstruction of the 1.05+ executable.
export const RULESET = 'web-tactical-preview-v3';
export const RULES = { initialTroopsPerGeneral: 80, developCost: 300, developDefense: 20,
  developPopulation: 500, recruitCost: 200, recruitTroops: 50, roadUnitsPerDay: 60, maxArmyGenerals: 5 } as const;

export interface CityState { ownerId: string | null; money: number; population: number; defense: number; troops: number; lastActionDay: number }
export interface GeneralState extends Partial<NativeOfficerCondition>,Partial<OfficerProgress>,Partial<OfficerEquipment> { ownerId: string | null; cityId: string | null; armyId: string | null; status: string; hp:number; mp:number; troops:number; troopSlots?:TroopSlots; currentUnit?:string }
export interface Army {
  id: string; ownerId: string; from: string; to: string; roadId: string; generalIds: string[];
  troops: number; totalDays: number; remainingDays: number;
  treasury?:number;
}
export interface Chronicle { id: number; day: number; text: string; kind: 'info' | 'march' | 'victory' | 'defeat' }
export interface BattleReport {
  id: number; day: number; cityId: string; commanderId: string; won: boolean;
  attackingTroops: number; defendingTroops: number; survivors: number; text: string;
}
export interface Session {
  schemaVersion: 1; ruleset: typeof RULESET; contentId: string; contentHash: string;
  scenarioId: string; factionId: string; day: number; rng: number; nextId: number;
  cities: Record<string, CityState>; generals: Record<string, GeneralState>;
  armies: Army[]; chronicle: Chronicle[]; reports: BattleReport[];
  battle: BattleState | null;
  nativeAI?:NativeCampaignAI;
  policy?:DomesticState;
}
export type Command =
  | DomesticCommand
  | { type: 'develop' | 'recruit'; cityId: string }
  | { type: 'march'; from: string; to: string; generalIds: string[]; troops: number; troopsByGeneral?:Record<string,number> }
  | { type: 'advance'; days: number }
  | { type: 'battle-command'; command: BattleCommand }
  | { type: 'battle-tick'; steps: number }
  | { type: 'battle-finish' };

function note(s: Session, text: string, kind: Chronicle['kind'] = 'info') {
  s.chronicle.unshift({ id: s.nextId++, day: s.day, text, kind });
  s.chronicle.length = Math.min(s.chronicle.length, 100);
}

export function createSession(content: GameContent, scenarioId: string, factionId: string, seed = 184): Session {
  const scene = scenarioById(content, scenarioId);
  const faction = scene.factions.find(f => f.id === factionId && !f.special);
  if (!faction || !scene.cities.some(c => c.ownerId === factionId)) throw new Error('请选择拥有城池的势力。');
  const cities: Session['cities'] = {};
  const generals: Session['generals'] = {};
  for (const c of scene.cities) {
    const stationed = scene.generals.filter(g => g.cityId === c.id && g.ownerId === c.ownerId && g.status === '登').length;
    cities[c.id] = { ownerId: c.ownerId, money: c.money, population: c.population, defense: c.defense,
      troops: c.ownerId ? Math.max(1, stationed) * RULES.initialTroopsPerGeneral : 0, lastActionDay: -1 };
  }
  for (const g of scene.generals) generals[g.id] = { ownerId: g.ownerId, cityId: g.cityId, armyId: null, status: g.status, hp:g.hp,mp:g.mp,troops:0,...initialOfficerCondition() };
  const s: Session = { schemaVersion: 1, ruleset: RULESET, contentId: content.id, contentHash: content.sourceHash,
    scenarioId, factionId, day: 0, rng: (seed >>> 0) || 1, nextId: 1, cities, generals, armies: [], chronicle: [], reports: [], battle: null };
  for(const c of scene.cities)assignCityTroops(s,c.id);
  if(scene.initialization==='native-105plus') {
    // 0x42D1A3 initializes both troop slots to their level-derived maxima.
    // Existing saves keep their recorded allocations; only new games use this.
    for(const def of scene.generals) {
      const g=generals[def.id],capacity=nativeTroopCapacity(def.level??20);
      Object.assign(g,{level:def.level??20,experience:def.baseExperience??0,maxHp:def.hp,maxMp:def.mp,
        troopSlots:{active:Math.max(0,capacity.active),reserve:capacity.reserve},troops:Math.max(0,capacity.active)+capacity.reserve});
      initializeOfficerEquipment(g,def,content.items);
    }
    for(const c of scene.cities)cities[c.id].troops=stationedGenerals(s,c.id).reduce((n,id)=>n+generals[id].troops,0);
  }
  s.nativeAI=createNativeCampaignAI(s,scene);
  s.policy=createDomesticState(s,scene,content.items);
  ensureDomesticAnnual(s,scene);
  note(s, `${scene.title}，${faction.name}起兵。选择城池，经营内政，沿道路调兵遣将。`);
  return s;
}

export function stationedGenerals(s: Session, cityId: string): string[] {
  return Object.entries(s.generals).filter(([, g]) => g.cityId === cityId && !g.armyId && g.status === '登' && g.ownerId === s.cities[cityId]?.ownerId).map(([id]) => id);
}

// Aggregate-only Web reassignment has no source class allocation. Preserve known
// slots for unchanged allocations; explicitly re-adapt when the total changes.
function assignAggregateTroops(g:GeneralState,troops:number) {
  if(g.troops!==troops)delete g.troopSlots;
  g.troops=troops;
}
function distribute(s:Session,ids:string[],troops:number) {
  ids.forEach((id,i)=>assignAggregateTroops(s.generals[id],Math.floor(troops/ids.length)+(i<troops%ids.length?1:0)));
}
// Explicit provisional allocation policy. A city may retain unassigned soldiers when empty.
function assignCityTroops(s:Session,cityId:string) { distribute(s,stationedGenerals(s,cityId),s.cities[cityId].troops); }

// Entering a city must not change existing officer allocations (and AI scores).
// Only legacy/unassigned garrison totals need the provisional allocation policy.
function reconcileCityTroops(s:Session,cityId:string) {
  const ids=stationedGenerals(s,cityId);
  if(ids.reduce((n,id)=>n+s.generals[id].troops,0)!==s.cities[cityId].troops)assignCityTroops(s,cityId);
}

export function adjacentRoads(scene: ScenarioDefinition, cityId: string) {
  return scene.roads.filter(r => r.from === cityId || r.to === cityId);
}

/**
 * Resolve the battlefield scenery for a strategic location.
 *
 * The native map selector samples CHINAMAP*.MSK at the strategic POS/2
 * coordinate. Converted content records that source-backed result as
 * `battleScenery`; locations without a recovered mapping intentionally keep
 * the historical castle fallback until the seasonal route selector is wired.
 */
export function battleSceneryForCity(scene: ScenarioDefinition, cityId: string): NonNullable<BattleState['scenery']> {
  const city = scene.cities.find(c => c.id === cityId);
  const scenery = city?.battleScenery;
  if (scenery) return {terrainId: scenery.terrainId, variant: scenery.variant};
  return {terrainId: 0, variant: 'a'};
}

function ownCity(s: Session, id: string, actor=s.factionId) {
  const c = s.cities[id];
  if (!c || c.ownerId !== actor) throw new Error('只能在我方城池执行此命令。');
  return c;
}

interface EncounterOutcome { attackerWon:boolean; attackingSurvivors:number; defendingSurvivors:number }
function tacticalOutcome(s:Session,battle:BattleState):EncounterOutcome {
  const invader=battle.invasionSide??'attacker',defense=invader==='attacker'?'defender':'attacker';
  for(const side of ['attacker','defender'] as const)for(const member of battle.rosters[side]) {
    const g=s.generals[member.commander.id];
    if(g){g.hp=member.commander.hp;g.mp=member.commander.mp;g.troops=member.troops;
      if(member.troopSlots)g.troopSlots={...member.troopSlots};else delete g.troopSlots;
      for(const key of ['morale','fatigue','loyalty'] as const)if(member.commander[key]!==undefined)g[key]=member.commander[key];}
  }
  return {attackerWon:battle.winner===invader,attackingSurvivors:battleTeamSurvivors(battle,invader),defendingSurvivors:battleTeamSurvivors(battle,defense)};
}
function rivalCommander(s:Session,scene:ScenarioDefinition,id:string):BattleCommander {
  const def=scene.generals.find(g=>g.id===id);
  const state=s.generals[id];
  if(!def||!state)throw new Error('战役武将资料缺失。');
  return {id:def.id,name:def.name,portrait:def.portrait,strength:state.strength??def.strength,
    intelligence:state.intelligence??def.intelligence,hp:state.hp,mp:state.mp,
    maxHp:officerMaxHp(state,def),maxMp:officerMaxMp(state,def),unit:state.currentUnit??def.unit,
    formations:officerFormations(state,def),rawSkill:def.rawSkill,rawStrategy:def.rawStrategy,
    level:officerLevel(state,def),speed:state.speed??def.speed,skillLearnset:def.skillLearnset,
    strategyLearnset:def.strategyLearnset,morale:state.morale??80,fatigue:state.fatigue??0,loyalty:state.loyalty??90};
}

function rivalMember(s:Session,scene:ScenarioDefinition,id:string):BattleMember {
  const state=s.generals[id];
  return {commander:rivalCommander(s,scene,id),troops:state.troops,
    troopSlots:state.troopSlots?{...state.troopSlots}:undefined,withdrawn:state.hp<=0};
}

/** Computer-versus-computer battles use the same fixed-step battle state as a
 * player encounter. The strategic map still settles the result immediately,
 * but casualties, commander rotation, skills, retreat and RNG now come from
 * the tactical state machine instead of a power-ratio estimate. */
function resolveRivalEncounter(s:Session,army:Army,scene:ScenarioDefinition):EncounterOutcome {
  const attacker=army.generalIds.map(id=>rivalMember(s,scene,id));
  const defenderIds=stationedGenerals(s,army.to),defending=s.cities[army.to].troops;
  let defender=defenderIds.map(id=>rivalMember(s,scene,id));
  if(!defender.some(m=>!m.withdrawn)) {
    const commander:BattleCommander={id:'garrison',name:'守城校尉',portrait:'portraits/001.png',strength:45,intelligence:45,hp:80,maxHp:80,mp:0,maxMp:0,unit:'槍'};
    defender=[{commander,troops:defending,withdrawn:false}];
  }
  const a=attacker.find(m=>!m.withdrawn)??attacker[0];
  // Keep the two native RNG words in the session stream. `nativeAI` is always
  // present in new saves, while old preview saves are restored below.
  const rng:[number,number]=s.nativeAI?[...s.nativeAI.rng]:[s.rng,0x87654321];
  const d=chooseOpponentCommander(defender,rng)??defender[0];
  let b=createBattle({id:`auto-${army.id}`,armyId:army.id,cityId:army.to,attacker:a.commander,defender:d.commander,
    attackingTroops:a.troops,defendingTroops:d.troops,seed:s.rng,aiRng:rng,rosters:{attacker,defender},
    scenery:battleSceneryForCity(scene,army.to)});
  b.invasionSide='attacker';
  b.fortifications={attacker:0,defender:s.cities[army.to].defense};
  const advance=()=>{
    b=commandBattle(b,{type:'start'});
    if(b.nativeCommands) b=commandBattle(b,{type:'native-order',division:256,command:1});
    else b=commandBattle(b,{type:'order',division:'all',order:'advance'});
    for(let i=0;i<20&&b.phase==='fighting';i++)tickBattle(b,200);
  };
  advance();
  for(let round=0;round<8&&b.phase==='intermission';round++) {
    const next=availableCommanders(b,'attacker').find(m=>m.commander.id===b.commanders.attacker.id)??availableCommanders(b,'attacker')[0];
    if(!next)break;
    b=commandBattle(b,{type:'next-round',commanderId:next.commander.id});
    advance();
  }
  // A native battle has a hard 99-second cap. If both sides survive all
  // available rounds, use the same end-of-day withdrawal rule as tickBattle.
  if(b.phase==='intermission')b=commandBattle(b,{type:'withdraw'});
  if(b.phase!=='finished'||!b.winner)throw new Error('电脑战斗未能完成结算。');
  s.rng=b.rng;if(s.nativeAI&&b.opponentAI)s.nativeAI.rng=[...b.opponentAI.rng];
  for(const side of ['attacker','defender'] as const)for(const member of b.rosters[side]) {
    const g=s.generals[member.commander.id];
    if(g){g.hp=member.commander.hp;g.mp=member.commander.mp;g.troops=member.troops;
      if(member.troopSlots)g.troopSlots={...member.troopSlots};else delete g.troopSlots;}
  }
  return {attackerWon:b.winner==='attacker',attackingSurvivors:battleTeamSurvivors(b,'attacker'),defendingSurvivors:battleTeamSurvivors(b,'defender')};
}
function arrive(s:Session,army:Army,scene:ScenarioDefinition,outcome?:EncounterOutcome) {
  const target=s.cities[army.to],cityName=scene.cities.find(c=>c.id===army.to)!.name;
  const commander=scene.generals.find(g=>g.id===army.generalIds[0])!;
  const factionName=scene.factions.find(f=>f.id===army.ownerId)!.name;
  let destination:string|undefined=army.to,troops=army.troops;
  if(target.ownerId&&target.ownerId!==army.ownerId) {
    if(!outcome)throw new Error('须先完成实时战斗。');
    const previousOwner=target.ownerId,defenders=stationedGenerals(s,army.to),original=target.troops;
    const involved=army.ownerId===s.factionId||previousOwner===s.factionId;
    const won=outcome.attackerWon;
    troops=outcome.attackingSurvivors;
    if(won) {
      const retreat=scene.cities.find(c=>c.id!==army.to&&s.cities[c.id].ownerId===previousOwner);
      if(retreat)s.cities[retreat.id].troops+=outcome.defendingSurvivors;
      for(const id of defenders) {
        s.generals[id].cityId=retreat?.id??army.to;
        if(!retreat){s.generals[id].ownerId=null;s.generals[id].status='野';assignAggregateTroops(s.generals[id],0);}
      }
      if(retreat)reconcileCityTroops(s,retreat.id);
      target.troops=0;target.ownerId=army.ownerId;
    } else {
      target.troops=outcome.defendingSurvivors;reconcileCityTroops(s,army.to);
      destination=s.cities[army.from].ownerId===army.ownerId?army.from:scene.cities.find(c=>s.cities[c.id].ownerId===army.ownerId)?.id;
    }
    const text=won?`${factionName}军${commander.name}攻下${cityName}，余兵${troops}人。`:`${factionName}军${commander.name}攻打${cityName}失利，率余部撤回。`;
    if(involved) {
      const playerWon=army.ownerId===s.factionId?won:!won;
      s.reports.unshift({id:s.nextId++,day:s.day,cityId:army.to,commanderId:commander.id,won:playerWon,
        attackingTroops:army.troops,defendingTroops:original,survivors:army.ownerId===s.factionId?troops:outcome.defendingSurvivors,text});
      s.reports.length=Math.min(20,s.reports.length);
      note(s,text,playerWon?'victory':'defeat');
    } else note(s,`诸侯战报：${text}`,'info');
  } else if(!target.ownerId) {
    target.ownerId=army.ownerId;
    note(s,`${factionName}军${commander.name}进驻${cityName}，此城归属${factionName}。`,army.ownerId===s.factionId?'victory':'info');
  } else note(s,`${factionName}军${commander.name}抵达${cityName}，${troops}名士兵归入驻军。`,'march');
  if(destination){s.cities[destination].troops+=troops;s.cities[destination].money+=army.treasury??0;}
  for(const id of army.generalIds) {
    const g=s.generals[id];g.cityId=destination??army.from;g.armyId=null;
    if(!destination){g.ownerId=null;g.status='野';assignAggregateTroops(g,0);}
  }
  if(destination)reconcileCityTroops(s,destination);
  refreshPolicyGovernors(s,scene);
}

function encounter(s:Session,army:Army,scene:ScenarioDefinition,items:readonly Record<string,string>[]) {
  // Include every stationed defender; one commander and that commander's soldiers fight each round.
  const stationed=stationedGenerals(s,army.to);
  // 0x446B52 preserves the city list then swaps the governor into slot zero.
  // Reverse source insertion is our existing city-list adapter; full native
  // linked-list mutation history is still a separate parity gap.
  const defenderIds=[...stationed].reverse();
  const governorId = s.policy
    ? policyGovernorId(s, scene, army.to)
    : scene.cities.find(city => city.id === army.to)?.governorId;
  const governorIndex = governorId ? defenderIds.indexOf(governorId) : -1;
  if (governorIndex > 0) {
    [defenderIds[0], defenderIds[governorIndex]] = [defenderIds[governorIndex], defenderIds[0]];
  }
  // Preserve per-officer soldiers, including zero-HP officers. Redistributing
  // here changes native commander weights before its very first decision.
  reconcileCityTroops(s,army.to);
  const member=(id:string):BattleMember=>{const def=scene.generals.find(g=>g.id===id)!,state=s.generals[id];return {commander:{...officerDefinition(state,def,items),level:officerLevel(state,def),hp:state.hp,mp:state.mp,maxHp:officerMaxHp(state,def),maxMp:officerMaxMp(state,def),morale:state.morale??80,fatigue:state.fatigue??0,loyalty:state.loyalty??90},troops:state.troops,troopSlots:state.troopSlots?{...state.troopSlots}:undefined,withdrawn:state.hp===0};};
  const attackers=army.generalIds.map(member),defenders=defenderIds.map(member);
  if(!defenders.some(m=>!m.withdrawn)) {
    // Existing Web garrison fallback when there is no deployable officer.
    stationed.forEach(id=>assignAggregateTroops(s.generals[id],0));defenders.length=0;
    const commander:BattleCommander={id:'garrison',name:'守城校尉',portrait:'portraits/001.png',strength:45,intelligence:45,hp:80,mp:0,unit:'槍'};
    defenders.push({commander,troops:s.cities[army.to].troops,withdrawn:false});
  }
  // Tactical left/attacker slot is always the player. invasionSide records the strategic attacker.
  const defendingPlayer=army.ownerId!==s.factionId;
  const left=defendingPlayer?defenders:attackers,right=defendingPlayer?attackers:defenders;
  const aiRng:[number,number]=s.nativeAI?[...s.nativeAI.rng]:[s.rng,0x87654321];
  const a=left.find(m=>!m.withdrawn)??left[0],d=chooseOpponentCommander(right,aiRng)??right[0];
  s.battle=createBattle({id:`battle-${s.nextId++}`,armyId:army.id,cityId:army.to,attacker:a.commander,defender:d.commander,attackingTroops:a.troops,defendingTroops:d.troops,seed:s.rng,aiRng,rosters:{attacker:left,defender:right},scenery:battleSceneryForCity(scene,army.to)});
  s.battle.invasionSide=defendingPlayer?'defender':'attacker';
  s.battle.fortifications={attacker:defendingPlayer?s.cities[army.to].defense:0,defender:defendingPlayer?0:s.cities[army.to].defense};
  note(s,`${defendingPlayer?'敌军来袭！':''}${scene.cities.find(c=>c.id===army.to)!.name}双方列阵，我军由${a.commander.name}出战。`,'march');
}
function arrivals(s:Session,scene:ScenarioDefinition,items:readonly Record<string,string>[]) {
  for(const army of [...s.armies].filter(a=>a.remainingDays===0).sort((a,b)=>a.id.localeCompare(b.id))) {
    const target=s.cities[army.to];
    if(target.ownerId&&target.ownerId!==army.ownerId) {
      if(target.ownerId===s.factionId||army.ownerId===s.factionId){encounter(s,army,scene,items);return;}
      arrive(s,army,scene,resolveRivalEncounter(s,army,scene));
    } else arrive(s,army,scene);s.armies=s.armies.filter(a=>a.id!==army.id);
  }
}

export function dispatch(previous: Session, command: Command, content: GameContent): Session {
  const s = structuredClone(previous);
  const scene = scenarioById(content, s.scenarioId);
  if (s.ruleset !== RULESET || s.contentHash !== content.sourceHash) throw new Error('战役规则与当前资料不一致。');
  if(command.type==='battle-command'||command.type==='battle-tick'||command.type==='battle-finish') {
    if(!s.battle)throw new Error('当前没有进行中的战斗。');
    if(command.type==='battle-command')s.battle=commandBattle(s.battle,command.command);
    else if(command.type==='battle-tick')tickBattle(s.battle,command.steps);
    else {
      if(s.battle.phase!=='finished')throw new Error('战斗尚未结束。');
      const army=s.armies.find(a=>a.id===s.battle!.armyId);if(!army)throw new Error('战斗军队不存在。');
      if(s.nativeAI&&s.battle.opponentAI)s.nativeAI.rng=[...s.battle.opponentAI.rng];
      arrive(s,army,scene,tacticalOutcome(s,s.battle));s.rng=s.battle.rng;s.armies=s.armies.filter(a=>a.id!==army.id);s.battle=null;
      arrivals(s,scene,content.items);
      refreshPolicyGovernors(s,scene);
      if(!s.battle&&beginDomesticYear(s,scene,content.items))note(s,`${s.policy!.year}年内政时间到了，年度赋税已入库。`);
    }
    return s;
  }
  if(s.battle)throw new Error('请先完成当前战斗，战略时间已暂停。');
  if(command.type.startsWith('policy-')) {
    const message=executeDomestic(s,scene,command as DomesticCommand,content.items);
    // Per-update autofill is one user action, not a new report per soldier.
    if(command.type!=='policy-troops-fill'||command.mode!=='step')note(s,message);
    return s;
  }
  if(s.policy?.active)throw new Error('当前为内政阶段，请先完成内政，再返回征战。');
  if (command.type === 'advance') {
    if (!Number.isInteger(command.days) || command.days < 1 || command.days > 30) throw new Error('推进天数必须在1至30天之间。');
    arrivals(s,scene,content.items);if(s.battle)return s;
    for (let day = 0; day < command.days; day++) {
      s.day++;
      // Every faction uses the same economy and march validation as the player.
      for (const army of s.armies) army.remainingDays=Math.max(0,army.remainingDays-1);
      if (!s.policy && s.day % 30 === 0) {
        for (const c of Object.values(s.cities)) if (c.ownerId) c.money += Math.floor(c.population / 1000);
        note(s, '月初赋税入库，各城获得人口数千分之一的金钱。');
      }
      arrivals(s,scene,content.items);if(s.battle)break;
      refreshPolicyGovernors(s,scene);
      // Patched native calendar 0x41B7F2: 300 callbacks/month, 10/day.
      // Movement still uses the Web daily road model; no claim of global timing parity.
      for(let callback=0;callback<10;callback++)runNativeStrategicCallback(s,scene,(plan,owner)=>{
        executeStrategic(s,plan.command,scene,owner);
        s.cities[plan.command.from].money-=plan.money;
        s.armies[s.armies.length-1].treasury=plan.money;
      });
      refreshPolicyGovernors(s,scene);
      if(beginDomesticYear(s,scene,content.items)) {note(s,`${s.policy!.year}年内政时间到了，年度赋税已入库。`);break;}
    }
    return s;
  }
  const next=executeStrategic(s,command as StrategicAction,scene,s.factionId);
  refreshPolicyGovernors(next,scene);return next;
}

function executeStrategic(s:Session,command:StrategicAction,scene:ScenarioDefinition,actor:string):Session {
  const prefix=actor===s.factionId?'':`${scene.factions.find(f=>f.id===actor)!.name}·`;
  if (command.type === 'develop' || command.type === 'recruit') {
    const c = ownCity(s, command.cityId,actor);
    if(s.policy)throw new Error('请在内政经营中选择武将开发，或从城内预备池配兵。');
    if (!stationedGenerals(s, command.cityId).length) throw new Error('城中须有我方武将才能执行内政。');
    if (c.lastActionDay === s.day) throw new Error('此城今日已处理内政，请推进一天。');
    const cityName = scene.cities.find(x => x.id === command.cityId)!.name;
    const cost = command.type === 'develop' ? RULES.developCost : RULES.recruitCost;
    if (c.money < cost) throw new Error(`金钱不足，需要${cost}金。`);
    if (command.type === 'recruit' && c.population < RULES.recruitTroops) throw new Error('城中人口不足。');
    c.money -= cost; c.lastActionDay = s.day;
    if (command.type === 'develop') {
      c.defense += RULES.developDefense; c.population += RULES.developPopulation;
      note(s, `${prefix}${cityName}完成开发：城防+20，人口+500，耗费300金。`);
    } else {
      c.troops += RULES.recruitTroops; c.population -= RULES.recruitTroops;
      assignCityTroops(s,command.cityId);
      note(s, `${prefix}${cityName}征募50人，耗费200金。`);
    }
    return s;
  }
  if (command.type === 'march') {
    const city = ownCity(s, command.from,actor);
    const road = scene.roads.find(r => (r.from === command.from && r.to === command.to) || (r.to === command.from && r.from === command.to));
    if (!road || road.restricted) throw new Error('目标没有可用的相邻道路。');
    if (!Number.isInteger(command.troops) || command.troops < 1 || command.troops > city.troops) throw new Error('出征兵力超出驻军数量。');
    const ids = command.generalIds;
    if (!ids.length || ids.length > RULES.maxArmyGenerals || new Set(ids).size !== ids.length || ids.some(id => !stationedGenerals(s, command.from).includes(id))) throw new Error('请选择城中尚未出征的武将，最多五人。');
    if(ids.some(id=>s.generals[id].hp<=0))throw new Error('重伤武将不能出征。');
    if(command.troopsByGeneral&&(Object.keys(command.troopsByGeneral).length!==ids.length||ids.some(id=>!Number.isInteger(command.troopsByGeneral![id])||command.troopsByGeneral![id]<0)||Object.values(command.troopsByGeneral).reduce((a,b)=>a+b,0)!==command.troops))throw new Error('各将配兵之和须等于出征总兵力。');
    const totalDays = Math.max(2, Math.ceil(road.length / RULES.roadUnitsPerDay));
    const army: Army = { id: 'army-' + s.nextId++, ownerId: actor, from: command.from, to: command.to,
      roadId: road.id, generalIds: [...ids], troops: command.troops, totalDays, remainingDays: totalDays };
    city.troops -= army.troops;
    s.armies.push(army);
    for (const id of ids) { s.generals[id].cityId = null; s.generals[id].armyId = army.id; }
    if(command.troopsByGeneral)for(const id of ids)assignAggregateTroops(s.generals[id],command.troopsByGeneral[id]);
    else distribute(s,ids,army.troops);
    if(actor===s.factionId)assignCityTroops(s,command.from);
    const leader = scene.generals.find(g => g.id === ids[0])!;
    note(s, `${prefix}${leader.name}率${army.troops}人向${scene.cities.find(c => c.id === army.to)!.name}进发，预计${totalDays}天抵达。`, 'march');
    refreshPolicyGovernors(s,scene);
    return s;
  }
  throw new Error('不支持的命令。');
}

export function gameDate(session: Session, scene: ScenarioDefinition) {
  return { year: scene.year + Math.floor(session.day / 360), month: Math.floor(session.day % 360 / 30) + 1, day: session.day % 30 + 1 };
}

export function validateSession(value: unknown, content: GameContent): asserts value is Session {
  const fail = () => { throw new Error('存档内容损坏或与当前先行版不兼容。'); };
  if (!value || typeof value !== 'object') return fail();
  const s = value as Session;
  if (s.schemaVersion !== 1 || s.ruleset !== RULESET || s.contentId !== content.id || s.contentHash !== content.sourceHash) return fail();
  const scene = content.scenarios.find(x => x.id === s.scenarioId);
  if (!scene || !scene.factions.some(f => f.id === s.factionId && !f.special)) return fail();
  const integer = (n: unknown, max = 1000000000) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= max;
  if (!integer(s.day) || !integer(s.rng, 4294967295) || s.rng === 0 || !integer(s.nextId) || s.nextId < 1 || !s.cities || !s.generals ||
      Object.keys(s.cities).length !== scene.cities.length || Object.keys(s.generals).length !== scene.generals.length ||
      !Array.isArray(s.armies) || s.armies.length > scene.generals.length || !Array.isArray(s.chronicle) || s.chronicle.length > 100 ||
      !Array.isArray(s.reports) || s.reports.length > 20) return fail();
  const owner = (id: unknown) => id === null || scene.factions.some(f => f.id === id);
  const cityIds = new Set(scene.cities.map(c => c.id));
  if(s.nativeAI!==undefined) {
    const a=s.nativeAI,keys=scene.factions.map(f=>f.id);
    if(!a||a.version!==1||!Array.isArray(a.rng)||a.rng.length!==2||!a.rng.every(n=>integer(n,4294967295))||!integer(a.callbacks)||
      !a.countdowns||!a.cityOrder||!a.seen||!a.reserves||!a.recruitTimers||!a.recovery||!Array.isArray(a.trace)||a.trace.length>32)return fail();
    if(keys.some(id=>!integer(a.countdowns[id],1000)||![a.cityOrder[id],a.seen[id]].every(list=>Array.isArray(list)&&list.length<=scene.cities.length&&new Set(list).size===list.length&&list.every(c=>cityIds.has(c)))))return fail();
    if(scene.cities.some(c=>!integer(a.reserves[c.id],600)||!Number.isSafeInteger(a.recruitTimers[c.id])||Math.abs(a.recruitTimers[c.id])>1000000))return fail();
    if(scene.generals.some(g=>!a.recovery[g.id]||![a.recovery[g.id].hp,a.recovery[g.id].mp].every(n=>Number.isSafeInteger(n)&&Math.abs(n)<=1000000)))return fail();
    if(scene.generals.some(g=>Object.keys(initialConditionTimers()).some(k=>{const n=a.recovery[g.id][k as keyof ReturnType<typeof initialConditionTimers>];return n!==undefined&&(!Number.isInteger(n)||n< -32768||n>32767);})))return fail();
    if(a.trace.some(t=>!t||!integer(t.callback,a.callbacks)||!keys.includes(t.owner)||![0,1,3,4,5,7,8,9].includes(t.kind)||
      ![t.from,t.to].every(c=>c===null||cityIds.has(c))||!integer(t.candidates,64)||!integer(t.unresolvedCooperationReads,10000)))return fail();
  }
  for (const def of scene.cities) {
    const c = s.cities[def.id];
    if (!c || !owner(c.ownerId) || ![c.money,c.population,c.defense,c.troops].every(n => integer(n)) ||
        !Number.isInteger(c.lastActionDay) || c.lastActionDay < -1 || c.lastActionDay > s.day) return fail();
  }
  const armyIds = new Set<string>(); const marching = new Set<string>();
  for (const a of s.armies) {
    const road = scene.roads.find(r => r.id === a.roadId);
    if (typeof a.id !== 'string' || !/^army-[1-9]\d*$/.test(a.id) || !integer(Number(a.id.slice(5)), s.nextId - 1) || armyIds.has(a.id) || !road || road.restricted || !owner(a.ownerId) || !a.ownerId ||
        !((a.from === road.from && a.to === road.to) || (a.from === road.to && a.to === road.from)) ||
        !integer(a.troops) || a.troops < 1 || !integer(a.totalDays, 1000) || !integer(a.remainingDays, a.totalDays) ||
        !Array.isArray(a.generalIds) || a.generalIds.length < 1 || a.generalIds.length > 5) return fail();
    armyIds.add(a.id);
    if(a.treasury!==undefined&&!integer(a.treasury))return fail();
    for (const id of a.generalIds) {
      const g = s.generals[id];
      if (!g || marching.has(id) || g.armyId !== a.id || g.cityId !== null || g.ownerId !== a.ownerId || g.status !== '登') return fail();
      marching.add(id);
    }
    if(a.generalIds.reduce((n,id)=>n+s.generals[id].troops,0)!==a.troops)return fail();
  }
  for (const def of scene.generals) {
    const g = s.generals[def.id];
    if (!g || !owner(g.ownerId) || !integer(g.hp,officerMaxHp(g,def))||!integer(g.mp,officerMaxMp(g,def))||!integer(g.troops)||!['登','野','未'].includes(g.status) || (g.cityId !== null && !cityIds.has(g.cityId)) ||
        (g.armyId !== null && (!armyIds.has(g.armyId) || !marching.has(def.id)))) return fail();
    if(g.troopSlots!==undefined) {
      const t=g.troopSlots,cap=nativeTroopCapacity(officerLevel(g,def));
      if(!t||!integer(t.active,Math.max(0,cap.active))||!integer(t.reserve,cap.reserve)||t.active+t.reserve>g.troops)return fail();
    }
    if(['morale','fatigue','loyalty'].some(k=>{const n=g[k as keyof NativeOfficerCondition];return n!==undefined&&!integer(n,100);}))return fail();
    if(g.level!==undefined&&(!integer(g.level,99)||g.level<1))return fail();
    if(g.experience!==undefined&&!integer(g.experience,4294967295))return fail();
    if(g.maxHp!==undefined&&(!integer(g.maxHp,32767)||g.maxHp<1))return fail();
    if(g.maxMp!==undefined&&(!integer(g.maxMp,32767)||g.maxMp<1))return fail();
    for(const key of ['strength','intelligence','speed'] as const)if(g[key]!==undefined&&(!Number.isInteger(g[key])||g[key]!< -32768||g[key]!>32767))return fail();
    for(const key of ['weaponId','horseId','thingId'] as const)if(g[key]!==undefined&&(!integer(g[key],127)||(g[key]!==0&&!content.items.some(i=>Number(i.SEQUENCE)===g[key]))))return fail();
    if(g.forceMask!==undefined&&!integer(g.forceMask,8191)||g.battleMask!==undefined&&!integer(g.battleMask,511))return fail();
    if(g.currentUnit!==undefined&&(!nativeForceNames.includes(g.currentUnit as typeof nativeForceNames[number])||(officerForceMask(g,def)&(1<<nativeForceNames.indexOf(g.currentUnit as typeof nativeForceNames[number])))===0))return fail();
    if(g.legacyEquipment!==undefined&&(!Array.isArray(g.legacyEquipment)||g.legacyEquipment.length>3||new Set(g.legacyEquipment).size!==g.legacyEquipment.length||g.legacyEquipment.some(id=>!integer(id,127)||id===0||!content.items.some(i=>Number(i.SEQUENCE)===id))))return fail();
  }
  for(const city of scene.cities)if(stationedGenerals(s,city.id).reduce((n,id)=>n+s.generals[id].troops,0)>s.cities[city.id].troops)return fail();
  if(s.policy!==undefined) {
    const p=s.policy,currentYear=scene.year+Math.floor(s.day/360);
    if(!p||p.version!==1||typeof p.active!=='boolean'||!integer(p.year,currentYear)||p.year<scene.year||p.year<currentYear-1||
      (p.active&&s.battle!==null)||(p.year<currentYear&&s.battle===null)||!Array.isArray(p.acted)||p.acted.length>scene.generals.length||
      new Set(p.acted).size!==p.acted.length||p.acted.some(id=>!scene.generals.some(g=>g.id===id))||
      !p.governors||Object.keys(p.governors).length!==scene.cities.length||!Array.isArray(p.results)||p.results.length>100)return fail();
    for(const def of scene.cities) {
      const id=p.governors[def.id];
      if(id!==null&&(typeof id!=='string'||!stationedGenerals(s,def.id).includes(id)))return fail();
    }
    for(const r of p.results)if(!r||!integer(r.year,p.year)||r.year<scene.year||!cityIds.has(r.cityId)||!scene.generals.some(g=>g.id===r.generalId)||
      ![r.population,r.defense,r.reportedPopulation,r.reportedDefense].every(n=>integer(n)))return fail();
    if(p.annual!==undefined) {
      const a=p.annual,factions=scene.factions.map(f=>f.id),ids=new Set(scene.generals.map(g=>g.id));
      if(!a||a.version!==1||!a.rosterOrder||Object.keys(a.rosterOrder).length!==factions.length||!a.battleExperience||Object.keys(a.battleExperience).length!==factions.length||!Array.isArray(a.reports)||a.reports.length>100)return fail();
      const listed=new Set<string>();
      for(const faction of factions) {
        const order=a.rosterOrder[faction];if(!Array.isArray(order)||order.length>ids.size||!integer(a.battleExperience[faction],4294967295))return fail();
        for(const id of order){if(!ids.has(id)||listed.has(id))return fail();listed.add(id);}
      }
      for(const r of a.reports)if(!r||!integer(r.year,p.year)||r.year<scene.year||!factions.includes(r.factionId)||!['searches','developments','recruits','levels','items'].every(key=>integer(r[key as 'searches'],100000)))return fail();
    }
    if(p.search!==undefined) {
      const q=p.search,generalIds=new Set(scene.generals.map(g=>g.id)),factions=scene.factions.map(f=>f.id);
      const itemIds=new Set(content.items.map(item=>Number(item.SEQUENCE)));
      if(!q||q.version!==1||!q.inventory||Object.keys(q.inventory).length!==factions.length||
        !q.autonomy||Object.keys(q.autonomy).length!==cityIds.size||!q.residentOrder||Object.keys(q.residentOrder).length!==cityIds.size||
        !Array.isArray(q.found)||q.found.length>128||new Set(q.found).size!==q.found.length||q.found.some(id=>!integer(id,127))||
        !Array.isArray(q.reports)||q.reports.length>100)return fail();
      for(const id of factions) {
        const inventory=q.inventory[id];if(!inventory||typeof inventory!=='object'||Array.isArray(inventory)||Object.keys(inventory).length>127)return fail();
        if(Object.entries(inventory).some(([key,count])=>!/^[1-9]\d*$/.test(key)||!integer(Number(key),127)||!itemIds.has(Number(key))||!integer(count,99)||count<1))return fail();
      }
      for(const id of cityIds) {
        const list=q.residentOrder[id];if(!integer(q.autonomy[id],4)||!Array.isArray(list)||list.length>generalIds.size||new Set(list).size!==list.length||list.some(g=>!generalIds.has(g)))return fail();
      }
      for(const r of q.reports) {
        if(!r||!integer(r.year,p.year)||r.year<scene.year||!cityIds.has(r.cityId)||!generalIds.has(r.generalId)||!['none','item','officer'].includes(r.kind))return fail();
        if(r.kind==='item'&&(!integer(r.itemId,127)||!itemIds.has(r.itemId!)||r.itemId===0))return fail();
        if(r.kind==='officer'&&(!generalIds.has(r.candidateId!)||![16,17,18,19].includes(r.code!)))return fail();
        if(r.levels!==undefined&&(!integer(r.levels,98)||r.kind!=='officer'||![16,17].includes(r.code!)))return fail();
        if(r.kind!=='item'&&r.itemId!==undefined||r.kind!=='officer'&&(r.code!==undefined||r.candidateId!==undefined))return fail();
      }
    }
  }
  for (const e of s.chronicle) if (!e || !integer(e.id,s.nextId-1) || !integer(e.day,s.day) || typeof e.text !== 'string' || e.text.length > 1000 || !['info','march','victory','defeat'].includes(e.kind)) return fail();
  for (const e of s.reports) if (!e || !integer(e.id,s.nextId-1) || !integer(e.day,s.day) || !cityIds.has(e.cityId) || !scene.generals.some(g => g.id === e.commanderId) || typeof e.won !== 'boolean' ||
      ![e.attackingTroops,e.defendingTroops,e.survivors].every(n => integer(n)) || typeof e.text !== 'string' || e.text.length > 1000) return fail();
  if(s.battle!==null) {
    validateBattle(s.battle);
    const army=s.armies.find(a=>a.id===s.battle!.armyId);
    const invader=s.battle.invasionSide??'attacker',defense=invader==='attacker'?'defender':'attacker';
    if(!army||army.remainingDays!==0||army.to!==s.battle.cityId||s.battle.totalInitial[invader]!==army.troops||s.battle.totalInitial[defense]!==s.cities[army.to].troops||!army.generalIds.includes(s.battle.commanders[invader].id))return fail();
    if((invader==='attacker'?army.ownerId:s.cities[army.to].ownerId)!==s.factionId)return fail();
    if(s.battle.rosters[invader].some(m=>!army.generalIds.includes(m.commander.id))||s.battle.rosters[defense].some(m=>m.commander.id!=='garrison'&&!stationedGenerals(s,army.to).includes(m.commander.id)))return fail();
  }
  if(s.battle===null&&s.armies.some(a=>a.remainingDays===0))return fail();
}

/** Explicitly upgrades the strategic preview save; preserves all existing resources and movement. */
export function readSession(value:unknown,content:GameContent):Session {
  const copy=structuredClone(value) as Session;
  if(copy&&['web-strategy-preview-v1','web-tactical-preview-v2'].includes(String(copy.ruleset))) {
    if(String(copy.ruleset)==='web-strategy-preview-v1')copy.battle=null;
    copy.ruleset=RULESET;
    const scene=scenarioById(content,copy.scenarioId);
    for(const def of scene.generals)if(copy.generals?.[def.id])Object.assign(copy.generals[def.id],{hp:def.hp,mp:def.mp,troops:0});
    for(const c of scene.cities)if(copy.cities?.[c.id])assignCityTroops(copy,c.id);
    for(const a of copy.armies??[])distribute(copy,a.generalIds,a.troops);
    if(copy.battle) {
      copy.battle=upgradeBattle(copy.battle);
      // A v2 duel represented an entire army. Keep it intact, and put its surviving
      // allocation on the original commander rather than introducing new troops.
      const army=copy.armies.find(a=>a.id===copy.battle!.armyId);
      if(army)for(const id of army.generalIds)copy.generals[id].troops=id===copy.battle.commanders.attacker.id?army.troops:0;
      if(copy.battle.cityId)for(const id of stationedGenerals(copy,copy.battle.cityId))copy.generals[id].troops=id===copy.battle.commanders.defender.id?copy.cities[copy.battle.cityId].troops:0;
    }
  }
  // Recover learning schedules lost by the old converter without resetting an
  // in-flight duel's vitals, maxima, charge, units, RNG or script progress.
  if(copy?.battle&&copy.contentId===content.id&&copy.contentHash===content.sourceHash) {
    const scene=content.scenarios.find(s=>s.id===copy.scenarioId);
    for(const side of ['attacker','defender'] as const) {
      const commanders=[copy.battle.commanders?.[side],...(Array.isArray(copy.battle.rosters?.[side])?copy.battle.rosters[side]:[]).map(m=>m?.commander)];
      for(const c of commanders) {
        const def=scene?.generals.find(g=>g.id===c?.id);
        if(c&&def&&c.skillLearnset===undefined) {
          c.skillLearnset=structuredClone(def.skillLearnset);c.level??=def.level;c.rawSkill=def.rawSkill;
        }
      }
    }
  }
  validateSession(copy,content);
  if(copy.nativeAI===undefined)copy.nativeAI=createNativeCampaignAI(copy,scenarioById(content,copy.scenarioId));
  return copy;
}
