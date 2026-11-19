import { describe,it,expect } from 'vitest';
import { createBattle,commandBattle,tickBattle,battleGeneral,battleTeamSurvivors,battleSurvivors,validateBattle,upgradeBattle,type BattleCommander,type BattleState } from './battle';

const commander=(id:string):BattleCommander=>({id,name:id,portrait:'portraits/001.png',strength:80,intelligence:80,hp:80,maxHp:100,mp:40,unit:'刀'});
function fresh() {
  const a=commander('a'),d=commander('d');
  return createBattle({id:'rounds',attacker:a,defender:d,attackingTroops:60,defendingTroops:40,seed:1,
    rosters:{attacker:[{commander:a,troops:60,withdrawn:false},{commander:commander('a2'),troops:30,withdrawn:false}],
      defender:[{commander:d,troops:40,withdrawn:false},{commander:commander('d2'),troops:20,withdrawn:false}]}});
}
function winRound(b:BattleState) {
  const next=commandBattle(b,{type:'start'});
  battleGeneral(next,'defender').hp=0;
  tickBattle(next);return next;
}
describe('successive commander encounters',()=>{
  it('preserves wounded commanders and casualties across rounds, without double counting',()=>{
    const b=fresh();battleGeneral(b,'attacker').hp=17;
    b.units.filter(u=>u.side==='attacker'&&!u.general).slice(0,7).forEach(u=>{u.hp=0;u.action='death';});
    const first=winRound(b);
    expect(first.phase).toBe('intermission');expect(first.winner).toBeNull();
    expect(first.history).toHaveLength(1);expect(battleTeamSurvivors(first,'attacker')).toBe(83);
    expect(()=>validateBattle(first)).not.toThrow();
    expect(()=>commandBattle(first,{type:'start'})).toThrow();
    let second=commandBattle(first,{type:'next-round',commanderId:'a'});
    expect(second.round).toBe(2);expect(second.commanders.defender.id).toBe('d2');
    expect(battleGeneral(second,'attacker')).toMatchObject({hp:17,maxHp:100});
    expect(battleSurvivors(second,'attacker')).toBe(53);
    expect(second.totalInitial).toEqual({attacker:90,defender:60});
    second=winRound(second);expect(second.phase).toBe('finished');expect(second.winner).toBe('attacker');
    expect(second.history).toHaveLength(2);expect(battleTeamSurvivors(second,'attacker')).toBe(83);
    expect(()=>validateBattle(second)).not.toThrow();
  });
  it('lets a second commander take over after retreat while retaining the first commander’s survivors',()=>{
    let b=commandBattle(commandBattle(fresh(),{type:'order',division:'all',order:'retreat'}),{type:'start'});
    for(let i=0;i<3960&&b.phase==='fighting';i++)tickBattle(b);
    expect(b.phase).toBe('intermission');
    expect(b.rosters.attacker[0].withdrawn).toBe(true);
    expect(()=>commandBattle(b,{type:'next-round',commanderId:'a'})).toThrow();
    b=commandBattle(b,{type:'next-round',commanderId:'a2'});
    expect(battleSurvivors(b,'attacker')).toBe(30);expect(battleTeamSurvivors(b,'attacker')).toBe(90);
    expect(()=>validateBattle(b)).not.toThrow();
  });
  it('resumes intermission and the next fight deterministically from JSON',()=>{
    const b=winRound(fresh());const restored=JSON.parse(JSON.stringify(b));validateBattle(restored);
    const a=commandBattle(commandBattle(b,{type:'next-round',commanderId:'a2'}),{type:'start'});
    const c=commandBattle(commandBattle(restored,{type:'next-round',commanderId:'a2'}),{type:'start'});
    tickBattle(a,200);tickBattle(c,200);expect(a).toEqual(c);
    const withdrawn=commandBattle(b,{type:'withdraw'});expect(withdrawn.winner).toBe('defender');
    expect(battleTeamSurvivors(withdrawn,'attacker')).toBe(90);expect(()=>validateBattle(withdrawn)).not.toThrow();
  });
  it('allows explicit pre-battle selection without spending a round or changing troops',()=>{
    const b=commandBattle(fresh(),{type:'select-commander',commanderId:'a2'});
    expect(b.round).toBe(1);expect(b.history).toEqual([]);expect(b.commanders.attacker.id).toBe('a2');
    expect(b.initial.attacker).toBe(30);expect(battleTeamSurvivors(b,'attacker')).toBe(90);expect(()=>validateBattle(b)).not.toThrow();
  });
  it.each(['native-grid-v2','native-grid-v3'] as const)('triggers damage once with the saved %s event clock',rules=>{
    const a=commander('a');a.appearance={body:600,weapon:700,horse:900,soldier:100,generalAttack:{hitTick:6,ticks:30},soldierAttack:{hitTick:6,ticks:30}};
    const b=commandBattle(createBattle({id:'events',attacker:a,defender:commander('d'),attackingTroops:0,defendingTroops:0,seed:1}),{type:'start'});
    delete b.deploymentRules;b.movementRules=rules;delete b.attackRules;delete b.projectileRules;delete b.projectiles;delete b.magicRules; // Saved legacy appearance timings.
    battleGeneral(b,'attacker').x=500;battleGeneral(b,'defender').x=520;
    tickBattle(b);expect(battleGeneral(b,'defender').hp).toBe(80);
    tickBattle(b);if(rules==='native-grid-v2'){expect(battleGeneral(b,'defender').hp).toBe(80);tickBattle(b);}
    const afterHit=battleGeneral(b,'defender').hp;expect(afterHit).toBeLessThan(80);
    tickBattle(b,3);expect(battleGeneral(b,'defender').hp).toBe(afterHit);
  });
  it('upgrades legacy in-flight units without resetting their clock, health, RNG or attack progress',()=>{
    const b=commandBattle(createBattle({id:'legacy',attacker:commander('a'),defender:commander('d'),attackingTroops:30,defendingTroops:30,seed:123}),{type:'start'});
    tickBattle(b,150);battleGeneral(b,'attacker').hp=13;
    const old=JSON.parse(JSON.stringify(b));old.version=1;delete old.round;delete old.rosters;delete old.history;delete old.totalInitial;
    const migrated=upgradeBattle(old);expect(migrated.units).toEqual(b.units);expect(migrated.tick).toBe(b.tick);expect(migrated.rng).toBe(b.rng);
    tickBattle(b,200);tickBattle(migrated,200);expect(migrated.units).toEqual(b.units);expect(migrated.rng).toBe(b.rng);expect(()=>validateBattle(migrated)).not.toThrow();
  });
});
