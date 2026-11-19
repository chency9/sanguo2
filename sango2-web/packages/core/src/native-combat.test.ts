import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {nativeAttackHits,nativeGeneralDamage,nativeUnitMatchup,nativeTerrainMatchup,nativeFormationMatchup,nativeCombatPower,type NativeCombatUnit} from './native-combat';
import {nativeBelow,type NativeRandomState} from './native-strategic-ai';
import {createBattle,commandBattle,tickBattle,validateBattle,battleGeneral,NATIVE_STRATEGIES,type BattleState} from './battle';

const vectors=JSON.parse(readFileSync(new URL('../fixtures/native-combat-vectors.json',import.meta.url),'utf8')) as {
  combat:{input:{attacker:NativeCombatUnit;target:NativeCombatUnit;rng:NativeRandomState};native:{hit:boolean;damage:number|null;rngAfterHit:NativeRandomState;rng:NativeRandomState}}[];
  lookups:{kind:'units'|'terrain'|'formation';args:[number,number];native:number}[];
};
describe('original x86 hit/damage and matchup tables',()=>{
  it.each(vectors.combat.map((v,index)=>({...v,index})))('matches hit, conditional damage and both RNG checkpoints $index',({input:o,native})=>{
    const rng:NativeRandomState=[...o.rng];
    const hit=nativeAttackHits(o.attacker,o.target,rng);
    expect(hit).toBe(native.hit);expect(rng).toEqual(native.rngAfterHit);
    const damage=hit&&o.target.general?nativeGeneralDamage(o.attacker,rng):null;
    expect(damage).toBe(native.damage);expect(rng).toEqual(native.rng);
  });
  it.each(vectors.lookups.map((v,index)=>({...v,index})))('matches original table lookup and invalid-mask behavior $index',({kind,args,native})=>{
    expect(({units:nativeUnitMatchup,terrain:nativeTerrainMatchup,formation:nativeFormationMatchup})[kind](...args)).toBe(native);
  });
  it('uses signed division towards zero for morale, including values just below 50',()=>{
    const base={base:150,unitMask:0,enemyUnitMask:0,terrain:0,formation:-1,enemyFormation:-1,defense:49,morale:46};
    expect(nativeCombatPower(base)).toBe(150);
    expect(nativeCombatPower({...base,defense:50,morale:45})).toBe(150);
  });
});

const commander=(id:string,execute=0)=>({id,name:id,portrait:'portraits/001.png',strength:80,intelligence:90,hp:100,mp:50,unit:'刀',level:20,
  strategyLearnset:execute?[{level:1,sequence:NATIVE_STRATEGIES.find(s=>s.execute===execute)!.sequence}]:[]});
function duel(execute=0) {
  let b=createBattle({id:'native-combat',attacker:commander('a',execute),defender:commander('d'),attackingTroops:1,defendingTroops:1,seed:184});
  // These fixtures exercise saved v2 hit events, without a new target search.
  b.formation='line';delete b.deploymentRules;delete b.nativeCommands;b.movementRules='native-grid-v2';delete b.attackRules;delete b.projectileRules;delete b.projectiles;delete b.magicRules;
  if(execute)b=commandBattle(b,{type:'strategy',advisorId:'a',sequence:NATIVE_STRATEGIES.find(s=>s.execute===execute)!.sequence});
  return commandBattle(b,{type:'start'});
}
function strike(b:BattleState,ownGeneral=false,targetGeneral=false) {
  for(const u of b.units){u.order='hold';u.x=u.side==='attacker'?64:1136;u.y=342;}
  const a=b.units.find(u=>u.side==='attacker'&&u.general===ownGeneral)!;
  const d=b.units.find(u=>u.side==='defender'&&u.general===targetGeneral)!;
  a.x=500;d.x=520;a.action='attack';a.actionTick=6;a.target=d.id;a.hit=false;
  b.opponentAI!.countdown=60;
  return {a,d};
}
describe('native combat in battle lifecycle',()=>{
  it('kills a soldier without a damage draw, then consumes the three native death-flight draws',()=>{
    const b=duel(),{d}=strike(b);
    // Pick a first draw below every normal matchup threshold.
    const seed=vectors.combat.find(v=>{const r:NativeRandomState=[...v.input.rng];return nativeBelow(r,300)<50;})!.input.rng;
    b.opponentAI!.rng=[...seed];const expected:NativeRandomState=[...seed];nativeBelow(expected,300);
    nativeBelow(expected,48);nativeBelow(expected,36);nativeBelow(expected,0x10000);
    tickBattle(b);expect(d.hp).toBe(0);expect(d.action).toBe('death');expect(b.opponentAI!.rng).toEqual(expected);
    validateBattle(b);
  });
  it('leaves a soldier alive on a miss without inventing hit feedback',()=>{
    const b=duel(),{d}=strike(b);
    const seed=vectors.combat.find(v=>{const r:NativeRandomState=[...v.input.rng];return nativeBelow(r,300)>=250;})!.input.rng;
    b.opponentAI!.rng=[...seed];tickBattle(b);
    expect(d.hp).toBe(1);expect(b.effects).toHaveLength(0);
  });
  it('strengthening is consumed by actual damage and save/resume keeps the shared stream',()=>{
    const b=duel(23),{d}=strike(b,false,true);
    const seed=vectors.combat.find(v=>{const r:NativeRandomState=[...v.input.rng];return nativeBelow(r,300)<50;})!.input.rng;
    b.opponentAI!.rng=[...seed];b.fortifications={attacker:999,defender:0};
    const loaded=JSON.parse(JSON.stringify(b));validateBattle(loaded);
    tickBattle(b);tickBattle(loaded);expect(loaded).toEqual(b);
    const power=nativeCombatPower({base:180,unitMask:1,enemyUnitMask:1,terrain:0,formation:-1,enemyFormation:b.opponentAI!.formation!,defense:999,morale:80});
    expect(d.hp).toBe(100-Math.max(1,Math.trunc(4*power/192)));
    expect(b.rng).toBe(184); // no separate xorshift damage stream
  });
  it('fortification inputs survive commander selection and corrupt saves are rejected',()=>{
    const b=createBattle({id:'defense',attacker:commander('a'),defender:commander('d'),attackingTroops:1,defendingTroops:1,seed:184});
    b.fortifications={attacker:800,defender:0};
    const next=commandBattle(b,{type:'select-commander',commanderId:'a'});
    expect(next.fortifications).toEqual(b.fortifications);validateBattle(next);
    next.fortifications!.attacker=NaN;expect(()=>validateBattle(next)).toThrow();
    const bad=duel();bad.strategies!.effects.attacker.soldierPower=NaN;expect(()=>validateBattle(bad)).toThrow();
    const old=duel();delete old.strategies!.effects.attacker.soldierPower;delete old.strategies!.effects.attacker.generalHitBonus;
    validateBattle(old);strike(old);tickBattle(old);expect(Number.isFinite(battleGeneral(old,'attacker').hp)).toBe(true);
  });
  it('supports general hit enhancement in the integrated strategy state',()=>{
    const b=duel(43);expect(b.strategies!.effects.attacker.flags&512).toBe(512);
    expect(b.strategies!.effects.attacker.generalHitBonus).toBe(20);validateBattle(b);
    const plain=duel(),enhancedTarget=strike(b,true,false).d,plainTarget=strike(plain,true,false).d;
    const seed=vectors.combat.find(v=>{const r:NativeRandomState=[...v.input.rng],draw=nativeBelow(r,300);return draw>=190&&draw<210;})!.input.rng;
    b.opponentAI!.rng=[...seed];plain.opponentAI!.rng=[...seed];tickBattle(b);tickBattle(plain);
    expect(enhancedTarget.hp).toBe(0);expect(plainTarget.hp).toBe(1);
  });
});
