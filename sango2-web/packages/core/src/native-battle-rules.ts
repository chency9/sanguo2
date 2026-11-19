/** Static EXE evidence: docs/REVERSE-ENGINEERING-2026-11-17.md.
 * Functions operate per native update; no real-time clock frequency is implied. */
import { NATIVE_MAGIC_MANIFEST, type NativeMagicDefinition } from './native-magic-manifest';
export const CHARGE_LIMIT=120000;
export const INITIAL_CHARGE=60000;
export type NativeMagicEffect = NativeMagicDefinition['effectType'];
export interface NativeMagic extends NativeMagicDefinition {
  /** Normalized target side used by the battle executor. */
  activeSide:'ally'|'enemy'|'both';
  /** Kept as a compatibility alias for the two paths with closed VM evidence. */
  verified?:'heal'|'projectile';
}
function activeSide(active:string):NativeMagic['activeSide'] {
  if(active.includes('我方')&&active.includes('敵我'))return 'both';
  if(active.includes('我方'))return 'ally';
  return 'enemy';
}
export const NATIVE_MAGIC:Readonly<Record<number,NativeMagic>> = Object.fromEntries(
  Object.values(NATIVE_MAGIC_MANIFEST).map(def=>[def.sequence,{
    ...def,
    activeSide:activeSide(def.active),
    verified:def.sequence===1?'heal':def.sequence===2?'projectile':undefined,
  }])
) as Readonly<Record<number,NativeMagic>>;
export function learnedMagicSequences(learnset:readonly {level:number;sequence:number}[],level:number):number[] {
  // 0x40A140 / 0x40A183: walk levels in ascending order, first match per level,
  // first eight source entries only. Learning levels are never skill IDs.
  const result:number[]=[];
  for(let n=1;n<=Math.min(level,99)&&result.length<8;n++) {
    const entry=learnset.slice(0,8).find(e=>e.level===n);
    if(entry?.sequence)result.push(entry.sequence);
  }
  return result;
}
export function commanderMagicSequences(rawSkill:string|undefined,level=0,learnset?:readonly {level:number;sequence:number}[]):number[] {
  const entries=learnset??(rawSkill??'').split(/\r?\n/).flatMap(line=>{
    const pair=line.trim().match(/^(\d+)\s*,\s*(\d+)(?:\s*,.*)?$/);
    return pair?[{level:Number(pair[1]),sequence:Number(pair[2])}]:[];
  });
  return learnedMagicSequences(entries,level);
}
export function knownMagicSequences(rawSkill:string|undefined,level=0,learnset?:readonly {level:number;sequence:number}[]):number[] {
  return commanderMagicSequences(rawSkill,level,learnset).filter(n=>NATIVE_MAGIC[n]);
}
export function chargeIncrement(strength:number,intelligence:number,modifier=0) {
  const rate=({'-3':50,'-2':66,'-1':76,'1':130,'2':150,'3':200} as Record<string,number>)[modifier]??100;
  return Math.trunc(Math.max(strength,intelligence)*rate/100);
}
/** 0x43BAE3 uses two integer divisions; the MP floor also applies at zero. */
export function nativeSkillCost(mp:number,charge:number,mpCost:number,power:number,costPercent=100) {
  const chargeCost=Math.trunc(Math.trunc(CHARGE_LIMIT*power/100)*costPercent/100);
  return {mp:Math.max(0,mp-mpCost),charge:Math.max(0,charge-chargeCost)};
}
/** 0x440F59: maximum capacity controls length as well as the fill ratio. */
export function nativeGaugeWidth(maximum:number,current:number) {
  const track=Math.min(107,Math.trunc(107*maximum/150));
  return {track,fill:maximum>0?Math.trunc(track*current/maximum):0};
}
