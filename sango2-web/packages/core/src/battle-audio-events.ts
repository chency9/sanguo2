/** Presentation-only output of original sound callbacks. The simulation stores
 * original names/volumes; the browser owns decoding, gain and playback policy. */
export interface BattleSoundEvent {id:number;sourceTick:number;name:string;volume:number}
export interface BattleSoundEvents {
  nextId:number;events:BattleSoundEvent[];
  /** Audio-only mirrors of the original deferred-defense bit. These do not
   * change a unit's action, decision clock, damage, movement or RNG. */
  pendingDefenses?:number[];
}
export interface BattleSoundHost {soundEvents?:BattleSoundEvents}
export interface NativeAttackSound {tick:number;name:string;volume:number}
export const BATTLE_SOUND_EVENT_LIMIT=256;
export const createBattleSoundEvents=():BattleSoundEvents=>({nextId:1,events:[]});

/** Missing output state denotes an older saved battle. It stays silent until
 * explicitly upgraded, so resuming it never invents previously heard audio. */
export function emitBattleSound(b:BattleSoundHost,name:string,volume:number,sourceTick:number):void {
  const state=b.soundEvents;if(!state)return;
  state.events.push({id:state.nextId++,sourceTick,name,volume});
  if(state.events.length>BATTLE_SOUND_EVENT_LIMIT)state.events.splice(0,state.events.length-BATTLE_SOUND_EVENT_LIMIT);
}

/** 0x421BF2 dispatches a node's sound when entering it, at original volume 192.
 * Attack age already persists in saves. A tick-zero node is entered on the
 * first source update; later nodes use the same ages as native hit messages. */
export function emitBattleAttackSounds(b:BattleSoundHost,sounds:readonly NativeAttackSound[]|undefined,previousAge:number,age:number,sourceTick:number):void {
  if(!b.soundEvents||!sounds)return;
  for(const sound of sounds)if((sound.tick===0&&previousAge===0&&age>0)||(sound.tick>previousAge&&sound.tick<=age)) {
    emitBattleSound(b,sound.name,sound.volume,sourceTick);
  }
}

export function validateBattleSoundEvents(b:BattleSoundHost,fail:()=>never):void {
  const state=b.soundEvents;if(state===undefined)return;
  const integer=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
  if(!state||!integer(state.nextId,1,Number.MAX_SAFE_INTEGER)||!Array.isArray(state.events)||state.events.length>BATTLE_SOUND_EVENT_LIMIT)fail();
  if(state.pendingDefenses!==undefined&&(!Array.isArray(state.pendingDefenses)||state.pendingDefenses.length>600||
    state.pendingDefenses.some(id=>!integer(id,1,2147483647))||new Set(state.pendingDefenses).size!==state.pendingDefenses.length))fail();
  let previous=0;
  for(const event of state.events) {
    if(!event||!integer(event.id,previous+1,state.nextId-1)||!integer(event.sourceTick,0,11880)||
      typeof event.name!=='string'||!/^([A-Za-z0-9_ -]+|SOUND[\\/][A-Za-z0-9_ -]+\.WAV)$/i.test(event.name)||
      !integer(event.volume,-2147483648,2147483647))fail();
    previous=event.id;
  }
}
