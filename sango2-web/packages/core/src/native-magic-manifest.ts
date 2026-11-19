import manifest from './native-magic-manifest.json';

/** The manifest is generated from magic.csv, native AI flags and script links. */
export type NativeMagicEffectType = 'heal' | 'projectile' | 'area' | 'reinforce' | 'status';
export type NativeMagicEvidence = 'verified' | 'inferred';
export interface NativeMagicDefinition {
  sequence:number; name:string; mp:number; power:number; attack:number; script:number;
  attrib:string; active:string; flags:number; effectType:NativeMagicEffectType;
  evidenceLevel:NativeMagicEvidence; scriptSymbol?:string;
}
export const NATIVE_MAGIC_MANIFEST:Readonly<Record<number,NativeMagicDefinition>> =
  Object.fromEntries((manifest as NativeMagicDefinition[]).map(m=>[m.sequence,m]));
export function nativeMagicDefinition(sequence:number):NativeMagicDefinition|undefined {
  return NATIVE_MAGIC_MANIFEST[sequence];
}
