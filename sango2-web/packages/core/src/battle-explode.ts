import type {BattleState,BattleUnit} from './battle';
import {battleMovementCell} from './battle-movement';
import {nativeAdvanceMagicExplode,nativeExplodeHit} from './native-magic-explode';
import {nativeMagicCollision,nativeMagicDirectHit} from './native-magic-shoot';
import {projectBattleCell} from './native-battle-grid';

/** Original generic process skips dead draw objects, death action 32 and an
 * empty occupancy cell before the shared height / affiliation mask gate. */
export function battleExplodeCollision(object:{alive:boolean;flags:number;z:number;action?:number},target?:{general:boolean;ally:boolean}):0|65539|65540 {
  return !object.alive||object.action===32||!target?0:nativeMagicCollision(object.flags,target.general,target.ally,object.z);
}

/** The SO reserves handles 1/2 for its two generals. Soldier targets live in
 * a separate handle namespace from the skill's own transient draw objects. */
function targetSnapshot(unit:BattleUnit,casterSide:BattleUnit['side']) {
  const fallback=projectBattleCell(unit.x,unit.y);
  const position=unit.casualty?.flight??{x:unit.movement?.px??(fallback.x*96+48)*65536,y:unit.movement?.py??(fallback.y*72+36)*65536,z:0};
  return {id:unit.general?(unit.side===casterSide?1:2):100000+unit.id,
    general:unit.general,x:position.x,y:position.y,z:position.z,alive:true,hp:unit.hp,facing:(unit.movement?.facing??0)/65536};
}

/** Original ExplodeRound creates point-collision objects around the caster.
 * It never applies one probabilistic area pulse to the entire army. */
export function advanceBattleExplode(b:BattleState,death:(target:BattleUnit,caster:BattleUnit)=>void,locked:(unit:BattleUnit)=>boolean):void {
  const script=b.activeScript;if(script?.kind!=='native-explode')return;
  const s=script.runtime,caster=b.units.find(u=>u.id===script.casterId);
  if(!caster){b.activeScript=undefined;return;}
  s.origin={x:caster.movement!.px,y:caster.movement!.py,z:0};
  const targetUnits=new Map(b.units.map(u=>[u.general?(u.side===script.side?1:2):100000+u.id,u]));
  const emit=(event:{host?:number;args:(number|string)[]})=>{
    if(event.host===289)caster.movement!.clock!.deferred=(caster.movement!.clock!.deferred+40*Number(event.args[1]))|0;
    if(event.host===293) {
      const unit=targetUnits.get(Number(event.args[0]));if(!unit?.general)return;
      const result=nativeMagicDirectHit(unit.hp,b.commanders[unit.side].charge??0,Number(event.args[2]),locked(unit));
      unit.hp=result.hp;b.commanders[unit.side].charge=result.charge;
      if(unit.hp===0&&unit.action!=='death'){unit.action='death';unit.actionTick=0;death(unit,caster);}
    }
  };
  nativeAdvanceMagicExplode(s,b.opponentAI!.rng,emit,b.units.map(u=>targetSnapshot(u,script.side)));
  const occupants=new Map<string,BattleUnit>();
  for(const unit of b.units)if(unit.hp>0&&!unit.escaped&&!unit.movement?.exiting) {
    const cell=battleMovementCell(unit);occupants.set(`${cell.x},${cell.y}`,unit);
  }
  for(const object of s.objects)if(object.alive&&object.callback===8001) {
    const x=Math.trunc((object.x>>16)/96),y=Math.trunc((object.y>>16)/72),target=occupants.get(`${x},${y}`);
    if(!target||target.hp<=0||!battleExplodeCollision(object,{general:target.general,ally:target.side===script.side}))continue;
    // 0x40A8CC sends 65539 to a soldier before it starts callback 8001.
    if(!target.general){target.hp=0;target.action='death';target.actionTick=0;death(target,caster);}
    nativeExplodeHit(s,object.handle,targetSnapshot(target,script.side),script.damage,b.opponentAI!.rng,emit);
  }
  if(s.phase==='done')b.activeScript=undefined;
}
