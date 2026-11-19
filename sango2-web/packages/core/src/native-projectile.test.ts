import {describe,it,expect} from 'vitest';
import vectors from '../fixtures/native-projectile-vectors.json';
import {nativeLaunchProjectile,nativeProjectileImpact,nativeAdvanceProjectile} from './native-projectile';
import {nativeAttackHits,type NativeCombatUnit} from './native-combat';
import type {NativeRandomState} from './native-strategic-ai';

describe('original 0x43D5BF / 0x43E28B projectile traces',()=>{
  it.each(vectors.cases.map((v,id)=>({...v,id})))('matches flight, collision, fading and RNG for trace $id',({input:o,native})=>{
    const rng=[...o.rng] as NativeRandomState,p=nativeLaunchProjectile(o.unit,o)!;
    expect(p).toEqual(native.initial);
    if(o.impact!==undefined)nativeProjectileImpact(p,!!o.impact,rng);
    if(o.life!==undefined)p.life=o.life;
    const messages:number[]=[];
    const combat=(general=false):NativeCombatUnit=>({general,reserve:o.reserve??false,settled:o.settled??true,strength:o.strength??80,power:o.power??150,flags:0,hitBonus:0});
    for(let step=0;step<native.trace.length;step++) {
      if(step)nativeAdvanceProjectile(p,rng,(x,y)=>{
        if(!o.cell||x!==o.cell[0]||y!==o.cell[1])return 'empty';
        if(o.occupant!=='enemy')return o.occupant as 'self'|'ally';
        const hit=nativeAttackHits(combat(),combat(o.general),rng);messages.push(hit?65540:65546);return hit?'hit':'miss';
      });
      expect({state:p,rng,messages},`source update ${step}`).toEqual(native.trace[step]);
    }
  });
  it('does not invent projectiles for melee-only troop types',()=>{
    for(let unit=0;unit<13;unit++)expect(nativeLaunchProjectile(unit,{x:0,y:0,z:0,facing:0})?.object??0).toBe(vectors.units[unit]);
  });
});
