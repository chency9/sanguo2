import { scenarioById, type GameContent, type ScenarioDefinition } from '@sango2/content';
import { createBattle, commandBattle, tickBattle, validateBattle, battleTeamSurvivors, upgradeBattle, chooseOpponentCommander, type BattleState, type BattleCommand, type BattleCommander, type BattleMember,type BattleSide } from './battle';
export * from './battle';
export * from './native-projection';
export * from './battle-scene';
export {battleScriptCameraLocked} from './battle-native-magic';
import {type StrategicAction} from './strategic-ai';
import {nativeBelow,type NativeRandomState} from './native-strategic-ai';
import {nativeSceneryTerrain,nativeSceneryVariant} from './native-scenery';
import {createNativeCampaignAI,runNativeStrategicCallback,nativeCityCapacity,type NativeCampaignAI} from './native-ai-campaign';
import {initialOfficerCondition,initialConditionTimers,type NativeOfficerCondition} from './native-officer-condition';
import {nativeTroopCapacity,type TroopSlots} from './native-troops';
import {officerLevel,officerMaxHp,officerMaxMp,officerExperience,applyOfficerExperience,type OfficerProgress} from './native-progression';
import {nativeVictoryMeritBonus,nativeBattleExperience,nativeParticipantDisposition,nativeFactionDisposition,isNativeBattleRecord,type NativeBattleRecord} from './native-battle-experience';
import {initializeOfficerEquipment,officerDefinition,officerForceMask,nativeForceNames,type OfficerEquipment} from './native-officer-runtime';
import {ensureDomesticAnnual} from './native-policy-annual';
import {nativeResolveAICaptives,nativePreparePlayerCaptive,nativePlayerCaptiveDecision,nativeCapturedJoinLoyalty,nativeRulerCanEscape,nativeCaptiveDefeatCondition,type NativeCaptureCandidate,type NativePlayerCaptive} from './native-capture';
import {initNativeCampaignMovement,runNativeCampaignMovement,settleNativeArmyAftermath,nativeDefeatedCityRetreat,validateNativeCampaignMovement,nativeCampaignArmyPosition,retargetNativeCampaignArmy,type NativeCampaignMovement,type NativeCampaignEncounter} from './campaign-native-movement';
import {createCampaignRoadBattle,resolveComputerRoadBattle,settleCampaignRoadBattle,validateCampaignRoadBattle} from './campaign-road-battle';
import {createNativeCaptiveScript,advanceNativeCaptiveScript,validateNativeCaptiveScript,type NativeCaptiveScript} from './native-captive-script';
import {emitBattleSound} from './battle-audio-events';
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
export interface GeneralState extends Partial<NativeOfficerCondition>,Partial<OfficerProgress>,Partial<OfficerEquipment> { ownerId: string | null; cityId: string | null; armyId: string | null; status: string; hp:number; mp:number; troops:number; troopSlots?:TroopSlots; currentUnit?:string;battleRecord?:NativeBattleRecord;appearanceHidden?:boolean }
export interface Army {
  id: string; ownerId: string; from: string; to: string; roadId: string; generalIds: string[];
  troops: number; totalDays: number; remainingDays: number;
  treasury?:number;
  nativeMovement?:NativeCampaignMovement;
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
  captureRules?:'native-capture-v1';
  pendingCaptive?:{version:1;side:BattleSide;winnerFactionId:string;current:NativePlayerCaptive;script?:NativeCaptiveScript};
  endgame?:{result:'victory'|'defeat';day:number;reason:'unification'|'ruler-lost'};
  movementRules?:'native-strategic-v1';
  nativeMovementClock?:{callbackInDay:number};
}
export type Command =
  | DomesticCommand
  | { type: 'develop' | 'recruit'; cityId: string }
  | { type: 'march'; from: string; to: string; generalIds: string[]; troops: number; troopsByGeneral?:Record<string,number> }
  | { type: 'advance'; days: number }
  | { type: 'battle-command'; command: BattleCommand }
  | { type: 'battle-tick'; steps: number }
  | { type: 'battle-finish' }
  | { type:'capture-choice';choice:'yield'|'kill'|'free' }
  | { type:'capture-dialogue-next' }
  | { type:'capture-script-tick';steps:number };

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
  if(scene.initialization==='native-105plus'){s.captureRules='native-capture-v1';s.movementRules='native-strategic-v1';}
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
 * coordinate. Converted content records one sample for each three-month
 * season; locations without a recovered mapping intentionally keep the
 * historical castle fallback.
 */
export function battleSceneryForCity(scene: ScenarioDefinition, cityId: string, day = 0, rng?: NativeRandomState, population?:number): NonNullable<BattleState['scenery']> {
  const city = scene.cities.find(c => c.id === cityId);
  const season = Math.floor((Math.max(0, day) % 360) / 90);
  const scenery = city?.battleSceneryBySeason?.[season] ?? city?.battleScenery;
  if (scenery) {
    const mode=city?.battleSceneryMode;
    const variant=mode==='a'||mode==='b'?mode:mode==='random'&&rng?nativeSceneryVariant(mode,rng):scenery.variant;
    return {terrainId:nativeSceneryTerrain(scenery.terrainId,population===undefined?undefined:nativeCityCapacity(population)),variant};
  }
  return {terrainId: 0, variant: 'a'};
}

/** Native map terrain at the middle of a road, retained for in-transit
 * encounters and route rendering. The original queries the moving object's
 * current coordinates; this helper exposes the verified midpoint sample until
 * the strategic object pair loop is wired into the Web campaign. */
export function roadMidpointTerrainForDay(scene: ScenarioDefinition, roadId: string, day = 0): number | null {
  const road=scene.roads.find(r=>r.id===roadId),season=Math.floor((Math.max(0,day)%360)/90);
  const terrain=road?.midpointTerrainBySeason?.[season];
  return terrain===undefined?null:terrain;
}

/** Project an in-transit army onto the original polyline. Strategic rules and
 * the map renderer use the same distance fraction, so a later object-pair
 * query cannot disagree with the position shown to the player. */
export function strategicArmyPosition(scene: ScenarioDefinition, army: Army): [number, number] | null {
  const native=nativeCampaignArmyPosition(army);if(native)return native;
  const road=scene.roads.find(r=>r.id===army.roadId);
  if(!road||road.points.length<2||army.totalDays<=0)return null;
  const points=road.from===army.from?road.points:[...road.points].reverse();
  const lengths=points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1]));
  let distance=lengths.reduce((a,b)=>a+b,0)*Math.max(0,Math.min(1,1-army.remainingDays/army.totalDays));
  for(let i=0;i<lengths.length;i++) {
    const length=lengths[i];
    if(distance<=length||i===lengths.length-1) {
      const ratio=length?Math.max(0,Math.min(1,distance/length)):1;
      return [points[i][0]+(points[i+1][0]-points[i][0])*ratio,points[i][1]+(points[i+1][1]-points[i][1])*ratio];
    }
    distance-=length;
  }
  return points.at(-1)??null;
}

/** The native type-0 strategic encounter queries the midpoint of the two
 * object coordinates before looking up the seasonal map mask. Keep this
 * calculation separate from collision policy because the executable's pair
 * insertion threshold is still being reconstructed. */
export function strategicEncounterPosition(scene: ScenarioDefinition, first: Army, second: Army): [number, number] | null {
  const a=strategicArmyPosition(scene,first),b=strategicArmyPosition(scene,second);
  return a&&b?[(a[0]+b[0])/2,(a[1]+b[1])/2]:null;
}

function ownCity(s: Session, id: string, actor=s.factionId) {
  const c = s.cities[id];
  if (!c || c.ownerId !== actor) throw new Error('只能在我方城池执行此命令。');
  return c;
}

interface EncounterOutcome { attackerWon:boolean; attackingSurvivors:number; defendingSurvivors:number;sourceSettled?:boolean }
function tacticalOutcome(s:Session,battle:BattleState,scene:ScenarioDefinition):EncounterOutcome {
  const invader=battle.invasionSide??'attacker',defense=invader==='attacker'?'defender':'attacker';
  for(const side of ['attacker','defender'] as const)for(const member of battle.rosters[side]) {
    const g=s.generals[member.commander.id];
    if(g){g.hp=member.commander.hp;g.mp=member.commander.mp;g.troops=member.troops;
      if(member.troopSlots)g.troopSlots={...member.troopSlots};else delete g.troopSlots;
      if(member.commander.battleRecord)g.battleRecord={...member.commander.battleRecord};
      for(const key of ['morale','fatigue','loyalty'] as const)if(member.commander[key]!==undefined)g[key]=member.commander[key];}
  }
  if(battle.experienceRules)settleBattleExperience(s,battle,scene);
  return {attackerWon:battle.winner===invader,attackingSurvivors:battleTeamSurvivors(battle,invader),defendingSurvivors:battleTeamSurvivors(battle,defense)};
}

function settleBattleExperience(s:Session,b:BattleState,scene:ScenarioDefinition) {
  if(!b.drawn&&b.winner) {
    const losing=b.winner==='attacker'?'defender':'attacker',winning=b.rosters[b.winner];
    const {merits}=nativeVictoryMeritBonus(winning.map(m=>({merit:m.merit??0})),b.rosters[losing].map(m=>m.commander.level??20));
    winning.forEach((m,i)=>m.merit=merits[i]);
  }
  const annual=s.policy?ensureDomesticAnnual(s,scene):undefined;
  const invader=b.invasionSide??'attacker',nativeFirstSide=b.roadEncounter?.firstSide??(invader==='attacker'?'defender':'attacker');
  const result:0|1|2=b.drawn?0:b.winner===nativeFirstSide?1:2;
  const owners=new Map<BattleSide,string>();
  for(const side of ['attacker','defender'] as const)for(const member of b.rosters[side]) {
    const g=s.generals[member.commander.id],def=scene.generals.find(d=>d.id===member.commander.id);
    if(!g||!def)continue;
    const owner=g.ownerId;if(owner)owners.set(side,owner);
    const award=nativeBattleExperience(member.merit??0,officerExperience(g,def),owner?annual?.battleExperience[owner]??0:0);
    applyOfficerExperience(g,def,award.experience);
    if(owner&&annual)annual.battleExperience[owner]=award.factionExperience;
    if(def.constancy!==undefined) {
      const next=nativeParticipantDisposition({...initialOfficerCondition(g),constancy:def.constancy},side===nativeFirstSide?'first':'second',result);
      g.morale=next.morale;g.loyalty=next.loyalty;g.fatigue=next.fatigue;
    }
  }
  if(result!==0)for(const [side,owner] of owners)for(const def of scene.generals) {
    const g=s.generals[def.id];if(g.ownerId!==owner||g.status!=='登'||def.constancy===undefined)continue;
    const next=nativeFactionDisposition({...initialOfficerCondition(g),constancy:def.constancy},side===b.winner);
    g.morale=next.morale;g.loyalty=next.loyalty;g.fatigue=next.fatigue;
  }
}
function campaignBattleMember(s:Session,scene:ScenarioDefinition,id:string,items:readonly Record<string,string>[]):BattleMember {
  const def=scene.generals.find(g=>g.id===id);
  const state=s.generals[id];
  if(!def||!state)throw new Error('战役武将资料缺失。');
  return {commander:{...officerDefinition(state,def,items),level:officerLevel(state,def),
    hp:state.hp,mp:state.mp,maxHp:officerMaxHp(state,def),maxMp:officerMaxMp(state,def),
    battleRecord:state.battleRecord?{...state.battleRecord}:undefined,
    morale:state.morale??80,fatigue:state.fatigue??0,loyalty:state.loyalty??90},
    troops:state.troops,troopSlots:state.troopSlots?{...state.troopSlots}:undefined,withdrawn:state.hp<=0};
}

function captureCandidates(s:Session,b:BattleState,scene:ScenarioDefinition,side:BattleSide):NativeCaptureCandidate[] {
  return b.rosters[side].map(m=>{
    const def=scene.generals.find(g=>g.id===m.commander.id),g=s.generals[m.commander.id],owner=g?.ownerId;
    const faction=scene.factions.find(f=>f.id===owner),loyal=def?.loyalFactionId??null;
    const loyalLeader=scene.factions.find(f=>f.id===loyal)?.leaderId,leaderState=loyalLeader?s.generals[loyalLeader]:undefined;
    return {id:m.commander.id,status:m.battleStatus??0,loyalty:m.commander.loyalty??90,constancy:def?.constancy??0,
      loyalFactionId:loyal,loyalLeaderOwnerId:leaderState?.ownerId??null,loyalLeaderActive:leaderState?.status==='登',
      isRuler:faction?.leaderId===m.commander.id,ownerIsPlayer:owner===s.factionId,
      rulerHasOtherCity:!!owner&&scene.cities.some(c=>c.id!==g.cityId&&s.cities[c.id].ownerId===owner)};
  });
}
/** Real-time 0x447037 -> 0x447520 -> 0x44E820. The captured roster order,
 * one-time condition penalty and cached persuasion result all survive saves. */
function prepareCampaignCaptives(s:Session,b:BattleState,scene:ScenarioDefinition):boolean {
  if(!b.captureRules||b.drawn||!b.winner)return false;
  const side:BattleSide=b.winner==='attacker'?'defender':'attacker',rng=b.opponentAI!.rng;
  if(!b.capturePrepared) {
    const candidates=captureCandidates(s,b,scene,side);
    for(let i=0;i<candidates.length;i++) {
      const c=candidates[i],member=b.rosters[side][i];if(c.status!==3)continue;
      if(nativeRulerCanEscape(c.isRuler,c.ownerIsPlayer,c.rulerHasOtherCity))member.battleStatus=7;
      else if(!b.attackerAI) {
        const penalty=nativeCaptiveDefeatCondition(member.commander.morale??80,c.loyalty,c.constancy);
        // Original 44E820 clamps the selected prisoner before persuasion, and
        // 40FA92 clamps all remaining participants. Save the equivalent bounded
        // projection so intermediate Web saves retain valid condition fields.
        member.commander.morale=Math.max(0,Math.min(100,penalty.morale));member.commander.loyalty=Math.max(0,Math.min(100,penalty.loyalty));
      }
    }
    b.capturePrepared=true;
  }
  const winningOwner=s.generals[b.rosters[b.winner][0].commander.id]?.ownerId;
  if(!winningOwner)return false;
  if(winningOwner===s.factionId&&!b.attackerAI) {
    const current=nativePreparePlayerCaptive(winningOwner,captureCandidates(s,b,scene,side),rng);
    if(current){s.pendingCaptive={version:1,side,winnerFactionId:winningOwner,current};return true;}
  } else {
    const results=nativeResolveAICaptives(winningOwner,Object.values(s.cities).some(c=>c.ownerId===winningOwner),captureCandidates(s,b,scene,side),rng);
    results.forEach((result,i)=>b.rosters[side][i].battleStatus=result.status);
  }
  return false;
}

function detachCampaignOfficer(s:Session,id:string):void {
  const g=s.generals[id];
  if(g.cityId&&s.cities[g.cityId])s.cities[g.cityId].troops=Math.max(0,s.cities[g.cityId].troops-g.troops);
  if(g.armyId) {
    const army=s.armies.find(a=>a.id===g.armyId);
    if(army){army.generalIds=army.generalIds.filter(member=>member!==id);army.troops=army.generalIds.reduce((n,member)=>n+s.generals[member].troops,0);}
  }
  g.cityId=null;g.armyId=null;
}
function captureMovementArmy(s:Session,scene:ScenarioDefinition,ids:string[],ownerId:string,from:string,to:string,retreat=false):Army {
  const army:Army={id:`army-${s.nextId++}`,ownerId,from,to,roadId:'',generalIds:[...ids],troops:ids.reduce((n,id)=>n+s.generals[id].troops,0),totalDays:1,remainingDays:1,treasury:0};
  if(!initNativeCampaignMovement(scene,army,{cityId:from,destinationId:to}))throw new Error('原版战后军团找不到可用路线。');
  for(const id of ids){detachCampaignOfficer(s,id);s.generals[id].armyId=army.id;}
  s.armies.push(army);if(retreat)settleNativeArmyAftermath(s,scene,army,16);return army;
}
/** The executable keeps the designated leader pointer. Changing that
 * officer's owner makes the old faction inactive; there is no invented heir. */
function refreshCampaignFactions(s:Session,scene:ScenarioDefinition):void {
  if(!s.captureRules)return;
  const bandits=scene.factions.find(f=>f.special),active=(f:typeof scene.factions[number])=>!!f.leaderId&&s.generals[f.leaderId]?.ownerId===f.id;
  if(bandits)for(const army of s.armies) {
    const owner=scene.factions.find(f=>f.id===army.ownerId);
    if(owner&&!owner.special&&owner.leaderId&&!active(owner)) {
      army.ownerId=bandits.id;for(const id of army.generalIds)s.generals[id].ownerId=bandits.id;
    }
  }
  const player=scene.factions.find(f=>f.id===s.factionId),opponents=scene.factions.filter(f=>!f.special&&f.id!==s.factionId&&f.leaderId);
  if(opponents.length&&!opponents.some(active))s.endgame={result:'victory',day:s.day,reason:'unification'};
  else if(player?.leaderId&&!active(player))s.endgame={result:'defeat',day:s.day,reason:'ruler-lost'};
}

/** Original status5 removes an officer, status6 creates a one-officer return
 * army with existing wounds/slots/equipment, and status7 relocates its ruler. */
function applyCampaignCaptiveDisposition(s:Session,b:BattleState,scene:ScenarioDefinition,army:Army):void {
  if(!b.winner||b.drawn)return;
  const losing:BattleSide=b.winner==='attacker'?'defender':'attacker',winnerId=s.generals[b.rosters[b.winner][0].commander.id]?.ownerId;
  if(!winnerId)return;
  for(const member of b.rosters[losing]) {
    const g=s.generals[member.commander.id];if(!g)continue;
    if(member.battleStatus===5) {detachCampaignOfficer(s,member.commander.id);g.ownerId=null;g.status='死';g.appearanceHidden=true;}
    else if(member.battleStatus===6) {
      detachCampaignOfficer(s,member.commander.id);g.ownerId=winnerId;g.loyalty=nativeCapturedJoinLoyalty(g.loyalty??90);
      const road=b.roadEncounter;
      const destination=road?(
        s.armies.find(a=>a.id===(b.winner===road.firstSide?road.firstArmyId:road.secondArmyId))?.nativeMovement?.lastCityId
        ??scene.cities.find(c=>s.cities[c.id].ownerId===winnerId)?.id):army.to;
      if(!destination)throw new Error('归附武将没有原版目的城。');
      if(s.cities[destination].ownerId===null)s.cities[destination].ownerId=winnerId;
      captureMovementArmy(s,scene,[member.commander.id],winnerId,destination,destination);
    } else if(member.battleStatus===7&&g.ownerId) {
      const all=scene.cities.filter(c=>s.cities[c.id].ownerId===g.ownerId).map(c=>c.id),old=s.nativeAI!.cityOrder[g.ownerId]??[];
      const choices=[...all.filter(id=>!old.includes(id)).reverse(),...old.filter(id=>all.includes(id))];
      if(choices.length) {
        const destination=choices[nativeBelow(s.nativeAI!.rng,choices.length)];
        // 40EDA1's a2 prevents moving a defending ruler back into the city
        // which is about to fall. Its random selection still consumes a draw.
        if(destination===army.to&&b.winner===(b.invasionSide??'attacker'))continue;
        detachCampaignOfficer(s,member.commander.id);g.cityId=destination;s.cities[destination].troops+=g.troops;
        if(s.policy)s.policy.governors[destination]=member.commander.id;
      }
    }
  }
  army.generalIds=army.generalIds.filter(id=>s.generals[id].armyId===army.id&&s.generals[id].ownerId===army.ownerId&&s.generals[id].status==='登');
  army.troops=army.generalIds.reduce((n,id)=>n+s.generals[id].troops,0);
}

function settleNativeCityBattle(s:Session,b:BattleState,scene:ScenarioDefinition,army:Army):void {
  const target=s.cities[army.to],previousOwner=target.ownerId,cityName=scene.cities.find(c=>c.id===army.to)!.name;
  const invader=b.invasionSide??'attacker',won=!b.drawn&&b.winner===invader;
  target.troops=stationedGenerals(s,army.to).reduce((sum,id)=>sum+s.generals[id].troops,0);
  const before=army.troops;applyCampaignCaptiveDisposition(s,b,scene,army);
  if(won) {
    // 0x40F692 chooses its route while the city still belongs to the loser.
    const destination=nativeDefeatedCityRetreat(s,scene,army.to);
    const remaining=stationedGenerals(s,army.to);
    if(remaining.length&&!destination)throw new Error('败城余将找不到原版撤退目标。');
    for(let i=0;i<remaining.length;i+=5)captureMovementArmy(s,scene,remaining.slice(i,i+5),previousOwner!,army.to,destination!,true);
    target.ownerId=army.ownerId;target.troops=0;
    for(const id of army.generalIds){s.generals[id].cityId=army.to;s.generals[id].armyId=null;target.troops+=s.generals[id].troops;}
    target.money+=army.treasury??0;s.armies=s.armies.filter(a=>a!==army);
  } else if(army.generalIds.length) {
    if(!army.nativeMovement&&!initNativeCampaignMovement(scene,army,{cityId:army.to,destinationId:army.from}))throw new Error('败军找不到原版撤退路线。');
    settleNativeArmyAftermath(s,scene,army,4);
  } else s.armies=s.armies.filter(a=>a!==army);
  const playerWon=b.winner==='attacker'&&!b.drawn;
  const text=b.drawn?`${cityName}日暮收兵，双方余部各自撤军。`:won?`${scene.factions.find(f=>f.id===army.ownerId)!.name}军攻下${cityName}。`:`进攻${cityName}失利，余部沿道路撤军。`;
  s.reports.unshift({id:s.nextId++,day:s.day,cityId:army.to,commanderId:b.rosters[invader][0].commander.id,won:playerWon,attackingTroops:before,defendingTroops:b.totalInitial[invader==='attacker'?'defender':'attacker'],survivors:battleTeamSurvivors(b,'attacker'),text});s.reports.length=Math.min(20,s.reports.length);
  note(s,text,playerWon?'victory':b.drawn?'info':'defeat');
  refreshCampaignFactions(s,scene);if(s.policy)ensureDomesticAnnual(s,scene);refreshPolicyGovernors(s,scene);
}

/** Both campaign entry points use the current governor, effective equipment
 * and the same per-officer soldier allocations. Native linked-list mutation
 * history is still represented by the existing reversed city-list adapter. */
function campaignBattleRosters(s:Session,army:Army,scene:ScenarioDefinition,items:readonly Record<string,string>[]) {
  const stationed=stationedGenerals(s,army.to),defenderIds=[...stationed].reverse();
  const governor=s.policy?policyGovernorId(s,scene,army.to):scene.cities.find(c=>c.id===army.to)?.governorId;
  const at=governor?defenderIds.indexOf(governor):-1;
  if(at>0)[defenderIds[0],defenderIds[at]]=[defenderIds[at],defenderIds[0]];
  reconcileCityTroops(s,army.to);
  const attackers=army.generalIds.map(id=>campaignBattleMember(s,scene,id,items));
  const defenders=defenderIds.map(id=>campaignBattleMember(s,scene,id,items));
  if(!defenders.some(m=>!m.withdrawn)) {
    // Preserve the existing Web fallback for a city without deployable officers.
    // It is shared by player and computer encounters, not an original rule.
    stationed.forEach(id=>assignAggregateTroops(s.generals[id],0));defenders.length=0;
    const commander:BattleCommander={id:'garrison',name:'守城校尉',portrait:'portraits/001.png',strength:45,intelligence:45,hp:80,mp:0,unit:'槍'};
    defenders.push({commander,troops:s.cities[army.to].troops,withdrawn:false});
  }
  return {attackers,defenders};
}

/** Computer-versus-computer battles use the same fixed-step battle state as a
 * player encounter. The strategic map still settles the result immediately,
 * but casualties, commander rotation, skills, retreat and RNG now come from
 * the tactical state machine instead of a power-ratio estimate. */
function resolveRivalEncounter(s:Session,army:Army,scene:ScenarioDefinition,items:readonly Record<string,string>[]):EncounterOutcome {
  const {attackers:attacker,defenders:defender}=campaignBattleRosters(s,army,scene,items);
  const scenery=battleSceneryForCity(scene,army.to,s.day,s.nativeAI?.rng,s.cities[army.to].population);
  // Keep the two native RNG words in the session stream. `nativeAI` is always
  // present in new saves, while old preview saves are restored below.
  const rng:[number,number]=s.nativeAI?[...s.nativeAI.rng]:[s.rng,0x87654321];
  const a=chooseOpponentCommander(attacker,rng)??attacker[0];
  const d=chooseOpponentCommander(defender,rng)??defender[0];
  let b=createBattle({id:`auto-${army.id}`,armyId:army.id,cityId:army.to,attacker:a.commander,defender:d.commander,
    attackingTroops:a.troops,defendingTroops:d.troops,seed:s.rng,aiRng:rng,rosters:{attacker,defender},
    scenery,computerAttacker:true});
  b.invasionSide='attacker';
  if(s.captureRules)b.captureRules=s.captureRules;
  b.fortifications={attacker:0,defender:s.cities[army.to].defense};
  const advance=()=>{
    b=commandBattle(b,{type:'start'});
    for(let i=0;i<20&&b.phase==='fighting';i++)tickBattle(b,200);
  };
  advance();
  // Each round withdraws at least one previously available commander. This
  // bound covers the complete city roster rather than truncating after nine
  // rounds when an army encounters a large garrison.
  const roundLimit=attacker.filter(m=>!m.withdrawn).length+defender.filter(m=>!m.withdrawn).length-1;
  for(let round=1;round<roundLimit&&b.phase==='intermission';round++) {
    b=commandBattle(b,{type:'auto-next-round'});
    advance();
  }
  if(b.phase!=='finished'||!b.winner)throw new Error('电脑战斗未能完成结算。');
  s.rng=b.rng;if(s.nativeAI&&b.opponentAI)s.nativeAI.rng=[...b.opponentAI.rng];
  if(b.captureRules){prepareCampaignCaptives(s,b,scene);if(s.nativeAI&&b.opponentAI)s.nativeAI.rng=[...b.opponentAI.rng];const outcome=tacticalOutcome(s,b,scene);settleNativeCityBattle(s,b,scene,army);return {...outcome,sourceSettled:true};}
  return tacticalOutcome(s,b,scene);
}
function arrive(s:Session,army:Army,scene:ScenarioDefinition,outcome?:EncounterOutcome) {
  if(outcome?.sourceSettled)return;
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
  const {attackers,defenders}=campaignBattleRosters(s,army,scene,items);
  // Tactical left/attacker slot is always the player. invasionSide records the strategic attacker.
  const defendingPlayer=army.ownerId!==s.factionId;
  const left=defendingPlayer?defenders:attackers,right=defendingPlayer?attackers:defenders;
  const scenery=battleSceneryForCity(scene,army.to,s.day,s.nativeAI?.rng,s.cities[army.to].population);
  const aiRng:[number,number]=s.nativeAI?[...s.nativeAI.rng]:[s.rng,0x87654321];
  const a=left.find(m=>!m.withdrawn)??left[0],d=chooseOpponentCommander(right,aiRng)??right[0];
  s.battle=createBattle({id:`battle-${s.nextId++}`,armyId:army.id,cityId:army.to,attacker:a.commander,defender:d.commander,attackingTroops:a.troops,defendingTroops:d.troops,seed:s.rng,aiRng,rosters:{attacker:left,defender:right},scenery});
  s.battle.invasionSide=defendingPlayer?'defender':'attacker';
  if(s.captureRules)s.battle.captureRules=s.captureRules;
  s.battle.fortifications={attacker:defendingPlayer?s.cities[army.to].defense:0,defender:defendingPlayer?0:s.cities[army.to].defense};
  note(s,`${defendingPlayer?'敌军来袭！':''}${scene.cities.find(c=>c.id===army.to)!.name}双方列阵，我军由${a.commander.name}出战。`,'march');
}
function arrivals(s:Session,scene:ScenarioDefinition,items:readonly Record<string,string>[]) {
  for(const army of [...s.armies].filter(a=>!a.nativeMovement&&a.remainingDays===0).sort((a,b)=>a.id.localeCompare(b.id))) {
    const target=s.cities[army.to];
    if(target.ownerId&&target.ownerId!==army.ownerId) {
      if(target.ownerId===s.factionId||army.ownerId===s.factionId){encounter(s,army,scene,items);return;}
      const outcome=resolveRivalEncounter(s,army,scene,items);arrive(s,army,scene,outcome);if(outcome.sourceSettled)continue;
    } else arrive(s,army,scene);s.armies=s.armies.filter(a=>a.id!==army.id);
  }
}

function finishCampaignBattle(s:Session,b:BattleState,scene:ScenarioDefinition,items:readonly Record<string,string>[]):void {
  const army=s.armies.find(a=>a.id===b.armyId);if(!army)throw new Error('战斗军队不存在。');
  if(s.nativeAI&&b.opponentAI)s.nativeAI.rng=[...b.opponentAI.rng];
  const outcome=tacticalOutcome(s,b,scene);
  if(b.roadEncounter) {
    settleCampaignRoadBattle(s,scene,b,()=>{if(b.captureRules)applyCampaignCaptiveDisposition(s,b,scene,army);});
    refreshCampaignFactions(s,scene);
  } else if(b.captureRules)settleNativeCityBattle(s,b,scene,army);
  else {arrive(s,army,scene,outcome);s.armies=s.armies.filter(a=>a.id!==army.id);}
  s.rng=b.rng;s.battle=null;delete s.pendingCaptive;
  if(!s.endgame)arrivals(s,scene,items);
  refreshPolicyGovernors(s,scene);
  if(!s.battle&&!s.endgame&&!s.nativeMovementClock&&beginDomesticYear(s,scene,items))note(s,`${s.policy!.year}年内政时间到了，年度赋税已入库。`);
}

function resolveNativeCampaignEncounter(s:Session,scene:ScenarioDefinition,entry:NativeCampaignEncounter,items:readonly Record<string,string>[]):void {
  if(entry.kind==='city') {
    const army=s.armies.find(a=>a.id===entry.secondId);if(!army)return;
    // The encountered endpoint can interrupt a route to a more distant city.
    army.to=entry.firstId;if(army.nativeMovement)army.nativeMovement.destinationId=entry.firstId;
    if(army.ownerId===s.factionId||s.cities[entry.firstId].ownerId===s.factionId)encounter(s,army,scene,items);
    else {const outcome=resolveRivalEncounter(s,army,scene,items);arrive(s,army,scene,outcome);}
    return;
  }
  const first=s.armies.find(a=>a.id===entry.firstId),second=s.armies.find(a=>a.id===entry.secondId);
  if(!first||!second||first.ownerId===second.ownerId)return;
  if(first.ownerId===s.factionId||second.ownerId===s.factionId) {
    s.battle=createCampaignRoadBattle(s,scene,first,second,items);
    if(s.battle)note(s,'两军途中相遇，列阵交战。','march');
  } else resolveComputerRoadBattle(s,scene,first,second,items,b=>{
    if(b.captureRules)prepareCampaignCaptives(s,b,scene);
    if(s.nativeAI&&b.opponentAI)s.nativeAI.rng=[...b.opponentAI.rng];
    tacticalOutcome(s,b,scene);if(b.captureRules)applyCampaignCaptiveDisposition(s,b,scene,first);
  });
  if(!s.battle)refreshCampaignFactions(s,scene);
}

/** Complete the saved fraction of a strategic day. Encounters freeze after
 * their source callback; the remaining callbacks resume after settlement. */
function advanceNativeCampaignDay(s:Session,scene:ScenarioDefinition,items:readonly Record<string,string>[]):void {
  const clock=s.nativeMovementClock??(s.nativeMovementClock={callbackInDay:0});
  while(clock.callbackInDay<10&&!s.battle&&!s.endgame) {
    runNativeCampaignMovement(s,scene,{
      afterMovement:()=>runNativeStrategicCallback(s,scene,(plan,owner)=>{
        executeStrategic(s,plan.command,scene,owner);s.cities[plan.command.from].money-=plan.money;s.armies[s.armies.length-1].treasury=plan.money;
      }),encounter:entry=>resolveNativeCampaignEncounter(s,scene,entry,items),
    });
    clock.callbackInDay++;
  }
  if(clock.callbackInDay===10&&!s.battle&&!s.endgame) {
    delete s.nativeMovementClock;refreshPolicyGovernors(s,scene);
    if(beginDomesticYear(s,scene,items))note(s,`${s.policy!.year}年内政时间到了，年度赋税已入库。`);
  }
}

export function dispatch(previous: Session, command: Command, content: GameContent): Session {
  const s = structuredClone(previous);
  const scene = scenarioById(content, s.scenarioId);
  if (s.ruleset !== RULESET || s.contentHash !== content.sourceHash) throw new Error('战役规则与当前资料不一致。');
  if(s.endgame)throw new Error('此局已经结束，请开始新的战役。');
  if(command.type==='capture-choice'||command.type==='capture-dialogue-next'||command.type==='capture-script-tick') {
    const p=s.pendingCaptive,b=s.battle;
    if(!p||!b||b.phase!=='finished')throw new Error('当前没有待处置的俘将。');
    if(command.type==='capture-choice') {
      if(!['yield','kill','free'].includes(command.choice))throw new Error('俘将处置命令无效。');
      if(p.script)throw new Error('请先完成当前俘将对白。');
      const rulerId=scene.factions.find(f=>f.id===p.winnerFactionId)?.leaderId??b.commanders.attacker.id;
      p.script=createNativeCaptiveScript(command.choice,p.current.accepted,{rulerId,captiveId:p.current.id,
        rulerName:scene.generals.find(g=>g.id===rulerId)?.name,captiveName:scene.generals.find(g=>g.id===p.current.id)?.name});
      advanceNativeCaptiveScript(p.script,b.opponentAI!.rng,{type:'source-tick'});return s;
    }
    if(!p.script)throw new Error('当前没有进行中的俘将对白。');
    const emit=(event:{host:number;args:(string|number)[]})=>{if(event.host===769)emitBattleSound(b,String(event.args[0]),Number(event.args[1]),b.tick*3);};
    if(command.type==='capture-dialogue-next') {advanceNativeCaptiveScript(p.script,b.opponentAI!.rng,{type:'dialogue-next'},emit);return s;}
    if(!Number.isInteger(command.steps)||command.steps<1||command.steps>200)throw new Error('俘将脚本更新次数无效。');
    for(let i=0;i<command.steps&&p.script.phase!=='done'&&p.script.phase!=='dialogue';i++)advanceNativeCaptiveScript(p.script,b.opponentAI!.rng,{type:'source-tick'},emit);
    if(p.script.phase!=='done')return s;
    const result=nativePlayerCaptiveDecision(p.current,p.script.choice);delete p.script;
    b.rosters[p.side][p.current.index].battleStatus=result.status;
    if(!result.advance){note(s,`${b.rosters[p.side][p.current.index].commander.name}不肯归降。`);return s;}
    delete s.pendingCaptive;
    if(prepareCampaignCaptives(s,b,scene))return s;
    finishCampaignBattle(s,b,scene,content.items);return s;
  }
  if(command.type==='battle-command'||command.type==='battle-tick'||command.type==='battle-finish') {
    if(!s.battle)throw new Error('当前没有进行中的战斗。');
    if(command.type==='battle-command')s.battle=commandBattle(s.battle,command.command);
    else if(command.type==='battle-tick')tickBattle(s.battle,command.steps);
    else {
      if(s.battle.phase!=='finished')throw new Error('战斗尚未结束。');
      if(s.pendingCaptive)return s;
      if(prepareCampaignCaptives(s,s.battle,scene))return s;
      finishCampaignBattle(s,s.battle,scene,content.items);
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
    if(s.nativeMovementClock){advanceNativeCampaignDay(s,scene,content.items);if(s.battle||s.endgame||s.policy?.active)return s;}
    arrivals(s,scene,content.items);if(s.battle)return s;
    for (let day = 0; day < command.days; day++) {
      s.day++;
      // Every faction uses the same economy and march validation as the player.
      for (const army of s.armies)if(!army.nativeMovement)army.remainingDays=Math.max(0,army.remainingDays-1);
      if (!s.policy && s.day % 30 === 0) {
        for (const c of Object.values(s.cities)) if (c.ownerId) c.money += Math.floor(c.population / 1000);
        note(s, '月初赋税入库，各城获得人口数千分之一的金钱。');
      }
      arrivals(s,scene,content.items);if(s.battle)break;
      refreshPolicyGovernors(s,scene);
      advanceNativeCampaignDay(s,scene,content.items);
      if(s.battle||s.endgame||s.policy?.active)break;
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
    if (!road || (!s.movementRules&&road.restricted)) throw new Error('目标没有可用的相邻道路。');
    if (!Number.isInteger(command.troops) || command.troops < 1 || command.troops > city.troops) throw new Error('出征兵力超出驻军数量。');
    const ids = command.generalIds;
    if (!ids.length || ids.length > RULES.maxArmyGenerals || new Set(ids).size !== ids.length || ids.some(id => !stationedGenerals(s, command.from).includes(id))) throw new Error('请选择城中尚未出征的武将，最多五人。');
    if(ids.some(id=>s.generals[id].hp<=0))throw new Error('重伤武将不能出征。');
    if(command.troopsByGeneral&&(Object.keys(command.troopsByGeneral).length!==ids.length||ids.some(id=>!Number.isInteger(command.troopsByGeneral![id])||command.troopsByGeneral![id]<0)||Object.values(command.troopsByGeneral).reduce((a,b)=>a+b,0)!==command.troops))throw new Error('各将配兵之和须等于出征总兵力。');
    const totalDays = Math.max(2, Math.ceil(road.length / RULES.roadUnitsPerDay));
    const army: Army = { id: 'army-' + s.nextId++, ownerId: actor, from: command.from, to: command.to,
      roadId: road.id, generalIds: [...ids], troops: command.troops, totalDays, remainingDays: totalDays };
    if(s.movementRules&&!initNativeCampaignMovement(scene,army))throw new Error('原版军团无法进入此道路。');
    city.troops -= army.troops;
    s.armies.push(army);
    for (const id of ids) { s.generals[id].cityId = null; s.generals[id].armyId = army.id; }
    if(command.troopsByGeneral)for(const id of ids)assignAggregateTroops(s.generals[id],command.troopsByGeneral[id]);
    else distribute(s,ids,army.troops);
    if(actor===s.factionId)assignCityTroops(s,command.from);
    const leader = scene.generals.find(g => g.id === ids[0])!;
    note(s, `${prefix}${leader.name}率${army.troops}人向${scene.cities.find(c => c.id === army.to)!.name}进发，预计${army.totalDays}天抵达。`, 'march');
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
  if(s.captureRules!==undefined&&s.captureRules!=='native-capture-v1')return fail();
  if(s.movementRules!==undefined&&s.movementRules!=='native-strategic-v1')return fail();
  if(s.nativeMovementClock!==undefined&&(!s.nativeMovementClock||!integer(s.nativeMovementClock.callbackInDay,10)))return fail();
  if(s.endgame!==undefined&&(!s.captureRules||!s.endgame||!['victory','defeat'].includes(s.endgame.result)||!['unification','ruler-lost'].includes(s.endgame.reason)||!integer(s.endgame.day,s.day)||s.battle!==null))return fail();
  if(s.pendingCaptive!==undefined) {
    const p=s.pendingCaptive,b=s.battle;
    if(!p||p.version!==1||!b||b.phase!=='finished'||!b.captureRules||!b.capturePrepared||b.drawn||b.winner!=='attacker'||p.side!=='defender'||p.winnerFactionId!==s.factionId||!p.current||
      typeof p.current.accepted!=='boolean'||!integer(p.current.index,b.rosters[p.side].length-1)||!integer(p.current.reason,19)||
      ![1,2,3,6,16,17,18,19].includes(p.current.reason)||b.rosters[p.side][p.current.index].commander.id!==p.current.id||b.rosters[p.side][p.current.index].battleStatus!==3)return fail();
    if(p.script!==undefined) {
      validateNativeCaptiveScript(p.script,fail);
      if(p.script.accepted!==p.current.accepted||p.script.context.captiveId!==p.current.id||p.script.context.rulerId!==scene.factions.find(f=>f.id===p.winnerFactionId)?.leaderId||p.script.phase==='done')fail();
    }
  }
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
    if (typeof a.id !== 'string' || !/^army-[1-9]\d*$/.test(a.id) || !integer(Number(a.id.slice(5)), s.nextId - 1) || armyIds.has(a.id) || !owner(a.ownerId) || !a.ownerId ||
        !a.nativeMovement&&(!road||road.restricted||!((a.from === road.from && a.to === road.to) || (a.from === road.to && a.to === road.from))) ||
        !integer(a.troops) || !a.nativeMovement&&a.troops < 1 || !integer(a.totalDays,a.nativeMovement?1000000:1000) || !integer(a.remainingDays, a.totalDays) ||
        !Array.isArray(a.generalIds) || a.generalIds.length < 1 || a.generalIds.length > 5) return fail();
    validateNativeCampaignMovement(scene,a,fail);
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
    if (!g || !owner(g.ownerId) || !integer(g.hp,officerMaxHp(g,def))||!integer(g.mp,officerMaxMp(g,def))||!integer(g.troops)||!['登','野','未',...(s.captureRules?['死']:[])].includes(g.status) || (g.cityId !== null && !cityIds.has(g.cityId)) ||
        (g.armyId !== null && (!armyIds.has(g.armyId) || !marching.has(def.id)))) return fail();
    if(g.troopSlots!==undefined) {
      const t=g.troopSlots,cap=nativeTroopCapacity(officerLevel(g,def));
      if(!t||!integer(t.active,Math.max(0,cap.active))||!integer(t.reserve,cap.reserve)||t.active+t.reserve>g.troops)return fail();
    }
    if(['morale','fatigue','loyalty'].some(k=>{const n=g[k as keyof NativeOfficerCondition];return n!==undefined&&!integer(n,100);}))return fail();
    if(g.level!==undefined&&(!integer(g.level,99)||g.level<1))return fail();
    if(g.experience!==undefined&&!integer(g.experience,4294967295))return fail();
    if(g.battleRecord!==undefined&&!isNativeBattleRecord(g.battleRecord))return fail();
    if(g.appearanceHidden!==undefined&&typeof g.appearanceHidden!=='boolean')return fail();
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
      (p.active&&s.battle!==null)||(p.year<currentYear&&s.battle===null&&!s.nativeMovementClock)||!Array.isArray(p.acted)||p.acted.length>scene.generals.length||
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
    if(s.battle.roadEncounter) {
      validateCampaignRoadBattle(s,s.battle,fail);
      const e=s.battle.roadEncounter,first=s.armies.find(a=>a.id===e.firstArmyId)!,second=s.armies.find(a=>a.id===e.secondArmyId)!;
      const ours=e.firstSide==='attacker'?first:second;
      if(ours.ownerId!==s.factionId||s.battle.totalInitial[e.firstSide]!==first.troops||s.battle.totalInitial[e.firstSide==='attacker'?'defender':'attacker']!==second.troops)fail();
      return;
    }
    const army=s.armies.find(a=>a.id===s.battle!.armyId);
    const invader=s.battle.invasionSide??'attacker',defense=invader==='attacker'?'defender':'attacker';
    if(!army||!army.nativeMovement&&army.remainingDays!==0||army.to!==s.battle.cityId||s.battle.totalInitial[invader]!==army.troops||s.battle.totalInitial[defense]!==s.cities[army.to].troops||!army.generalIds.includes(s.battle.commanders[invader].id))return fail();
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
