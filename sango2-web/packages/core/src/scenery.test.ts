import {expect,it} from 'vitest';
import {createBattle,commandBattle,tickBattle,validateBattle,battleGeneral} from './battle';

const commander={id:'a',name:'甲',portrait:'portraits/001.png',strength:80,intelligence:80,hp:100,mp:40,unit:'刀'};
const fresh=()=>createBattle({id:'scenery',attacker:commander,defender:{...commander,id:'b'},attackingTroops:100,defendingTroops:100,seed:184,
  rosters:{attacker:[{commander,troops:100,withdrawn:false}],defender:['b','c'].map(id=>({commander:{...commander,id},troops:100,withdrawn:false}))}});

it('chooses all original terrain variants without changing deployed soldiers, clock or RNG',()=>{
  const original=fresh();
  for(let terrainId=0;terrainId<12;terrainId++)for(const variant of ['a','b'] as const) {
    const b=commandBattle(original,{type:'scenery',terrainId,variant});
    expect(b.units).toEqual(original.units);expect(b.rng).toBe(original.rng);expect(b.tick).toBe(0);
    expect(b.scenery).toEqual({terrainId,variant});expect(()=>validateBattle(b)).not.toThrow();
  }
});
it('retains scenery through commander selection, round changes and JSON saves',()=>{
  let b=commandBattle(fresh(),{type:'scenery',terrainId:8,variant:'b'});
  b=commandBattle(b,{type:'select-commander',commanderId:'a'});
  b=commandBattle(b,{type:'start'});battleGeneral(b,'defender').hp=0;tickBattle(b);
  expect(b.phase).toBe('intermission');
  b=commandBattle(JSON.parse(JSON.stringify(b)),{type:'next-round',commanderId:'a'});
  expect(b.scenery).toEqual({terrainId:8,variant:'b'});expect(()=>validateBattle(b)).not.toThrow();
});
it('accepts earlier saves and rejects corrupt scenery or changes during campaign/combat',()=>{
  const old=fresh();delete old.scenery;expect(()=>validateBattle(old)).not.toThrow();
  for(const terrainId of [-1,12,NaN,1.5])expect(()=>commandBattle(fresh(),{type:'scenery',terrainId,variant:'a'})).toThrow();
  const corrupt=fresh();corrupt.scenery!.variant='c' as 'a';expect(()=>validateBattle(corrupt)).toThrow();
  const campaign=fresh();campaign.armyId='army';
  expect(()=>commandBattle(campaign,{type:'scenery',terrainId:4,variant:'a'})).toThrow();
  expect(()=>commandBattle(commandBattle(fresh(),{type:'start'}),{type:'scenery',terrainId:4,variant:'a'})).toThrow();
});
