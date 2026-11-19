/**
 * Native 1.05+ formation names and their stable Web adapters.
 *
 * Officers learn nine ordinary formation slots (0..8); native AI chooses only
 * slots 0..6. The executable also contains special deployment tables. Older Web saves used
 * line/wedge/square, so those values remain accepted as aliases while all new
 * UI state uses the native names below.
 */
export type NativeFormation = 'fang' | 'yuan' | 'zhui' | 'yan' | 'xuan' | 'yu' | 'gou' | 'chong' | 'jian';
export type Formation = NativeFormation | 'line' | 'wedge' | 'square';

export interface FormationDefinition {
  id: NativeFormation;
  nativeIndex: number;
  label: string;
  /** Human-readable tactical description shown in the battle controls. */
  description: string;
}

export const NATIVE_FORMATIONS: readonly FormationDefinition[] = [
  { id: 'fang', nativeIndex: 0, label: '方阵', description: '纵深均衡，适合正面推进' },
  { id: 'yuan', nativeIndex: 1, label: '圆阵', description: '环形守势，适合兵力不足时固守' },
  { id: 'zhui', nativeIndex: 2, label: '锥形阵', description: '集中锋线，适合突破敌阵' },
  { id: 'yan', nativeIndex: 3, label: '雁形阵', description: '展开两翼，适合夹击敌军' },
  { id: 'xuan', nativeIndex: 4, label: '玄襄阵', description: '多列承伤，适合牵制强敌' },
  { id: 'yu', nativeIndex: 5, label: '鱼丽阵', description: '前、中、后三部分列' },
  { id: 'gou', nativeIndex: 6, label: '钩形阵', description: '一翼前伸，适合包抄侧翼' },
  { id: 'chong', nativeIndex: 7, label: '冲锋阵', description: '前、后、左、右四部分列' },
  { id: 'jian', nativeIndex: 8, label: '箭矢阵', description: '前锋呈箭头，后军居后' },
] as const;

export const FORMATION_OPTIONS = NATIVE_FORMATIONS.map(({ id, label, description }) => ({ id, label, description }));

const byId = new Map<string, FormationDefinition>(NATIVE_FORMATIONS.map(definition => [definition.id, definition]));
const aliases: Record<string, number> = {
  // Native names (both simplified and traditional spellings).
  方: 0, 圆: 1, 圓: 1, 锥: 2, 錐: 2, 雁: 3, 玄: 4, 鱼: 5, 魚: 5, 钩: 6, 鉤: 6, 冲: 7, 衝: 7, 箭: 8,
  // Stable English ids are useful for JSON and DOM values.
  fang: 0, yuan: 1, zhui: 2, yan: 3, xuan: 4, yu: 5, gou: 6, chong: 7, jian: 8,
  // Compatibility aliases from the first Web battle implementation.
  line: 0, square: 0, wedge: 2,
};

/** Convert any current or legacy formation value to the native slot index. */
export function formationToNativeIndex(value: Formation | string | undefined): number {
  if (value === undefined) return 0;
  return aliases[value] ?? 0;
}

export function nativeIndexToFormation(index: number): NativeFormation {
  return NATIVE_FORMATIONS[Math.max(0, Math.min(NATIVE_FORMATIONS.length - 1, Math.trunc(index)))].id;
}

export function formationDefinition(value: Formation | string | number): FormationDefinition {
  const index = typeof value === 'number' ? value : formationToNativeIndex(value);
  return NATIVE_FORMATIONS[Math.max(0, Math.min(NATIVE_FORMATIONS.length - 1, Math.trunc(index)))];
}

export function formationLabel(value: Formation | string | number): string {
  return formationDefinition(value).label;
}

/** Translate officer data, which stores the native Chinese formation names. */
export function nativeFormationMask(names: readonly string[] | undefined): number {
  return (names ?? ['方']).reduce((mask, name) => {
    const index = aliases[name.trim()];
    return index === undefined ? mask : mask | (1 << index);
  }, 0);
}

/** Missing/empty legacy metadata permits only the basic formation. Never
 * infer that an officer has learned every formation from absent save data. */
export function availableFormations(names: readonly string[] | undefined): readonly FormationDefinition[] {
  const mask = nativeFormationMask(names) || 1;
  return NATIVE_FORMATIONS.filter(definition => mask & (1 << definition.nativeIndex));
}

export function defaultFormation(names: readonly string[] | undefined): NativeFormation {
  return availableFormations(names)[0].id;
}

export function canUseFormation(names: readonly string[] | undefined, value: Formation): boolean {
  return availableFormations(names).some(definition => definition.nativeIndex === formationToNativeIndex(value));
}

export function isNativeFormation(value: string): value is NativeFormation {
  return byId.has(value);
}
