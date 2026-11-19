import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {NATIVE_AI_PARAMETERS,nativeRandom,nativeBelow,nativeWeightedChoice,nativeStrategyDecision,nativeCanDispatch,nativeOfficerReady,nativeNextDecisionCountdown,type NativeRandomState,type NativeStrategySnapshot,type NativeCandidate} from './native-strategic-ai';
import {nativeTacticalWeights,nativeSkillWeights,nativeCommanderWeights,nativeFormationWeights,type NativeTacticalObservation,type NativeSkillChoice} from './native-tactical-ai';

const vectors=JSON.parse(readFileSync(new URL('../fixtures/native-ai-vectors.json',import.meta.url),'utf8')) as {
  exeSha256:string;parameters:number[][];rngCases:{input:NativeRandomState;outputs:number[];state:NativeRandomState}[];
  strategyCases:{input:NativeStrategySnapshot;native:{candidates:NativeCandidate[];chosen:number;rngAfterGeneration:NativeRandomState;rngAfterChoice:NativeRandomState;cooperationComparisons:boolean[]}}[];
  tacticalCases:{input:NativeTacticalObservation;weights:number[]}[];
  skillCases:{input:{skills:NativeSkillChoice[];mp:number;hpRatio:number;troopRatio:number;enemyHpRatio:number;distanceX:number;counts:{line:number;edges:number;near:number;enemyTroops:number}};weights:number[]}[];
  commanderCases:{input:{rng:NativeRandomState;members:Parameters<typeof nativeCommanderWeights>[0];uniform:boolean;uncappedLeader:boolean};native:{chosen:number;rng:NativeRandomState}}[];
  formationCases:{input:{rng:NativeRandomState;troops:number;capacity:number;unitMask:number;unitClass:number;learned:number};native:{weights:number[];chosen:number;rng:NativeRandomState}}[];
};
describe('original x86 strategic AI differential oracle',()=>{
  it('uses the original five TYPE parameter blocks and executable fingerprint',()=>{
    expect(vectors.exeSha256).toBe('1098558aaea96ae552753df786a8d3910df08fda11c8219dfa133ca001d8e419');
    expect(NATIVE_AI_PARAMETERS).toEqual(vectors.parameters);
  });
  it.each(vectors.rngCases)('matches 100 original RNG outputs including zero shift: $input',v=>{
    const state:NativeRandomState=[...v.input];
    expect(v.outputs.map(()=>nativeRandom(state))).toEqual(v.outputs);expect(state).toEqual(v.state);
    const before=[...state];expect(nativeBelow(state,0)).toBe(0);expect(state).toEqual(before);
  });
  it.each(vectors.strategyCases.map((v,index)=>({...v,index})))('matches native candidate order, choice and both RNG states: $index',({input,native})=>{
    const decision=nativeStrategyDecision({...input,cooperationComparisons:native.cooperationComparisons});
    expect(decision.candidates).toEqual(native.candidates);
    expect(decision.rngAfterGeneration).toEqual(native.rngAfterGeneration);
    expect(decision.chosen).toBe(native.chosen);expect(decision.rngAfterChoice).toEqual(native.rngAfterChoice);
    expect(decision.unresolvedCooperationReads).toBe(0);
  });
  it('reports original undefined stack reads instead of claiming portable joint-attack parity',()=>{
    const fixture=vectors.strategyCases.find(v=>v.native.cooperationComparisons.length>0)!;
    expect(nativeStrategyDecision(fixture.input).unresolvedCooperationReads).toBe(fixture.native.cooperationComparisons.length);
  });
  it.each((vectors.tacticalCases??[]).map((v,index)=>({...v,index})))('matches original seven tactical action weights: $index',({input,weights})=>{
    expect(nativeTacticalWeights(input)).toEqual(weights);
  });
  it.each((vectors.skillCases??[]).map((v,index)=>({...v,index})))('matches original eight-slot skill choice weights: $index',({input:o,weights})=>{
    expect(nativeSkillWeights(o.skills,o.mp,o.hpRatio,o.troopRatio,o.enemyHpRatio,o.distanceX,o.counts)).toEqual(weights);
  });
  it.each((vectors.commanderCases??[]).map((v,index)=>({...v,index})))('matches original commander selection and RNG: $index',({input:o,native})=>{
    const rng:NativeRandomState=[...o.rng];
    expect(nativeWeightedChoice(nativeCommanderWeights(o.members,o.uniform,o.uncappedLeader),rng)).toBe(native.chosen);expect(rng).toEqual(native.rng);
  });
  it.each((vectors.formationCases??[]).map((v,index)=>({...v,index})))('matches original formation weights, selection and RNG: $index',({input:o,native})=>{
    const rng:NativeRandomState=[...o.rng],weights=nativeFormationWeights(o.troops,o.capacity,o.unitMask,o.unitClass,o.learned);
    expect(weights).toEqual(native.weights);expect(Math.max(0,nativeWeightedChoice(weights,rng))).toBe(native.chosen);expect(rng).toEqual(native.rng);
  });
  it('checks all inclusive readiness thresholds and global/owner army limits',()=>{
    const g={hp:30,maxHp:100,mp:20,maxMp:100,troops:50,maxTroops:100,reserve:0,maxReserve:0};
    expect(nativeOfficerReady(g,0)).toBe(true);
    for(const key of ['hp','mp','troops'] as const)expect(nativeOfficerReady({...g,[key]:g[key]-1},0)).toBe(false);
    expect(nativeCanDispatch(6,1)).toBe(true);expect(nativeCanDispatch(7,1)).toBe(false);expect(nativeCanDispatch(6,2)).toBe(false);
  });
  it('retains action-specific callback delays including no-action countdown',()=>{
    expect(nativeNextDecisionCountdown(2)).toBe(1);expect(nativeNextDecisionCountdown(1)).toBe(120);
    expect(nativeNextDecisionCountdown(0)).toBe(119);expect(nativeNextDecisionCountdown(1,3)).toBe(720);
    expect(nativeNextDecisionCountdown(1,7)).toBe(600);expect(nativeNextDecisionCountdown(1,4)).toBe(960);
  });
});
