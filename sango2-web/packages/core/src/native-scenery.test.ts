import {describe,it,expect} from 'vitest';
import fixtures from '../fixtures/native-scenery-vectors.json';
import {nativeSceneryTerrain,nativeSceneryVariant} from './native-scenery';

describe('native terrain classification and scenery RNG',()=>{
  it.each(fixtures.terrainCases)('maps mask $mask with city capacity $capacity',c=>{
    expect(nativeSceneryTerrain(c.mask,c.capacity??undefined)).toBe(c.terrain);
  });
  it.each(fixtures.variantCases)('matches original MAPMODE $mode and saved RNG $rng',c=>{
    const rng:[number,number]=[c.rng[0],c.rng[1]],mode=c.mode===1?'a':c.mode===2?'b':'random';
    expect(nativeSceneryVariant(mode,rng)).toBe(c.native.variant);
    expect(rng).toEqual(c.native.rng);
  });
});
