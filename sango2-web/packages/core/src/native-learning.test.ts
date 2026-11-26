import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import type {GameContent} from '@sango2/content';
import {createSession as createNativeSession,dispatch,readSession,validateSession} from './index';
import {knownMagicSequences,learnedMagicSequences} from './native-battle-rules';
import {battleGeneral,battleSkillUnavailable,commandBattle,createBattle,validateBattle} from './battle';

const content=JSON.parse(readFileSync(new URL('../../../apps/game/public/assets/content.json',import.meta.url),'utf8')) as GameContent;
const scene=content.scenarios[0];
const cao=scene.generals.find(g=>g.name==='曹操')!;

describe('native general initialization and learning',()=>{
  it('retains every skill occurrence instead of treating the last learning level as an ID',()=>{
    expect(cao.skillLearnset).toHaveLength(8);
    expect(cao.skillLearnset?.at(-1)).toEqual({level:41,sequence:42});
    expect(cao.skillLearnset?.[0]).toEqual({level:1,sequence:4});
    expect(learnedMagicSequences(cao.skillLearnset!,cao.level!)).toEqual([4]);
    // The native manifest now covers the full 1-110 table, so sequence 4 is
    // recognized as an executable inferred skill instead of being filtered out.
    expect(knownMagicSequences(cao.rawSkill,cao.level,cao.skillLearnset)).toEqual([4]);
    expect(knownMagicSequences('1, 2',1)).toEqual([2]);
    expect(knownMagicSequences('1, 2',0)).toEqual([]);
    expect(knownMagicSequences('1',99)).toEqual([]);
    expect(knownMagicSequences('8, 1',7)).toEqual([]);
    expect(knownMagicSequences('8, 1',8)).toEqual([1]);
  });
  it('uses the first match per level, original slot limit and ascending level order',()=>{
    expect(learnedMagicSequences([{level:5,sequence:3},{level:1,sequence:2},{level:1,sequence:1}],5)).toEqual([2,3]);
    expect(learnedMagicSequences([...Array.from({length:8},(_,i)=>({level:i+2,sequence:i+10})),{level:1,sequence:1}],99)).toEqual([10,11,12,13,14,15,16,17]);
  });
  it('initializes source experience-derived vitals in all five scenarios',()=>{
    const generals=content.scenarios.map(s=>s.generals.find(g=>g.name==='曹操')!);
    expect(generals.map(g=>[g.level,g.hp,g.mp])).toEqual([[2,86,47],[2,86,47],[4,89,51],[6,93,55],[8,96,58]]);
    expect(generals.map(g=>[g.baseHp,g.baseMp])).toEqual(Array(5).fill([83,44]));
    for(const s of content.scenarios)for(const g of s.generals) {
      expect(g.level).toBeGreaterThanOrEqual(1);
      expect(g.skillLearnset!.length).toBeLessThanOrEqual(8);
      expect(g.strategyLearnset!.length).toBeLessThanOrEqual(8);
      expect(g.rawSkill.split('\n').slice(0,8).length).toBe(g.skillLearnset!.length);
    }
  });
  it('uses the same casting gate for UI and simulation and never consumes a rejected cast',()=>{
    const a={...cao,level:1,skillLearnset:[{level:1,sequence:1},{level:1,sequence:2}]};
    let b=createBattle({id:'gates',attacker:a,defender:cao,attackingTroops:0,defendingTroops:0,seed:1});
    expect(battleSkillUnavailable(b,1)).toBe('尚未开战');
    b=commandBattle(b,{type:'start'});
    expect(battleSkillUnavailable(b,1)).toBe('集气未满');
    b.commanders.attacker.charge=120000;
    expect(battleSkillUnavailable(b,1)).toBeNull();
    const cast=commandBattle(b,{type:'skill',sequence:1});
    expect(battleSkillUnavailable(cast,1)).toBe('正在施法');
    b.commanders.attacker.mp=0;
    expect(battleSkillUnavailable(b,1)).toBe('技力不足');
    b.commanders.attacker.mp=40;
    b.commanders.attacker.skillLearnset=[{level:1,sequence:2}];
    expect(battleSkillUnavailable(b,2)).toBeNull();
    const projectile=commandBattle(b,{type:'skill',sequence:2});
    expect(projectile.activeScript?.kind).toBe('native-shoot');
    expect(projectile.commanders.attacker.mp).toBe(22);
    b.commanders.attacker.skillLearnset=[{level:1,sequence:1}];
    battleGeneral(b,'attacker').escaped=true;
    expect(battleSkillUnavailable(b,1)).toBe('主将无法施法');
  });
  it('preserves in-flight legacy battle state while recovering source learning metadata',()=>{
    let s=createSession(content,scene.id,scene.factions[0].id);
    // This regression restores a pre-source-movement saved encounter.
    delete s.movementRules;
    const from=scene.cities.find(c=>c.ownerId===s.factionId&&scene.roads.some(r=>r.from===c.id&&!r.restricted&&s.cities[r.to].ownerId!==s.factionId&&s.cities[r.to].ownerId))!;
    const road=scene.roads.find(r=>r.from===from.id&&!r.restricted&&s.cities[r.to].ownerId!==s.factionId&&s.cities[r.to].ownerId)!;
    const general=scene.generals.find(g=>g.cityId===from.id&&g.ownerId===s.factionId)!;
    s=dispatch(s,{type:'march',from:from.id,to:road.to,generalIds:[general.id],troops:40},content);
    while(!s.battle)s=dispatch(s,{type:'advance',days:1},content);
    const b=s.battle!;
    for(const side of ['attacker','defender'] as const) {
      for(const c of [b.commanders[side],...b.rosters[side].map(m=>m.commander)]) {
        delete c.level;delete c.skillLearnset;c.rawSkill='41, 42';
      }
    }
    const before=structuredClone(b);
    const loaded=readSession(s,content);
    expect(loaded.battle!.commanders.attacker.skillLearnset).toEqual(general.skillLearnset);
    expect(loaded.battle!.units).toEqual(before.units);
    expect(loaded.battle!.rng).toBe(before.rng);
    expect(loaded.battle!.commanders.attacker.hp).toBe(before.commanders.attacker.hp);
    expect(loaded.battle!.commanders.attacker.charge).toBe(before.commanders.attacker.charge);
    expect(()=>validateSession(loaded,content)).not.toThrow();
    loaded.battle!.commanders.attacker.skillLearnset=[{level:NaN,sequence:1}];
    expect(()=>validateBattle(loaded.battle)).toThrow();
  });
});

function createSession(...args:Parameters<typeof createNativeSession>) {
  return dispatch(createNativeSession(...args),{type:"policy-finish"},args[0]);
}
