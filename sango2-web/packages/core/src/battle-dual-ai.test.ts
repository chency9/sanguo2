import {describe,it,expect} from 'vitest';
import {createBattle,commandBattle,tickBattle,battleGeneral,validateBattle,formationToNativeIndex,type BattleCommander,type BattleState} from './battle';
import {nativeWeightedChoice,type NativeRandomState} from './native-strategic-ai';
import {nativeCommanderWeights} from './native-tactical-ai';

const commander=(id:string,extra:Partial<BattleCommander>={}):BattleCommander=>({id,name:id,portrait:'portraits/001.png',strength:80,intelligence:80,hp:100,maxHp:100,mp:40,maxMp:40,unit:'刀',level:20,formations:['方'],skillLearnset:[],...extra});
const create=(seed=184,a:Partial<BattleCommander>={},d:Partial<BattleCommander>={},troops=0)=>createBattle({id:'dual-ai',attacker:commander('a',a),defender:commander('d',d),attackingTroops:troops,defendingTroops:troops,seed,computerAttacker:true});

describe('both computer armies use the native tactical kernel',()=>{
  it('leaves ordinary player battles on their existing RNG and controls',()=>{
    const input={id:'player',attacker:commander('a'),defender:commander('d'),attackingTroops:20,defendingTroops:20,seed:184};
    const a=commandBattle(createBattle(input),{type:'start'}),b=commandBattle(createBattle({...input,computerAttacker:false}),{type:'start'});
    tickBattle(a,200);tickBattle(b,200);expect(a).toEqual(b);expect(a.attackerAI).toBeUndefined();
    expect(a.units.filter(u=>u.side==='attacker').every(u=>u.order==='hold')).toBe(true);
  });

  it('lets either army select and cast its learned healing skill, paying only that caster',()=>{
    const casts={attacker:0,defender:0};
    for(let seed=1;seed<=64;seed++) {
      const heal={hp:5,skillLearnset:[{level:1,sequence:1}]};
      let b=commandBattle(create(seed,heal,heal),{type:'start'});
      b.commanders.attacker.charge=b.commanders.defender.charge=120000;
      tickBattle(b,4);
      if(b.activeScript?.kind!=='native-heal')continue;
      const side=b.activeScript.side,enemy=side==='attacker'?'defender':'attacker';casts[side]++;
      expect(b.commanders[side].mp).toBe(20);expect(b.commanders[enemy].mp).toBe(40);
      expect(b.attackerAI!.lastSkill===1||b.opponentAI!.lastSkill===1).toBe(true);
      tickBattle(b,140);expect(battleGeneral(b,side).hp).toBe(35);validateBattle(b);
    }
    expect(casts.attacker).toBeGreaterThan(0);expect(casts.defender).toBeGreaterThan(0);
  });

  it('allows the attacking computer to retreat through the lottery without ordering the other army',()=>{
    let retreats=0;
    for(let seed=1;seed<=64;seed++) {
      const a=commander('a',{hp:5}),d=commander('d');
      const b=commandBattle(createBattle({id:'retreat',attacker:a,defender:d,attackingTroops:0,defendingTroops:100,seed,computerAttacker:true}),{type:'start'});
      tickBattle(b,4);
      if(b.attackerAI!.lastAction!==6)continue;
      retreats++;expect(b.nativeCommands!.attacker.flags&4).toBe(4);
      expect(b.nativeCommands!.attacker.orders).toEqual(Array(8).fill(8));
      expect(battleGeneral(b,'attacker').order).toBe('retreat');
      expect(battleGeneral(b,'defender').order).not.toBe('retreat');validateBattle(b);
    }
    expect(retreats).toBeGreaterThan(0);expect(retreats).toBeLessThan(64);
  });

  it('chooses both military advisers and their learned formations at deployment',()=>{
    const b=create(184,{formations:['玄'],strategyLearnset:[{level:1,sequence:1}]},{formations:['魚'],strategyLearnset:[{level:1,sequence:2}]},50);
    expect(b.strategies!.choices.attacker.sequence).toBe(1);
    expect(b.strategies!.choices.defender.sequence).toBe(2);
    expect(b.attackerAI!.formation).toBe(4);expect(formationToNativeIndex(b.formation)).toBe(4);
    expect(b.opponentAI!.formation).toBe(5);validateBattle(b);
  });

  it('keeps independent clocks and one shared random stream through JSON continuation',()=>{
    const b=commandBattle(create(184,{}, {},20),{type:'start'});
    b.attackerAI!.countdown=1;b.opponentAI!.countdown=31;
    const before=[...b.opponentAI!.rng];tickBattle(b);
    expect(b.attackerAI!.countdown).toBe(58);expect(b.opponentAI!.countdown).toBe(28);
    expect(b.opponentAI!.rng).not.toEqual(before);expect('rng' in b.attackerAI!).toBe(false);
    const copy=JSON.parse(JSON.stringify(b)) as BattleState;validateBattle(copy);
    for(let i=0;i<8;i++){tickBattle(b,100);tickBattle(copy,100);expect(copy).toEqual(b);}
    validateBattle(b);
  });

  it('draws the next attacking commander rather than always keeping the first survivor',()=>{
    const a=commander('a'),d=commander('d');
    let b=createBattle({id:'rounds',attacker:a,defender:d,attackingTroops:0,defendingTroops:0,seed:184,computerAttacker:true,
      rosters:{attacker:[{commander:a,troops:0,withdrawn:false},{commander:commander('a2'),troops:0,withdrawn:false}],defender:[{commander:d,troops:0,withdrawn:false},{commander:commander('d2'),troops:0,withdrawn:false}]}});
    b=commandBattle(b,{type:'start'});battleGeneral(b,'defender').hp=0;tickBattle(b);
    expect(b.phase).toBe('intermission');
    const copy=JSON.parse(JSON.stringify(b)) as BattleState,rng:NativeRandomState=[...b.opponentAI!.rng];
    const weights=nativeCommanderWeights(b.rosters.attacker.map(m=>({...m.commander,troops:m.troops,available:!m.withdrawn&&m.commander.hp>0})));
    const expected=b.rosters.attacker[nativeWeightedChoice(weights,rng)].commander.id;
    b=commandBattle(b,{type:'auto-next-round'});
    expect(b).toEqual(commandBattle(copy,{type:'auto-next-round'}));
    expect(b.commanders.attacker.id).toBe(expected);expect(b.commanders.defender.id).toBe('d2');
    expect(b.round).toBe(2);expect(b.attackerAI).toBeDefined();validateBattle(b);
  });

  it('rejects corrupt attacking AI state and does not auto-select a player army',()=>{
    const b=create();
    for(const mutate of [(c:BattleState)=>{c.attackerAI!.countdown=-1;},(c:BattleState)=>{c.attackerAI!.formation=9;},(c:BattleState)=>{delete c.opponentAI;}]) {
      const bad=structuredClone(b);mutate(bad);expect(()=>validateBattle(bad)).toThrow();
    }
    delete b.attackerAI;b.phase='intermission';
    expect(()=>commandBattle(b,{type:'auto-next-round'})).toThrow('玩家选将');
  });
});
