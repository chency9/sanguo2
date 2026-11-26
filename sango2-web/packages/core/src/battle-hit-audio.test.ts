import {readFileSync,existsSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {createBattle,commandBattle,tickBattle,validateBattle,battleGeneral,type BattleState,type BattleUnit} from './battle';
import {prepareBattleMovement} from './battle-movement';
import {updateBattleUnits} from './battle-unit-scheduler';
import {createBattleSoundEvents,type NativeAttackSound} from './battle-audio-events';
import {emitBattleHitAudio,emitBattleDamageAudio,beginBattleAttackAudio,finishBattleAttackAudio,pruneBattleHitAudio,validateBattleHitAudio} from './battle-hit-audio';
import reactionCatalogue from './native-hit-audio.json';

interface NativeReaction {object:number;kind:'pain'|'defense';text:string;native:{ticks:number;soundTicks:NativeAttackSound[];rng:number[]}}
const vectors=JSON.parse(readFileSync(new URL('../fixtures/native-hit-audio-vectors.json',import.meta.url),'utf8')) as {
  reactions:NativeReaction[];
  defenses:{input:{action:number;equalFacing:boolean;afterEnd:boolean};native:{before:{actions:number[];pending:boolean};after:{actions:number[];pending:boolean}}}[];
  soldier:({name:string;volume:number}|{event:number})[];
};
const catalogue=reactionCatalogue as Record<string,{pain:{ticks:number;soundTicks:NativeAttackSound[]};defense:{ticks:number;soundTicks:NativeAttackSound[]}}>;
function ready() {
  const commander=(id:string)=>({id,name:id,portrait:'',strength:80,intelligence:80,hp:100,mp:40,unit:'刀',level:40});
  const b=commandBattle(createBattle({id:'hit-audio',attacker:commander('a'),defender:commander('d'),attackingTroops:1,defendingTroops:1,seed:184}),{type:'start'});
  b.soundEvents=createBattleSoundEvents();
  delete b.magicRules;delete b.healRules;delete b.generalRules;delete b.cameraRules;
  prepareBattleMovement(b);
  for(const u of b.units){u.order='hold';u.movement!.clock!.decision=10000;}
  const attacker=b.units.find(u=>u.side==='attacker'&&!u.general)!,soldier=b.units.find(u=>u.side==='defender'&&!u.general)!,general=battleGeneral(b,'defender');
  attacker.movement!.facing=0;soldier.movement!.facing=0x800000;general.movement!.facing=0x800000;
  return {b,attacker,soldier,general};
}
const names=(b:BattleState)=>b.soundEvents!.events.map(e=>[e.name,e.volume,e.sourceTick]);
function place(u:BattleUnit,x:number,y:number) {
  Object.assign(u.movement!,{x,y,previousX:x,previousY:y,px:(x*96+48)*65536,py:(y*72+36)*65536});
  u.x=(x+.5)/71*1200;u.y=150+y/13*360;
}

describe('original x86 reaction sound callbacks',()=>{
  it.each(vectors.reactions.map((v,index)=>({...v,index})))('matches object $object/$kind original node selection, sound and duration',v=>{
    expect(catalogue[String(v.object)][v.kind]).toMatchObject({ticks:v.native.ticks,soundTicks:v.native.soundTicks});
    expect(v.native.rng).toEqual([0x12345678,0x87654321]);
    const {b,attacker,general}=ready();
    general.side=v.object>=800?'defender':'attacker';
    b.commanders[general.side].appearance={body:v.object-(general.side==='defender'?200:0),weapon:700,horse:900,soldier:100,
      generalAttack:{hitTick:15,ticks:30},soldierAttack:{hitTick:15,ticks:30}};
    general.action='wait';general.movement!.facing=0x800000;attacker.movement!.facing=0;
    const rng=[...b.opponentAI!.rng];
    if(v.kind==='pain')emitBattleDamageAudio(b,general,17);else emitBattleHitAudio(b,attacker,general,false,17);
    expect(b.soundEvents!.events.map(({sourceTick,name,volume})=>({tick:sourceTick-17,name,volume}))).toEqual(v.native.soundTicks);
    expect(b.opponentAI!.rng).toEqual(rng);
  });
  it('matches soldier ordinary-hit audio before its separate original death callback',()=>{
    expect(vectors.soldier).toEqual([{name:'HIT01',volume:255},{event:65539}]);
    const {b,attacker,soldier}=ready();soldier.hp=0;emitBattleHitAudio(b,attacker,soldier,true,29);
    expect(names(b)).toEqual([['HIT01',255,29]]);
  });
  it.each(vectors.defenses)('matches original defense request for action $input.action/equal-facing $input.equalFacing',({input:o,native})=>{
    const {b,attacker,general}=ready();general.action=o.action===4?'attack':o.action===32?'death':'wait';
    if(o.action===32)general.hp=0;
    general.movement!.facing=o.equalFacing?attacker.movement!.facing:0x800000;
    emitBattleHitAudio(b,attacker,general,false,12);
    // The x86 can retain a defense bit on a corpse. The audio projection drops
    // that inaudible bit because this actor can never finish another attack.
    expect((b.soundEvents!.pendingDefenses??[]).includes(general.id)).toBe(general.hp>0&&native.before.pending);
    expect(names(b).length).toBe(native.before.actions.includes(8)?1:0);
    if(o.afterEnd)finishBattleAttackAudio(b,general,30);
    expect(names(b).length).toBe(native.after.actions.includes(8)?1:0);
  });
  it('ships every reaction WAV referenced by the executable metadata',()=>{
    const sounds=new Set(vectors.reactions.flatMap(v=>v.native.soundTicks.map(s=>s.name)));
    expect(sounds).toEqual(new Set(['SOUND\\HIT01.WAV','SOUND\\DEFENSE.WAV']));
    for(const name of sounds)expect(existsSync(new URL(`../../../apps/game/public/assets/sound/${name.split('\\').at(-1)!.toLowerCase()}`,import.meta.url))).toBe(true);
  });
});

describe('saved ordinary battle audio lifecycle',()=>{
  it('keeps failed soldier attacks, dead generals, immune generals and direct magic soldier deaths silent',()=>{
    const {b,attacker,soldier,general}=ready();
    emitBattleHitAudio(b,attacker,soldier,false,1);soldier.hp=0;emitBattleDamageAudio(b,soldier,2);
    general.hp=0;emitBattleHitAudio(b,attacker,general,true,3);general.hp=90;emitBattleHitAudio(b,attacker,general,true,4,true);
    expect(names(b)).toEqual([]);expect(b.soundEvents!.pendingDefenses).toBeUndefined();
  });
  it('saves a defense request during an attack and sounds it once at the natural end',()=>{
    const {b,attacker,general}=ready();general.action='attack';general.target=attacker.id;
    Object.assign(general.movement!.clock!,{actionAge:27,attackEvent:1});
    emitBattleHitAudio(b,attacker,general,false,1);expect(names(b)).toEqual([]);validateBattle(b);
    const loaded:BattleState=JSON.parse(JSON.stringify(b));validateBattle(loaded);const rng=[...b.opponentAI!.rng];
    for(const state of [b,loaded]){state.tick++;updateBattleUnits(state,{unitType:()=>0,hit:()=>{},escaped:()=>{}});}
    expect(loaded).toEqual(b);expect(names(b)).toEqual([['SOUND\\DEFENSE.WAV',192,3]]);
    expect(b.soundEvents!.pendingDefenses).toEqual([]);expect(b.opponentAI!.rng).toEqual(rng);validateBattle(b);
    const after:BattleState=JSON.parse(JSON.stringify(b));after.tick++;updateBattleUnits(after,{unitType:()=>0,hit:()=>{},escaped:()=>{}});
    expect(names(after)).toEqual(names(b));
  });
  it('cancels pending audio for killed, escaped or removed actors without a stale save reference',()=>{
    for(const event of ['killed','escaped','removed']) {
      const {b,attacker,general}=ready();general.action='attack';emitBattleHitAudio(b,attacker,general,false,1);
      if(event==='killed')general.hp=0;else if(event==='escaped')general.escaped=true;else b.units=b.units.filter(u=>u.id!==general.id);
      pruneBattleHitAudio(b);expect(b.soundEvents!.pendingDefenses).toEqual([]);expect(names(b)).toEqual([]);validateBattleHitAudio(b,()=>{throw new Error('stale');});
    }
  });
  it('clears an interrupted defense request when a later attack starts',()=>{
    const {b,attacker,general}=ready();general.action='attack';emitBattleHitAudio(b,attacker,general,false,1);
    general.action='wait';emitBattleDamageAudio(b,general,2); // original attack was interrupted by PAIN
    beginBattleAttackAudio(b,general);finishBattleAttackAudio(b,general,32);
    expect(names(b)).toEqual([['SOUND\\HIT01.WAV',192,2]]);expect(b.soundEvents!.pendingDefenses).toEqual([]);
  });
  it('sends an actual soldier hit through damage, casualty creation and its original sound output',()=>{
    const {b,attacker,soldier,general}=ready();place(attacker,35,6);place(soldier,36,6);place(general,40,7);
    attacker.action='attack';attacker.target=soldier.id;Object.assign(attacker.movement!.clock!,{actionAge:14,attackEvent:0,special:true});
    tickBattle(b,1);expect(soldier.hp).toBe(0);expect(soldier.casualty).toBeDefined();expect(names(b)).toEqual([['HIT01',255,1]]);validateBattle(b);
    const loaded:BattleState=JSON.parse(JSON.stringify(b));tickBattle(b);tickBattle(loaded);expect(loaded).toEqual(b);expect(names(b)).toHaveLength(1);
  });
  it('sends actual nonlethal general damage to PAIN at its exact source update',()=>{
    const {b,attacker,general}=ready();place(attacker,35,6);place(general,36,6);
    attacker.action='attack';attacker.target=general.id;Object.assign(attacker.movement!.clock!,{actionAge:14,attackEvent:0,special:true});
    tickBattle(b,1);expect(general.hp).toBeGreaterThan(0);expect(general.hp).toBeLessThan(100);
    expect(names(b)).toEqual([['SOUND\\HIT01.WAV',192,1]]);validateBattle(b);
  });
});
