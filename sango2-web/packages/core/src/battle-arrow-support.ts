import type {BattleState,BattleUnit} from './battle';
import {battleMovementCell} from './battle-movement';
import {nativeAdvanceMagicArrowSupport,nativeArrowSupportCollision,nativeArrowSupportObjectEvent,type NativeArrowSupportTarget} from './native-magic-arrow-support';
import {nativeMagicDirectHit} from './native-magic-shoot';
import {emitBattleSound} from './battle-audio-events';
import {emitBattleDamageAudio} from './battle-hit-audio';

/** ArrowSupport's random living-soldier query retains the native slot order.
 * Occupancy is a separate host275 input; casualties remain addressable by
 * their saved handles while FireMan follows their original body position. */
export function advanceBattleArrowSupport(b:BattleState,death:(target:BattleUnit,caster:BattleUnit)=>void,locked:(unit:BattleUnit)=>boolean,sourceTick:number):void {
  const script=b.activeScript;if(script?.kind!=='native-arrow-support')return;
  const s=script.runtime,caster=b.units.find(u=>u.id===script.casterId);
  if(!caster){b.activeScript=undefined;return;}
  const handle=(u:BattleUnit)=>u.general?(u.side===script.side?1:2):100000+u.id;
  const snapshot=(u:BattleUnit):NativeArrowSupportTarget=>{
    const p=u.casualty?.flight??{x:u.movement!.px,y:u.movement!.py,z:0};
    return {id:handle(u),general:u.general,alive:u.hp>0&&!u.escaped&&!u.movement?.exiting,hp:u.hp,
      x:p.x,y:p.y,z:p.z,facing:(u.movement?.facing??0)/65536};
  };
  s.origin={x:caster.movement!.px,y:caster.movement!.py,z:0};
  const enemy=b.units.find(u=>u.general&&u.side!==script.side)!;
  s.target={x:enemy.movement!.px,y:enemy.movement!.py,z:0};
  const targetUnits=new Map(b.units.map(u=>[handle(u),u])),occupants=new Map<string,BattleUnit>();
  for(const unit of b.units)if(unit.hp>0&&!unit.escaped&&!unit.movement?.exiting){const c=battleMovementCell(unit);occupants.set(`${c.x},${c.y}`,unit);}
  const targets=b.units.filter(u=>u.general||u.side!==script.side).sort((a,c)=>Number(c.general)-Number(a.general)||(a.nativeSoldierSlot??a.id)-(c.nativeSoldierSlot??c.id)).map(snapshot);
  nativeAdvanceMagicArrowSupport(s,b.opponentAI!.rng,event=>{
    if(event.host===769)emitBattleSound(b,String(event.args[0]),Number(event.args[1]),sourceTick);
    if(event.host===768)emitBattleSound(b,String(event.args[1]),Number(event.args[2]),sourceTick);
    if(event.host===289)caster.movement!.clock!.deferred=(caster.movement!.clock!.deferred+40*Number(event.args[1]))|0;
    if(event.host===293) {
      const unit=targetUnits.get(Number(event.args[0]));if(!unit?.general)return;
      const result=nativeMagicDirectHit(unit.hp,b.commanders[unit.side].charge??0,Number(event.args[2]),locked(unit));
      unit.hp=result.hp;b.commanders[unit.side].charge=result.charge;
      const snapshot=s.targets.find(p=>p.id===handle(unit));if(snapshot){snapshot.hp=unit.hp;snapshot.alive=unit.hp>0&&!unit.escaped;}
      if(result.actions.length)emitBattleDamageAudio(b,unit,sourceTick);
      if(unit.hp===0&&unit.action!=='death'){unit.action='death';unit.actionTick=0;death(unit,caster);}
    }
  },targets,[...occupants].map(([key,u])=>{const [x,y]=key.split(',').map(Number);return {x,y,handle:handle(u)};}));
  for(const object of s.objects)if(object.alive&&[6001,6002].includes(object.callback)) {
    const x=Math.trunc((object.x>>16)/96),y=Math.trunc((object.y>>16)/72),unit=occupants.get(`${x},${y}`);
    if(!unit||unit.hp<=0||!nativeArrowSupportCollision(object,{general:unit.general,ally:unit.side===script.side}))continue;
    // Original generic 65539 precedes the source SO callback; it is the
    // only soldier kill here. There is no probability or army-wide pulse.
    if(!unit.general){unit.hp=0;unit.action='death';unit.actionTick=0;death(unit,caster);}
    nativeArrowSupportObjectEvent(s,object.handle,object.callback as 6001|6002,snapshot(unit));
  }
  if(s.phase==='done')b.activeScript=undefined;
}
