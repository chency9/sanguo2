/** Fixed-step tactical reconstruction. Original artwork/animation order is used by the view;
 * native movement steps are verified; targeting, scheduling and formations still have Web adapters. */
import type { CombatAppearance, SkillLearning } from '@sango2/content';
import { CHARGE_LIMIT, INITIAL_CHARGE, NATIVE_MAGIC, chargeIncrement, commanderMagicSequences, nativeSkillCost, type NativeMagic } from './native-battle-rules';
import { NATIVE_UPDATE_SECONDS, NATIVE_BATTLE_UPDATES } from './native-clock';
import {nativeWeightedChoice,type NativeRandomState} from './native-strategic-ai';
import {nativeTacticalWeights,nativeSkillWeights,nativeCommanderWeights,nativeFormationWeights} from './native-tactical-ai';
import {nativeAttackHits,nativeGeneralDamage,nativeCombatPower,type NativeCombatUnit} from './native-combat';
import {initialOfficerCondition,nativeBattleFatigue,type NativeOfficerCondition} from './native-officer-condition';
import {allocateBattleTroops,nativeTroopCapacity,nativeTroopDivisions,type TroopSlots} from './native-troops';
import {nativeGridOccupancy,nativeGridCount,projectBattleCell} from './native-battle-grid';
import type {NativeFlight,NativeDetached} from './native-casualty';
import {beginBattleCasualty,advanceBattleCasualties,validateBattleCasualties} from './battle-casualties';
import {prepareBattleMovement,advanceBattleMovement,planBattleMovement,validateBattleMovement,battleMovementCell,type BattleMovement} from './battle-movement';
import {nearbyPairs} from './nearby-pairs';
import {updateBattleUnits} from './battle-unit-scheduler';
import {validateBattleAttackActions} from './native-attack-animation';
import {validateBattleProjectiles,type BattleProjectile} from './battle-projectiles';
import {formationToNativeIndex,nativeFormationMask,defaultFormation,canUseFormation,isNativeFormation,type Formation} from './battle-formations';
import {createNativeCommands,issueNativeCommand,advanceNativeAI,validateNativeCommands,syncNativeCommands,type BattleNativeCommands,type NativeCommand,type NativeDivision} from './battle-commands';
import {nativeCanAdvance,NATIVE_COMMAND_LABELS} from './native-commands';
import type {NativeWorldPoint} from './native-projection';
import {nativeCreateMagicShoot,nativeShootDefinition,type NativeMagicShoot} from './native-magic-shoot';
import {advanceBattleNativeMagic,battleMagicLocked,validateBattleNativeMagic} from './battle-native-magic';
export {NATIVE_COMMAND_LABELS} from './native-commands';
export {FORMATION_OPTIONS,NATIVE_FORMATIONS,formationDefinition,formationLabel,formationToNativeIndex,nativeFormationMask,nativeIndexToFormation,availableFormations,canUseFormation,isNativeFormation} from './battle-formations';
export {battleAttackAction,nativeAttackFrame} from './native-attack-animation';
export {nativeProjectileObject} from './native-projectile';
export {battleCasualtyPosition,battleDetachedPosition} from './battle-casualties';
export {nativeDetachedObject} from './native-casualty';
export {projectBattleCell} from './native-battle-grid';
export {battleMovementCell} from './battle-movement';
export {nativeTroopCapacity,nativeSoldierObject} from './native-troops';
import nativeSkills from './native-ai-skills.json';
import {createBattleStrategies,selectBattleStrategy,applyBattleStrategies,recoverBattleStrategy,restoreBattleStrategy,validateBattleStrategies,type BattleStrategies} from './battle-strategies';
export {NATIVE_STRATEGIES,battleStrategyOptions} from './battle-strategies';
export { nativeCountdown } from './native-clock';
export { CHARGE_LIMIT, INITIAL_CHARGE, NATIVE_MAGIC, nativeGaugeWidth, knownMagicSequences, learnedMagicSequences, commanderMagicSequences } from './native-battle-rules';
export const SOURCE_TICKS_PER_STEP = 3;
// The view advances groups of three source updates. v3 dispatches units once
// per source update; older snapshots retain their grouped unit scheduler.
export const BATTLE_STEP = SOURCE_TICKS_PER_STEP*NATIVE_UPDATE_SECONDS;
export function battleStepDuration(b:BattleState) { return b.timing==='native-99'?BATTLE_STEP:1/20; }
export function battleRemainingUpdates(b:BattleState) { return Math.max(0,(b.timing==='native-99'?NATIVE_BATTLE_UPDATES:10800)-b.tick*SOURCE_TICKS_PER_STEP); }
export type BattleSide = 'attacker' | 'defender';
export type Order = 'advance' | 'hold' | 'retreat';
export type Division = 'all' | 'front' | 'rear' | 'general';
export type {Formation} from './battle-formations';
export interface BattleCommander extends Partial<NativeOfficerCondition> { id: string; name: string; portrait: string; strength: number; intelligence: number; hp: number; mp: number; unit: string; rawSkill?:string; rawStrategy?:string;level?:number; skillLearnset?:SkillLearning[];strategyLearnset?:SkillLearning[]; maxHp?:number; charge?:number; maxMp?:number; appearance?:CombatAppearance;formations?:string[] }
export interface BattleMember { commander:BattleCommander; troops:number; withdrawn:boolean;troopSlots?:TroopSlots }
export interface RoundReport { round:number; attackerId:string; defenderId:string; winner:BattleSide; reason:string }
export interface BattleUnit {
  id: number; side: BattleSide; general: boolean; division: Exclude<Division,'all'>;
  x: number; y: number; hp: number; maxHp: number; ranged: boolean; order: Order;
  action: 'wait' | 'walk' | 'attack' | 'death'; actionTick: number; target: number | null; hit: boolean; escaped: boolean;
  /** Original unit flag 4. Older saves do not distinguish reserve soldiers. */
  nativeReserve?:boolean;
  nativeDivision?:NativeDivision;
  movement?:BattleMovement;
  casualty?:{flight:NativeFlight;facing:number;origin:{x:number;y:number};born:number};
  /** Temporary native-style control effect. Missing on legacy saves. */
  status?:{kind:'stunned'|'silenced'|'weakened';until:number;magic:number};
}
export interface BattleDetached extends NativeDetached {id:number;side:BattleSide;x:number;y:number;vx:number;vy:number;age:number;displayOffset?:{x:number;y:number}}
/** A transient draw event. The coordinates keep legacy saves readable, while
 * source/target ids let the native renderer follow the same fixed-point actor
 * anchors as the battle scene instead of guessing from the nearest unit. */
export interface BattleEffect {
  id: number;
  kind: 'arrow' | 'hit';
  x: number;
  y: number;
  toX: number;
  toY: number;
  ticks: number;
  sourceId?: number;
  targetId?: number;
  /** World height above the actor, in source units; absent on older saves. */
  sourceZ?: number;
  targetZ?: number;
  /** Fixed scene origin for effects without an actor, such as the reserve gate. */
  point?: NativeWorldPoint;
}
export interface BattleState {
  version: 2; id: string; armyId: string | null; cityId: string | null; tick: number; nextId: number; rng: number;
  /** Missing in old saves: preserve their original 180-second/20 Hz timing. */
  timing?:'native-99';
  /** Player uses the left/attacker slot even when defending a city. */
  invasionSide?:BattleSide;
  phase: 'deployment' | 'fighting' | 'intermission' | 'finished'; winner: BattleSide | null; reason: string;
  round:number; rosters:Record<BattleSide,BattleMember[]>; totalInitial:Record<BattleSide,number>; history:RoundReport[];
  commanders: Record<BattleSide,BattleCommander>; initial: Record<BattleSide,number>; reserves: Record<BattleSide,number>;
  units: BattleUnit[]; effects: BattleEffect[]; formation: Formation; orders: Record<Exclude<Division,'all'>,Order>;
  log: string[];
  activeScript?:
    | {kind:'native-shoot';side:BattleSide;casterId:number;targetId:number;magic:number;script:number;damage:number;runtime:NativeMagicShoot}
    | {kind:'heal'; side:BattleSide; targetId:number; initialHp:number; nextPoint:number; amount:number; wait:number; magic:NativeMagic['sequence']}
    | {kind:'magic-projectile'; side:BattleSide; casterId:number; targetId:number; magic:NativeMagic['sequence']; script:number; damage:number; phase:'windup'|'flight'|'impact'; phaseAge:number; duration:number; fromX:number; fromY:number; toX:number; toY:number; x:number; y:number; z:number; age:number; hit:boolean}
    | {kind:'magic-area'; side:BattleSide; casterId:number; magic:NativeMagic['sequence']; script:number; targetSide:BattleSide|'both'; damage:number; phase:'windup'|'impact'; phaseAge:number; duration:number; x:number; y:number; age:number; hit:boolean}
    | {kind:'magic-reinforce'; side:BattleSide; casterId:number; magic:NativeMagic['sequence']; script:number; amount:number; phase:'windup'|'impact'; phaseAge:number; duration:number; age:number; hit:boolean}
    | {kind:'magic-status'; side:BattleSide; casterId:number; magic:NativeMagic['sequence']; script:number; targetSide:BattleSide|'both'; status:'stunned'|'silenced'|'weakened'; duration:number; effectDuration:number; phase:'windup'|'impact'; phaseAge:number; age:number; hit:boolean};
  scenery?:{terrainId:number;variant:'a'|'b'};
  fortifications?:Record<BattleSide,number>;
  /** Missing in legacy battles: keep their existing units and reinforcement waves. */
  troopDeployment?:Record<BattleSide,TroopSlots>;
  /** Missing in existing saves: retain their projected deployment cells. */
  deploymentRules?:'native-tables-v1';
  nativeCommands?:BattleNativeCommands;
  /** Absent in older saves: preserve their existing random consumption and sensors. */
  casualtyRules?:'native-v1';
  /** Older snapshots retain continuous pursuit and their existing RNG order. */
  movementRules?:'native-grid-v1'|'native-grid-v2'|'native-grid-v3';
  /** Absent in existing snapshots: preserve their default-attack timing. */
  attackRules?:'native-actions-v1';
  /** Older battles keep immediate ranged damage and their original RNG flow. */
  projectileRules?:'native-projectiles-v1';
  /** Missing in old battles: retain their previous magic timing and targeting. */
  magicRules?:'native-shoot-v1';
  projectiles?:BattleProjectile[];
  detached?:BattleDetached[];
  strategies?:BattleStrategies;
  opponentAI?:{rng:NativeRandomState;countdown:number;flags:number;entryHp:number;chargeTick:number;lastAction:number;lastSkill:number;formation?:number};
}
export type BattleCommand = { type: 'start' } | { type: 'next-round' | 'select-commander'; commanderId:string } | { type:'withdraw' } | { type: 'formation'; formation: Formation } |
  {type:'native-order';division:number;command:NativeCommand} |
  {type:'strategy';advisorId:string;sequence:number} |
  { type:'skill'; sequence:number } |
  {type:'scenery';terrainId:number;variant:'a'|'b'} |
  { type: 'order'; division: Division; order: Order };
const opposite = (side: BattleSide): BattleSide => side === 'attacker' ? 'defender' : 'attacker';
const nativeUnitIndex=(c:BattleCommander)=>(c.appearance?.soldier??({'刀':100,'槍':101,'關':102,'大':102,'弓':103,'鏈':104,'鍊':104,'飛':105,'武':106,'蠻':107,'鐵':108,'籐':109,'賊':110,'黃':110,'弩':111,'女':112}[c.unit.slice(0,1)]??100))-100;
const nativeUnitClass=(c:BattleCommander)=>[3,11].includes(nativeUnitIndex(c))?3:[4,5].includes(nativeUnitIndex(c))?2:1;
export function chooseOpponentCommander(members:BattleMember[],rng:NativeRandomState):BattleMember|undefined {
  const weights=nativeCommanderWeights(members.map(m=>{const slots=allocateBattleTroops(m.troops,m.commander.level??20,m.troopSlots);return {...m.commander,troops:slots.active+slots.reserve,available:!m.withdrawn&&m.commander.hp>0};}));
  return members[nativeWeightedChoice(weights,rng)];
}
function normalizeCommander(c:BattleCommander):BattleCommander {
  return {...structuredClone(c),...initialOfficerCondition(c),maxHp:c.maxHp??c.hp,maxMp:c.maxMp??c.mp,charge:INITIAL_CHARGE};
}
function commanderKnows(c:BattleCommander,sequence:number) { return commanderMagicSequences(c.rawSkill,c.level,c.skillLearnset).includes(sequence); }
function activeStatus(unit:BattleUnit|undefined,kind?:NonNullable<BattleUnit['status']>['kind'],now=0) {
  return !!unit?.status&&unit.status.until>now&&(kind===undefined||unit.status.kind===kind);
}
function magicTargetSide(side:BattleSide,magic:NativeMagic):BattleSide|'both' {
  return magic.activeSide==='both'?'both':magic.activeSide==='ally'?side:opposite(side);
}
function magicTargets(b:BattleState,side:BattleSide,magic:NativeMagic):BattleUnit[] {
  const targetSide=magicTargetSide(side,magic);
  const onlyGeneral=magic.active.includes('主將')&&!magic.active.includes('士兵')&&!magic.active.includes('全軍');
  const onlySoldier=magic.active.includes('士兵')&&!magic.active.includes('主將')&&!magic.active.includes('全軍');
  return b.units.filter(u=>u.hp>0&&!u.escaped&&(targetSide==='both'||u.side===targetSide)&&(!onlyGeneral||u.general)&&(!onlySoldier||!u.general));
}
function magicAreaHit(unit:BattleUnit,magic:NativeMagic,b:BattleState):boolean {
  if(unit.general)return true;
  // The original scripts consume a deterministic combat RNG stream. The Web
  // adapter uses the saved ids/tick as a stable sample so JSON replay remains
  // bit-for-bit repeatable without introducing Math.random().
  const intensity=Math.max(.12,Math.min(.78,(Math.max(0,magic.attack)+magic.mp*.25)/100));
  const stride=Math.max(1,Math.round(1/intensity));
  return ((unit.id+magic.sequence+b.tick) % stride)===0;
}
/** Shared by skill buttons and the command executor. */
export function battleSkillUnavailable(b:BattleState,sequence:number,side:BattleSide='attacker'):string|null {
  const magic=NATIVE_MAGIC[sequence],caster=b.commanders[side],g=battleGeneral(b,side);
  if(!commanderKnows(caster,sequence))return '尚未习得';
  if(!magic||!['heal','projectile','area','reinforce','status'].includes(magic.effectType))return '暂不可用';
  if(b.phase!=='fighting')return '尚未开战';
  if((b.strategies?.effects[side].flags??0)&256)return '武将技被封';
  if(b.activeScript)return '正在施法';
  if(g.hp<=0||g.escaped||g.order==='retreat')return '主将无法施法';
  if(activeStatus(g,'stunned',b.tick)||activeStatus(g,'silenced',b.tick))return '主将处于异常状态';
  if(magic.effectType==='projectile'&&!(b.magicRules&&nativeShootDefinition(magic.script))) {
    const enemy=battleGeneral(b,opposite(side));
    if(enemy.hp<=0||enemy.escaped||enemy.order==='retreat')return '敌方主将无法成为目标';
  }
  if(magic.effectType==='reinforce'&&battleSurvivors(b,side)>=b.initial[side])return '没有可补充的士兵';
  if(magic.effectType==='area'||magic.effectType==='status') {
    if(!magicTargets(b,side,magic).length)return '没有有效目标';
  }
  if(caster.mp<magic.mp)return '技力不足';
  if((caster.charge??INITIAL_CHARGE)<CHARGE_LIMIT)return '集气未满';
  return null;
}
function castSkill(b:BattleState,sequence:number,side:BattleSide) {
  const unavailable=battleSkillUnavailable(b,sequence,side);
  if(unavailable)throw new Error(unavailable);
  const magic=NATIVE_MAGIC[sequence],caster=b.commanders[side],target=battleGeneral(b,side);
  const effect=b.strategies?.effects[side];
  const cost=nativeSkillCost(caster.mp,caster.charge??INITIAL_CHARGE,magic.mp,magic.power,effect&&(effect.flags&128)?effect.parameter:100);
  caster.mp=cost.mp;caster.charge=cost.charge;
  if(b.magicRules&&nativeShootDefinition(magic.script)) {
    prepareBattleMovement(b);
    const enemy=battleGeneral(b,opposite(side)),m=target.movement!;
    b.activeScript={kind:'native-shoot',side,casterId:target.id,targetId:enemy.id,magic:sequence,script:magic.script,damage:magic.attack,
      runtime:nativeCreateMagicShoot(magic.script,{x:m.px,y:m.py,z:0},side==='attacker'?1:0)};
    b.log.unshift(`${caster.name}施展${magic.name}！`);
  } else if(magic.effectType==='heal') {
    b.activeScript={kind:'heal',side,targetId:target.id,initialHp:target.hp,nextPoint:1,amount:magic.attack,wait:0,magic:magic.sequence};
    b.log.unshift(`${caster.name}施展${magic.name}，圣光正在恢复体力。`);
  } else if(magic.effectType==='projectile') {
    const enemy=battleGeneral(b,opposite(side));
    const casterUnit=b.units.find(u=>u.id===target.id)??target;
    const fromX=casterUnit.x,fromY=casterUnit.y-48,toX=enemy.x,toY=enemy.y-48;
    b.activeScript={kind:'magic-projectile',side,casterId:target.id,targetId:enemy.id,magic:magic.sequence,script:magic.script,damage:magic.attack,
      phase:'windup',phaseAge:0,duration:12,fromX,fromY,toX,toY,x:fromX,y:fromY,z:0,age:0,hit:false};
    b.log.unshift(`${caster.name}施展${magic.name}，金色箭光锁定敌方主将。`);
  } else if(magic.effectType==='reinforce') {
    const room=Math.max(0,b.initial[side]-battleSurvivors(b,side));
    const amount=Math.min(room,Math.max(1,Math.min(24,magic.attack||10)));
    b.activeScript={kind:'magic-reinforce',side,casterId:target.id,magic:magic.sequence,script:magic.script,amount,
      phase:'windup',phaseAge:0,duration:8,age:0,hit:false};
    b.log.unshift(`${caster.name}施展${magic.name}，后方援军正在赶来。`);
  } else if(magic.effectType==='status') {
    b.activeScript={kind:'magic-status',side,casterId:target.id,magic:magic.sequence,script:magic.script,
      targetSide:magicTargetSide(side,magic),status:magic.sequence===104?'stunned':'weakened',duration:8,effectDuration:24,
      phase:'windup',phaseAge:0,age:0,hit:false};
    b.log.unshift(`${caster.name}施展${magic.name}，敌军阵脚大乱。`);
  } else {
    const casterUnit=b.units.find(u=>u.id===target.id)??target;
    b.activeScript={kind:'magic-area',side,casterId:target.id,magic:magic.sequence,script:magic.script,
      targetSide:magicTargetSide(side,magic),damage:Math.max(1,magic.attack||Math.trunc(magic.mp/7)),
      phase:'windup',phaseAge:0,duration:8,x:casterUnit.x,y:casterUnit.y-48,age:0,hit:false};
    b.log.unshift(`${caster.name}施展${magic.name}，战场卷起强烈冲击。`);
  }
  b.log.length=Math.min(8,b.log.length);
}
/** Native scoring/lottery, with explicit Web grid/order adapters. Grid
 * occupancy and unsupported skill execution still prevent whole-battle parity. */
function decideOpponent(b:BattleState) {
  const ai=b.opponentAI??(b.opponentAI={rng:[b.rng,0x87654321],countdown:10,flags:0,entryHp:battleGeneral(b,'defender').hp,chargeTick:0,lastAction:0,lastSkill:0});
  ai.countdown-=SOURCE_TICKS_PER_STEP;if(ai.countdown>0)return;ai.countdown+=60;
  if(b.activeScript)return;
  const g=battleGeneral(b,'defender');if(g.hp<=0||g.escaped||g.order==='retreat'||activeStatus(g,'stunned',b.tick))return;
  const opponent=battleGeneral(b,'attacker'),caster=b.commanders.defender;
  const own=b.units.filter(u=>u.side==='defender'&&!u.general&&u.hp>0&&!u.escaped),enemy=b.units.filter(u=>u.side==='attacker'&&!u.general&&u.hp>0&&!u.escaped);
  // Native queries include generals and one occupant per cell. The continuous
  // position-to-cell adapter is shared with the minimap; old saves keep theirs.
  const cell=(u:BattleUnit)=>b.movementRules?battleMovementCell(u):b.casualtyRules?projectBattleCell(u.x,u.y):({x:Math.max(0,Math.min(54,Math.trunc(u.x/1200*55))),y:Math.max(0,Math.min(13,Math.trunc(u.y/600*14)))});
  const a=cell(g),d=cell(opponent),distance=Math.abs(a.x-d.x);
  const grid=nativeGridOccupancy(b.units.filter(u=>u.hp>0&&!u.escaped&&!u.movement?.exiting).map(u=>({...cell(u),side:u.side==='attacker'?0:1})));
  const count=(side:BattleSide,x1:number,y1:number,x2:number,y2:number)=>b.casualtyRules?nativeGridCount(grid,side==='attacker'?0:1,x1,y1,x2,y2):new Set((side==='defender'?own:enemy).filter(u=>{const p=cell(u);return p.x>=Math.min(x1,x2)&&p.x<=Math.max(x1,x2)&&p.y>=Math.min(y1,y2)&&p.y<=Math.max(y1,y2);}).map(u=>{const p=cell(u);return `${p.x},${p.y}`;})).size;
  const learned=commanderMagicSequences(caster.rawSkill,caster.level,caster.skillLearnset).map(sequence=>nativeSkills.find(s=>s.sequence===sequence)??{sequence,mp:0,attack:0,flags:0});
  const weights=nativeTacticalWeights({hp:g.hp,maxHp:g.maxHp,entryHp:ai.entryHp||g.maxHp,enemyHp:opponent.hp,enemyMaxHp:opponent.maxHp,
    strength:caster.strength,enemyStrength:b.commanders.attacker.strength,troops:own.length,enemyTroops:enemy.length,initialTroops:b.strategies?.applied?b.strategies.effects.defender.troops+b.strategies.effects.defender.reserve:b.troopDeployment?b.troopDeployment.defender.active+b.troopDeployment.defender.reserve:b.initial.defender,
    formationMask:1<<(ai.formation??0),unitClass:nativeUnitClass(caster),enemyUnitClass:nativeUnitClass(b.commanders.attacker),distanceX:distance,
    flags:ai.flags,enemyFlags:b.nativeCommands?.attacker.flags??(opponent.order==='retreat'?4:0),blockedFlags:0,canAdvance:b.nativeCommands?nativeCanAdvance(ai.formation??0,b.nativeCommands.defender.orders):own.some(u=>u.order!=='advance'),
    canCast:!((b.strategies?.effects.defender.flags??0)&256)&&caster.charge===CHARGE_LIMIT&&!activeStatus(g,'silenced',b.tick)&&learned.some(s=>s.mp<=caster.mp),
    hasDirectSkill:learned.some(s=>!!(s.flags&0x50)),hasAreaSkill:learned.some(s=>!!(s.flags&15)),
    hasHealSkill:learned.slice(0,4).some(s=>!!(s.flags&256)),hasReinforceSkill:learned.some(s=>!!(s.flags&512)),
    betweenUnits:count('defender',a.x,a.y,d.x,d.y),nearbyEnemies:count('attacker',a.x-3,0,a.x+3,13),
    elapsedSinceCharge:b.tick*3-ai.chargeTick,restrictRetreat:false});
  // 0x4687A0 varargs stop at the first negative weight, even before the -1 sentinel.
  const end=weights.findIndex(w=>w<0);
  const selected=nativeWeightedChoice(end<0?weights:weights.slice(0,end),ai.rng);ai.lastAction=selected;
  if(selected===4) {
    const capacity=Math.min(200,Math.max(5,(caster.level??20)*5));
    const skillWeights=nativeSkillWeights(learned,caster.mp,g.hp/g.maxHp,own.length/capacity,opponent.hp/opponent.maxHp,distance,
      // 54 is intentional: original 0x402A79 edge-skill queries stop there,
      // even though the occupancy map itself has 71 columns.
      {line:count('attacker',a.x,a.y-1,d.x,d.y+1),edges:count('attacker',0,0,54,3)+count('attacker',0,9,54,13),near:count('attacker',a.x-2,a.y-2,a.x+2,a.y+2),enemyTroops:enemy.length});
    const slot=nativeWeightedChoice(skillWeights,ai.rng),skill=learned[slot];ai.lastSkill=skill?.sequence??0;
    // Every selected manifest entry has a deterministic executor. The two
    // closed-loop skills remain evidence-verified; the remaining scripts use
    // their manifest target/effect metadata and are explicitly inferred.
    if(skill&&battleSkillUnavailable(b,skill.sequence,'defender')===null)castSkill(b,skill.sequence,'defender');
  } else if([2,3,5,6].includes(selected)) {
    if(b.nativeCommands) {
      if(selected===2)advanceNativeAI(b);
      else issueNativeCommand(b,'defender',selected===5?0:selected===3?257:256,selected===5?1:selected===3?7:8);
      if(selected===3)ai.chargeTick=b.tick*3;
      if(selected===6){b.log.unshift(`${caster.name}下令撤军。`);b.log.length=Math.min(8,b.log.length);}
      return;
    }
    for(const u of b.units)if(u.side==='defender'&&u.hp>0&&(selected===3||selected===6||u.general===(selected===5))) {
      u.order=selected===6?'retreat':'advance';
      if(b.movementRules!=='native-grid-v3'){u.target=null;u.action='walk';u.actionTick=0;}
    }
    if(selected===3){ai.flags|=1;ai.chargeTick=b.tick*3;}
    if(selected===5)ai.flags|=2;
    if(selected===6){ai.flags|=4;b.log.unshift(`${caster.name}下令撤军。`);b.log.length=Math.min(8,b.log.length);}
  }
}
const soldierRange = (unit: string) => ['弓','弩','飛'].some(c => unit.includes(c));
/** Input adapters remain explicit: continuous walking approximates native cell
 * settlement, horizontal line has no proven native formation. Old battles
 * without morale retain their former neutral-50 combat input until next round. */
function combatUnit(b:BattleState,u:BattleUnit):NativeCombatUnit {
  const own=b.commanders[u.side],enemy=b.commanders[opposite(u.side)],effect=b.strategies?.effects[u.side];
  // `line` is a legacy Web save value whose old neutral matchup must remain
  // replay-compatible. New native ids use their actual executable slot.
  const formation=(side:BattleSide)=>side==='defender'?(b.opponentAI?.formation??0):b.formation==='line'?-1:formationToNativeIndex(b.formation);
  const weakened=activeStatus(u,'weakened',b.tick);
  return {general:u.general,reserve:u.nativeReserve===true,settled:u.action!=='walk',strength:own.strength,
    power:Math.trunc(nativeCombatPower({base:effect?.soldierPower??150,unitMask:1<<nativeUnitIndex(own),enemyUnitMask:1<<nativeUnitIndex(enemy),
      terrain:b.scenery?.terrainId??0,formation:formation(u.side),enemyFormation:formation(opposite(u.side)),defense:b.fortifications?.[u.side]??0,morale:own.morale??50})*(weakened?.7:1)),
    flags:effect?.flags??0,hitBonus:effect?.generalHitBonus??0};
}
function formationOffset(nativeIndex:number,row:number,rows:number,column:number):number {
  const middle=(rows-1)/2;
  const distance=Math.abs(row-middle);
  // Keep one fixed rank spacing for every native pattern.  The offsets alter
  // only rank depth, so every sprite retains a readable 32x36 footprint.
  switch(nativeIndex) {
    case 1: return Math.round((middle-distance)*18); // round: deep centre
    case 2: return Math.round((middle-distance)*14); // wedge: sharp centre
    case 3: return Math.round(distance*17);          // goose: open centre
    // Xuanxiang alternates its wings by a small amount. Keep the native
    // inter-rank spacing readable: a +/-2px offset leaves 36px between
    // adjacent columns instead of creating overlapping 30px pairs.
    case 4: return Math.round((middle-distance)*9 + (column%2 ? 2 : -2)); // xuan: layered
    case 5: return Math.round((middle-distance)*22); // fish scale: broad rear
    case 6: return Math.round((row < middle ? distance*18 : -distance*10)); // hook: one wing
    case 7: return Math.round((row<3||row>rows-4?middle:middle-distance)*12);
    case 8: return Math.round((middle-distance)*24);
    default: return 0;                               // fang: regular square
  }
}

function addUnit(b: BattleState, side: BattleSide, index: number, general = false) {
  const direction = side === 'attacker' ? 1 : -1;
  const dense=battleTroopScale(b,side)<1,rows=dense?14:10;
  const column = Math.floor(index/rows), row=index%rows;
  const nativeIndex=side==='defender'?(b.opponentAI?.formation??0):formationToNativeIndex(b.formation);
  // Legacy line keeps the original 40px rank spacing; native Fang (and the
  // legacy square alias) use the denser square footprint from the executable.
  const square = nativeIndex===0&&(side==='defender'||b.formation!=='line');
  const spread = dense?27:square ? 36 : 40;
  // Stagger the feet so the next rank does not hide the same body silhouette.
  const stagger = square||dense ? 0 : (row%2 ? 7 : -7);
  const offset=formationOffset(nativeIndex,row,rows,column)+stagger;
  const x = general ? (side === 'attacker' ? (dense?25:64) : (dense?1175:1136)) : (side === 'attacker' ? 458 : 742) - direction*column*(dense?30:40) + direction*offset;
  const hp = general ? b.commanders[side].hp : 1;
  b.units.push({ id:b.nextId++, side,general,division:general?'general':column<4?'front':'rear',x,y:general?342:(square&&!dense?168:150)+row*spread,
    hp,maxHp:general?(b.commanders[side].maxHp??hp):hp,ranged:!general && soldierRange(b.commanders[side].unit),order:side==='attacker'?'hold':'advance',action:'wait',actionTick:0,target:null,hit:false,escaped:false });
  if(b.nativeCommands) {
    const unit=b.units[b.units.length-1];unit.nativeDivision=general?0:unit.division==='rear'?2:1;
    const command=b.nativeCommands[side].orders[unit.nativeDivision];unit.order=command===0?'hold':command===8?'retreat':'advance';
  }
}
export function battleTroopScale(b:BattleState,side:BattleSide):number {
  const d=b.troopDeployment?.[side];return d&&d.active+d.reserve>100?.75:1;
}
/** Retain legacy display groups while saving all five native division ids. */
function deployTroops(b:BattleState,side:BattleSide):void {
  const d=b.troopDeployment![side];
  const formation=side==='defender'?(b.opponentAI?.formation??0):formationToNativeIndex(b.formation);
  const active=nativeTroopDivisions(formation,d.active,false),reserve=nativeTroopDivisions(formation,d.reserve,true);
  let index=0;
  for(const div of [0,2,3,4,1])for(const isReserve of [true,false])for(let i=0;i<(isReserve?reserve:active)[div];i++) {
    addUnit(b,side,index++);const u=b.units[b.units.length-1];u.nativeReserve=isReserve;u.division=div===1?'rear':'front';u.nativeDivision=(div+1) as NativeDivision;
    if(side==='attacker')u.order=b.orders[u.division];
    if(b.nativeCommands)u.order=b.nativeCommands[side].orders[div+1]===0?'hold':b.nativeCommands[side].orders[div+1]===8?'retreat':'advance';
  }
}
export function createBattle(input: {id:string; armyId?:string; cityId?:string; attacker:BattleCommander; defender:BattleCommander; attackingTroops:number; defendingTroops:number; seed:number; aiRng?:NativeRandomState; rosters?:Record<BattleSide,BattleMember[]>; scenery?:BattleState['scenery']}): BattleState {
  for (const n of [input.attackingTroops,input.defendingTroops]) if (!Number.isInteger(n)||n<0||n>1000000) throw new Error('战场兵力无效。');
  const rosters=structuredClone(input.rosters??{attacker:[{commander:input.attacker,troops:input.attackingTroops,withdrawn:false}],defender:[{commander:input.defender,troops:input.defendingTroops,withdrawn:false}]});
  const b:BattleState={version:2,timing:'native-99',id:input.id,armyId:input.armyId??null,cityId:input.cityId??null,tick:0,nextId:1,rng:(input.seed>>>0)||1,phase:'deployment',winner:null,reason:'',
    opponentAI:{rng:input.aiRng?[...input.aiRng]:[input.seed>>>0,0x87654321],countdown:10,flags:0,entryHp:input.defender.hp,chargeTick:0,lastAction:0,lastSkill:0},
    round:1,rosters,totalInitial:{attacker:rosters.attacker.reduce((n,m)=>n+m.troops,0),defender:rosters.defender.reduce((n,m)=>n+m.troops,0)},history:[],
    commanders:{attacker:normalizeCommander(input.attacker),defender:normalizeCommander(input.defender)},initial:{attacker:input.attackingTroops,defender:input.defendingTroops},
    reserves:{attacker:input.attackingTroops,defender:input.defendingTroops},units:[],effects:[],formation:defaultFormation(input.attacker.formations),orders:{front:'hold',rear:'hold',general:'hold'},log:['双方列阵，等待军令。']};
  b.casualtyRules='native-v1';b.detached=[];
  b.movementRules='native-grid-v3';
  b.deploymentRules='native-tables-v1';
  b.nativeCommands=createNativeCommands();
  b.attackRules='native-actions-v1';
  b.projectileRules='native-projectiles-v1';b.projectiles=[];
  b.magicRules='native-shoot-v1';
  b.troopDeployment={attacker:{active:0,reserve:0},defender:{active:0,reserve:0}};
  for(const side of ['attacker','defender'] as const) {
    const c=b.commanders[side],member=b.rosters[side].find(m=>m.commander.id===c.id);
    const {active,reserve,overflow}=allocateBattleTroops(b.initial[side],c.level??20,member?.troopSlots);
    b.troopDeployment[side]={active,reserve};b.reserves[side]=overflow;
  }
  // 0x4042ED: commander has already been chosen; strategy precedes formation.
  b.strategies=createBattleStrategies(b);
  const learned=nativeFormationMask(input.defender.formations);
  const cap=nativeTroopCapacity(input.defender.level??20),slots=b.troopDeployment.defender;
  const formation=nativeWeightedChoice(nativeFormationWeights(slots.active+slots.reserve,cap.active+cap.reserve,1<<nativeUnitIndex(input.defender),nativeUnitClass(input.defender),learned),b.opponentAI!.rng);
  b.opponentAI!.formation=Math.max(0,formation);
  for(const side of ['attacker','defender'] as const)b.rosters[side].forEach(m=>{m.commander=normalizeCommander(m.commander);});
  for(const side of ['attacker','defender'] as const) {
    addUnit(b,side,0,true);const general=b.units[b.units.length-1];general.nativeDivision=0;general.order='hold';deployTroops(b,side);
  }
  b.scenery=structuredClone(input.scenery??{terrainId:0,variant:'a'});
  validateScenery(b.scenery);
  return b;
}
function validateScenery(s:NonNullable<BattleState['scenery']>) {
  if(!s||!Number.isInteger(s.terrainId)||s.terrainId<0||s.terrainId>11||!['a','b'].includes(s.variant))throw new Error('战场地形无效。');
}
export function battleSurvivors(b:BattleState,side:BattleSide) { return b.reserves[side]+b.units.filter(u=>u.side===side&&!u.general&&u.hp>0).length; }
export function battleFieldTroops(b:BattleState,side:BattleSide) {return b.units.filter(u=>u.side===side&&!u.general&&u.hp>0&&!u.escaped).length;}
export function battleGeneral(b:BattleState,side:BattleSide) { return b.units.find(u=>u.side===side&&u.general)!; }
export function battleTeamSurvivors(b:BattleState,side:BattleSide) {
  return b.rosters[side].reduce((n,m)=>n+(m.commander.id===b.commanders[side].id?battleSurvivors(b,side):m.troops),0);
}
export function availableCommanders(b:BattleState,side:BattleSide) { return b.rosters[side].filter(m=>!m.withdrawn&&m.commander.hp>0); }
function recordRound(b:BattleState) {
  for(const side of ['attacker','defender'] as const) {
    restoreBattleStrategy(b,side);
    const c=b.commanders[side],effect=b.strategies?.effects[side];
    c.fatigue=nativeBattleFatigue(c.fatigue??0,Math.trunc(b.tick*SOURCE_TICKS_PER_STEP/120),((effect?.settlementFlags??0)&4096)?effect?.fatigueModifier??0:0);
    const m=b.rosters[side].find(m=>m.commander.id===b.commanders[side].id)!;
    m.commander.hp=battleGeneral(b,side).hp;m.commander.mp=b.commanders[side].mp;m.troops=battleSurvivors(b,side);
    if(b.troopDeployment)m.troopSlots={active:b.units.filter(u=>u.side===side&&!u.general&&u.hp>0&&!u.nativeReserve).length,reserve:b.units.filter(u=>u.side===side&&!u.general&&u.hp>0&&u.nativeReserve).length};
    for(const key of ['morale','fatigue','loyalty'] as const)if(c[key]!==undefined)m.commander[key]=c[key];
  }
}
export function commandBattle(previous:BattleState,command:BattleCommand):BattleState {
  const b=structuredClone(previous);
  if(b.phase==='finished') throw new Error('此战已经结束。');
  if(command.type==='withdraw') {
    if(b.phase!=='intermission')throw new Error('须在两阵之间下令全军收兵。');
    b.phase='finished';b.winner='defender';b.reason='进攻方收兵，余部撤回。';return b;
  }
  if(command.type==='next-round'||command.type==='select-commander') {
    if(b.phase!==(command.type==='next-round'?'intermission':'deployment'))throw new Error('当前不能选将。');
    const a=availableCommanders(b,'attacker').find(m=>m.commander.id===command.commanderId);
    const aiRng:NativeRandomState=b.opponentAI?[...b.opponentAI.rng]:[b.rng,0x87654321];
    const d=command.type==='select-commander'?b.rosters.defender.find(m=>m.commander.id===b.commanders.defender.id):chooseOpponentCommander(b.rosters.defender,aiRng);
    if(!a||!d)throw new Error('请选择尚能出战的武将。');
    const next=createBattle({id:b.id,armyId:b.armyId??undefined,cityId:b.cityId??undefined,attacker:a.commander,defender:d.commander,attackingTroops:a.troops,defendingTroops:d.troops,seed:b.rng,aiRng,rosters:b.rosters});
    next.timing=b.timing;
    next.invasionSide=b.invasionSide;
    next.fortifications=b.fortifications?{...b.fortifications}:undefined;
    if(command.type==='select-commander'&&b.opponentAI){
      next.opponentAI=structuredClone(b.opponentAI);
      next.units=next.units.filter(u=>u.side!=='defender'||u.general);deployTroops(next,'defender');
    }
    if(b.strategies&&next.strategies) {
      next.strategies.choices.attacker={...b.strategies.choices.attacker,status:'selected'};
      if(command.type==='select-commander')next.strategies.choices.defender=structuredClone(b.strategies.choices.defender);
    }
    next.scenery=structuredClone(b.scenery??{terrainId:0,variant:'a'});
    next.round=b.round+(command.type==='next-round'?1:0);next.totalInitial=b.totalInitial;next.history=b.history;
    next.log=[`第${next.round}阵：${a.commander.name}对阵${d.commander.name}。`,...b.log].slice(0,8);
    return next;
  }
  if(b.phase==='intermission')throw new Error('请先选将进入下一阵。');
  if(command.type==='strategy') {selectBattleStrategy(b,command.advisorId,command.sequence);return b;}
  if(command.type==='scenery') {
    if(b.armyId||b.cityId||b.phase!=='deployment')throw new Error('只能在演武布阵时选择地形。');
    const scenery={terrainId:command.terrainId,variant:command.variant};validateScenery(scenery);b.scenery=scenery;return b;
  }
  if(command.type==='start') {
    if(b.phase!=='deployment') throw new Error('战斗已经开始。');
    b.log.unshift('战鼓擂响！可分别指挥前军、后军与主将。');applyBattleStrategies(b);b.phase='fighting';return b;
  }
  if(command.type==='skill') {
    castSkill(b,command.sequence,'attacker');
    return b;
  }
  if(command.type==='formation') {
    if(b.phase!=='deployment') throw new Error('开战后不能重新布阵。');
    if(!isNativeFormation(command.formation)&&!['line','wedge','square'].includes(command.formation)) throw new Error('阵形无效。');
    if(!canUseFormation(b.commanders.attacker.formations,command.formation))throw new Error('出阵武将尚未习得此阵形。');
    b.formation=command.formation;
    // Explicit legacy adapters keep their previous pixel-to-grid deployment.
    if(!isNativeFormation(command.formation)){delete b.deploymentRules;delete b.nativeCommands;}
    const soldiers=b.units.filter(u=>u.side==='attacker'&&!u.general); b.units=b.units.filter(u=>u.side!=='attacker'||u.general);
    if(b.troopDeployment)deployTroops(b,'attacker');else soldiers.forEach((_,i)=>addUnit(b,'attacker',i)); return b;
  }
  if(command.type==='native-order') {
    if(!b.nativeCommands)throw new Error('此旧战斗沿用原有军令。');
    if(![0,1,2,3,4,5,256,257].includes(command.division)||!Number.isInteger(command.command)||command.command<0||command.command>9||
      ([0,256].includes(command.division)&&![0,1,2,8].includes(command.command)))throw new Error('战场命令无效。');
    if(b.nativeCommands.attacker.flags&4)throw new Error('撤退军令已下，不能中止撤离。');
    // Original withdrawal is a side-wide irreversible order (0x4447B7),
    // even when the UI currently has one division selected.
    const division=command.command===8?256:command.division;
    issueNativeCommand(b,'attacker',division,command.command);
    const names:Record<number,string>={0:'主将',1:'前军',2:'后军',3:'左军',4:'右军',5:'中军',256:'全军',257:'全体士兵'};
    b.log.unshift(`${names[division]}${NATIVE_COMMAND_LABELS[command.command]}！`);b.log.length=Math.min(8,b.log.length);return b;
  }
  if(command.type!=='order') throw new Error('战场命令无效。');
  if(!['all','front','rear','general'].includes(command.division)||!['advance','hold','retreat'].includes(command.order)) throw new Error('战场命令无效。');
  if(b.nativeCommands) {
    if(b.nativeCommands.attacker.flags&4)throw new Error('撤退军令已下，不能中止撤离。');
    const slots=command.order==='retreat'||command.division==='all'?[256]:command.division==='general'?[0]:command.division==='rear'?[2]:[1,3,4,5];
    for(const slot of slots)issueNativeCommand(b,'attacker',slot,command.order==='advance'?1:command.order==='retreat'?8:0);
  }
  for(const division of ['front','rear','general'] as const) if(command.division==='all'||command.division===division) b.orders[division]=command.order;
  for(const u of b.units) if(u.side==='attacker'&&u.hp>0&&!u.escaped&&(command.division==='all'||u.division===command.division)) {
    u.order=command.order;
    if(command.order==='retreat'&&b.movementRules!=='native-grid-v3') {u.action='walk';u.actionTick=0;u.target=null;}
  }
  const names={all:'全军',front:'前军',rear:'后军',general:'主将'}; const orders={advance:'前进',hold:'待命',retreat:'撤退'};
  b.log.unshift(`${names[command.division]}${orders[command.order]}！`); b.log.length=Math.min(8,b.log.length);
  return b;
}
function finish(b:BattleState,winner:BattleSide,reason:string) {
  recordRound(b);
  b.rosters[opposite(winner)].find(m=>m.commander.id===b.commanders[opposite(winner)].id)!.withdrawn=true;
  b.history.push({round:b.round,attackerId:b.commanders.attacker.id,defenderId:b.commanders.defender.id,winner,reason});
  b.phase=availableCommanders(b,opposite(winner)).length?'intermission':'finished';
  b.winner=b.phase==='finished'?winner:null;b.reason=reason;b.log.unshift(reason);b.log.length=Math.min(8,b.log.length);
}

/** SCRIPT_MAGIC IncreaseHP: host 279 reads the initial HP, host 280 writes
 * initialHP+i capped by max HP, and opcode 66 yields for two scheduler counts. */
function advanceNativeScript(b:BattleState,nativeSteps:number) {
  for(let i=0;i<nativeSteps&&b.activeScript;i++) {
    const script=b.activeScript;
    if(script.kind==='native-shoot')break; // Runs on the source unit clock.
    if(script.kind==='magic-projectile') {
      script.age++;script.phaseAge++;
      const target=b.units.find(u=>u.id===script.targetId&&u.general&&u.side===opposite(script.side));
      if(script.phase!=='windup'&&(!target||target.hp<=0||target.escaped)){b.activeScript=undefined;break;}
      if(script.phase==='windup') {
        script.x=script.fromX;script.y=script.fromY;script.z=0;
        if(script.phaseAge>=script.duration){script.phase='flight';script.phaseAge=0;script.duration=24;}
        continue;
      }
      if(script.phase==='flight') {
        if(target){script.toX=target.x;script.toY=target.y-48;}
        const t=Math.min(1,script.phaseAge/script.duration);
        script.x=script.fromX+(script.toX-script.fromX)*t;script.y=script.fromY+(script.toY-script.fromY)*t;script.z=22+76*Math.sin(Math.PI*t);
        if(script.phaseAge>=script.duration) {
          script.phase='impact';script.phaseAge=0;script.duration=8;script.x=script.toX;script.y=script.toY;script.z=0;
          if(target&&!script.hit) {
            target.hp=Math.max(0,target.hp-script.damage);script.hit=true;
            b.effects.push({id:b.nextId++,kind:'hit',x:script.x,y:script.y,toX:script.x,toY:script.y,ticks:8,targetId:target.id,targetZ:48});
            if(target.hp===0) {target.action='death';target.actionTick=0;const attacker=b.units.find(u=>u.id===script.casterId)??battleGeneral(b,script.side);beginBattleCasualty(b,target,attacker,nativeUnitIndex(b.commanders[target.side]));}
          }
        }
        continue;
      }
      if(target){script.x=target.x;script.y=target.y-48;}
      script.z=0;
      if(script.phaseAge>=script.duration)b.activeScript=undefined;
      continue;
    }
    if(script.kind==='magic-area') {
      script.age++;script.phaseAge++;
      if(script.phase==='windup') {
        if(script.phaseAge>=script.duration){script.phase='impact';script.phaseAge=0;script.duration=8;}
        continue;
      }
      if(!script.hit) {
        const magic=NATIVE_MAGIC[script.magic];
        const targets=magic?magicTargets(b,script.side,magic).filter(u=>script.targetSide==='both'||u.side===script.targetSide):[];
        const caster=b.units.find(u=>u.id===script.casterId)??battleGeneral(b,script.side);
        for(const target of targets) {
          if(!magicAreaHit(target,magic!,b))continue;
          const damage=target.general?script.damage:Math.max(1,Math.ceil(script.damage/2));
          target.hp=Math.max(0,target.hp-damage);
          b.effects.push({id:b.nextId++,kind:'hit',x:target.x,y:target.y-24,toX:target.x,toY:target.y-24,ticks:8,targetId:target.id,targetZ:24});
          if(target.hp===0) {
            target.action='death';target.actionTick=0;
            if(target.general)beginBattleCasualty(b,target,caster,nativeUnitIndex(b.commanders[target.side]));
          }
        }
        script.hit=true;
      }
      if(script.phaseAge>=script.duration)b.activeScript=undefined;
      continue;
    }
    if(script.kind==='magic-reinforce') {
      script.age++;script.phaseAge++;
      if(script.phase==='windup') {
        if(script.phaseAge>=script.duration){script.phase='impact';script.phaseAge=0;script.duration=8;}
        continue;
      }
      if(!script.hit) {
        const side=script.side,d=b.troopDeployment?.[side];
        let active=b.units.filter(u=>u.side===side&&!u.general&&u.hp>0&&!u.escaped&&!u.nativeReserve).length;
        let reserve=b.units.filter(u=>u.side===side&&!u.general&&u.hp>0&&!u.escaped&&u.nativeReserve===true).length;
        let deployed=0;
        for(let i=0;i<script.amount;i++) {
          const canActive=d?active<d.active:true,canReserve=d?reserve<d.reserve:true;
          if(!canActive&&!canReserve)break;
          const useReserve=!canActive&&canReserve;
          const index=b.units.filter(u=>u.side===side&&!u.general).length;
          addUnit(b,side,index);const unit=b.units[b.units.length-1];
          unit.nativeReserve=useReserve;unit.x=side==='attacker'?40:1160;unit.y=150+(index%10)*40;unit.order=side==='attacker'?b.orders[unit.division]:'advance';
          if(useReserve)reserve++;else active++;
          if(b.reserves[side]>0)b.reserves[side]--;
          deployed++;
        }
        if(b.nativeCommands)syncNativeCommands(b,side);
        if(deployed)b.effects.push({id:b.nextId++,kind:'hit',x:script.side==='attacker'?40:1160,y:330,toX:script.side==='attacker'?40:1160,toY:330,ticks:10,point:{x:(script.side==='attacker'?48:6768)*65536,y:468*65536,z:0}});
        script.amount=deployed;script.hit=true;
      }
      if(script.phaseAge>=script.duration)b.activeScript=undefined;
      continue;
    }
    if(script.kind==='magic-status') {
      script.age++;script.phaseAge++;
      if(script.phase==='windup') {
        if(script.phaseAge>=script.duration){script.phase='impact';script.phaseAge=0;script.duration=8;}
        continue;
      }
      if(!script.hit) {
        const magic=NATIVE_MAGIC[script.magic];
        const targets=magic?magicTargets(b,script.side,magic).filter(u=>script.targetSide==='both'||u.side===script.targetSide):[];
        for(const target of targets) {
          target.status={kind:script.status,until:b.tick+script.effectDuration,magic:script.magic};
          b.effects.push({id:b.nextId++,kind:'hit',x:target.x,y:target.y-36,toX:target.x,toY:target.y-36,ticks:10,targetId:target.id,targetZ:36});
        }
        script.hit=true;
      }
      if(script.phaseAge>=script.duration)b.activeScript=undefined;
      continue;
    }
    if(script.wait>0){script.wait--;continue;}
    const target=b.units.find(u=>u.id===script.targetId&&u.general&&u.side===script.side);
    if(!target){b.activeScript=undefined;break;}
    target.hp=Math.min(target.maxHp,script.initialHp+script.nextPoint);
    script.nextPoint++;
    if(script.nextPoint>script.amount){b.activeScript=undefined;break;}
    script.wait=2;
  }
}

/** Footprints are smaller than weapon frames. Resolve allies together after movement,
 * including attacking units, so a shared target cannot collapse the entire formation.
 * Stable iteration and coincident-point direction keep save/replay deterministic. */
function separateAllies(b:BattleState) {
  for(const side of ['attacker','defender'] as const) {
    const units=b.units.filter(u=>u.side===side&&u.hp>0&&!u.escaped);
    // Source deployment and readable artwork have independent origins. Keep
    // every live footprint on the visible field before resolving neighbours;
    // correcting only overlapping pairs lets isolated actors drift offscreen.
    // The native fixed-point position, reservations and RNG remain untouched.
    if(b.movementRules==='native-grid-v3')for(const u of units) {
      u.x=Math.max(21,Math.min(1179,u.x));u.y=Math.max(150,Math.min(510,u.y));
    }
    let overlap=0;
    // Native cells are narrower than the Web artwork. These corrections affect
    // display/legacy targeting only, never the saved fixed-point movement.
    const separate=(a:BattleUnit,c:BattleUnit)=>{
      const scale=battleTroopScale(b,side),width=a.general||c.general?44:32*scale,height=a.general||c.general?40:36*scale;
      let dx=a.x-c.x,dy=a.y-c.y;
      if(Math.abs(dx)>=width||Math.abs(dy)>=height)return;
      const aWeight=a.order==='hold'?0:a.action==='attack'?.5:1;
      const cWeight=c.order==='hold'?0:c.action==='attack'?.5:1;
      const total=aWeight+cWeight;if(!total)return;
      let distance=Math.hypot(dx/width,dy/height);if(distance>=1)return;
      const penetration=1-distance;
      overlap=Math.max(overlap,penetration);
      if(distance<.0001){dx=(side==='attacker'?-1:1)*width;dy=0;}
      else {dx/=distance;dy/=distance;}
      const moveX=dx*penetration,moveY=dy*penetration;
      a.x+=moveX*aWeight/total;a.y+=moveY*aWeight/total;
      c.x-=moveX*cWeight/total;c.y-=moveY*cWeight/total;
      for(const u of [a,c]) {
        u.x=Math.max(21,Math.min(1179,u.x));u.y=Math.max(150,Math.min(510,u.y));
      }
      // At a field edge, clamping both corrections can erase their separation.
      // v3 keeps the fixed-point simulation intact and moves one displayed
      // footprint inward instead of squeezing a whole row against the boundary.
      if(b.movementRules==='native-grid-v3'&&a.y===c.y&&(a.y===150||a.y===510)&&Math.abs(a.x-c.x)<width) {
        const mover=aWeight>0?a:c,other=mover===a?c:a;
        mover.y=other.y+(a.y===150?1:-1)*height*Math.sqrt(1-((a.x-c.x)/width)**2);
      }
    };
    const nearby=b.movementRules==='native-grid-v2'||b.movementRules==='native-grid-v3';
    for(let pass=0;pass<(nearby?18:b.movementRules?12:3);pass++) {
      overlap=0;
      if(nearby)nearbyPairs(units,separate);
      else for(let i=0;i<units.length;i++)for(let j=0;j<i;j++)separate(units[i],units[j]);
      if(nearby&&overlap<.02)break;
    }
  }
}

/** Damage event adapter shared by the legacy and source-clock schedulers. */
function resolveBattleHit(b:BattleState,u:BattleUnit,current:BattleUnit,forced=false,projectile=u.ranged):boolean {
  const attacker=combatUnit(b,u),target=combatUnit(b,current),rng=b.opponentAI!.rng;
  const hit=forced||nativeAttackHits(attacker,target,rng);
  if(hit) {
    current.hp=current.general?battleMagicLocked(b,current)?current.hp:Math.max(0,current.hp-nativeGeneralDamage(attacker,rng)):0;
    if(current.hp===0) {current.action='death';current.actionTick=0;beginBattleCasualty(b,current,u,nativeUnitIndex(b.commanders[current.side]));}
  }
  if(projectile||hit)b.effects.push({id:b.nextId++,kind:projectile?'arrow':'hit',x:u.x,y:u.y-25,toX:current.x,toY:current.y-23,ticks:projectile?7:4,sourceId:u.id,targetId:current.id,sourceZ:25,targetZ:23});
  return hit;
}

/** Mutates only the supplied battle snapshot. Caller owns it; display frame rate never enters damage rules. */
export function tickBattle(b:BattleState,steps=1):void {
  if(!Number.isInteger(steps)||steps<1||steps>200) throw new Error('战场步数无效。');
  for(let step=0;step<steps&&b.phase==='fighting';step++) {
    b.tick++;
    // EXE 0x43E72E/0x43E964: per-update increment, grouped in three updates.
    for(const side of ['attacker','defender'] as const) {
      const c=b.commanders[side],g=battleGeneral(b,side);
      const effect=b.strategies?.effects[side];
      if(g.hp>0&&!g.escaped&&g.order!=='retreat')c.charge=Math.min(CHARGE_LIMIT,(c.charge??INITIAL_CHARGE)+SOURCE_TICKS_PER_STEP*chargeIncrement(c.strength,c.intelligence,effect&&(effect.flags&32)?effect.chargeModifier:0));
      recoverBattleStrategy(b,side,SOURCE_TICKS_PER_STEP);
    }
    advanceNativeScript(b,SOURCE_TICKS_PER_STEP);
    advanceBattleCasualties(b,SOURCE_TICKS_PER_STEP);
    prepareBattleMovement(b);
    decideOpponent(b);
    for(const e of b.effects)e.ticks--;
    b.effects=b.effects.filter(e=>e.ticks>0);
    if(b.movementRules==='native-grid-v3') {
      updateBattleUnits(b,{sourceStep:()=>advanceBattleNativeMagic(b,(target,caster)=>beginBattleCasualty(b,target,caster,nativeUnitIndex(b.commanders[target.side]))),
        unitType:u=>nativeUnitIndex(b.commanders[u.side]),hit:(u,target,forced,projectile)=>resolveBattleHit(b,u,target,forced,projectile),
        escaped:u=>{if(u.general)finish(b,opposite(u.side),`${b.commanders[u.side].name}撤离战场。`);}});
    } else {
      const alive=b.units.filter(u=>u.hp>0&&!u.escaped);
      const sides={attacker:alive.filter(u=>u.side==='attacker'),defender:alive.filter(u=>u.side==='defender')};
      const activeUpdates=new Set<number>();
      const yieldContext={active:activeUpdates,update:updateUnit};
      function updateUnit(u:BattleUnit):void {
        if(b.phase!=='fighting')return;
        const recursive=b.movementRules==='native-grid-v2';
        if(recursive&&(u.movement?.updatedAt===b.tick*3||activeUpdates.has(u.id)))return;
        if(recursive)activeUpdates.add(u.id);
        try {
          u.actionTick++;
          if(u.hp<=0||u.escaped)return;
          if(u.status&&u.status.until>b.tick){u.action='wait';u.actionTick=0;u.target=null;return;}
          if(b.movementRules&&u.movement!.remaining>0) {
            advanceBattleMovement(u,SOURCE_TICKS_PER_STEP);
            if(u.escaped&&u.general){finish(b,opposite(u.side),`${b.commanders[u.side].name}撤离战场。`);return;}
            return;
          }
          if(u.order==='retreat') {
            if(b.movementRules){planBattleMovement(b,u,undefined,nativeUnitIndex(b.commanders[u.side]),yieldContext);advanceBattleMovement(u,SOURCE_TICKS_PER_STEP);return;}
            u.x+=(u.side==='attacker'?-1:1)*(u.general?62:48)*battleStepDuration(b);u.action='walk';
            if(u.x<20||u.x>1180) {u.escaped=true;if(u.general)finish(b,opposite(u.side),`${b.commanders[u.side].name}撤离战场。`);}
            return;
          }
          const targets=sides[opposite(u.side)].filter(t=>t.hp>0&&!t.escaped);
          if(!targets.length) {finish(b,u.side,'敌军已溃散。');return;}
          const current=b.units.find(t=>t.id===u.target&&t.hp>0&&!t.escaped);
          // Attack is locked to the selected target until its hit event; no retarget damage teleport.
          if(u.action==='attack') {
            const appearance=b.commanders[u.side].appearance;
            const timing=appearance?.[u.general?'generalAttack':u.nativeReserve?'reserveSoldierAttack':'soldierAttack']??appearance?.soldierAttack;
            if(!u.hit&&u.actionTick>=Math.max(1,Math.ceil((timing?.hitTick??21)/SOURCE_TICKS_PER_STEP))) {
              u.hit=true;
              if(current&&Math.hypot(current.x-u.x,current.y-u.y)<(u.ranged?230:u.general?75:42)) {
                resolveBattleHit(b,u,current);
              }
            }
            if(u.actionTick>=Math.ceil((timing?.ticks??60)/SOURCE_TICKS_PER_STEP)) {u.action='wait';u.actionTick=0;u.target=null;}
            return;
          }
          let target=targets[0],best=Infinity;
          for(const t of targets) {const d=(t.x-u.x)**2+(t.y-u.y)**2;if(d<best){best=d;target=t;}}
          const distance=Math.sqrt(best),range=u.ranged?190:u.general?44:24;
          if(distance<=range) {u.action='attack';u.actionTick=0;u.target=target.id;u.hit=false;if(u.movement)u.movement.facing=target.x>=u.x?0:0x800000;}
          else if(u.order==='advance') {
            if(b.movementRules){planBattleMovement(b,u,target,nativeUnitIndex(b.commanders[u.side]),yieldContext);advanceBattleMovement(u,SOURCE_TICKS_PER_STEP);return;}
            const speed=(u.general?36:30)*battleStepDuration(b);
            u.x+=(target.x-u.x)/distance*speed;u.y+=(target.y-u.y)/distance*speed;u.action='walk';
            u.y=Math.max(150,Math.min(510,u.y));
          } else u.action='wait';
        } finally {
          if(recursive) {
            if(u.movement)u.movement.updatedAt=b.tick*3;
            activeUpdates.delete(u.id);
          }
        }
      }
      for(const u of b.units){updateUnit(u);if(b.phase!=='fighting')break;}
    }
    if(b.phase!=='fighting')break;
    for(const side of ['attacker','defender'] as const) if(battleGeneral(b,side).hp<=0) {finish(b,opposite(side),`${b.commanders[side].name}败退，此战结束。`);break;}
    if(b.phase!=='fighting')break;
    separateAllies(b);
    // Reserves represent actual soldiers waiting off-field, never a visual multiplier.
    if(!b.troopDeployment&&b.tick%40===0) for(const side of ['attacker','defender'] as const) {
      if(side==='attacker'&&Object.values(b.orders).every(order=>order==='retreat'))continue;
      if(side==='defender'&&battleGeneral(b,side).order==='retreat')continue;
      const count=b.units.filter(u=>u.side===side&&!u.general&&u.hp>0&&!u.escaped).length;
      const replenish=Math.min(100-count,b.reserves[side],10);
      let deployed=0;
      for(let row=0;row<10&&deployed<replenish;row++) {
        const x=side==='attacker'?40:1160,y=150+row*40;
        // Occupied entrances wait until the next wave; reserves are never discarded.
        if(b.units.some(u=>u.hp>0&&!u.escaped&&Math.hypot((u.x-x)/40,(u.y-y)/40)<1))continue;
        addUnit(b,side,count+deployed);const u=b.units[b.units.length-1];
        u.nativeReserve=true;
        u.x=x;u.y=y;u.order=side==='attacker'?b.orders[u.division]:'advance';deployed++;
      }
      b.reserves[side]-=deployed;
    }
    // Corpses may leave the renderer; they no longer contribute to survivor counts.
    // The source unit record outlives its rendered corpse while arrows still
    // reference it. Keep hit/casualty ownership valid through save and restore.
    const projectileOwners=new Set((b.projectiles??[]).map(p=>p.owner));
    const effectOwners=new Set(b.effects.flatMap(e=>[e.sourceId,e.targetId]));
    // Native charge keeps a pointer into the enemy creation list, including
    // the dead current target, until the next command decision advances it.
    const commandTargets=new Set(b.nativeCommands?Object.values(b.nativeCommands).map(s=>s.target):[]);
    b.units=b.units.filter(u=>u.general||u.hp>0||u.actionTick<50||projectileOwners.has(u.id)||commandTargets.has(u.id)||effectOwners.has(u.id));
    if(battleRemainingUpdates(b)===0)finish(b,opposite(b.invasionSide??'attacker'),'日暮收兵，进攻方撤回。');
  }
}

export function validateBattle(value:unknown):asserts value is BattleState {
  const b=value as BattleState; const fail=()=>{throw new Error('战场存档无效。');};
  const integer=(x:unknown,max=1000000)=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0&&x<=max;
  if(!b||b.version!==2||typeof b.id!=='string'||!integer(b.tick,b.timing==='native-99'?3960:3600)||!integer(b.nextId)||!integer(b.rng,4294967295)||b.rng===0||!['deployment','fighting','intermission','finished'].includes(b.phase)||!['fang','yuan','zhui','yan','xuan','yu','gou','chong','jian','line','wedge','square'].includes(b.formation)||!Array.isArray(b.units)||b.units.length>600||!Array.isArray(b.effects)||b.effects.length>1000||!Array.isArray(b.log)||b.log.length>8||!b.orders) return fail();
  if(b.timing!==undefined&&b.timing!=='native-99')return fail();
  if(b.invasionSide!==undefined&&!['attacker','defender'].includes(b.invasionSide))return fail();
  if(b.opponentAI!==undefined) {
    const a=b.opponentAI;
    if(!a||!Array.isArray(a.rng)||a.rng.length!==2||!a.rng.every(n=>integer(n,4294967295))||!integer(a.countdown,60)||!integer(a.flags,7)||!integer(a.entryHp,10000)||!integer(a.chargeTick)||!integer(a.lastAction,6)||!integer(a.lastSkill,127))return fail();
    if(a.formation!==undefined&&!integer(a.formation,6))return fail();
  }
  if(b.scenery!==undefined)validateScenery(b.scenery);
  if(b.fortifications!==undefined&&(!b.fortifications||!integer(b.fortifications.attacker,1000000000)||!integer(b.fortifications.defender,1000000000)))return fail();
  if((b.phase==='finished')!==['attacker','defender'].includes(b.winner as string)|| (b.phase!=='finished'&&b.winner!==null)||typeof b.reason!=='string'||b.reason.length>500)return fail();
  for(const order of Object.values(b.orders))if(!['advance','hold','retreat'].includes(order))return fail();
  for(const division of ['front','rear','general'])if(!(division in b.orders))return fail();
  const ids=new Set<number>();
  for(const u of b.units) {
    if(!u||!integer(u.id,b.nextId-1)||ids.has(u.id)||!['attacker','defender'].includes(u.side)||typeof u.general!=='boolean'||typeof u.escaped!=='boolean'||typeof u.ranged!=='boolean'||typeof u.hit!=='boolean'||!['front','rear','general'].includes(u.division)||!['advance','hold','retreat'].includes(u.order)||!['wait','walk','attack','death'].includes(u.action)||!integer(u.actionTick)||!Number.isFinite(u.x)||u.x < -100||u.x>1300||!Number.isFinite(u.y)||u.y<0||u.y>600||!Number.isFinite(u.hp)||u.hp<0||u.hp>u.maxHp||!integer(u.maxHp,10000)||(u.target!==null&&!integer(u.target,b.nextId-1)))return fail();
    ids.add(u.id);
    if(u.nativeReserve!==undefined&&(typeof u.nativeReserve!=='boolean'||u.general&&u.nativeReserve))return fail();
    if(u.status!==undefined&&(!u.status||!['stunned','silenced','weakened'].includes(u.status.kind)||!integer(u.status.until,1000000)||!integer(u.status.magic,110)))return fail();
  }
  validateBattleCasualties(b,fail);
  validateBattleMovement(b,fail);
  validateNativeCommands(b,fail);
  if(b.attackRules!==undefined&&(b.attackRules!=='native-actions-v1'||b.movementRules!=='native-grid-v3'))fail();
  for(const side of ['attacker','defender'] as const) {
    const c=b.commanders?.[side];
    if(!c||typeof c.id!=='string'||typeof c.name!=='string'||c.name.length>100||typeof c.portrait!=='string'||typeof c.unit!=='string'||![c.strength,c.intelligence,c.hp,c.mp].every(n=>integer(n,10000))||!integer(b.initial?.[side])||!integer(b.reserves?.[side])||battleSurvivors(b,side)>b.initial[side]||b.units.filter(u=>u.general&&u.side===side).length!==1)return fail();
    if(b.troopDeployment!==undefined) {
      const d=b.troopDeployment?.[side],cap=nativeTroopCapacity(c.level??20);
      if(!d||!integer(d.active,Math.max(0,cap.active))||!integer(d.reserve,cap.reserve)||d.active+d.reserve+b.reserves[side]>b.initial[side])return fail();
      for(const reserve of [false,true])if(b.units.filter(u=>u.side===side&&!u.general&&u.hp>0&&u.nativeReserve===reserve).length>(reserve?d.reserve:d.active))return fail();
      if(b.units.some(u=>u.side===side&&!u.general&&typeof u.nativeReserve!=='boolean'))return fail();
    }
    const members=b.rosters?.[side];
    if(!Array.isArray(members)||!members.length||members.length>401||new Set(members.map(m=>m.commander?.id)).size!==members.length||!members.some(m=>m.commander.id===c.id)||!integer(b.totalInitial?.[side])||battleTeamSurvivors(b,side)>b.totalInitial[side])return fail();
    for(const m of members) {
      const mc=m.commander;
      if(!mc||typeof mc.id!=='string'||typeof mc.name!=='string'||typeof mc.portrait!=='string'||typeof mc.unit!=='string'||![mc.hp,mc.mp,mc.strength,mc.intelligence].every(n=>integer(n,10000))||!integer(m.troops)||typeof m.withdrawn!=='boolean')return fail();
      validateAppearance(mc,fail);if(mc.maxHp!==undefined&&(!integer(mc.maxHp,10000)||mc.hp>mc.maxHp))return fail();
      const cap=nativeTroopCapacity(mc.level??20);
      if(m.troopSlots!==undefined&&(!m.troopSlots||!integer(m.troopSlots.active,Math.max(0,cap.active))||!integer(m.troopSlots.reserve,cap.reserve)||m.troopSlots.active+m.troopSlots.reserve>m.troops))return fail();
    }
    validateAppearance(c,fail);
    if(c.charge!==undefined&&!integer(c.charge,CHARGE_LIMIT))return fail();
    if(c.maxMp!==undefined&&(!integer(c.maxMp,10000)||c.mp>c.maxMp))return fail();
  }
  validateBattleAttackActions(b,fail);
  validateBattleProjectiles(b,fail);
  validateBattleNativeMagic(b,fail);
  if(b.activeScript!==undefined) {
    const x=b.activeScript;
    if(x.kind==='native-shoot') {
      // Full native coroutine/weapon validation lives with its adapter.
    } else if(x.kind==='heal') {
      if(!['attacker','defender'].includes(x.side)||!integer(x.targetId,b.nextId-1)||!integer(x.initialHp,10000)||!integer(x.nextPoint,10000)||!integer(x.amount,10000)||!integer(x.wait,100)||!integer(x.magic,100))return fail();
    } else if(x.kind==='magic-projectile') {
      if(!['attacker','defender'].includes(x.side)||!integer(x.casterId,b.nextId-1)||!integer(x.targetId,b.nextId-1)||!integer(x.magic,100)||!integer(x.script,1000)||!integer(x.damage,10000)||!['windup','flight','impact'].includes(x.phase)||!integer(x.phaseAge,1000)||!integer(x.duration,1000)||!integer(x.age,10000)||typeof x.hit!=='boolean'||![x.fromX,x.fromY,x.toX,x.toY,x.x,x.y,x.z].every(n=>Number.isFinite(n)&&Math.abs(n)<2000)||x.z<0)return fail();
      const caster=b.units.find(u=>u.id===x.casterId),target=b.units.find(u=>u.id===x.targetId);
      if(!caster||!caster.general||caster.side!==x.side||!target||!target.general||target.side!==opposite(x.side))return fail();
    } else if(x.kind==='magic-area') {
      if(!['attacker','defender'].includes(x.side)||!integer(x.casterId,b.nextId-1)||!integer(x.magic,110)||!NATIVE_MAGIC[x.magic]||NATIVE_MAGIC[x.magic].effectType!=='area'||!integer(x.script,1000)||!['attacker','defender','both'].includes(x.targetSide)||!integer(x.damage,10000)||!['windup','impact'].includes(x.phase)||!integer(x.phaseAge,1000)||!integer(x.duration,1000)||!integer(x.age,10000)||typeof x.hit!=='boolean'||![x.x,x.y].every(n=>Number.isFinite(n)&&Math.abs(n)<2000))return fail();
      const caster=b.units.find(u=>u.id===x.casterId);
      if(!caster||!caster.general||caster.side!==x.side)return fail();
    } else if(x.kind==='magic-reinforce') {
      const validSide=['attacker','defender'].includes(x.side);
      const validMagic=integer(x.magic,110)&&!!NATIVE_MAGIC[x.magic]&&NATIVE_MAGIC[x.magic].effectType==='reinforce';
      const validPhase=['windup','impact'].includes(x.phase);
      if(!validSide||!integer(x.casterId,b.nextId-1)||!validMagic||!integer(x.script,1000)||!integer(x.amount,1000000)||!validPhase||!integer(x.phaseAge,1000)||!integer(x.duration,1000)||!integer(x.age,10000)||typeof x.hit!=='boolean')return fail();
      const caster=b.units.find(u=>u.id===x.casterId);
      if(!caster||!caster.general||caster.side!==x.side)return fail();
    } else if(x.kind==='magic-status') {
      const validSide=['attacker','defender'].includes(x.side);
      const validMagic=integer(x.magic,110)&&!!NATIVE_MAGIC[x.magic]&&NATIVE_MAGIC[x.magic].effectType==='status';
      const validTarget=['attacker','defender','both'].includes(x.targetSide);
      const validStatus=['stunned','silenced','weakened'].includes(x.status);
      const validPhase=['windup','impact'].includes(x.phase);
      if(!validSide||!integer(x.casterId,b.nextId-1)||!validMagic||!integer(x.script,1000)||!validTarget||!validStatus||!integer(x.duration,1000)||!integer(x.effectDuration,10000)||!validPhase||!integer(x.phaseAge,1000)||!integer(x.age,10000)||typeof x.hit!=='boolean')return fail();
      const caster=b.units.find(u=>u.id===x.casterId);
      if(!caster||!caster.general||caster.side!==x.side)return fail();
    } else return fail();
  }
  validateBattleStrategies(b,fail);
  if(!integer(b.round,802)||b.round<1||!Array.isArray(b.history)||b.history.length>802||b.history.length!==b.round-(b.phase==='deployment'||b.phase==='fighting'?1:0))return fail();
  for(const [i,r] of b.history.entries())if(r.round!==i+1||!['attacker','defender'].includes(r.winner)||typeof r.reason!=='string'||!b.rosters.attacker.some(m=>m.commander.id===r.attackerId)||!b.rosters.defender.some(m=>m.commander.id===r.defenderId))return fail();
  if(b.phase==='intermission'&&(!availableCommanders(b,'attacker').length||!availableCommanders(b,'defender').length))return fail();
  for(const e of b.effects) {
    if(!e||!integer(e.id,b.nextId-1)||!['arrow','hit'].includes(e.kind)||!integer(e.ticks,20)||![e.x,e.y,e.toX,e.toY].every(n=>Number.isFinite(n)&&Math.abs(n)<2000))return fail();
    for(const id of [e.sourceId,e.targetId]) if(id!==undefined&&(!integer(id,b.nextId-1)||!ids.has(id)))return fail();
    for(const z of [e.sourceZ,e.targetZ])if(z!==undefined&&!integer(z,2000))return fail();
    if(e.point!==undefined&&(!e.point||![e.point.x,e.point.y,e.point.z].every(n=>Number.isInteger(n)&&n>=-2147483648&&n<=2147483647)||e.point.z<0))return fail();
  }
  if(b.log.some(x=>typeof x!=='string'||x.length>500))return fail();
}

function validateAppearance(c:BattleCommander,fail:()=>never) {
  for(const key of ['morale','fatigue','loyalty'] as const)if(c[key]!==undefined&&(!Number.isInteger(c[key])||c[key]<0||c[key]>100))fail();
  if(c.formations!==undefined&&(!Array.isArray(c.formations)||c.formations.length>9||c.formations.some(f=>typeof f!=='string'||f.length>10)))fail();
  if(c.level!==undefined&&(!Number.isInteger(c.level)||c.level < -1||c.level>99))fail();
  if(c.skillLearnset!==undefined&&(!Array.isArray(c.skillLearnset)||c.skillLearnset.length>8||c.skillLearnset.some(e=>!e||![e.level,e.sequence].every(n=>Number.isInteger(n)&&n>=0&&n<=255))))fail();
  if(c.rawStrategy!==undefined&&(typeof c.rawStrategy!=='string'||c.rawStrategy.length>4096))fail();
  if(c.strategyLearnset!==undefined&&(!Array.isArray(c.strategyLearnset)||c.strategyLearnset.length>8||c.strategyLearnset.some(e=>!e||![e.level,e.sequence].every(n=>Number.isInteger(n)&&n>=0&&n<=255))))fail();
  if(!c.appearance)return;
  const a=c.appearance;
  if(![a.body,a.weapon,a.horse,a.soldier].every(n=>Number.isInteger(n)&&n>=100&&n<=907))fail();
  for(const t of [a.generalAttack,a.soldierAttack,...(a.reserveSoldierAttack===undefined?[]:[a.reserveSoldierAttack])])if(!t||!Number.isInteger(t.hitTick)||!Number.isInteger(t.ticks)||t.hitTick<0||t.ticks<=t.hitTick||t.ticks>10000)fail();
}

/** Legacy single-duel saves retain their exact units, clock and RNG; no extra rounds are invented. */
export function upgradeBattle(value:BattleState):BattleState {
  if((value.version as number)!==1)return value;
  const b=value;b.version=2;b.round=1;b.history=[];
  b.rosters={attacker:[],defender:[]};b.totalInitial={...b.initial};
  for(const side of ['attacker','defender'] as const)b.rosters[side]=[{commander:structuredClone(b.commanders[side]),troops:b.initial[side],withdrawn:false}];
  if(b.phase==='finished') {
    recordRound(b);b.rosters[opposite(b.winner!)][0].withdrawn=true;
    b.history=[{round:1,attackerId:b.commanders.attacker.id,defenderId:b.commanders.defender.id,winner:b.winner!,reason:b.reason}];
  }
  return b;
}
