import {describe,it,expect} from 'vitest';
import {createBattle,commandBattle,tickBattle,validateBattle,battleGeneral,type BattleState} from './battle';
import {prepareBattleMovement} from './battle-movement';
import {issueNativeCommand} from './battle-commands';

function ready():BattleState {
  const commander=(id:string)=>({id,name:id,portrait:'',strength:80,intelligence:60,hp:80,maxHp:100,mp:40,maxMp:60,unit:'刀',level:20,skillLearnset:[{level:1,sequence:2}]});
  const b=commandBattle(createBattle({id:'general-source',attacker:commander('a'),defender:commander('d'),attackingTroops:0,defendingTroops:0,seed:184}),{type:'start'});
  prepareBattleMovement(b);b.opponentAI!.countdown=60;
  for(const u of b.units){u.order='hold';u.movement!.clock!.decision=10000;}
  return b;
}

describe('general source updates in actual battles',()=>{
  it.each([[0,0,46],[1,0,44],[0,1,48],[6,1,36],[1,6,56]])('uses native retreat clock for own speed %s and enemy speed %s', (speed,enemySpeed,decision)=>{
    const b=ready(),g=battleGeneral(b,'attacker');
    b.commanders.attacker.speed=speed;b.commanders.defender.speed=enemySpeed;
    g.movement!.clock!.decision=1;issueNativeCommand(b,'attacker',0,8);tickBattle(b);
    expect(g.movement!.clock!.decision).toBe(decision-2);validateBattle(b);
    const restored=JSON.parse(JSON.stringify(b)) as BattleState;
    tickBattle(b,10);tickBattle(restored,10);expect(restored).toEqual(b);
  });
  it('keeps old saved retreat clocks at equal speed and rejects invalid speed fields',()=>{
    const b=ready(),g=battleGeneral(b,'attacker');delete b.generalRules;
    b.commanders.attacker.speed=6;b.commanders.defender.speed=0;g.movement!.clock!.decision=1;
    issueNativeCommand(b,'attacker',0,8);tickBattle(b);expect(g.movement!.clock!.decision).toBe(44);validateBattle(b);
    b.commanders.attacker.speed=32768;expect(()=>validateBattle(b)).toThrow();
  });
  it('subtracts 50 per source update during retreat, including through zero',()=>{
    const b=ready();issueNativeCommand(b,'attacker',0,8);b.commanders.attacker.charge=50;
    tickBattle(b);expect(b.commanders.attacker.charge).toBe(-100);validateBattle(b);
    const saved=JSON.parse(JSON.stringify(b)) as BattleState;validateBattle(saved);
    tickBattle(b,5);tickBattle(saved,5);expect(saved).toEqual(b);
  });
  it('runs the retreat prefix before the general death-action veto',()=>{
    const b=ready(),g=battleGeneral(b,'attacker');issueNativeCommand(b,'attacker',0,8);
    b.commanders.attacker.charge=50;g.hp=0;g.action='death';
    tickBattle(b);expect(b.commanders.attacker.charge).toBe(-100);expect(b.phase).toBe('finished');validateBattle(b);
  });
  it('retains the previous non-decreasing retreat gauge in old saves',()=>{
    const b=ready();delete b.generalRules;b.commanders.attacker.charge=50;issueNativeCommand(b,'attacker',0,8);
    tickBattle(b);expect(b.commanders.attacker.charge).toBe(50);validateBattle(b);
  });
  it('continues native recovery while a spell is active',()=>{
    let b=ready();b.commanders.attacker.charge=120000;
    b=commandBattle(b,{type:'skill',sequence:2});
    const effect=b.strategies!.effects.attacker;Object.assign(effect,{flags:1,parameter:50,recoveryClock:5950});
    tickBattle(b);expect(battleGeneral(b,'attacker').hp).toBe(81);expect(effect.recoveryClock).toBe(100);
    validateBattle(b);
  });
  it('heals only after 6000 and gives HP precedence over MP',()=>{
    const b=ready(),effect=b.strategies!.effects.attacker;Object.assign(effect,{flags:3,parameter:1,recoveryClock:5999});
    tickBattle(b);expect(battleGeneral(b,'attacker').hp).toBe(81);expect(b.commanders.attacker.mp).toBe(40);expect(effect.recoveryClock).toBe(2);
  });
  it('does not run recovery during retreat',()=>{
    const b=ready(),effect=b.strategies!.effects.attacker;Object.assign(effect,{flags:1,parameter:100,recoveryClock:6000});
    issueNativeCommand(b,'attacker',0,8);tickBattle(b);
    expect(battleGeneral(b,'attacker').hp).toBe(80);expect(effect.recoveryClock).toBe(6000);
  });
  it('rejects future rules and negative charge on snapshots without the native rule',()=>{
    const b=ready();(b as unknown as {generalRules:string}).generalRules='future';expect(()=>validateBattle(b)).toThrow();
    delete b.generalRules;b.commanders.attacker.charge=-1;expect(()=>validateBattle(b)).toThrow();
  });
});
