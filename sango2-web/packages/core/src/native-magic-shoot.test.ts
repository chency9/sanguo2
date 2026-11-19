import {describe,it,expect} from 'vitest';
import scriptVectors from '../fixtures/native-magic-shoot-script-vectors.json';
import impactVectors from '../fixtures/native-magic-impact-vectors.json';
import {nativeCreateMagicShoot,nativeAdvanceMagicShoot,nativeAdvanceMagicWeapon,nativeMagicWeaponHit,nativeMagicCollision,nativeMagicDirectHit,type NativeMagicShootEvent} from './native-magic-shoot';
import type {NativeRandomState} from './native-strategic-ai';

const scripts:Record<string,number>={Magic2:502,Magic14:514,Magic52:552,Magic58:558};
describe('ShootObject main coroutine against original EXE VM + SO',()=>{
  it.each(scriptVectors.cases)('$input.name side=$input.side x=$input.x rng=$input.rng',({input,native})=>{
    const s=nativeCreateMagicShoot(scripts[input.name],{x:input.x*65536,y:input.y*65536,z:0},input.side as 0|1);
    const rng=[...input.rng] as NativeRandomState,events:NativeMagicShootEvent[]=[];
    for(let i=0;i<1000&&s.phase!=='done';i++) {
      nativeAdvanceMagicShoot(s,rng,e=>events.push(e));
      if(s.weapon)nativeAdvanceMagicWeapon(s.weapon);
    }
    expect(s.phase).toBe('done');expect(s.age).toBe(native.ticks);
    expect(events).toEqual(native.events);expect(rng).toEqual(native.rng);
    expect(s.weapon).toMatchObject({x:native.objects['3'].x,y:native.objects['3'].y,z:native.objects['3'].z,alive:false});
  });
});
describe('original magic object collision and host damage rules',()=>{
  it.each(impactVectors.collisions)('collision flags=$input.flags general=$input.general ally=$input.ally z=$input.z',({input,native})=>{
    const event=nativeMagicCollision(input.flags,input.general,input.ally,input.z);
    expect(event).toBe(native.events.length?native.events[0][1]:0);
  });
  it.each(impactVectors.hurts)('direct damage $input',({input,native})=>{
    expect(nativeMagicDirectHit(input.hp,input.charge,input.damage,input.locked,input.percent)).toEqual(native);
  });
  it.each([0,1,2] as const)('uses source fade timing for style %s',style=>{
    const s=nativeCreateMagicShoot([552,514,558][style],{x:1488*65536,y:468*65536,z:0},1),rng:NativeRandomState=[1,2];
    while(!s.weapon)nativeAdvanceMagicShoot(s,rng);
    const w=s.weapon;nativeMagicWeaponHit(w,style);
    const trace=[];
    for(let i=0;i<130;i++) {
      trace.push({alive:w.alive,fade:Math.trunc(w.fade),wait:w.fadeWait});
      if(!w.alive)break;nativeAdvanceMagicWeapon(w);
    }
    expect(trace).toEqual(impactVectors.fades[style]);
    expect(w.flags&0x1000000).toBe(0);
    expect(w.flags&0x2000000).toBe(style===2?0x2000000:0);
  });
  it.each(impactVectors.callbacks)('SO callback style=$input.style flaming=$input.flaming general=$input.general',({input,native})=>{
    const events=native.events;
    expect(events.some(e=>'host' in e&&e.host===293)).toBe(input.general);
    expect(events.some(e=>'host' in e&&e.host===295)).toBe(input.general&&input.style===1);
    if(input.general) {
      expect(events.find(e=>'host' in e&&e.host===293)?.args).toEqual([2,0,30]);
      expect(events.find(e=>'host' in e&&e.host===38)?.args).toEqual([3,input.style===2?16:2,input.style===2?8:1]);
    }
  });
});
