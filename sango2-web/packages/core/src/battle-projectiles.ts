import type {BattleState,BattleUnit} from './battle';
import {battleMovementCell} from './battle-movement';
import {battleDetachedPosition} from './battle-casualties';
import {nativeAdvanceProjectile,nativeLaunchProjectile,type NativeProjectile} from './native-projectile';
import data from './native-projectile-types.json';

export interface BattleProjectile extends NativeProjectile {
  id:number;owner:number;side:'attacker'|'defender';born:number;age:number;displayOffset:{x:number;y:number};
}
export function launchBattleProjectile(b:BattleState,u:BattleUnit,unit:number,tick:number):void {
  const m=u.movement!,p=nativeLaunchProjectile(unit,{x:m.px,y:m.py,z:0,facing:m.facing});if(!p)return;
  const display=battleDetachedPosition({x:m.px,y:m.py});
  b.projectiles!.push({...p,id:b.nextId++,owner:u.id,side:u.side,born:tick,age:0,displayOffset:{x:u.x-display.x,y:u.y-display.y}});
}
/** Units update first, then projectiles in creation order, at each source tick.
 * This is still an adapter for the original mixed global object linked list. */
export function advanceBattleProjectiles(b:BattleState,hit:(u:BattleUnit,target:BattleUnit)=>boolean):void {
  if(!b.projectileRules||!b.projectiles!.length)return;
  const occupants=new Map<string,BattleUnit>();
  for(const u of b.units)if(u.hp>0&&!u.escaped&&!u.movement?.exiting){const c=battleMovementCell(u);occupants.set(`${c.x},${c.y}`,u);}
  const owners=new Map(b.units.map(u=>[u.id,u]));
  for(const p of b.projectiles!) {
    const owner=owners.get(p.owner)!;
    nativeAdvanceProjectile(p,b.opponentAI!.rng,(x,y)=>{
      const target=occupants.get(`${x},${y}`);
      if(!target||target.hp<=0)return 'empty';if(target===owner)return 'self';
      if(target.side===owner.side)return 'ally';return hit(owner,target)?'hit':'miss';
    });
    p.age++;
  }
  b.projectiles=b.projectiles!.filter(p=>p.alive);
}
export function validateBattleProjectiles(b:BattleState,fail:()=>never):void {
  if(!b.projectileRules){if(b.projectiles!==undefined)fail();return;}
  if(b.projectileRules!=='native-projectiles-v1'||b.movementRules!=='native-grid-v3'||b.attackRules!=='native-actions-v1'||!Array.isArray(b.projectiles)||b.projectiles.length>20000)fail();
  const integer=(x:unknown,min:number,max:number):x is number=>typeof x==='number'&&Number.isInteger(x)&&x>=min&&x<=max;
  const ids=new Set([...b.units,...b.effects,...(b.detached??[])].map(u=>u.id));
  const objects=data.objects as Record<number,{wait:number[];death:number[];life:number}>;
  for(const p of b.projectiles!) {
    if(!p||!integer(p.id,0,b.nextId-1)||ids.has(p.id)||!integer(p.born,1,b.tick*3)||!integer(p.age,1,b.tick*3-p.born+1))fail();
    const owner=b.units.find(u=>u.id===p.owner);
    if(!owner||owner.general||owner.side!==p.side||!objects[p.object]||!p.alive||!integer(p.life,1,2400)||p.life!==2400-p.age||!['flight','hit','deflected'].includes(p.phase))fail();
    const durations=objects[p.object][p.phase==='deflected'?'death':'wait'];
    if(!integer(p.frame,0,durations.length-1)||!integer(p.remaining,1,durations[p.frame]+(p.phase==='deflected'&&p.frame===0?4:0)))fail();
    if(p.flags!==(p.phase==='flight'?0x30040:p.phase==='hit'?0x70040:0x60040)||!integer(p.fade,p.phase==='flight'?0:1,p.phase==='flight'?0:p.phase==='hit'?8:24))fail();
    if(![p.x,p.y,p.z,p.vx,p.vy,p.vz].every(n=>integer(n,-2147483648,2147483647))||p.z<0||!integer(p.facing,0,255<<16)||p.facing%65536!==0)fail();
    if(!p.displayOffset||![p.displayOffset.x,p.displayOffset.y].every(n=>Number.isFinite(n)&&Math.abs(n)<2000))fail();
    ids.add(p.id);
  }
}
