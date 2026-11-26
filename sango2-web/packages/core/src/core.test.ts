import { describe, expect, it } from 'vitest';
import type { GameContent } from '@sango2/content';
import { createSession, dispatch, validateSession, readSession, battleSceneryForCity, roadMidpointTerrainForDay, strategicArmyPosition, strategicEncounterPosition } from './index';

// Small independent fixture: owned origin, friendly outpost, neutral city, enemy city.
const content: GameContent = {
  version: 1, id: 'test-content', sourceHash: 'a'.repeat(64), skills: [], strategies: [], items: [], terrains:[],
  scenarios: [{ id: 'era', title: '测试时代', year: 184,
    factions: [{ id: 'a', name: '甲', leaderId: 'g1', color: '#fff', select: 1, special: false }, { id: 'b', name: '乙', leaderId: 'g2', color: '#aaa', select: 1, special: false }],
    cities: ['home','friend','neutral','enemy'].map((id,i) => ({ id, name: id, ownerId: i < 2 ? 'a' : i === 2 ? null : 'b', governorId: null, position: [i*100,100], money: 1000, population: 10000, defense: 50 })),
    roads: ['friend','neutral','enemy'].map((to,i) => ({ id: `r${i}`, from: 'home', to, length: 180, points: [[0,100],[100,100]], restricted: false })),
    generals: ['g1','g2'].map((id,i) => ({ id, name: id, portrait: '', strength: i ? 40 : 90, intelligence: 80, hp: 80, mp: 50, loyalty: 100, status: '登', cityId: i ? 'enemy' : 'home', ownerId: i ? 'b' : 'a', weapon: '', horse: '', item: '', unit: '', formations: [], rawSkill: '', rawStrategy: '', sourceLine: 1 })),
  }],
};
// Retain the original preview-save regression suite independently of new policy rules.
const fresh = () => { const s=createSession(content, 'era', 'a');delete s.policy;return s; };
const march = (to = 'neutral', troops = 60) => ({ type: 'march' as const, from: 'home', to, generalIds: ['g1'], troops });

describe('strategic preview rules', () => {
  it('creates all owners and validates a fresh session', () => { const s = fresh(); expect(s.cities.home.troops).toBe(80); expect(s.cities.neutral.troops).toBe(0); expect(() => validateSession(s, content)).not.toThrow(); });
  it('applies development immutably, once per city per day', () => {
    const original = fresh(); const next = dispatch(original, { type: 'develop', cityId: 'home' }, content);
    expect(original.cities.home.money).toBe(1000); expect(next.cities.home).toMatchObject({ money: 700, defense: 70, population: 10500 });
    expect(() => dispatch(next, { type: 'recruit', cityId: 'home' }, content)).toThrow('今日');
    const tomorrow = dispatch(next, { type: 'advance', days: 1 }, content);
    const recruited = dispatch(tomorrow, { type: 'recruit', cityId: 'home' }, content);
    expect(recruited.cities.home).toMatchObject({ money: 400, troops: 130, population: 10450 });
    expect(recruited.nativeAI!.reserves.home).toBe(1); // original passive recruitment costs 100
  });
  it('rejects foreign city actions, inadequate funds, and absent officers', () => {
    expect(() => dispatch(fresh(), { type: 'develop', cityId: 'enemy' }, content)).toThrow('我方');
    const poor = fresh(); poor.cities.home.money = 0;
    expect(() => dispatch(poor, { type: 'develop', cityId: 'home' }, content)).toThrow('金钱不足');
    expect(() => dispatch(fresh(), { type: 'develop', cityId: 'friend' }, content)).toThrow('武将');
  });
  it('keeps army and officers in transit until arrival, then captures a neutral city with conserved troops', () => {
    const s = dispatch(fresh(), march(), content);
    expect(s.generals.g1).toMatchObject({ cityId: null, armyId: s.armies[0].id });
    expect(s.cities.home.troops).toBe(20);
    const halfway = dispatch(s, { type: 'advance', days: 2 }, content);
    expect(halfway.cities.neutral.ownerId).toBeNull(); expect(halfway.armies[0].remainingDays).toBe(1);
    const arrived = dispatch(halfway, { type: 'advance', days: 1 }, content);
    expect(arrived.armies).toEqual([]); expect(arrived.cities.neutral).toMatchObject({ ownerId: 'a', troops: 60 });
    expect(arrived.generals.g1).toMatchObject({ cityId: 'neutral', armyId: null });
    expect(arrived.cities.home.troops + arrived.cities.neutral.troops).toBe(80);
    expect(() => validateSession(arrived, content)).not.toThrow();
  });
  it('rejects duplicate officers, excessive troops, and restricted or nonexistent roads', () => {
    expect(() => dispatch(fresh(), { ...march(), generalIds: ['g1','g1'] }, content)).toThrow('武将');
    expect(() => dispatch(fresh(), march('neutral',81), content)).toThrow('兵力');
    expect(() => dispatch(fresh(), march('missing'), content)).toThrow('道路');
    const restricted = structuredClone(content); restricted.scenarios[0].roads[1].restricted = true;
    expect(() => dispatch(fresh(), march(), restricted)).toThrow('道路');
  });
  it('reinforces a friendly city without a battle or ownership change', () => {
    const s = dispatch(dispatch(fresh(), march('friend'), content), { type: 'advance', days: 3 }, content);
    expect(s.cities.friend.troops).toBe(140); expect(s.reports).toEqual([]);
  });
  it('replays identical battles after JSON save/restore', () => {
    const s = dispatch(fresh(), march('enemy',80), content);
    const restored: unknown = JSON.parse(JSON.stringify(s)); validateSession(restored,content);
    const a = dispatch(s,{type:'advance',days:3},content); const b = dispatch(restored,{type:'advance',days:3},content);
    expect(a).toEqual(b); expect(a.reports).toHaveLength(0);expect(a.battle?.phase).toBe('deployment'); expect(() => validateSession(a,content)).not.toThrow();
    expect(()=>dispatch(a,{type:'advance',days:1},content)).toThrow('当前战斗');
  });
  it('carries a source-backed city scenery mapping into campaign battles', () => {
    const pack = structuredClone(content);
    pack.scenarios[0].cities.find(c => c.id === 'enemy')!.battleScenery = {terrainId: 10, variant: 'a'};
    let s = dispatch(fresh(), march('enemy', 80), pack);
    s = dispatch(s, {type:'advance', days: 3}, pack);
    expect(s.battle?.scenery).toEqual({terrainId: 10, variant: 'a'});
    expect(s.battle?.cityId).toBe('enemy');
    expect(() => validateSession(s, pack)).not.toThrow();
  });
  it('selects the native three-month scenery mask by campaign day', () => {
    const scene = structuredClone(content.scenarios[0]);
    scene.cities[0].battleSceneryBySeason = [
      {terrainId: 1, variant: 'a'}, {terrainId: 2, variant: 'b'},
      {terrainId: 3, variant: 'a'}, {terrainId: 4, variant: 'b'},
    ];
    expect(battleSceneryForCity(scene, 'home', 0)).toEqual({terrainId: 1, variant: 'a'});
    expect(battleSceneryForCity(scene, 'home', 89)).toEqual({terrainId: 1, variant: 'a'});
    expect(battleSceneryForCity(scene, 'home', 90)).toEqual({terrainId: 2, variant: 'b'});
    expect(battleSceneryForCity(scene, 'home', 270)).toEqual({terrainId: 4, variant: 'b'});
    expect(battleSceneryForCity(scene, 'home', 360)).toEqual({terrainId: 1, variant: 'a'});
    scene.cities[0].battleSceneryMode='random';
    const rng:[number,number]=[184,0x87654321],before=[...rng];
    expect(['a','b']).toContain(battleSceneryForCity(scene, 'home', 0, rng).variant);
    expect(rng).not.toEqual(before);
    scene.cities[0].battleSceneryMode='b';
    expect(battleSceneryForCity(scene, 'home', 0, rng).variant).toBe('b');
  });
  it('uses live city capacity for castle scenery and freezes the chosen scene in battle saves',()=>{
    const pack=structuredClone(content),scene=pack.scenarios[0];
    scene.cities.find(c=>c.id==='enemy')!.battleScenery={terrainId:2,variant:'a'};
    for(const [population,terrainId] of [[30000,0],[239999,0],[240000,1],[520000,2]] as const) {
      let s=fresh();s.cities.enemy.population=population;
      s=dispatch(dispatch(s,march('enemy',80),pack),{type:'advance',days:3},pack);
      expect(s.battle!.scenery).toEqual({terrainId,variant:'a'});
      s.cities.enemy.population=1000000;
      expect(readSession(JSON.parse(JSON.stringify(s)),pack).battle!.scenery).toEqual({terrainId,variant:'a'});
    }
  });
  it('exposes source-backed seasonal terrain at a road midpoint', () => {
    const scene = structuredClone(content.scenarios[0]);
    scene.roads[0].midpointTerrainBySeason = [2, 3, 4, 5];
    expect(roadMidpointTerrainForDay(scene, scene.roads[0].id, 0)).toBe(2);
    expect(roadMidpointTerrainForDay(scene, scene.roads[0].id, 90)).toBe(3);
    expect(roadMidpointTerrainForDay(scene, scene.roads[0].id, 360)).toBe(2);
    expect(roadMidpointTerrainForDay(scene, 'missing', 0)).toBeNull();
  });
  it('projects marching armies on the same polyline used by the map', () => {
    const s=dispatch(fresh(),march(),content),army=s.armies[0];
    expect(strategicArmyPosition(content.scenarios[0],army)).toEqual([0,100]);
    const halfway=dispatch(s,{type:'advance',days:1},content),moved=halfway.armies[0];
    expect(strategicArmyPosition(content.scenarios[0],moved)?.[0]).toBeCloseTo(33.333333,5);
    const second=dispatch(fresh(),{type:'march',from:'home',to:'neutral',generalIds:['g1'],troops:60},content).armies[0];
    const meeting=strategicEncounterPosition(content.scenarios[0],moved,second);
    expect(meeting?.[0]).toBeCloseTo(16.666666,5);expect(meeting?.[1]).toBe(100);
  });
  it('returns surviving attackers after a loss', () => {
    const initial = fresh(); initial.cities.enemy.troops = 1000;
    let s = dispatch(dispatch(initial,march('enemy'),content),{type:'advance',days:3},content);
    s=dispatch(s,{type:'battle-command',command:{type:'order',division:'all',order:'retreat'}},content);
    s=dispatch(s,{type:'battle-command',command:{type:'start'}},content);
    for(let i=0;i<20&&s.battle?.phase==='fighting';i++)s=dispatch(s,{type:'battle-tick',steps:200},content);
    expect(s.battle?.winner).toBe('defender');
    s=dispatch(s,{type:'battle-finish'},content);
    expect(s.reports[0].won).toBe(false); expect(s.generals.g1.cityId).toBe('home'); expect(s.cities.home.troops).toBe(80);
    expect(()=>dispatch(s,{type:'battle-finish'},content)).toThrow('没有');
  });
  it('upgrades old strategic saves without discarding their progress',()=>{
    const old={...fresh(),ruleset:'web-strategy-preview-v1'};delete (old as {battle?:unknown}).battle;
    const migrated=readSession(old,content);expect(migrated.battle).toBeNull();expect(migrated.cities).toEqual(old.cities);
  });
  it('writes a tactical victory into city ownership once',()=>{
    const initial=fresh();initial.cities.enemy.troops=0;
    let s=dispatch(dispatch(initial,march('enemy'),content),{type:'advance',days:3},content);
    s=dispatch(s,{type:'battle-command',command:{type:'order',division:'all',order:'advance'}},content);
    s=dispatch(s,{type:'battle-command',command:{type:'start'}},content);
    for(let i=0;i<18&&s.battle?.phase!=='finished';i++)s=dispatch(s,{type:'battle-tick',steps:200},content);
    expect(s.battle?.winner).toBe('attacker');
    s=dispatch(s,{type:'battle-finish'},content);
    expect(s.cities.enemy.ownerId).toBe('a');expect(s.generals.g1.cityId).toBe('enemy');expect(s.reports).toHaveLength(1);
    expect(()=>validateSession(s,content)).not.toThrow();
  });
  it('queues simultaneous arrivals without advancing an extra day after battle',()=>{
    const pack=structuredClone(content);
    pack.scenarios[0].generals.push({...pack.scenarios[0].generals[0],id:'g3',name:'g3'});
    let s=createSession(pack,'era','a');delete s.policy;
    s=dispatch(s,march('enemy',60),pack);
    s=dispatch(s,{...march('neutral',40),generalIds:['g3']},pack);
    s=dispatch(s,{type:'advance',days:30},pack);
    expect(s.day).toBe(3);expect(s.armies).toHaveLength(2);expect(()=>validateSession(s,pack)).not.toThrow();
    s=dispatch(s,{type:'battle-command',command:{type:'order',division:'all',order:'retreat'}},pack);
    s=dispatch(s,{type:'battle-command',command:{type:'start'}},pack);
    for(let i=0;i<20&&s.battle?.phase==='fighting';i++)s=dispatch(s,{type:'battle-tick',steps:200},pack);
    s=dispatch(s,{type:'battle-finish'},pack);
    expect(s.day).toBe(3);expect(s.cities.neutral.ownerId).toBe('a');expect(s.cities.neutral.troops).toBe(40);expect(s.armies).toHaveLength(0);
  });
  it('accrues income on day thirty and enforces bounded advances', () => {
    const after=dispatch(fresh(),{type:'advance',days:30},content);
    expect(after.cities.home.money+after.nativeAI!.reserves.home*100).toBe(1010);
    expect(() => dispatch(fresh(),{type:'advance',days:31},content)).toThrow('天数');
  });
  it.each(['hash','negative','orphan','double','unknown','counter','inherited-city'])('rejects a corrupt save: %s', problem => {
    const s = dispatch(fresh(),march(),content);
    if(problem==='hash') s.contentHash='wrong';
    if(problem==='negative') s.cities.home.money=-1;
    if(problem==='orphan') s.generals.g1.armyId='nonexistent';
    if(problem==='double') s.armies[0].generalIds.push('g1');
    if(problem==='unknown') delete s.cities.neutral;
    if(problem==='counter') s.nextId=1;
    if(problem==='inherited-city') s.generals.g2.cityId='__proto__';
    expect(() => validateSession(s,content)).toThrow();
  });
});
