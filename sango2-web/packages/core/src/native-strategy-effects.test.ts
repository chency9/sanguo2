import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {nativeApplyStrategy,nativeStrategyRecovery,SUPPORTED_STRATEGY_EXECUTES,type NativeStrategyCombat} from './native-strategy-effects';
import {nativeChooseStrategy,type NativeStrategySlot,type NativeStrategyChoice} from './native-strategist-ai';
import type {NativeRandomState} from './native-strategic-ai';
import {createBattle,commandBattle,tickBattle,battleGeneral,battleSkillUnavailable,validateBattle,NATIVE_STRATEGIES,type BattleCommander} from './battle';

const vectors=JSON.parse(readFileSync(new URL('../fixtures/native-strategy-effects-vectors.json',import.meta.url),'utf8')) as {
  effects:{input:{execute:number;side:number;states:NativeStrategyCombat[];rng:NativeRandomState};native:{states:NativeStrategyCombat[];rng:NativeRandomState}}[];
  recovery:{input:{state:NativeStrategyCombat;updates:number};native:NativeStrategyCombat}[];
  runtimeChoices:{input:{slots:NativeStrategySlot[];troops:number;rng:NativeRandomState};native:NativeStrategyChoice&{rng:NativeRandomState}}[];
};
describe('original strategy effects / captured runtime rates',()=>{
  it.each(vectors.effects.map((v,index)=>({...v,index})))('matches original effect memory writes and RNG $index',({input:o,native})=>{
    const rng:NativeRandomState=[...o.rng],states=structuredClone(o.states);
    expect(nativeApplyStrategy(o.execute,states[o.side],states[o.side^1],rng)).toBe(true);
    expect({states,rng}).toEqual(native);
  });
  it.each(vectors.recovery.map((v,index)=>({...v,index})))('matches recovery thresholds, precedence and saturation $index',({input:o,native})=>{
    const state=structuredClone(o.state);nativeStrategyRecovery(state,o.updates);expect(state).toEqual(native);
  });
  it.each(vectors.runtimeChoices.map((v,index)=>({...v,index})))('matches selection with real captured rates $index',({input:o,native})=>{
    const rng:NativeRandomState=[...o.rng],{rng:expected,...result}=native;
    expect(nativeChooseStrategy(o.slots,o.troops,rng)).toEqual(result);expect(rng).toEqual(expected);
  });
});
const sequence=(execute:number)=>NATIVE_STRATEGIES.find(s=>s.execute===execute)!.sequence;
const commander=(id:string,execute=0):BattleCommander=>({id,name:id,portrait:'portraits/001.png',strength:80,intelligence:90,hp:60,maxHp:100,mp:30,maxMp:80,unit:'刀',level:27,
  skillLearnset:[{level:1,sequence:1}],strategyLearnset:execute?[{level:1,sequence:sequence(execute)}]:[]});
const battle=(own=0,enemy=0)=>createBattle({id:'wise',attacker:commander('player',own),defender:commander('enemy',enemy),attackingTroops:133,defendingTroops:133,seed:184});
const select=(b:ReturnType<typeof battle>,execute:number)=>commandBattle(b,{type:'strategy',advisorId:'player',sequence:sequence(execute)});
describe('strategist battle lifecycle',()=>{
  it('supports 55 of the 67 original military strategy effects',()=>{
    expect(SUPPORTED_STRATEGY_EXECUTES.filter(execute=>execute!==0)).toHaveLength(55);
  });
  it.each([{execute:53,modifier:30},{execute:54,modifier:50},{execute:55,modifier:100}])('applies experience strategy $execute to real duel merit and survives save/load',({execute,modifier})=>{
    let b=select(battle(execute,10),execute);b=commandBattle(b,{type:'start'});
    expect(b.strategies!.effects.attacker).toMatchObject({settlementFlags:12288,experienceModifier:modifier,fatigueModifier:2});
    expect(b.strategies!.effects.attacker.flags).toBe(0);
    const loaded=JSON.parse(JSON.stringify(b));validateBattle(loaded);
    battleGeneral(b,'defender').hp=0;battleGeneral(loaded,'defender').hp=0;
    tickBattle(b);tickBattle(loaded);expect(loaded).toEqual(b);
    // No soldiers have died. Knockdown is 51 * enemy level, with the military
    // strategy applied before cumulative encounter experience is awarded.
    expect(b.rosters.attacker[0].merit).toBe(Math.trunc(51*27*(100+modifier)/100));
    const corrupt=JSON.parse(JSON.stringify(b));corrupt.strategies.effects.attacker.experienceModifier=31;
    expect(()=>validateBattle(corrupt)).toThrow();
  });
  it('selects enemy strategy before formation and keeps its RNG/choice when the player changes commanders',()=>{
    const a=commander('a'),other=commander('other'),d=commander('d',50);
    const b=createBattle({id:'x',attacker:a,defender:d,attackingTroops:50,defendingTroops:50,seed:30,rosters:{attacker:[{commander:a,troops:50,withdrawn:false},{commander:other,troops:30,withdrawn:false}],defender:[{commander:d,troops:50,withdrawn:false}]}});
    expect(b.strategies!.choices.defender.sequence).toBe(sequence(50));
    const changed=commandBattle(b,{type:'select-commander',commanderId:'other'});
    expect(changed.opponentAI).toEqual(b.opponentAI);expect(changed.strategies!.choices.defender).toEqual(b.strategies!.choices.defender);
  });
  it('combines speed modifiers and restores identical recovery after serialization',()=>{
    let b=select(battle(50,65),50);b=commandBattle(b,{type:'start'});
    expect(b.strategies!.effects.attacker.chargeModifier).toBe(0);
    tickBattle(b,1);expect(b.commanders.attacker.charge).toBe(60270);
    let r=select(battle(35),35);r=commandBattle(r,{type:'start'});
    r.strategies!.effects.attacker.recoveryClock=5880;
    const loaded=JSON.parse(JSON.stringify(r));validateBattle(loaded);tickBattle(r,1);tickBattle(loaded,1);
    expect(battleGeneral(r,'attacker').hp).toBe(60);expect(loaded).toEqual(r);
    tickBattle(r,1);expect(battleGeneral(r,'attacker').hp).toBe(61);
  });
  it('removes active and reserve shout casualties separately and never reapplies on save/load',()=>{
    let b=commandBattle(battle(0,60),{type:'start'});
    expect(b.units.filter(u=>!u.general&&u.side==='attacker'&&!u.nativeReserve)).toHaveLength(75);
    expect(b.units.filter(u=>!u.general&&u.side==='attacker'&&u.nativeReserve)).toHaveLength(25);
    expect(b.reserves.attacker).toBe(0);
    const restored=JSON.parse(JSON.stringify(b));validateBattle(restored);
    expect(()=>commandBattle(restored,{type:'start'})).toThrow();expect(restored).toEqual(b);
  });
  it('temporary boosts restore original maxima without becoming permanent healing',()=>{
    let b=select(battle(17),17);b=commandBattle(b,{type:'start'});
    expect(battleGeneral(b,'attacker').hp).toBe(110);expect(battleGeneral(b,'attacker').maxHp).toBe(150);
    battleGeneral(b,'defender').hp=0;tickBattle(b,1);
    expect(b.rosters.attacker[0].commander.hp).toBe(60);expect(b.rosters.attacker[0].commander.maxHp).toBe(100);
    validateBattle(b);
  });
  it('retains charge on casting without discounting MP',()=>{
    let b=select(battle(63),63);b=commandBattle(b,{type:'start'});b.commanders.attacker.charge=120000;
    b=commandBattle(b,{type:'skill',sequence:1});expect(b.commanders.attacker.charge).toBe(90000);expect(b.commanders.attacker.mp).toBe(10);
  });
  it('retains the original seal success lottery, rejects corrupt effects and leaves old saves untouched',()=>{
    let sealed=false,missed=false;
    for(let seed=1;seed<30;seed++) {
      const b=commandBattle(createBattle({id:'seal',attacker:commander('player'),defender:commander('enemy',64),attackingTroops:5,defendingTroops:5,seed}),{type:'start'});
      if(b.strategies!.effects.attacker.flags&256){sealed=true;expect(battleSkillUnavailable(b,1)).toBe('武将技被封');}else missed=true;
    }
    expect(sealed&&missed).toBe(true);
    const b=battle();b.strategies!.effects.attacker.recoveryClock=NaN;expect(()=>validateBattle(b)).toThrow();
    delete b.strategies;const rng=[...b.opponentAI!.rng];validateBattle(b);
    expect(commandBattle(b,{type:'start'}).opponentAI!.rng).toEqual(rng);
  });
});
