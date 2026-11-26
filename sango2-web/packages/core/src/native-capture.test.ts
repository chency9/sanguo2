import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import type {NativeRandomState} from './native-strategic-ai';
import {nativeCapturePersuasion,nativeResolveAICaptives,nativePreparePlayerCaptive,nativePlayerCaptiveDecision,nativeCapturedJoinLoyalty,nativeCaptiveDefeatCondition,type NativeCaptureCandidate,type NativePlayerCaptive} from './native-capture';

const vectors=JSON.parse(readFileSync(new URL('../fixtures/native-capture-vectors.json',import.meta.url),'utf8')) as {
  persuasionCases:{input:NativeCaptureCandidate&{rng:NativeRandomState};native:{accepted:boolean;reason:number;rng:NativeRandomState}}[];
  aiCases:{input:{candidates:NativeCaptureCandidate[];winnerHasCity:boolean;rng:NativeRandomState};native:{statuses:number[];rng:NativeRandomState}}[];
  playerCases:{input:{candidates:NativeCaptureCandidate[];choice:'yield'|'kill'|'free';rng:NativeRandomState};native:{current:NativePlayerCaptive|null;statuses:number[];advance:boolean;rngBeforeChoice:NativeRandomState;rng:NativeRandomState}}[];
  joinCases:{input:{loyalty:number;rng:NativeRandomState};native:{loyalty:number;owner:string;status:number;active:number;reserve:number;hp:number;mp:number;equipment:number[];rng:NativeRandomState}}[];
  penaltyCases:{input:{status:number;morale:number;loyalty:number;constancy:number;rng:NativeRandomState};native:{morale:number;loyalty:number;rng:NativeRandomState}}[];
};
describe('original 1.05+ prisoner decisions',()=>{
  it.each(vectors.persuasionCases.map((v,index)=>({...v,index})))('matches original persuasion and exact short-circuit RNG $index',({input:o,native})=>{
    const rng:NativeRandomState=[...o.rng];expect({...nativeCapturePersuasion('winner',o,rng),rng}).toEqual(native);
  });
  it.each(vectors.aiCases.map((v,index)=>({...v,index})))('matches AI prisoner/ruler disposition in roster order $index',({input:o,native})=>{
    const rng:NativeRandomState=[...o.rng],result=nativeResolveAICaptives('winner',o.winnerHasCity,o.candidates,rng);
    expect({statuses:result.map(m=>m.status),rng}).toEqual(native);
  });
  it.each(vectors.playerCases.map((v,index)=>({...v,index})))('prepares the original current prisoner and reuses its stored decision $index',({input:o,native})=>{
    const rng:NativeRandomState=[...o.rng],current=nativePreparePlayerCaptive('winner',o.candidates,rng);
    expect(current).toEqual(native.current);expect(rng).toEqual(native.rngBeforeChoice);
    const statuses=o.candidates.map(c=>c.status);let advance=false;
    if(current){const choice=nativePlayerCaptiveDecision(current,o.choice);statuses[current.index]=choice.status;advance=choice.advance;}
    expect({statuses,advance,rng}).toEqual({statuses:native.statuses,advance:native.advance,rng:native.rng});
  });
  it.each(vectors.joinCases)('changes only the joining loyalty, preserving troops/wounds/equipment at loyalty $input.loyalty',({input:o,native})=>{
    expect(nativeCapturedJoinLoyalty(o.loyalty)).toBe(native.loyalty);
    expect(native).toMatchObject({owner:'winner',status:1,active:17,reserve:9,hp:0,mp:17,equipment:[12,34,56],rng:o.rng});
  });
  it.each(vectors.penaltyCases.map((v,index)=>({...v,index})))('matches original one-time knocked-down prisoner morale and loyalty writes $index',({input:o,native})=>{
    const result=o.status===3?nativeCaptiveDefeatCondition(o.morale,o.loyalty,o.constancy):{morale:o.morale,loyalty:o.loyalty};
    expect({...result,rng:o.rng}).toEqual(native);
  });
  it('never rerolls a rejected recruit choice and leaves its captive selected',()=>{
    const current:NativePlayerCaptive={id:'loyal',index:0,accepted:false,reason:16};
    expect(nativePlayerCaptiveDecision(current,'yield')).toEqual({status:3,advance:false});
    expect(nativePlayerCaptiveDecision(JSON.parse(JSON.stringify(current)),'yield')).toEqual({status:3,advance:false});
    expect(nativePlayerCaptiveDecision(current,'free')).toEqual({status:2,advance:true});
  });
});
