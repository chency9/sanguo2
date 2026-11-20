export interface FactionDefinition {
  id: string; name: string; leaderId: string | null; color: string; select: number; special: boolean;
  aiType?:number;flagNumber?:number;
}
export interface CityDefinition {
  id: string; name: string; ownerId: string | null; governorId: string | null;
  position: [number, number]; money: number; population: number; defense: number;
  nativeFlags?:number;searchCategory?:number;
  /** Original battle scenery selected for this strategic location, when known. */
  battleScenery?:{terrainId:number;variant:'a'|'b'};
  /** One source-backed scenery sample for each three-month season. */
  battleSceneryBySeason?:{terrainId:number;variant:'a'|'b'}[];
}
export interface RoadDefinition {
  id: string; from: string; to: string; length: number; points: [number, number][]; restricted: boolean;
}
export interface AttackTiming { hitTick: number; ticks: number }
export interface SkillLearning { level:number; sequence:number }
export interface CombatAppearance {
  body: number; weapon: number; horse: number; soldier: number;
  generalAttack: AttackTiming; soldierAttack: AttackTiming;
  reserveSoldierAttack?:AttackTiming;
}
export interface GeneralDefinition {
  id: string; name: string; portrait: string; strength: number; intelligence: number;
  hp: number; mp: number; loyalty: number; status: string; cityId: string | null; ownerId: string | null;
  weapon: string; horse: string; item: string; unit: string; formations: string[];
  rawSkill: string; rawStrategy: string; sourceLine: number;
  appearance?: CombatAppearance; bodyType?: number; baseExperience?: number;
  loyalFactionId?:string|null;
  forceMask?:number;
  level?:number; baseHp?:number; baseMp?:number; speed?:number; skillLearnset?:SkillLearning[]; strategyLearnset?:SkillLearning[];
}
export interface ScenarioDefinition {
  id: string; title: string; year: number; factions: FactionDefinition[];
  cities: CityDefinition[]; roads: RoadDefinition[]; generals: GeneralDefinition[];
  initialization?:'native-105plus';
}
export interface TerrainDefinition {
  id:number; name:string; soundtrack:number; sourceLine:number; floor:string;
  variants:{id:'a'|'b'; background:string; midground:string; foreground:string}[];
}
export interface GameContent {
  version: 1; id: string; sourceHash: string; scenarios: ScenarioDefinition[];
  skills: Record<string, string>[]; strategies: Record<string, string>[]; items: Record<string, string>[];
  terrains:TerrainDefinition[];
}

export function scenarioById(content: GameContent, id: string): ScenarioDefinition {
  const scenario = content.scenarios.find(s => s.id === id);
  if (!scenario) throw new Error('没有找到对应剧本，请重新选择。');
  return scenario;
}

export function validateContent(value: unknown): asserts value is GameContent {
  if (!value || typeof value !== 'object') throw new Error('游戏资料格式无效。');
  const c = value as GameContent;
  if (c.version !== 1 || typeof c.id !== 'string' || !/^[a-f0-9]{64}$/.test(c.sourceHash) ||
      !Array.isArray(c.scenarios) || c.scenarios.length !== 5) throw new Error('游戏资料版本不受支持，请重新生成资源。');
  if(!Array.isArray(c.terrains)||c.terrains.length!==12||new Set(c.terrains.map(t=>t.id)).size!==12)throw new Error('战场地形资料不完整，请重新生成资源。');
  for(const t of c.terrains) {
    const asset=(path:unknown)=>typeof path==='string'&&/^battle\/terrain-\d{2}\/[a-z-]+\.png$/.test(path);
    if(!Number.isInteger(t.id)||t.id<0||t.id>11||typeof t.name!=='string'||![4,5,6].includes(t.soundtrack)||!asset(t.floor)||
      !Array.isArray(t.variants)||t.variants.length!==2||t.variants[0].id!=='a'||t.variants[1].id!=='b'||
      t.variants.some(v=>![v.background,v.midground,v.foreground].every(asset)))throw new Error('战场地形资料无效。');
  }
  for (const s of c.scenarios) {
    if (!Array.isArray(s.cities) || s.cities.length !== 60 || !Array.isArray(s.generals) || s.generals.length !== 401 ||
        !Array.isArray(s.roads) || s.roads.length !== 116 || !Array.isArray(s.factions)) throw new Error('剧本资料不完整。');
    for (const list of [s.cities, s.generals, s.roads, s.factions]) {
      if (list.some(x => typeof x.id !== 'string') || new Set(list.map(x => x.id)).size !== list.length) throw new Error('资料中存在重复编号。');
    }
    const cities = new Set(s.cities.map(c => c.id));
    if(s.initialization!==undefined&&s.initialization!=='native-105plus')throw new Error('剧本初始化规则无效。');
    if(s.cities.some(c=>c.searchCategory!==undefined&&(!Number.isInteger(c.searchCategory)||c.searchCategory<1||c.searchCategory>5)))throw new Error('城池搜索类别无效。');
    if(s.cities.some(c=>c.battleScenery!==undefined&&(!Number.isInteger(c.battleScenery.terrainId)||c.battleScenery.terrainId<0||c.battleScenery.terrainId>11||!['a','b'].includes(c.battleScenery.variant))))throw new Error('城池战场景色资料无效。');
    if(s.cities.some(c=>c.battleSceneryBySeason!==undefined&&(!Array.isArray(c.battleSceneryBySeason)||c.battleSceneryBySeason.length!==4||c.battleSceneryBySeason.some(v=>!v||!Number.isInteger(v.terrainId)||v.terrainId<0||v.terrainId>11||!['a','b'].includes(v.variant)))))throw new Error('城池季节战场景色资料无效。');
    if(s.generals.some(g=>g.loyalFactionId!==undefined&&g.loyalFactionId!==null&&!s.factions.some(f=>f.id===g.loyalFactionId)))throw new Error('武将情义势力资料无效。');
    if(s.generals.some(g=>g.speed!==undefined&&(!Number.isInteger(g.speed)||g.speed < -32768||g.speed>32767)))throw new Error('武将速度资料无效。');
    if(s.generals.some(g=>g.forceMask!==undefined&&(!Number.isInteger(g.forceMask)||g.forceMask<0||g.forceMask>8191)))throw new Error('武将兵种资料无效。');
    if (s.roads.some(r => !cities.has(r.from) || !cities.has(r.to) || !Number.isFinite(r.length) || r.points.length < 2)) throw new Error('道路资料无效。');
  }
}
