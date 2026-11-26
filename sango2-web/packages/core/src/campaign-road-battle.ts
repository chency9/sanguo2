import type {ScenarioDefinition} from '@sango2/content';
import type {Session,Army} from './index';
import {officerDefinition} from './index';
import {createBattle,commandBattle,tickBattle,chooseOpponentCommander,type BattleState,type BattleMember,type BattleSide} from './battle';
import {nativeCampaignArmyPosition,settleNativeArmyAftermath,type NativeCampaignArmy} from './campaign-native-movement';
import {nativeRoadBattleScenery} from './campaign-native-scenery';

export interface CampaignRoadEncounter {firstArmyId:string;secondArmyId:string;firstSide:BattleSide}
export type CampaignRoadBattle=BattleState&{roadEncounter?:CampaignRoadEncounter};
export function campaignRoadBattleRosters(s:Session,scene:ScenarioDefinition,army:Army,items:readonly Record<string,string>[]):BattleMember[] {
  const ids=army.generalIds.filter(id=>s.generals[id].status==='登');
  return ids.map(id=>{const g=s.generals[id],def=scene.generals.find(def=>def.id===id)!;return {
    commander:{...officerDefinition(g,def,items),hp:g.hp,mp:g.mp,morale:g.morale,fatigue:g.fatigue,loyalty:g.loyalty,battleRecord:g.battleRecord},
    troops:g.troops,troopSlots:g.troopSlots?{...g.troopSlots}:undefined,withdrawn:g.hp<=0};});
}
/** Keeps collision order as the original two teams, while rendering the player
 * on the controllable attacker side. No city fortification applies on roads. */
export function createCampaignRoadBattle(s:Session,scene:ScenarioDefinition,first:Army,second:Army,items:readonly Record<string,string>[]):CampaignRoadBattle|null {
  const rosters=[campaignRoadBattleRosters(s,scene,first,items),campaignRoadBattleRosters(s,scene,second,items)];
  if(rosters.some(members=>!members.some(m=>!m.withdrawn)))return null;
  const player=first.ownerId===s.factionId||second.ownerId===s.factionId,firstSide:BattleSide=second.ownerId===s.factionId?'defender':'attacker';
  const attacker=firstSide==='attacker'?rosters[0]:rosters[1],defender=firstSide==='attacker'?rosters[1]:rosters[0];
  const rng=s.nativeAI?.rng??[s.rng,0x87654321] as [number,number],aPos=nativeCampaignArmyPosition(first),dPos=nativeCampaignArmyPosition(second);
  if(!aPos||!dPos)return null;
  const scenery=nativeRoadBattleScenery(aPos,dPos,s.day,rng);
  const a=player?attacker.find(m=>!m.withdrawn)!:chooseOpponentCommander(attacker,rng)!,d=chooseOpponentCommander(defender,rng)!;
  const b:CampaignRoadBattle=createBattle({id:`road-${s.nextId++}`,attacker:a.commander,defender:d.commander,attackingTroops:a.troops,defendingTroops:d.troops,
    seed:s.rng,aiRng:rng,rosters:{attacker,defender},computerAttacker:!player,scenery});
  b.roadEncounter={firstArmyId:first.id,secondArmyId:second.id,firstSide};
  if(s.captureRules)b.captureRules=s.captureRules;
  // Both are moving armies. Team1 remains the semantic original first team
  // even when the player's controllable slot maps to the second team.
  b.invasionSide=firstSide;b.armyId=first.id;b.cityId=null;return b;
}
/** The caller's settle hook writes tactical HP/MP, troop slots, XP and
 * participant disposition exactly once, before any travelling-army aftermath. */
export function settleCampaignRoadBattle(s:Session,scene:ScenarioDefinition,battle:CampaignRoadBattle,settle:(battle:BattleState)=>void):void {
  const encounter=battle.roadEncounter;if(!encounter)throw new Error('缺少道路交战双方。');
  const first=s.armies.find(a=>a.id===encounter.firstArmyId),second=s.armies.find(a=>a.id===encounter.secondArmyId);
  if(!first||!second)throw new Error('道路交战军团已经失效。');
  settle(battle);
  for(const army of [first,second]) {
    army.generalIds=army.generalIds.filter(id=>s.generals[id].ownerId===army.ownerId&&s.generals[id].armyId===army.id&&s.generals[id].status==='登');
    army.troops=army.generalIds.reduce((sum,id)=>sum+s.generals[id].troops,0);
  }
  const drawn=battle.drawn||!battle.winner;
  const won=drawn?null:battle.winner===encounter.firstSide?first:second;
  // 0x410199 orders aftermath by original teams: first victory/retreat/remove,
  // then second. Each retreat can consume more RNG while selecting its route.
  for(const army of [first,second]) {
    if(!army.generalIds.length)settleNativeArmyAftermath(s,scene,army,8);
    else settleNativeArmyAftermath(s,scene,army,army===won?2:4);
  }
  const ours=first.ownerId===s.factionId||second.ownerId===s.factionId;
  const text=drawn?'道路交战双方收兵，余部各自退军。':`${scene.factions.find(f=>f.id===won!.ownerId)?.name??'胜军'}在道路交战中获胜，败军沿退路撤离。`;
  s.chronicle.unshift({id:s.nextId++,day:s.day,kind:ours&&!drawn?(won!.ownerId===s.factionId?'victory':'defeat'):'info',text});s.chronicle.length=Math.min(100,s.chronicle.length);
}
export function resolveComputerRoadBattle(s:Session,scene:ScenarioDefinition,first:Army,second:Army,items:readonly Record<string,string>[],settle:(battle:BattleState)=>void):CampaignRoadBattle|null {
  let b=createCampaignRoadBattle(s,scene,first,second,items);if(!b)return null;
  const limit=b.rosters.attacker.filter(m=>!m.withdrawn).length+b.rosters.defender.filter(m=>!m.withdrawn).length-1;
  for(let round=0;round<limit;round++) {
    b=commandBattle(b,{type:'start'}) as CampaignRoadBattle;
    for(let i=0;i<20&&b.phase==='fighting';i++)tickBattle(b,200);
    if(b.phase==='finished')break;
    b=commandBattle(b,{type:'auto-next-round'}) as CampaignRoadBattle;
  }
  if(b.phase!=='finished')throw new Error('道路电脑战斗未完成。');
  s.rng=b.rng;if(s.nativeAI&&b.opponentAI)s.nativeAI.rng=[...b.opponentAI.rng];settleCampaignRoadBattle(s,scene,b,settle);return b;
}
export function validateCampaignRoadBattle(s:Session,b:CampaignRoadBattle,fail:()=>never):void {
  const e=b.roadEncounter;if(e===undefined)return;
  const first=s.armies.find(a=>a.id===e.firstArmyId),second=s.armies.find(a=>a.id===e.secondArmyId);
  if(!e||!first||!second||first===second||first.ownerId===second.ownerId||!['attacker','defender'].includes(e.firstSide)||b.cityId!==null||
    !first.generalIds.every(id=>b.rosters[e.firstSide].some(m=>m.commander.id===id))||!second.generalIds.every(id=>b.rosters[e.firstSide==='attacker'?'defender':'attacker'].some(m=>m.commander.id===id)))fail();
}
