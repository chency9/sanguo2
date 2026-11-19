import type {GeneralDefinition} from '@sango2/content';
import type {GeneralState} from './index';
import {nativeApplyItem,nativeItemTable,type NativeItemOfficer,type NativeItem} from './native-items';
import {nativeFormationMask,NATIVE_FORMATIONS} from './battle-formations';
import {officerLevel,officerMaxHp,officerMaxMp} from './native-progression';
import {nativeAttackAction} from './native-attack-animation';

export type OfficerEquipment=Pick<NativeItemOfficer,'strength'|'intelligence'|'speed'|'forceMask'|'battleMask'|'weaponId'|'horseId'|'thingId'>&{legacyEquipment?:number[]};
export const officerStrength=(g:GeneralState,d:GeneralDefinition)=>g.strength??d.strength;
export const officerIntelligence=(g:GeneralState,d:GeneralDefinition)=>g.intelligence??d.intelligence;
export const officerSpeed=(g:GeneralState,d:GeneralDefinition)=>g.speed??d.speed??0;
export const nativeForceNames=['刀','槍','關','弓','鍊','飛','武','蠻','鐵','籐','賊','弩','女'] as const;
export function officerForceMask(g:GeneralState,d:GeneralDefinition) {
  return g.forceMask??d.forceMask??(1<<Math.max(0,nativeForceNames.indexOf(d.unit as typeof nativeForceNames[number])));
}
export function officerFormations(g:GeneralState,d:GeneralDefinition):string[] {
  return g.battleMask===undefined?d.formations:NATIVE_FORMATIONS.filter(f=>g.battleMask!&(1<<f.nativeIndex)).map(f=>f.id);
}
/** Legacy saves retain numerical state; infer only the missing equipment slots.
 * New games explicitly apply their initial equipment from empty slots below. */
export function materializeOfficer(g:GeneralState,d:GeneralDefinition,items:readonly Record<string,string>[]):NativeItemOfficer {
  const names=new Map(items.map(row=>[row.NAME,Number(row.SEQUENCE)]));
  const eligible=(name:string)=>{const id=names.get(name)??0;return officerLevel(g,d)>=(Number(items.find(row=>Number(row.SEQUENCE)===id)?.LEVEL)||1)?id:0;};
  const state={level:officerLevel(g,d),strength:officerStrength(g,d),intelligence:officerIntelligence(g,d),speed:officerSpeed(g,d),
    maxHp:officerMaxHp(g,d),maxMp:officerMaxMp(g,d),hp:g.hp,mp:g.mp,morale:g.morale??80,loyalty:g.loyalty??90,fatigue:g.fatigue??0,
    forceMask:officerForceMask(g,d),battleMask:g.battleMask??(nativeFormationMask(d.formations)||1),
    weaponId:g.weaponId??eligible(d.weapon),horseId:g.horseId??eligible(d.horse),thingId:g.thingId??eligible(d.item)};
  // Old preview saves applied SPEED only. Remember that baseline so a later
  // swap never subtracts STR/INT/HP bonuses those saves never received.
  if(g.strength===undefined&&g.weaponId===undefined&&g.horseId===undefined&&g.thingId===undefined)
    g.legacyEquipment=[state.weaponId,state.horseId,state.thingId].filter(id=>id>0);
  return Object.assign(g,state) as GeneralState&NativeItemOfficer;
}
export function unloadOfficerEquipment(g:NativeItemOfficer,item:NativeItem) {
  const state=g as NativeItemOfficer&OfficerEquipment;
  if(state.legacyEquipment?.includes(item.id)) {
    nativeApplyItem(g,{...item,strength:0,intelligence:0,maxHp:0,maxMp:0,hp:0,mp:0,morale:0,loyalty:0,fatigue:0},true);
    state.legacyEquipment=state.legacyEquipment.filter(id=>id!==item.id);
  } else nativeApplyItem(g,item,true);
}
export function initializeOfficerEquipment(g:GeneralState,d:GeneralDefinition,items:readonly Record<string,string>[]) {
  Object.assign(g,{strength:d.strength,intelligence:d.intelligence,speed:0,weaponId:0,horseId:0,thingId:0});
  const state=materializeOfficer(g,d,items),table=nativeItemTable(items);
  for(const name of [d.weapon,d.horse,d.item]){const row=items.find(row=>row.NAME===name),item=table.find(item=>item.id===Number(row?.SEQUENCE));if(item)nativeApplyItem(state,item);}
}
/** Rendering and combat read the same effective equipment and attributes. */
export function officerDefinition(g:GeneralState,d:GeneralDefinition,items:readonly Record<string,string>[]):GeneralDefinition {
  const row=(slot:'weaponId'|'horseId'|'thingId',fallback:string)=>g[slot]===undefined?items.find(i=>i.NAME===fallback):items.find(i=>Number(i.SEQUENCE)===g[slot]);
  const weapon=row('weaponId',d.weapon),horse=row('horseId',d.horse),thing=row('thingId',d.item);
  let appearance=d.appearance;
  if(appearance&&(g.weaponId!==undefined||g.horseId!==undefined)) {
    const type=Number(weapon?.WEAPONTYPE)||0,body=600+((d.bodyType??1)>=1&&(d.bodyType??1)<=15?(d.bodyType??1)-1:14)*4+type;
    const timing=nativeAttackAction(body,false);
    appearance={...appearance,body,weapon:Number(weapon?.WEAPONOBJECT)||700,horse:Number(horse?.WEAPONOBJECT)||900,
      generalAttack:timing?{hitTick:timing.hitTicks[0],ticks:timing.ticks}:appearance.generalAttack};
  }
  return {...d,level:officerLevel(g,d),hp:officerMaxHp(g,d),mp:officerMaxMp(g,d),strength:officerStrength(g,d),intelligence:officerIntelligence(g,d),speed:officerSpeed(g,d),formations:officerFormations(g,d),
    weapon:g.weaponId===undefined?d.weapon:weapon?.NAME??'',horse:g.horseId===undefined?d.horse:horse?.NAME??'',item:g.thingId===undefined?d.item:thing?.NAME??'',appearance};
}
