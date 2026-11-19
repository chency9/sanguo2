/** Static normal-speed scheduler: 0x450410, 0x4685C0, 0x4685F0.
 * Runtime rendering, pause flags and the original slow-motion branch still need comparison. */
export const NATIVE_UPDATE_SECONDS=17/1024;
export const NATIVE_BATTLE_UPDATES=11880; // 0x444614 initializes 0x4AC35C.
export const NATIVE_COUNT_UPDATES=120; // 0x440DC3; these are counts, not seconds.

export function nativeCountdown(remainingUpdates:number) {
  const count=Math.max(0,Math.min(99,Math.trunc(remainingUpdates/NATIVE_COUNT_UPDATES)));
  // FONTS05 ASCII 58 is the Chinese 十 glyph. Zero remains the native zero glyph.
  const text=count<=10?String.fromCharCode(48+count):count<20?`:${count%10}`:
    `${Math.trunc(count/10)}:${count%10||''}`;
  return {count,glyphs:[...text].map(c=>c.charCodeAt(0)),x:text.length===1?308:text.length===2?299:289};
}
