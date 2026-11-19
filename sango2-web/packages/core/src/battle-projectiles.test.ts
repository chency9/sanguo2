import {describe,it,expect} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {createBattle,commandBattle,validateBattle,tickBattle,type BattleState,type BattleUnit} from './battle';
import {prepareBattleMovement} from './battle-movement';
import {updateBattleUnits} from './battle-unit-scheduler';
import type {BattleProjectile} from './battle-projectiles';
import {nativeBelow,type NativeRandomState} from './native-strategic-ai';
import types from './native-projectile-types.json';

function place(u:BattleUnit,x:number,y:number) {
  Object.assign(u.movement!,{x,y,previousX:x,previousY:y,px:(x*96+48)*65536,py:(y*72+36)*65536});
  u.x=(x+.5)/71*1200;u.y=150+y/13*360;
}
function ready() {
  const commander=(id:string)=>({id,name:id,portrait:'',strength:80,intelligence:80,hp:100,mp:40,unit:'弓',level:20});
  const b=commandBattle(createBattle({id:'projectile',attacker:commander('a'),defender:commander('d'),attackingTroops:2,defendingTroops:2,seed:184}),{type:'start'});
  prepareBattleMovement(b);b.opponentAI!.countdown=60;
  for(const u of b.units){u.order='hold';u.movement!.clock!.decision=10000;}
  const [u,ally]=b.units.filter(u=>!u.general&&u.side==='attacker'),[enemy,other]=b.units.filter(u=>!u.general&&u.side==='defender');
  // Keep unrelated generals outside the firing lane regardless of formation.
  for(const general of b.units.filter(u=>u.general))place(general,general.side==='attacker'?20:60,0);
  place(u,35,6);place(enemy,40,6);place(ally,30,4);place(other,45,4);u.movement!.clock!.decision=1;
  return {b,u,ally,enemy,other};
}
function step(b:BattleState,hit:(u:BattleUnit,target:BattleUnit)=>boolean=()=>true) {
  b.tick++;updateBattleUnits(b,{unitType:()=>3,hit:(u,target)=>hit(u,target),escaped:()=>{}});
}
function launched() {
  const f=ready();for(let i=0;i<4;i++)step(f.b,()=>{throw new Error('Damage before projectile reaches its target');});
  expect(f.b.projectiles).toHaveLength(1);expect(f.b.projectiles![0]).toMatchObject({phase:'flight',born:12,age:1,owner:f.u.id,object:500});
  return f;
}
describe('projectiles in the saved battle',()=>{
  it('travels to the occupied cell before damage and applies the hit only once',()=>{
    const {b,enemy}=launched();let hits=0;
    for(let i=0;i<12;i++)step(b,(_,target)=>{expect(target.id).toBe(enemy.id);hits++;return true;});
    expect(hits).toBe(1);expect(b.projectiles![0].phase).toBe('hit');
    for(let i=0;i<3;i++)step(b,()=>{hits++;return true;});
    expect(hits).toBe(1);expect(b.projectiles).toEqual([]);validateBattle(b);
  });
  it('does not track a target that leaves its row, and can hit a different enemy in its path',()=>{
    const {b,enemy,other}=launched();place(enemy,40,7);place(other,39,6);const targets:number[]=[];
    for(let i=0;i<15;i++)step(b,(_,target)=>{targets.push(target.id);return true;});
    expect(targets).toEqual([other.id]);validateBattle(b);
  });
  it('lets an ally intercept without damage or hit-chance draws, then follows original deflection RNG',()=>{
    const {b,ally}=launched();place(ally,37,6);const expected=[...b.opponentAI!.rng] as NativeRandomState;
    for(const bound of [96,3,0x40000,5,6])nativeBelow(expected,bound);
    for(let i=0;i<4;i++)step(b,()=>{throw new Error('Ally must not receive damage');});
    expect(b.projectiles![0]).toMatchObject({phase:'deflected',fade:21});expect(b.opponentAI!.rng).toEqual(expected);
    const restored:BattleState=JSON.parse(JSON.stringify(b));validateBattle(restored);
    for(let i=0;i<9;i++){step(b);step(restored);}expect(restored).toEqual(b);expect(b.projectiles).toEqual([]);
  });
  it('keeps an already launched projectile when its shooter dies',()=>{
    const {b,u,enemy}=launched();u.hp=0;u.action='death';let hits=0;
    for(let i=0;i<15;i++)step(b,(owner,target)=>{expect(owner.id).toBe(u.id);expect(target.id).toBe(enemy.id);hits++;return true;});
    expect(hits).toBe(1);validateBattle(b);
  });
  it('retains a faded shooter record until its last projectile disappears',()=>{
    const {b,u,enemy}=launched();u.hp=0;u.action='death';place(enemy,70,6);
    for(let i=0;i<60;i++){b.opponentAI!.countdown=60;tickBattle(b);}expect(b.projectiles!.some(p=>p.owner===u.id)).toBe(true);
    expect(b.units.some(x=>x.id===u.id)).toBe(true);validateBattle(b);
    const restored:BattleState=JSON.parse(JSON.stringify(b));validateBattle(restored);
    for(let i=0;i<100;i++){b.opponentAI!.countdown=60;restored.opponentAI!.countdown=60;tickBattle(b);tickBattle(restored);}expect(restored).toEqual(b);
    expect(b.projectiles!.some(p=>p.owner===u.id)).toBe(false);expect(b.units.some(x=>x.id===u.id)).toBe(false);validateBattle(b);
  });
  it('restores an in-flight projectile and real damage/RNG deterministically',()=>{
    const {b}=launched();const restored:BattleState=JSON.parse(JSON.stringify(b));validateBattle(restored);
    for(let i=0;i<60;i++){tickBattle(b);tickBattle(restored);}expect(restored).toEqual(b);validateBattle(b);
  });
  it('keeps older snapshots on immediate ranged damage without adding flight state',()=>{
    const {b}=ready();delete b.projectileRules;delete b.projectiles;let hits=0;
    for(let i=0;i<4;i++)step(b,()=>{hits++;return true;});
    expect(hits).toBe(1);expect(b.projectiles).toBeUndefined();validateBattle(b);
  });
  it('rejects broken projectile owners, clocks, animation state and identities',()=>{
    const {b}=launched();validateBattle(b);
    const changes:((p:BattleProjectile)=>void)[]=[p=>{p.owner=9999;},p=>{p.age=NaN;},p=>{p.frame=100;},p=>{p.remaining=0;},p=>{p.id=b.units[0].id;},p=>{p.x=Infinity;},p=>{p.life=0;},p=>{p.displayOffset.y=NaN;}];
    for(const change of changes){const bad=structuredClone(b);change(bad.projectiles![0]);expect(()=>validateBattle(bad)).toThrow();}
    const noRule=structuredClone(b);delete noRule.projectileRules;expect(()=>validateBattle(noRule)).toThrow();
    const noList=structuredClone(b);delete noList.projectiles;expect(()=>validateBattle(noList)).toThrow();
  });
  it('ships the four source projectile animations with their complete original loop durations',()=>{
    const root=new URL('../../../apps/game/public/assets/battle/',import.meta.url),atlas=JSON.parse(readFileSync(new URL('animations.json',root),'utf8'));
    for(const [object,definition] of Object.entries(types.objects))for(const action of ['wait','death'] as const) {
      const a=atlas.objects[object].actions[action];expect(a.frameTicks).toEqual(definition[action]);expect(a.loop).toBe(true);
      for(const f of a.frames)expect(existsSync(new URL(atlas.frames[f.key].page,root))).toBe(true);
    }
  });
});
