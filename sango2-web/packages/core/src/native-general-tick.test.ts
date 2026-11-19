import {describe,it,expect} from 'vitest';
import vectors from '../fixtures/native-general-tick-vectors.json';
import {nativeGeneralTick} from './native-general-tick';

describe('general update charge/recovery prefix from original EXE',()=>{
  for(const [index,{input,native}] of vectors.cases.entries())it(`native state ${index}`,()=>{
    const state=structuredClone(input);nativeGeneralTick(state);
    expect({charge:state.charge,hp:state.hp,mp:state.mp,recoveryClock:state.recoveryClock}).toEqual(native);
  });
});
