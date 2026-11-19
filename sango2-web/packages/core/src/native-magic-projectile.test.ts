import {describe,expect,it} from 'vitest';
import {battleGeneral,battleSkillUnavailable,commandBattle,createBattle,tickBattle,validateBattle,type BattleCommander,type BattleState} from './battle';

const commander=(id:string,skillLearnset:BattleCommander['skillLearnset']=[{level:1,sequence:2}]):BattleCommander=>({
  id,name:id,portrait:'portraits/001.png',strength:80,intelligence:80,hp:100,maxHp:100,mp:40,maxMp:40,unit:'刀',level:1,skillLearnset,
});

function started(seed=184,attacker=commander('attacker'),defender=commander('defender')):BattleState {
  let b=createBattle({id:'magic-projectile',attacker,defender,attackingTroops:0,defendingTroops:0,seed});
  b=commandBattle(b,{type:'start'});delete b.magicRules;
  b.commanders.attacker.charge=120000;
  b.commanders.defender.charge=0;
  b.opponentAI!.countdown=60;
  return b;
}

function cast(b:BattleState):BattleState {
  expect(battleSkillUnavailable(b,2)).toBeNull();
  const result=commandBattle(b,{type:'skill',sequence:2});
  expect(result.activeScript?.kind).toBe('magic-projectile');
  return result;
}

describe('legacy saved 落月弓 projectile adapter',()=>{
  it('pays MP and charge once, then advances windup, flight and impact in source updates',()=>{
    let b=cast(started());
    expect(b.commanders.attacker.mp).toBe(22);
    expect(b.commanders.attacker.charge).toBe(0);
    expect(b.activeScript).toMatchObject({kind:'magic-projectile',phase:'windup',phaseAge:0,damage:15,script:502,hit:false});
    const initial=b.activeScript?.kind==='magic-projectile'?{x:b.activeScript.x,y:b.activeScript.y}:null;
    tickBattle(b,3);
    expect(b.activeScript?.kind).toBe('magic-projectile');
    if(b.activeScript?.kind!=='magic-projectile')throw new Error('expected projectile windup');
    expect(b.activeScript.phase).toBe('windup');
    tickBattle(b);
    expect(b.activeScript?.kind).toBe('magic-projectile');
    if(b.activeScript?.kind!=='magic-projectile')throw new Error('expected projectile flight');
    expect(b.activeScript.phase).toBe('flight');
    tickBattle(b);
    expect(b.activeScript?.kind).toBe('magic-projectile');
    if(b.activeScript?.kind!=='magic-projectile')throw new Error('expected projectile flight');
    expect({x:b.activeScript.x,y:b.activeScript.y}).not.toEqual(initial);
    while(b.activeScript) {
      validateBattle(b);
      tickBattle(b);
    }
    expect(battleGeneral(b,'defender').hp).toBe(85);
    expect(b.effects.some(effect=>effect.kind==='hit')).toBe(true);
    validateBattle(b);
  });

  it('tracks a moving target during flight and applies the fixed native damage at impact',()=>{
    let b=cast(started());
    tickBattle(b,4);
    expect(b.activeScript?.kind).toBe('magic-projectile');
    const target=battleGeneral(b,'defender');
    target.x=1080;target.y=400;
    const launchTarget={x:target.x,y:target.y};
    tickBattle(b);
    expect(b.activeScript?.kind).toBe('magic-projectile');
    if(b.activeScript?.kind!=='magic-projectile')throw new Error('expected projectile flight');
    expect(b.activeScript.toX).toBe(launchTarget.x);
    expect(b.activeScript.toY).toBe(launchTarget.y-48);
    while(b.activeScript)tickBattle(b);
    expect(target.hp).toBe(85);
    validateBattle(b);
  });

  it('ends safely if the target dies before the impact update',()=>{
    let b=cast(started());
    tickBattle(b,4);
    battleGeneral(b,'defender').hp=0;
    tickBattle(b);
    expect(b.activeScript).toBeUndefined();
    expect(()=>validateBattle(b)).not.toThrow();
  });

  it('rejects a projectile save whose caster belongs to the target side',()=>{
    const b=cast(started());
    if(b.activeScript?.kind!=='magic-projectile')throw new Error('expected projectile script');
    b.activeScript.casterId=battleGeneral(b,'defender').id;
    expect(()=>validateBattle(b)).toThrow();
  });

  it('keeps an in-flight script deterministic across JSON save and restore',()=>{
    const b=cast(started());
    tickBattle(b,5);
    const restored=JSON.parse(JSON.stringify(b)) as BattleState;
    validateBattle(restored);
    for(let i=0;i<6;i++) {
      tickBattle(b);tickBattle(restored);
      expect(restored).toEqual(b);
    }
  });
});

describe('opponent AI projectile casting',()=>{
  it('can select and cast the verified projectile skill through the native lottery',()=>{
    let casts=0;
    for(let seed=1;seed<=256;seed++) {
      let b=started(seed,commander('attacker',[]),commander('defender'));
      b.commanders.defender.charge=120000;
      b.opponentAI!.countdown=10;
      tickBattle(b,4);
      if(b.activeScript?.kind==='magic-projectile') {
        casts++;
        expect(b.opponentAI!.lastSkill).toBe(2);
        expect(b.commanders.defender.mp).toBe(22);
        expect(b.activeScript.side).toBe('defender');
        validateBattle(b);
      }
    }
    expect(casts).toBeGreaterThan(0);
  });
});
