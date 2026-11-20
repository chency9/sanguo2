import {describe,it,expect} from 'vitest';
import vectors from '../fixtures/native-magic-round-host-vectors.json';
import {nativeMagicDirectHit} from './native-magic-shoot';
import {nativeExplodeAttach} from './native-magic-explode';
import {battleExplodeCollision} from './battle-explode';

describe('ExplodeRound host 21 original fixed-point attachment',()=>{
  it.each(vectors.attachments)('angle=$input.facing radius=$input.distance origin=$input.x/$input.y',({input,native})=>{
    const result=nativeExplodeAttach(input,input.facing,input.distance,input.height);
    expect(result).toEqual({x:native.x,y:native.y,z:native.z});
    expect(native.rng).toEqual([0x12345678,0x87654321]);
  });
});

describe('ExplodeRound original point collision and callback dispatch',()=>{
  it.each(vectors.collisions)('flags=$input.flags general=$input.general ally=$input.ally z=$input.z action=$input.action occupied=$input.occupied',({input,native})=>{
    const result=battleExplodeCollision({alive:true,flags:input.flags,z:input.z,action:input.action},
      input.occupied?{general:input.general,ally:input.ally}:undefined);
    const targetEvent=native.events.find(event=>event.kind==='target');
    expect(result).toBe(targetEvent?.code??0);
    if(result) {
      // Native dispatch sends the target event before constructing callback
      // 8001. The callback's SO execution is covered by a separate VM oracle.
      expect(native.events.map(event=>event.kind)).toEqual(['target','callback']);
      expect(native.events.find(event=>event.kind==='callback')?.args).toEqual(['caster-object',8001,3,2]);
    } else expect(native.events).toEqual([]);
    expect(native.rng).toEqual([0x12345678,0x87654321]);
  });
});

describe('ExplodeRound direct Hurt original x86 boundary',()=>{
  it.each(vectors.hurts)('HP=$input.hp damage=$input.damage locked=$input.locked charge=$input.charge',({input,native})=>{
    // The actual battle adapter uses this same direct-Hurt helper. A null
    // source supplies neither ordinary-attack RNG nor charge reduction.
    const result=nativeMagicDirectHit(input.hp,input.charge,input.damage,input.locked);
    expect({hp:result.hp,charge:result.charge}).toEqual({hp:native.hp,charge:native.charge});
    if(native.hp>0)expect(result.actions).toEqual(native.actions);
    // The source death event is observed after HP reaches zero; casualty
    // physics is separately exercised by the real battle integration tests.
    expect(native.deaths).toEqual(!input.locked&&result.hp===0?[65539]:[]);
    expect(native.rng).toEqual([0x12345678,0x87654321]);
  });
});
