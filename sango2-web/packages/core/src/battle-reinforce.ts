import type {BattleSide,BattleState,BattleUnit} from './battle';
import {commandOrder} from './battle-commands';
import {nativeAdvanceMagicReinforce} from './native-magic-reinforce';
import {emitBattleSound} from './battle-audio-events';

/** 0x43A971 scans 200 per-side records; 0x43DB0D marks a death reusable
 * immediately, independently of its still-visible corpse object. */
function nextSoldierSlot(b:BattleState,side:BattleSide):number|undefined {
  const soldiers=b.units.filter(u=>u.side===side&&!u.general);
  const known=new Set(soldiers.flatMap(u=>u.nativeSoldierSlot===undefined?[]:[u.nativeSoldierSlot]));
  // Snapshots created before slot tracking retain their creation order.
  for(const unit of soldiers)if(unit.nativeSoldierSlot===undefined) {
    const slot=Array.from({length:200},(_,i)=>i).find(i=>!known.has(i));
    if(slot===undefined)break;unit.nativeSoldierSlot=slot;known.add(slot);
  }
  const occupied=new Set(soldiers.filter(u=>u.hp>0).map(u=>u.nativeSoldierSlot));
  return Array.from({length:200},(_,i)=>i).find(i=>!occupied.has(i));
}

/** Original host 281 creation boundary. The positive high word selects a
 * reserve object; negative x remains a signed off-grid active coordinate. */
export function createBattleReinforceSoldier(b:BattleState,side:BattleSide,encodedX:number,y:number):number {
  const reserve=encodedX>65535,x=reserve?encodedX&65535:encodedX;
  if(b.units.some(u=>u.hp>0&&!u.escaped&&!u.movement?.exiting&&u.movement?.x===x&&u.movement?.y===y))return 0;
  const slot=nextSoldierSlot(b,side);if(slot===undefined)return 0;
  const caster=b.units.find(u=>u.general&&u.side===side)!;
  const id=b.nextId++,command=b.nativeCommands?.[side].orders[1]??1;
  const unit:BattleUnit={id,side,general:false,division:'front',nativeDivision:1,
    x:(x+.5)/71*1200,y:150+y/13*360,hp:1,maxHp:1,
    ranged:['弓','弩','飛'].some(c=>b.commanders[side].unit.includes(c)),
    order:commandOrder(command),action:'wait',actionTick:0,target:null,hit:false,escaped:false,
    nativeReserve:reserve,nativeSoldierSlot:slot,reinforceHandle:id,reinforceAlpha:0,
    movement:{x,y,previousX:x,previousY:y,px:(x*96+48)*65536,py:(y*72+36)*65536,vx:0,vy:0,remaining:0,
      facing:side==='attacker'?0:0x800000,exiting:false,
      clock:{decision:caster.movement!.clock!.decision,attack:0,deferred:0,actionAge:0,special:false}}};
  // Occupancy changes inside host 281, before Produce* scans its next cell.
  b.units.push(unit);
  if(b.troopDeployment) {
    const key=reserve?'reserve':'active';
    b.troopDeployment[side][key]=Math.max(b.troopDeployment[side][key],b.units.filter(u=>u.side===side&&!u.general&&u.hp>0&&u.nativeReserve===reserve).length);
  }
  return id;
}

/** host 281 -> 0x43A971. Object ids stay unique even when a soldier record
 * is reused, so arrows and corpses can keep their original saved ownership. */
export function advanceBattleReinforce(b:BattleState,sourceTick=b.tick*3):void {
  const script=b.activeScript;if(script?.kind!=='native-reinforce')return;
  const r=script.runtime,caster=b.units.find(u=>u.id===script.casterId);
  if(!caster){b.activeScript=undefined;return;}
  const side=script.side;
  // The first published adapter used synthetic handles. Preserve in-flight
  // saves by reconnecting their already-created objects before advancing.
  for(const visual of r.visuals) {
    const unit=b.units.find(u=>u.side===side&&u.reinforceHandle===visual.id);
    if(unit&&unit.id!==visual.id) {
      for(const spawn of r.spawns)if(spawn.handle===visual.id)spawn.handle=unit.id;
      visual.id=unit.id;unit.reinforceHandle=unit.id;
    }
  }
  r.origin={x:caster.movement!.px,y:caster.movement!.py,z:0};
  nativeAdvanceMagicReinforce(r,b.opponentAI!.rng,{
    level:b.commanders[side].level??20,
    // Off-field overflow is a Web save adapter, not a native soldier object.
    living:b.units.filter(u=>u.side===side&&!u.general&&u.hp>0).length,
    occupant:(x,y)=>b.units.some(u=>u.hp>0&&!u.escaped&&!u.movement?.exiting&&u.movement?.x===x&&u.movement?.y===y),
    spawn:(x,y)=>createBattleReinforceSoldier(b,side,x,y),
  },event=>{
    if(event.host===769)emitBattleSound(b,String(event.args[0]),Number(event.args[1]),sourceTick);
    // host 289 delays the caster's next decision on the same source clock.
    if(event.host===289)caster.movement!.clock!.deferred=(caster.movement!.clock!.deferred+40*Number(event.args[1]))|0;
  });
  r.materialized=r.spawns.length;
  for(const visual of r.visuals) {
    const unit=b.units.find(u=>u.id===visual.id&&u.side===side&&u.reinforceHandle===visual.id);
    if(unit)unit.reinforceAlpha=visual.alpha;
  }
  if(r.phase==='done')b.activeScript=undefined;
}
