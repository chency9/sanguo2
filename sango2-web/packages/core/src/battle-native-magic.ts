import type {BattleState,BattleUnit} from './battle';
import {battleMovementCell} from './battle-movement';
import {nativeAdvanceMagicShoot,nativeAdvanceMagicWeapon,nativeMagicCollision,nativeMagicDirectHit,nativeMagicWeaponHit} from './native-magic-shoot';
import {nativeMagicDefinition} from './native-magic-manifest';
import {nativeCreateLockCamera,nativeAdvanceMagicCamera} from './native-magic-camera';
import {nativeAdvanceMagicHeal,validateNativeMagicHeal} from './native-magic-heal';
import {nativeReinforceDefinition,validateNativeMagicReinforce} from './native-magic-reinforce';
import {advanceBattleReinforce} from './battle-reinforce';
import {advanceBattleExplode} from './battle-explode';
import {nativeExplodeDefinition,validateNativeMagicExplode} from './native-magic-explode';
import {nativeAdvanceMagicRollTub,nativeRollTubDefinition,nativeRollTubHit,validateNativeMagicRollTub} from './native-magic-rolltub';
import {battleExplodeCollision} from './battle-explode';
import {emitBattleSound} from './battle-audio-events';
import {emitBattleDamageAudio} from './battle-hit-audio';
import {advanceBattleArrowSupport} from './battle-arrow-support';
import {nativeArrowSupportDefinition,validateNativeMagicArrowSupport} from './native-magic-arrow-support';

/** 0x43BA59/0x441E61: normal camera management yields to spell scripts. */
export function battleScriptCameraLocked(b:BattleState):boolean {
  const script=b.activeScript;
  return b.cameraRules==='native-script-v1'&&(script?.kind==='native-shoot'||script?.kind==='native-heal'||script?.kind==='native-reinforce'||(script?.kind==='native-explode'||script?.kind==='native-rolltub'||script?.kind==='native-arrow-support')&&script.runtime.cameraReleased!==true);
}

export function battleMagicLocked(b:BattleState,u:BattleUnit):boolean {
  const s=b.activeScript;
  return (s?.kind==='native-shoot'||s?.kind==='native-heal'||s?.kind==='native-reinforce'||s?.kind==='native-explode'||s?.kind==='native-rolltub'||s?.kind==='native-arrow-support')&&s.casterId===u.id&&s.runtime.casterLocked;
}
/** One source update, next to the unit clock. The original mixed object list,
 * child visual coroutines and their RNG interleaving are still separate work. */
export function advanceBattleNativeMagic(b:BattleState,death:(target:BattleUnit,caster:BattleUnit)=>void,sourceTick=b.tick*3):void {
  if(b.activeScript?.kind==='native-arrow-support'){advanceBattleArrowSupport(b,death,u=>battleMagicLocked(b,u),sourceTick);return;}
  if(b.activeScript?.kind==='native-rolltub') {
    const script=b.activeScript,s=script.runtime,caster=b.units.find(u=>u.id===script.casterId);
    if(!caster){b.activeScript=undefined;return;}
    s.origin={x:caster.movement!.px,y:caster.movement!.py,z:0};
    // SO 0x316A4 reads the enemy's x/y only at update 55. Later waves and
    // MoveCamera use those saved coordinates even if the general moves away.
    const enemy=b.units.find(u=>u.general&&u.side!==script.side)!;
    if(s.age<=55)s.target={x:enemy.movement!.px,y:enemy.movement!.py,z:0};
    const handle=(unit:BattleUnit)=>unit.general?(unit.side===script.side?1:2):100000+unit.id;
    const snapshot=(unit:BattleUnit)=>({id:handle(unit),general:unit.general,alive:unit.hp>0&&!unit.escaped,
      x:unit.movement!.px,y:unit.movement!.py,z:0});
    const targets=new Map(b.units.map(u=>[handle(u),u]));
    nativeAdvanceMagicRollTub(s,b.opponentAI!.rng,event=>{
      if(event.host===769)emitBattleSound(b,String(event.args[0]),Number(event.args[1]),sourceTick);
      if(event.host===768)emitBattleSound(b,String(event.args[1]),Number(event.args[2]),sourceTick);
      if(event.host===289)caster.movement!.clock!.deferred=(caster.movement!.clock!.deferred+40*Number(event.args[1]))|0;
      if(event.host===293) {
        const unit=targets.get(Number(event.args[0]));if(!unit?.general)return;
        const result=nativeMagicDirectHit(unit.hp,b.commanders[unit.side].charge??0,Number(event.args[2]),battleMagicLocked(b,unit));
        unit.hp=result.hp;b.commanders[unit.side].charge=result.charge;
        if(result.actions.length)emitBattleDamageAudio(b,unit,sourceTick);
        if(unit.hp===0&&unit.action!=='death'){unit.action='death';unit.actionTick=0;death(unit,caster);}
      }
    },b.units.map(snapshot));
    const occupants=new Map<string,BattleUnit>();
    for(const unit of b.units)if(unit.hp>0&&!unit.escaped&&!unit.movement?.exiting) {
      const cell=battleMovementCell(unit);occupants.set(`${cell.x},${cell.y}`,unit);
    }
    for(const object of s.objects)if(object.alive&&object.callback===39001) {
      const x=Math.trunc((object.x>>16)/96),y=Math.trunc((object.y>>16)/72),unit=occupants.get(`${x},${y}`);
      if(!unit||unit.hp<=0||!battleExplodeCollision(object,{general:unit.general,ally:unit.side===script.side}))continue;
      // 0x40A8CC sends soldier death 65539 before callback 39001. The
      // callback itself waits, creates fragments and applies its one hit.
      if(!unit.general){unit.hp=0;unit.action='death';unit.actionTick=0;death(unit,caster);}
      nativeRollTubHit(s,object.handle,snapshot(unit),script.damage);
    }
    if(s.phase==='done')b.activeScript=undefined;
    return;
  }
  if(b.activeScript?.kind==='native-explode') {
    advanceBattleExplode(b,death,unit=>battleMagicLocked(b,unit),sourceTick);
    return;
  }
  if(b.activeScript?.kind==='native-reinforce') {
    advanceBattleReinforce(b,sourceTick);
    return;
  }
  if(b.activeScript?.kind==='native-heal') {
    const script=b.activeScript,s=script.runtime,caster=b.units.find(u=>u.id===script.casterId)!;
    // Hosts 261/262 and 17/21 read current object coordinates at their call.
    s.origin={x:caster.movement!.px,y:caster.movement!.py,z:0};
    nativeAdvanceMagicHeal(s,b.opponentAI!.rng,caster,event=>{
      if(event.host===769)emitBattleSound(b,String(event.args[0]),Number(event.args[1]),sourceTick);
      // Host 289 -> 0x43AB60 adds 40*n to unit +60 (deferred decision),
      // not to its team's charge and not to an animation pose number.
      if(event.host===289)caster.movement!.clock!.deferred=(caster.movement!.clock!.deferred+40*Number(event.args[1]))|0;
    });
    if(s.phase==='done')b.activeScript=undefined;
    return;
  }
  const script=b.activeScript;if(script?.kind!=='native-shoot')return;
  const s=script.runtime,caster=b.units.find(u=>u.id===script.casterId)!;
  // Hosts 261/262 read the caster at source update 40; host 21 attaches to
  // its current full fixed-point coordinates at update 70, not cast time.
  if(!s.weapon)s.origin={x:caster.movement!.px,y:caster.movement!.py,z:0};
  nativeAdvanceMagicShoot(s,b.opponentAI!.rng,event=>{
    if(event.host===769)emitBattleSound(b,String(event.args[0]),Number(event.args[1]),sourceTick);
    if(b.cameraRules&&event.child==='LockCamera')s.cameraTrack=nativeCreateLockCamera(s.sideFlag,180,-120+s.cameraJitter);
  });
  const w=s.weapon;
  if(b.cameraRules&&s.cameraTrack&&s.camera&&w) {
    const enemy=b.units.find(u=>u.id===script.targetId)!;
    s.cameraTrack=nativeAdvanceMagicCamera(s.cameraTrack,s.camera,{x:w.x>>16,y:w.y>>16,alive:w.alive},
      {x:enemy.movement!.px>>16,y:enemy.movement!.py>>16});
  }
  if(w?.alive) {
    nativeAdvanceMagicWeapon(w);
    if(w.alive) {
      const x=Math.trunc((w.x>>16)/96),y=Math.trunc((w.y>>16)/72);
      // Same saved occupancy convention as ordinary projectiles. One actor
      // per source cell; display spacing never changes a magic collision.
      const occupants=new Map<string,BattleUnit>();
      for(const u of b.units)if(u.hp>0&&!u.escaped&&!u.movement?.exiting){const c=battleMovementCell(u);occupants.set(`${c.x},${c.y}`,u);}
      const target=occupants.get(`${x},${y}`);
      if(target&&nativeMagicCollision(w.flags,target.general,target.side===script.side,w.z)) {
        if(target.general) {
          const c=b.commanders[target.side],result=nativeMagicDirectHit(target.hp,c.charge??0,script.damage,battleMagicLocked(b,target),s.style===1?50:0);
          target.hp=result.hp;c.charge=result.charge;
          if(result.actions.length)emitBattleDamageAudio(b,target,sourceTick);
          nativeMagicWeaponHit(w,s.style);
        } else target.hp=0; // Generic collision event 65539, before SO callback.
        b.effects.push({id:b.nextId++,kind:'hit',x:target.x,y:target.y-60,toX:target.x,toY:target.y-60,ticks:8,targetId:target.id,targetZ:60});
        if(target.hp===0){target.action='death';target.actionTick=0;death(target,caster);}
      }
    }
  }
  if(s.phase==='done')b.activeScript=undefined;
}

export function validateBattleNativeMagic(b:BattleState,fail:()=>never):void {
  if(b.magicRules!==undefined&&(b.magicRules!=='native-shoot-v1'||b.movementRules!=='native-grid-v3'))fail();
  if(b.cameraRules!==undefined&&(b.cameraRules!=='native-script-v1'||b.movementRules!=='native-grid-v3'))fail();
  if(b.healRules!==undefined&&(b.healRules!=='native-heal-v1'||b.movementRules!=='native-grid-v3'))fail();
  if(b.reinforceRules!==undefined&&(b.reinforceRules!=='native-reinforce-v1'||b.movementRules!=='native-grid-v3'))fail();
  if(b.explodeRules!==undefined&&(b.explodeRules!=='native-explode-v1'||b.movementRules!=='native-grid-v3'))fail();
  if(b.rollTubRules!==undefined&&(b.rollTubRules!=='native-rolltub-v1'||b.movementRules!=='native-grid-v3'))fail();
  if(b.arrowSupportRules!==undefined&&(b.arrowSupportRules!=='native-arrow-support-v1'||b.movementRules!=='native-grid-v3'))fail();
  if(b.activeScript?.kind==='native-arrow-support') {
    const script=b.activeScript,definition=nativeArrowSupportDefinition(script.magic),caster=b.units.find(u=>u.id===script.casterId),r=script.runtime;
    if(!b.arrowSupportRules||!definition||!caster?.general||caster.side!==script.side||r.script!==definition.script||r.sequence!==script.magic||r.sideFlag!==(script.side==='attacker'?1:0)||r.attack!==nativeMagicDefinition(script.magic)?.attack||r.age>b.tick*3||!r.nativeObjects)fail();
    validateNativeMagicArrowSupport(r,fail);return;
  }
  if(b.activeScript?.kind==='native-rolltub') {
    const script=b.activeScript,definition=nativeRollTubDefinition(script.magic),caster=b.units.find(u=>u.id===script.casterId);
    if(!b.rollTubRules||!definition||!caster?.general||caster.side!==script.side||script.runtime.script!==definition.script||script.runtime.sequence!==script.magic||script.runtime.sideFlag!==(script.side==='attacker'?1:0)||script.damage!==nativeMagicDefinition(script.magic)?.attack||script.runtime.age>b.tick*3)fail();
    validateNativeMagicRollTub(script.runtime,fail);return;
  }
  if(b.activeScript?.kind==='native-explode') {
    const script=b.activeScript,definition=nativeExplodeDefinition(script.magic),caster=b.units.find(u=>u.id===script.casterId);
    if(!b.explodeRules||!definition||!caster?.general||caster.side!==script.side||script.runtime.script!==definition.script||script.runtime.sequence!==script.magic||script.runtime.sideFlag!==(script.side==='attacker'?1:0)||script.damage!==nativeMagicDefinition(script.magic)?.attack||script.runtime.age>b.tick*3)fail();
    validateNativeMagicExplode(script.runtime,fail);return;
  }
  if(b.activeScript?.kind==='native-reinforce') {
    const script=b.activeScript,definition=nativeReinforceDefinition(script.magic),caster=b.units.find(u=>u.id===script.casterId);
    if(!b.reinforceRules||!definition||script.magic!==definition.sequence||!['attacker','defender'].includes(script.side)||!caster?.general||caster.side!==script.side||script.runtime.sideFlag!==(script.side==='attacker'?1:0)||script.runtime.script!==definition.script||script.runtime.sequence!==script.magic||script.runtime.age>b.tick*3)fail();
    validateNativeMagicReinforce(b.activeScript.runtime,fail);return;
  }
  if(b.activeScript?.kind==='native-heal') {
    const script=b.activeScript,caster=b.units.find(u=>u.id===script.casterId),definition=nativeMagicDefinition(script.magic);
    if(!b.healRules||!caster?.general||caster.side!==script.side||![1,60].includes(script.magic)||definition?.effectType!=='heal')fail();
    validateNativeMagicHeal(script.runtime,fail);
    if(script.runtime.amount!==definition!.attack||script.runtime.style!==(script.magic===1?0:1)||script.runtime.sideFlag!==(script.side==='attacker'?1:0)||script.runtime.age>b.tick*3)fail();
    return;
  }
  const script=b.activeScript;if(script?.kind!=='native-shoot')return;
  if(b.magicRules!=='native-shoot-v1')fail();
  const caster=b.units.find(u=>u.id===script.casterId),target=b.units.find(u=>u.id===script.targetId),s=script.runtime;
  const integer=(n:unknown,min:number,max:number):n is number=>typeof n==='number'&&Number.isInteger(n)&&n>=min&&n<=max;
  const configs:Record<number,[number,number,number]>={502:[2,0,1],514:[13,1,0],552:[52,0,0],558:[59,2,0]};
  const definition=configs[script.script];
  if(!definition||script.magic!==definition[0]||!caster?.general||!target?.general||caster.side!==script.side||target.side===script.side||script.damage!==nativeMagicDefinition(script.magic)?.attack||!s||s.style!==definition[1]||s.flaming!==definition[2])fail();
  if(!['darken','pose','release','flight','after','brighten'].includes(s.phase)||!integer(s.age,0,2000)||!integer(s.phaseAge,0,2000)||!integer(s.brightness,8,16)||![8,16].includes(s.palette)||!integer(s.cameraJitter,0,90)||typeof s.casterLocked!=='boolean'||s.sideFlag!==(script.side==='attacker'?1:0))fail();
  if(!s.origin||![s.origin.x,s.origin.y,s.origin.z].every(n=>integer(n,-2147483648,2147483647))||s.origin.z<0)fail();
  if(s.casterLocked!==(s.phase==='pose'))fail();
  if(s.age>b.tick*3||s.camera!==undefined&&(!integer(s.camera.x,-10000,10000)||!integer(s.camera.y,-10000,10000)))fail();
  if((s.phase!=='darken')!==!!s.camera)fail();
  if(s.cameraTrack) {
    if(!b.cameraRules||!s.camera||!s.weapon||!['flight','after','brighten'].includes(s.phase))fail();
    const c=s.cameraTrack;
    if(c.kind==='lock') {
      if(c.side!==s.sideFlag||c.offsetX!==180||c.offsetY!==-120+s.cameraJitter||!integer(c.drift,-1000,1000)||!integer(c.previousX,-10000,10000)||typeof c.waiting!=='boolean')fail();
    } else if(c.kind==='move') {
      if(![c.x,c.y,c.dx,c.dy,c.targetX,c.targetY].every(n=>integer(n,-2147483648,2147483647))||!integer(c.remaining,0,30))fail();
    } else fail();
  }
  const max={darken:40,pose:15,release:15,flight:1000,after:60,brighten:40,done:0}[s.phase];
  if(s.phaseAge>max)fail();
  if(['flight','after','brighten'].includes(s.phase)!==!!s.weapon)fail();
  if(s.weapon) {
    const w=s.weapon;
    if(w.object!==13001+s.style*2||w.facing!==(s.sideFlag===1?0:128)||typeof w.alive!=='boolean'||![w.x,w.y,w.z,w.vx,w.vy].every(n=>integer(n,-2147483648,2147483647))||w.z<0||!integer(w.age,0,1000)||!integer(w.fade,0,16)||![0,2,16].includes(w.fadePeriod)||!integer(w.fadeWait,0,8)||![0x1010000,0x3010000,0x50000,0x2050000].includes(w.flags))fail();
    const angle=w.facing*3.1415926/128;
    if(w.vx!==Math.trunc(Math.cos(angle)*16*65536)||w.vy!==Math.trunc(Math.sin(angle)*16*65536)||w.z!==s.origin.z+((s.style===2?69:80)<<16))fail();
    if(w.fadePeriod&&w.fadePeriod!==(s.style===2?16:2))fail();
  }
}
