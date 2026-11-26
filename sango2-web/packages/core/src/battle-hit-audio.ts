import type {BattleState,BattleUnit} from './battle';
import {emitBattleSound,type NativeAttackSound} from './battle-audio-events';
import reactions from './native-hit-audio.json';

interface ReactionTimeline {ticks:number;soundTicks:NativeAttackSound[]}
const catalogue=reactions as Record<string,{pain?:ReactionTimeline;defense?:ReactionTimeline}>;
const body=(b:BattleState,u:BattleUnit)=>(b.commanders[u.side].appearance?.body??600)+(u.side==='defender'?200:0);

/** 0x421E1B plays sound when selecting the first reaction node. Current PAIN
 * and DEFENSE streams attach their sound to that first node; an unfamiliar
 * later node stays unplayed until its reaction animation has a source clock. */
function enterReaction(b:BattleState,target:BattleUnit,kind:'pain'|'defense',sourceTick:number):void {
  if(!b.soundEvents)return;
  for(const sound of catalogue[body(b,target)]?.[kind]?.soundTicks??[])if(sound.tick===0) {
    emitBattleSound(b,sound.name,sound.volume,sourceTick);
  }
}

/** General 0x43EF64 events 65540/65550: nonlethal damage selects PAIN; death
 * selects the silent DEATH stream. Magic's direct soldier death event 65539
 * has no ordinary-hit sound, so this helper intentionally covers generals. */
export function emitBattleDamageAudio(b:BattleState,target:BattleUnit,sourceTick:number):void {
  if(target.general&&target.hp>0)enterReaction(b,target,'pain',sourceTick);
}

/** Called after the damage write, once per original ordinary hit callback.
 * Soldier 0x43DDBF event65540 plays Hit01 at 255 before invoking death. General
 * pain/defense uses the original object node and its 192 volume. `blocked`
 * denotes the native general skill lock which suppresses the damage callback. */
export function emitBattleHitAudio(b:BattleState,attacker:BattleUnit,target:BattleUnit,hit:boolean,sourceTick:number,blocked=false):void {
  if(!b.soundEvents||target.escaped)return;
  if(hit) {
    if(target.general) {if(!blocked)emitBattleDamageAudio(b,target,sourceTick);}
    else emitBattleSound(b,'HIT01',255,sourceTick);
    return;
  }
  // 0x43E55C event65546: equal facings mean the attack came from behind, so
  // there is no defense. A defense while attacking waits for its natural end.
  if(!target.general||target.hp<=0||target.movement?.facing===attacker.movement?.facing)return;
  if(target.action==='attack') {
    const pending=b.soundEvents.pendingDefenses??=[];
    if(!pending.includes(target.id))pending.push(target.id);
  } else enterReaction(b,target,'defense',sourceTick);
}

/** Audio projection of 0x43E55C's pending defense. The renderer still uses its
 * existing reaction artwork; this queue only preserves when the native sound
 * occurs and is deliberately independent of the combat state machine. */
export function finishBattleAttackAudio(b:BattleState,target:BattleUnit,sourceTick:number):void {
  const pending=b.soundEvents?.pendingDefenses;if(!pending)return;
  const index=pending.indexOf(target.id);if(index===-1)return;
  pending.splice(index,1);
  if(target.hp>0&&!target.escaped)enterReaction(b,target,'defense',sourceTick);
}

/** Original soldier/general event65543 clears +104 when starting a new
 * attack. An interrupted old reaction cannot leak into that new attack. */
export function beginBattleAttackAudio(b:BattleState,target:BattleUnit):void {
  const pending=b.soundEvents?.pendingDefenses;if(!pending)return;
  const index=pending.indexOf(target.id);if(index!==-1)pending.splice(index,1);
}

export function validateBattleHitAudio(b:BattleState,fail:()=>never):void {
  for(const id of b.soundEvents?.pendingDefenses??[])if(!b.units.some(u=>u.id===id&&u.general))fail();
}

/** A defeated or removed actor cannot finish an old defense reaction. */
export function pruneBattleHitAudio(b:BattleState):void {
  const state=b.soundEvents;if(!state?.pendingDefenses)return;
  state.pendingDefenses=state.pendingDefenses.filter(id=>b.units.some(u=>u.id===id&&u.general&&u.hp>0&&!u.escaped));
}
