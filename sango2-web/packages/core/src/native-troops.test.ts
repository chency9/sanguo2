import {describe,it,expect} from 'vitest';
import vectors from '../fixtures/native-troop-vectors.json';
import {nativeTroopCapacity,nativeTroopDivisions,nativeSoldierObject,allocateBattleTroops} from './native-troops';
import {createBattle,commandBattle,tickBattle,battleGeneral,battleFieldTroops,battleSurvivors,validateBattle,NATIVE_FORMATIONS,type BattleCommander,type BattleState} from './battle';

describe('hash-pinned 1.05+ troop functions',()=>{
  it.each(vectors.capacities)('matches original capacity at level $level',v=>{
    const c=nativeTroopCapacity(v.level);expect([c.active,c.reserve]).toEqual(v.native);
  });
  it.each(vectors.allocations)('matches formation $formation / count $count / reserve $reserve',v=>{
    expect(nativeTroopDivisions(v.formation,v.count,v.reserve)).toEqual(v.native);
  });
  it.each(vectors.objects)('matches sprites for unit $unit / side $side',v=>{
    expect(nativeSoldierObject(v.unit,false,!!v.side)).toBe(v.active);
    expect(nativeSoldierObject(v.unit,true,!!v.side)).toBe(v.reserve);
  });
});
const commander=(id:string,level=40):BattleCommander=>({id,name:id,portrait:'portraits/001.png',strength:80,intelligence:80,hp:100,mp:40,unit:'刀',level,formations:['方','圓','錐','雁','玄','魚','鉤','衝','箭']});
function battle(total=200,level=40) {
  return createBattle({id:'troops',attacker:commander('a',level),defender:commander('d',level),attackingTroops:total,defendingTroops:total,seed:184});
}
const soldiers=(b:BattleState,reserve:boolean)=>b.units.filter(u=>u.side==='attacker'&&!u.general&&u.hp>0&&u.nativeReserve===reserve);
describe('native troop deployment integration',()=>{
  it('deploys both classes immediately and keeps scaled bodies apart for 200 soldiers',()=>{
    const b=battle();expect(soldiers(b,false)).toHaveLength(100);expect(soldiers(b,true)).toHaveLength(100);
    expect(b.reserves.attacker).toBe(0);expect(battleFieldTroops(b,'attacker')).toBe(200);
    for(const side of ['attacker','defender'] as const) {
      const units=b.units.filter(u=>u.side===side&&!u.general);
      for(let i=0;i<units.length;i++)for(let j=0;j<i;j++)expect(Math.hypot((units[i].x-units[j].x)/24,(units[i].y-units[j].y)/27)).toBeGreaterThanOrEqual(1);
    }
    validateBattle(b);
  });
  it('applies level capacity without treating saved excess as reinforcement waves',()=>{
    let b=battle(80,2);expect(b.troopDeployment!.attacker).toEqual({active:10,reserve:0});
    expect(b.reserves.attacker).toBe(70);b=commandBattle(b,{type:'start'});
    soldiers(b,false).slice(0,3).forEach(u=>{u.hp=0;u.action='death';});tickBattle(b,40);
    expect(battleFieldTroops(b,'attacker')).toBe(7);expect(battleSurvivors(b,'attacker')).toBe(77);
    expect(b.reserves.attacker).toBe(70);validateBattle(b);
  });
  it('assigns front/rear rounding separately and keeps total/classes when changing formation',()=>{
    let b=battle(133,27);
    expect(soldiers(b,false).filter(u=>u.division==='rear')).toHaveLength(30);
    expect(soldiers(b,true).filter(u=>u.division==='rear')).toHaveLength(10);
    b=commandBattle(b,{type:'formation',formation:'wedge'});
    expect(soldiers(b,false)).toHaveLength(100);expect(soldiers(b,true)).toHaveLength(33);validateBattle(b);
  });
  it('deploys every native formation through the player command without changing troop totals',()=>{
    for(const definition of NATIVE_FORMATIONS) {
      const b=commandBattle(battle(100,40),{type:'formation',formation:definition.id});
      expect(battleSurvivors(b,'attacker')).toBe(100);
      const units=b.units.filter(u=>u.side==='attacker'&&!u.general);
      expect(units).toHaveLength(100);
      for(let i=0;i<units.length;i++)for(let j=0;j<i;j++)
        expect(Math.hypot((units[i].x-units[j].x)/32,(units[i].y-units[j].y)/36)).toBeGreaterThanOrEqual(1);
      validateBattle(b);
    }
  });
  it('preserves separate class casualties and overflow through intermission, JSON and next round',()=>{
    const a=commander('a'),d=commander('d');
    let b=createBattle({id:'rounds',attacker:a,defender:d,attackingTroops:230,defendingTroops:200,seed:184,
      rosters:{attacker:[{commander:a,troops:230,withdrawn:false}],defender:[{commander:d,troops:200,withdrawn:false},{commander:commander('d2'),troops:200,withdrawn:false}]}});
    b=commandBattle(b,{type:'start'});soldiers(b,false).slice(0,13).forEach(u=>{u.hp=0;u.action='death';});
    soldiers(b,true).slice(0,8).forEach(u=>{u.hp=0;u.action='death';});battleGeneral(b,'defender').hp=0;tickBattle(b);
    expect(b.phase).toBe('intermission');expect(b.rosters.attacker[0].troopSlots).toEqual({active:87,reserve:92});
    const restored=JSON.parse(JSON.stringify(b));validateBattle(restored);
    b=commandBattle(b,{type:'next-round',commanderId:'a'});
    expect(b).toEqual(commandBattle(restored,{type:'next-round',commanderId:'a'}));
    expect(b.troopDeployment!.attacker).toEqual({active:87,reserve:92});expect(b.reserves.attacker).toBe(30);validateBattle(b);
  });
  it('resumes a full deployment without changing RNG or troop classes',()=>{
    let b=commandBattle(battle(),{type:'order',division:'all',order:'advance'});b=commandBattle(b,{type:'start'});tickBattle(b,100);
    const restored=JSON.parse(JSON.stringify(b));validateBattle(restored);tickBattle(b,150);tickBattle(restored,150);expect(restored).toEqual(b);
  });
  it('rejects corrupt class counts and missing flags in new saves',()=>{
    const b=battle();b.troopDeployment!.attacker.active=99;expect(()=>validateBattle(b)).toThrow();
    const c=battle();delete soldiers(c,true)[0].nativeReserve;expect(()=>validateBattle(c)).toThrow();
    const d=battle();d.rosters.attacker[0].troopSlots={active:-1,reserve:100};expect(()=>validateBattle(d)).toThrow();
    const e=battle(80,2);e.troopDeployment!.attacker.active=11;expect(()=>validateBattle(e)).toThrow();
  });
  it('preserves valid saved slots and rejects malformed allocation hints',()=>{
    expect(allocateBattleTroops(150,40,{active:60,reserve:80})).toEqual({active:60,reserve:80,overflow:10});
    expect(allocateBattleTroops(150,40,{active:-1,reserve:80})).toEqual({active:100,reserve:50,overflow:0});
  });
});
