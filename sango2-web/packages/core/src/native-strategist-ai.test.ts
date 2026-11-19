import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {nativeChooseStrategy,nativeStrategistIndex,nativeStrategySucceeds,type NativeStrategySlot,type NativeStrategyChoice} from './native-strategist-ai';
import {nativeWeightedChoice,type NativeRandomState} from './native-strategic-ai';

const vectors=JSON.parse(readFileSync(new URL('../fixtures/native-strategist-vectors.json',import.meta.url),'utf8')) as {
  exeSha256:string;
  choices:{input:{slots:NativeStrategySlot[];troops:number;rng:NativeRandomState};native:NativeStrategyChoice&{rng:NativeRandomState}}[];
  conflicts:{input:{own:Parameters<typeof nativeStrategySucceeds>[0];enemy:Parameters<typeof nativeStrategySucceeds>[1]};succeeds:boolean}[];
  advisors:{intelligence:number[];chosen:number}[];
  lotteries:{input:{weights:number[];rng:NativeRandomState};native:{slot:number;rng:NativeRandomState}}[];
};
describe('strategist original x86 differential oracle (explicit runtime rates)',()=>{
  it('pins the executable and exercises fallback, empty and zero-weight draws',()=>{
    expect(vectors.exeSha256).toBe('1098558aaea96ae552753df786a8d3910df08fda11c8219dfa133ca001d8e419');
    expect(vectors.choices.some(v=>v.native.weights.length===2&&v.native.slot!==-1)).toBe(true);
    expect(vectors.choices.some(v=>v.native.slot===-1)).toBe(true);
  });
  it.each(vectors.choices.map((v,index)=>({...v,index})))('matches both lotteries, stored slot, ID and RNG $index',({input,native})=>{
    const rng:NativeRandomState=[...input.rng];
    const {rng:expected,...choice}=native;
    expect(nativeChooseStrategy(input.slots,input.troops,rng)).toEqual(choice);
    expect(rng).toEqual(expected);
  });
  it.each(vectors.conflicts.map((v,index)=>({...v,index})))('matches cancellation and strict intelligence tie $index',({input,succeeds})=>{
    expect(nativeStrategySucceeds(input.own,input.enemy)).toBe(succeeds);
  });
  it.each(vectors.advisors.map((v,index)=>({...v,index})))('matches advisor roster ties $index',({intelligence,chosen})=>{
    expect(nativeStrategistIndex(intelligence)).toBe(chosen);
  });
  it.each(vectors.lotteries.map((v,index)=>({...v,index})))('matches signed x86 lottery arithmetic $index',({input,native})=>{
    const rng:NativeRandomState=[...input.rng];
    expect(nativeWeightedChoice(input.weights,rng)).toBe(native.slot);
    expect(rng).toEqual(native.rng);
  });
});
