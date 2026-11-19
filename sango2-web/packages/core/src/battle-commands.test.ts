import {describe,it,expect} from 'vitest';
import {createBattle,commandBattle,tickBattle,validateBattle,type BattleCommander} from './battle';
import {issueNativeCommand,advanceNativeAI,battleChargeTarget} from './battle-commands';
import {prepareBattleMovement,planBattleMovement} from './battle-movement';

const commander=(id:string):BattleCommander=>({id,name:id,portrait:'',strength:80,intelligence:80,hp:100,mp:40,unit:'刀',level:40,formations:['玄','魚','方']});
const fresh=()=>createBattle({id:'commands',attacker:commander('a'),defender:commander('d'),attackingTroops:200,defendingTroops:200,seed:184});

describe('native command lifecycle',()=>{
  it('keeps the original five divisions and starts both sides at rest',()=>{
    const b=commandBattle(fresh(),{type:'formation',formation:'xuan'});
    expect([...new Set(b.units.filter(u=>u.side==='attacker').map(u=>u.nativeDivision))].sort()).toEqual([0,1,2,3,4,5]);
    expect(b.units.every(u=>u.order==='hold')).toBe(true);validateBattle(b);
  });
  it('commands a wing without moving the other divisions or general and retains it after reformation',()=>{
    let b=commandBattle(fresh(),{type:'formation',formation:'xuan'});
    b=commandBattle(b,{type:'native-order',division:3,command:1});
    expect(b.units.filter(u=>u.side==='attacker'&&u.order==='advance').map(u=>u.nativeDivision)).toEqual(Array(b.units.filter(u=>u.side==='attacker'&&u.nativeDivision===3).length).fill(3));
    b=commandBattle(b,{type:'formation',formation:'yu'});
    expect(b.nativeCommands!.attacker.orders).toEqual([0,0,0,1,0,0,0,0]);validateBattle(b);
  });
  it('charges soldiers while preserving the independent general order',()=>{
    let b=commandBattle(fresh(),{type:'native-order',division:257,command:7});
    expect(b.units.filter(u=>u.general).every(u=>u.order==='hold')).toBe(true);
    expect(b.nativeCommands!.attacker.orders).toEqual([0,7,7,7,7,7,7,7]);
    b=commandBattle(b,{type:'start'});tickBattle(b,15);validateBattle(b);
    expect(b.units.filter(u=>u.side==='attacker'&&!u.general).some(u=>u.movement!.x!==u.movement!.previousX)).toBe(true);
  });
  it('advances native AI divisions in stages and leaves the general behind',()=>{
    const b=fresh();b.opponentAI!.formation=5;
    for(const expected of [[0,1,0,0,0,0,0,0],[0,1,0,0,0,1,0,0],[0,1,1,0,0,1,0,0]]) {
      advanceNativeAI(b);expect(b.nativeCommands!.defender.orders).toEqual(expected);
    }
    expect(b.units.find(u=>u.side==='defender'&&u.general)!.order).toBe('hold');validateBattle(b);
  });
  it('shares the source charge target and moves to the next created soldier after death',()=>{
    const b=fresh(),enemies=b.units.filter(u=>u.side==='defender'&&!u.general);
    expect(battleChargeTarget(b,'attacker').id).toBe(enemies[0].id);
    enemies[0].hp=0;enemies[0].action='death';
    expect(battleChargeTarget(b,'attacker').id).toBe(enemies[1].id);
    const restored=JSON.parse(JSON.stringify(b));validateBattle(restored);
    expect(battleChargeTarget(restored,'attacker').id).toBe(enemies[1].id);
    for(const u of enemies){u.hp=0;u.action='death';}
    expect(battleChargeTarget(b,'attacker').general).toBe(true);
  });
  it('preserves commands and RNG across a moving battle save',()=>{
    let b=commandBattle(fresh(),{type:'native-order',division:257,command:5});
    b=commandBattle(b,{type:'start'});tickBattle(b,22);
    const restored=JSON.parse(JSON.stringify(b));validateBattle(restored);
    tickBattle(b,90);tickBattle(restored,90);expect(restored).toEqual(b);validateBattle(b);
  });
  it('retains a faded charge target until the shared source cursor advances',()=>{
    const b=commandBattle(fresh(),{type:'start'}),first=battleChargeTarget(b,'attacker');
    first.hp=0;first.action='death';first.actionTick=50;tickBattle(b);
    expect(b.units.some(u=>u.id===first.id)).toBe(true);validateBattle(b);
    expect(battleChargeTarget(b,'attacker').id).not.toBe(first.id);
    tickBattle(b);expect(b.units.some(u=>u.id===first.id)).toBe(false);validateBattle(b);
  });
  it('keeps backward movement in the battle while retreat exits and locks new orders',()=>{
    let b=commandBattle(fresh(),{type:'native-order',division:0,command:2});prepareBattleMovement(b);
    const u=b.units.find(u=>u.side==='attacker'&&u.general)!;
    Object.assign(u.movement!,{x:0,previousX:0,px:48*65536});
    planBattleMovement(b,u,undefined);
    expect(u.movement!.exiting).toBe(false);expect(b.nativeCommands!.attacker.orders[0]).toBe(0);expect(u.order).toBe('hold');
    b=commandBattle(b,{type:'native-order',division:3,command:8});
    expect(b.nativeCommands!.attacker.orders).toEqual(Array(8).fill(8));expect(b.units.filter(u=>u.side==='attacker').every(u=>u.order==='retreat')).toBe(true);
    expect(()=>commandBattle(b,{type:'native-order',division:256,command:0})).toThrow('不能中止');
    expect(()=>commandBattle(b,{type:'order',division:'all',order:'advance'})).toThrow('不能中止');validateBattle(b);
  });
  it('keeps existing saved battles on their legacy command adapter',()=>{
    const old=fresh();delete old.nativeCommands;
    const b=commandBattle(JSON.parse(JSON.stringify(old)),{type:'order',division:'front',order:'advance'});
    expect(b.nativeCommands).toBeUndefined();expect(()=>commandBattle(b,{type:'native-order',division:3,command:1})).toThrow('旧战斗');validateBattle(b);
  });
  it('rejects invalid slots, general-only unsupported commands and corrupt saves',()=>{
    const b=fresh();
    expect(()=>commandBattle(b,{type:'native-order',division:6,command:1})).toThrow();
    expect(()=>commandBattle(b,{type:'native-order',division:0,command:7})).toThrow();
    for(const mutate of [
      (x:typeof b)=>{x.nativeCommands!.attacker.orders[0]=7;},
      (x:typeof b)=>{x.nativeCommands!.attacker.orders.pop();},
      (x:typeof b)=>{x.nativeCommands!.attacker.target=999999;},
      (x:typeof b)=>{x.units[1].nativeDivision=0;},
      (x:typeof b)=>{x.units[1].order='advance';},
      (x:typeof b)=>{delete x.movementRules;}
    ]){const bad=structuredClone(b);mutate(bad);expect(()=>validateBattle(bad)).toThrow();}
  });
});
