import {readFileSync,existsSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import vectors from '../fixtures/native-attack-animation-vectors.json';
import {nativeAttackAction,nativeAttackFrame,battleAttackAction} from './native-attack-animation';
import {createBattle,commandBattle,validateBattle,type BattleState,type BattleUnit} from './battle';
import {prepareBattleMovement} from './battle-movement';
import {updateBattleUnits} from './battle-unit-scheduler';

const assets=new URL('../../../apps/game/public/assets/battle/',import.meta.url);
const atlas=JSON.parse(readFileSync(new URL('animations.json',assets),'utf8'));
describe('original 0x436B9A / 0x421E1B / 0x421BF2 on real PAK attack streams',()=>{
  it.each(vectors.cases)('matches object $object / $action, its events and every source frame',v=>{
    const special=v.action==='WIN',timing=nativeAttackAction(v.object,special)!;
    expect(timing).toEqual({ticks:v.native.ticks,hitTicks:v.native.hitTicks,frameTicks:v.native.frames.map(f=>f.ticks)});
    expect(v.native.trace.map((_,age)=>nativeAttackFrame(timing,age))).toEqual(v.native.trace);
    const exported=atlas.objects[v.object].actions[special?'specialAttack':'sourceAttack'];
    expect(exported.frames).toEqual(v.native.frames.map(({key,ticks})=>({key,ticks})));
    expect(exported.hitTicks).toEqual(v.native.hitTicks);expect(exported.ticks).toBe(v.native.ticks);
    for(const frame of exported.frames)expect(atlas.frames[frame.key]).toBeDefined();
  });
  it('ships every referenced atlas page and retains the legacy attack timeline',()=>{
    for(const page of atlas.pages)expect(existsSync(new URL(page,assets)),page).toBe(true);
    expect(atlas.objects[100].actions.attack.hitTick).toBe(18);
    expect(atlas.objects[103].actions.attack.hitTick).toBe(15);
    expect(atlas.objects[103].actions.sourceAttack.hitTicks).toEqual([12]);
    expect(atlas.objects[103].actions.specialAttack.hitTicks).toEqual([15]);
    expect(atlas.objects[103].actions.specialAttack.frames[0].key).not.toBe(atlas.objects[103].actions.sourceAttack.frames[0].key);
  });
});

function ready(unit='弓',troops=1) {
  const commander=(id:string)=>({id,name:id,portrait:'',strength:80,intelligence:80,hp:100,mp:40,unit,level:40});
  const b=commandBattle(createBattle({id:'attack-action',attacker:commander('a'),defender:commander('d'),attackingTroops:troops,defendingTroops:troops,seed:184}),{type:'start'});
  // Isolate attack-node events from the separately verified projectile flight.
  delete b.projectileRules;delete b.projectiles;delete b.magicRules;delete b.generalRules;delete b.cameraRules;delete b.healRules;
  prepareBattleMovement(b);b.opponentAI!.countdown=60;
  for(const u of b.units){u.order='hold';u.movement!.clock!.decision=10000;}
  const u=b.units.find(u=>!u.general&&u.side==='attacker')!,enemy=b.units.find(u=>!u.general&&u.side==='defender')!;
  place(u,35,6);place(enemy,36,6);return {b,u,enemy};
}
function place(u:BattleUnit,x:number,y:number) {
  Object.assign(u.movement!,{x,y,previousX:x,previousY:y,px:(x*96+48)*65536,py:(y*72+36)*65536});
  u.x=(x+.5)/71*1200;u.y=150+y/13*360;
}
function step(b:BattleState,unit=3,hit:Parameters<typeof updateBattleUnits>[1]['hit']=()=>{}) {
  b.tick++;updateBattleUnits(b,{unitType:()=>unit,hit,escaped:()=>{}});
}

describe('source attack events in the saved battle scheduler',()=>{
  it.each([{distance:1,key:'specialAttack',hit:15,ticks:30},{distance:10,key:'sourceAttack',hit:12,ticks:35}])('selects archer $key at distance $distance and hits on source update $hit',v=>{
    const {b,u,enemy}=ready();place(enemy,35+v.distance,6);u.movement!.clock!.decision=1;
    const hits:{age:number;projectile:boolean;forced:boolean}[]=[];
    const hit:Parameters<typeof step>[2]=(actor,target,forced,projectile)=>{
      expect(actor.id).toBe(u.id);expect(target.id).toBe(enemy.id);hits.push({age:actor.movement!.clock!.actionAge,projectile,forced});
    };
    step(b,3,hit);expect(battleAttackAction(b,u)?.key).toBe(v.key);
    for(let i=1;i<Math.ceil(v.ticks/3);i++)step(b,3,hit);
    expect(hits).toEqual([{age:v.hit,projectile:v.distance>1,forced:false}]);
    expect(u.action).toBe('wait');validateBattle(b);
  });
  it.each(vectors.cases.filter(v=>v.object<180))('dispatches object $object / $action once at the native event age',v=>{
    const {b,u,enemy}=ready('刀'),reserve=v.object>=140,defender=(v.object-100)%40>=20;
    u.side=defender?'defender':'attacker';enemy.side=defender?'attacker':'defender';u.nativeReserve=reserve;
    const unit=(v.object-100)%20;
    b.commanders[u.side].appearance={body:600,weapon:700,horse:900,soldier:100+unit,generalAttack:{hitTick:21,ticks:60},soldierAttack:{hitTick:21,ticks:60}};
    u.action='attack';u.target=enemy.id;
    Object.assign(u.movement!.clock!,{actionAge:0,special:v.action==='WIN',attackEvent:0});
    const ages:number[]=[];
    for(let i=0;i<Math.ceil(v.native.ticks/3);i++)step(b,unit,actor=>{ages.push(actor.movement!.clock!.actionAge);});
    expect(battleAttackAction(b,u)?.object).toBe(v.object);expect(ages).toEqual(v.native.hitTicks);expect(u.action).toBe('wait');
  });
  it('resumes both sides of a hit event without repeating or losing damage',()=>{
    const {b,u}=ready();u.movement!.clock!.decision=1;
    for(let i=0;i<4;i++)step(b);expect(u.movement!.clock!.actionAge).toBe(12);expect(u.hit).toBe(false);validateBattle(b);
    const before:BattleState=JSON.parse(JSON.stringify(b));validateBattle(before);
    let original=0,restored=0;step(b,3,()=>{original++;});step(before,3,()=>{restored++;});
    expect(original).toBe(1);expect(restored).toBe(1);expect(before).toEqual(b);validateBattle(b);
    const after:BattleState=JSON.parse(JSON.stringify(b));validateBattle(after);
    for(let i=0;i<5;i++){step(b,3,()=>{original++;});step(after,3,()=>{restored++;});}
    expect(original).toBe(1);expect(restored).toBe(1);expect(after).toEqual(b);
  });
  it('keeps snapshots without attackRules on their saved appearance and animation timing',()=>{
    const {b,u}=ready();delete b.attackRules;
    b.commanders.attacker.appearance={body:600,weapon:700,horse:900,soldier:103,generalAttack:{hitTick:18,ticks:30},soldierAttack:{hitTick:21,ticks:35}};
    u.movement!.clock!.decision=1;const ages:number[]=[];
    for(let i=0;i<12;i++)step(b,3,actor=>{ages.push(actor.movement!.clock!.actionAge);});
    expect(ages).toEqual([21]);expect(battleAttackAction(b,u)).toBeUndefined();expect(u.movement!.clock!.attackEvent).toBeUndefined();validateBattle(b);
  });
  it('rejects an incompatible rule version and corrupt or omitted live event cursors',()=>{
    const {b,u}=ready();u.movement!.clock!.decision=1;for(let i=0;i<5;i++)step(b);validateBattle(b);
    for(const value of [undefined,-1,0,2,NaN,1.5]) {
      const bad=structuredClone(b);bad.units.find(x=>x.id===u.id)!.movement!.clock!.attackEvent=value;
      expect(()=>validateBattle(bad)).toThrow();
    }
    const wrong=structuredClone(b);wrong.movementRules='native-grid-v2';expect(()=>validateBattle(wrong)).toThrow();
    expect(()=>validateBattle({...b,attackRules:'unknown'})).toThrow();
  });
});
