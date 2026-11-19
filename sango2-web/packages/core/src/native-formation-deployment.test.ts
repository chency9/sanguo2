import {describe,it,expect} from 'vitest';
import vectors from '../fixtures/native-formation-vectors.json';
import {nativeFormationDeployment} from './native-formation-deployment';
import {prepareBattleMovement} from './battle-movement';
import {projectBattleCell} from './native-battle-grid';
import {availableFormations,defaultFormation,nativeFormationMask} from './battle-formations';
import {createBattle,commandBattle,tickBattle,validateBattle,battleMovementCell,NATIVE_FORMATIONS,type BattleCommander} from './battle';

describe('hash-pinned original formation deployment',()=>{
  it.each(vectors.vectors.map((v,index)=>({...v,index})))('matches original coordinates, division and reserves $index',v=>{
    expect(nativeFormationDeployment(v.input)).toEqual(v.native);
  });
});
const commander=(id:string,formations?:string[]):BattleCommander=>({id,name:id,portrait:'portraits/001.png',strength:80,intelligence:80,hp:100,mp:40,unit:'刀',level:40,formations});
const create=(a?:string[],d?:string[],seed=184)=>createBattle({id:'formations',attacker:commander('a',a),defender:commander('d',d),attackingTroops:200,defendingTroops:200,seed});

describe('formation learning and battle lifecycle',()=>{
  it('maps all nine source learning tags and supplies only basic Fang for absent metadata',()=>{
    expect(nativeFormationMask(['方','圓','錐','雁','玄','魚','鉤','衝','箭'])).toBe(511);
    expect(availableFormations(undefined).map(f=>f.id)).toEqual(['fang']);
    expect(availableFormations([]).map(f=>f.id)).toEqual(['fang']);
    expect(defaultFormation(['圓','玄'])).toBe('yuan');
  });
  it('selects a learned default, rejects unlearned commands, and preserves loaded legacy values',()=>{
    const b=create(['圓','玄'],['玄','魚']);expect(b.formation).toBe('yuan');
    expect(()=>commandBattle(b,{type:'formation',formation:'zhui'})).toThrow('未习得');
    expect(commandBattle(b,{type:'formation',formation:'xuan'}).formation).toBe('xuan');
    expect(b.formation).toBe('yuan');
    for(const formation of ['line','wedge','square'] as const) {
      const old=create();old.formation=formation;delete old.deploymentRules;
      const restored=JSON.parse(JSON.stringify(old));validateBattle(restored);expect(restored.formation).toBe(formation);
    }
  });
  it('restricts enemy selection to learned slots in the original seven-slot AI',()=>{
    for(let seed=1;seed<=50;seed++) {
      const b=create(['方'],['圓','玄','衝','箭'],seed);
      expect([1,4]).toContain(b.opponentAI!.formation);
    }
  });
  it('keeps issued orders when the player changes formation',()=>{
    let b=commandBattle(create(['圓','玄']),{type:'order',division:'front',order:'advance'});
    b=commandBattle(b,{type:'formation',formation:'xuan'});
    expect(b.units.filter(u=>u.side==='attacker'&&u.division==='front').every(u=>u.order==='advance')).toBe(true);
    expect(b.units.filter(u=>u.side==='attacker'&&u.division==='rear').every(u=>u.order==='hold')).toBe(true);
  });
  it('retains old pixel projections across JSON instead of silently redeploying a saved battle',()=>{
    const b=createBattle({id:'old-grid',attacker:commander('a',['方']),defender:commander('d',['方']),attackingTroops:1,defendingTroops:1,seed:184});
    delete b.deploymentRules;
    const expected=b.units.map(u=>projectBattleCell(u.x,u.y)),rng=b.opponentAI!.rng.slice();
    const restored=JSON.parse(JSON.stringify(b));validateBattle(restored);prepareBattleMovement(restored);
    expect(restored.units.map((u:typeof b.units[number])=>{const {x,y}=battleMovementCell(u);return {x,y};})).toEqual(expected);
    expect(restored.opponentAI!.rng).toEqual(rng);expect(restored.deploymentRules).toBeUndefined();
  });
  it('rejects unknown deployment versions and incompatible saved rule combinations',()=>{
    for(const change of [(b:Record<string,unknown>)=>{b.deploymentRules='future';},(b:Record<string,unknown>)=>{delete b.troopDeployment;},(b:Record<string,unknown>)=>{b.movementRules='native-grid-v2';}]) {
      const bad=JSON.parse(JSON.stringify(create()));change(bad);expect(()=>validateBattle(bad)).toThrow();
    }
  });
  it('uses source cells independently of displayed spacing and preserves replay after JSON',()=>{
    for(const f of NATIVE_FORMATIONS) {
      let b=commandBattle(create(NATIVE_FORMATIONS.map(f=>f.id),['方']),{type:'formation',formation:f.id});
      const expected=nativeFormationDeployment({formation:f.nativeIndex,active:100,reserve:100,mirror:false});
      prepareBattleMovement(b);
      const units=b.units.filter(u=>u.side==='attacker'&&!u.general);
      expect(units.map(u=>{const {x,y}=battleMovementCell(u);return {x,y,reserve:u.nativeReserve};})).toEqual(expected.soldiers.map(({x,y,reserve})=>({x,y,reserve})));
      expect(units.map(u=>u.division)).toEqual(expected.soldiers.map(p=>p.division===2?'rear':'front'));
      const enemy=nativeFormationDeployment({formation:b.opponentAI!.formation!,active:100,reserve:100,mirror:true,obstacles:[expected.general,...expected.soldiers.map(p=>[p.x,p.y])]});
      const defenders=b.units.filter(u=>u.side==='defender'&&!u.general);
      expect(defenders.map(u=>{const {x,y}=battleMovementCell(u);return {x,y,reserve:u.nativeReserve};})).toEqual(enemy.soldiers.map(({x,y,reserve})=>({x,y,reserve})));
      for(const u of b.units)expect(u.movement).toMatchObject({px:(u.movement!.x*96+48)*65536,py:(u.movement!.y*72+36)*65536});
      b=commandBattle(b,{type:'start'});tickBattle(b);
      const restored=JSON.parse(JSON.stringify(b));validateBattle(restored);
      tickBattle(b,20);tickBattle(restored,20);expect(restored).toEqual(b);
    }
  });
});
