import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createBattle,commandBattle,validateBattle,type BattleState,type BattleUnit} from './battle';
import {prepareBattleMovement} from './battle-movement';
import {updateBattleUnits} from './battle-unit-scheduler';
import {nativeAttackAction,battleAttackAction} from './native-attack-animation';
import {
  BATTLE_SOUND_EVENT_LIMIT,createBattleSoundEvents,emitBattleSound,emitBattleAttackSounds,validateBattleSoundEvents,
  type BattleSoundHost,type NativeAttackSound,
} from './battle-audio-events';

const fail=():never=>{throw new Error('Invalid battle audio');};
describe('original battle sound event output',()=>{
  it('keeps original names, volumes, simultaneous events and stable IDs',()=>{
    const b:BattleSoundHost={soundEvents:createBattleSoundEvents()};
    emitBattleSound(b,'SOUND\\ATT01.WAV',192,1);emitBattleSound(b,'M008SND01',255,1);
    expect(b.soundEvents).toEqual({nextId:3,events:[{id:1,sourceTick:1,name:'SOUND\\ATT01.WAV',volume:192},{id:2,sourceTick:1,name:'M008SND01',volume:255}]});
    validateBattleSoundEvents(b,fail);
  });
  it('emits node-zero once and every crossed node, including two sounds at the same tick',()=>{
    const b:BattleSoundHost={soundEvents:createBattleSoundEvents()},sounds:NativeAttackSound[]=[
      {tick:0,name:'ATT01',volume:192},{tick:3,name:'ATT02',volume:192},{tick:3,name:'HIT01',volume:192},{tick:8,name:'ATT03',volume:192},
    ];
    emitBattleAttackSounds(b,sounds,0,1,1);emitBattleAttackSounds(b,sounds,1,2,2);emitBattleAttackSounds(b,sounds,2,3,3);
    expect(b.soundEvents!.events.map(e=>[e.name,e.sourceTick])).toEqual([['ATT01',1],['ATT02',3],['HIT01',3]]);
    const restored:BattleSoundHost=JSON.parse(JSON.stringify(b));
    emitBattleAttackSounds(b,sounds,3,9,9);emitBattleAttackSounds(restored,sounds,3,9,9);
    expect(restored).toEqual(b);expect(b.soundEvents!.events.map(e=>e.name)).toEqual(['ATT01','ATT02','HIT01','ATT03']);
  });
  it('retains a bounded tail without resetting the delivery sequence',()=>{
    const b:BattleSoundHost={soundEvents:createBattleSoundEvents()};
    for(let i=0;i<300;i++)emitBattleSound(b,'ATT01',192,i);
    expect(b.soundEvents!.events).toHaveLength(BATTLE_SOUND_EVENT_LIMIT);expect(b.soundEvents!.nextId).toBe(301);
    expect(b.soundEvents!.events[0].id).toBe(45);expect(b.soundEvents!.events.at(-1)!.id).toBe(300);validateBattleSoundEvents(b,fail);
  });
  it('does not synthesize events for older battles without an audio state',()=>{
    const b:BattleSoundHost={};emitBattleSound(b,'ATT01',192,1);
    emitBattleAttackSounds(b,[{tick:0,name:'ATT01',volume:192}],0,1,1);expect(b).toEqual({});validateBattleSoundEvents(b,fail);
  });
  it('rejects corrupt IDs, timestamps, paths, volumes and oversized queues',()=>{
    const valid:BattleSoundHost={soundEvents:{nextId:3,events:[{id:1,sourceTick:1,name:'ATT01',volume:192},{id:2,sourceTick:3,name:'SOUND\\HIT01.WAV',volume:192}]}};
    const mutations=[
      (b:BattleSoundHost)=>{b.soundEvents!.nextId=2;},
      (b:BattleSoundHost)=>{b.soundEvents!.events[1].id=1;},
      (b:BattleSoundHost)=>{b.soundEvents!.events[0].sourceTick=-1;},
      (b:BattleSoundHost)=>{b.soundEvents!.events[0].sourceTick=11881;},
      (b:BattleSoundHost)=>{b.soundEvents!.events[0].name='../../ATT01.WAV';},
      (b:BattleSoundHost)=>{b.soundEvents!.events[0].volume=NaN;},
      (b:BattleSoundHost)=>{b.soundEvents!.events=Array.from({length:257},()=>b.soundEvents!.events[0]);},
    ];
    for(const mutate of mutations){const bad=structuredClone(valid);mutate(bad);expect(()=>validateBattleSoundEvents(bad,fail)).toThrow();}
  });
});

type AudioBattle=BattleState&Required<BattleSoundHost>;
function ready():{b:AudioBattle;actor:BattleUnit;enemy:BattleUnit} {
  const commander=(id:string)=>({id,name:id,portrait:'',strength:80,intelligence:80,hp:100,mp:40,unit:'刀',level:40});
  const b=commandBattle(createBattle({id:'attack-audio',attacker:commander('a'),defender:commander('d'),attackingTroops:1,defendingTroops:1,seed:184}),{type:'start'}) as AudioBattle;
  b.soundEvents=createBattleSoundEvents();
  delete b.projectileRules;delete b.projectiles;delete b.magicRules;delete b.generalRules;delete b.cameraRules;delete b.healRules;
  prepareBattleMovement(b);
  for(const u of b.units){u.order='hold';u.movement!.clock!.decision=10000;}
  const actor=b.units.find(u=>!u.general&&u.side==='attacker')!,enemy=b.units.find(u=>!u.general&&u.side==='defender')!;
  for(const [u,x] of [[actor,35],[enemy,36]] as const) {
    Object.assign(u.movement!,{x,y:6,previousX:x,previousY:6,px:(x*96+48)*65536,py:(6*72+36)*65536});
    u.x=(x+.5)/71*1200;u.y=150+6/13*360;
  }
  return {b,actor,enemy};
}
function step(b:BattleState) {b.tick++;updateBattleUnits(b,{unitType:()=>0,hit:()=>{},escaped:()=>{}});}

describe('attack sound nodes in the saved source scheduler',()=>{
  it.each([false,true])('emits every ordinary/special node at its source update, special=%s',special=>{
    const {b,actor,enemy}=ready();actor.action='attack';actor.target=enemy.id;
    Object.assign(actor.movement!.clock!,{actionAge:0,attackEvent:0,special});
    const timing=battleAttackAction(b,actor)!.timing;
    const original=timing.soundTicks;
    // The timeline adapter accepts all native node layouts, even those absent
    // from the current attack catalogue (e.g. multiple sounds within a group).
    timing.soundTicks=[{tick:0,name:'ATT01',volume:192},{tick:3,name:'ATT02',volume:192},{tick:15,name:'HIT01',volume:192}];
    try {
      const rng=[...b.opponentAI!.rng];step(b);
      expect(b.soundEvents.events.map(e=>[e.name,e.sourceTick])).toEqual([['ATT01',1],['ATT02',3]]);
      expect(b.opponentAI!.rng).toEqual(rng);validateBattle(b);
      const loaded:AudioBattle=JSON.parse(JSON.stringify(b));validateBattle(loaded);
      for(let i=0;i<10;i++){step(b);step(loaded);}
      expect(loaded).toEqual(b);
      expect(b.soundEvents.events.map(e=>[e.name,e.sourceTick])).toEqual([['ATT01',1],['ATT02',3],['HIT01',15]]);
      expect(b.opponentAI!.rng).toEqual(rng);validateBattle(b);
    } finally {if(original===undefined)delete timing.soundTicks;else timing.soundTicks=original;}
  });
  it('dispatches the first native node when a target starts a new attack',()=>{
    const {b,actor}=ready(),timing=nativeAttackAction(100,false)!,original=timing.soundTicks;
    timing.soundTicks=[{tick:0,name:'ATT01',volume:192}];actor.movement!.clock!.decision=1;
    try {step(b);expect(actor.action).toBe('attack');expect(b.soundEvents.events).toEqual([{id:1,sourceTick:1,name:'ATT01',volume:192}]);}
    finally {if(original===undefined)delete timing.soundTicks;else timing.soundTicks=original;}
  });
  it('uses the converted catalogue sound names and node volumes unchanged',()=>{
    const catalogue=JSON.parse(readFileSync(new URL('./native-attack-actions.json',import.meta.url),'utf8')) as Record<string,Record<string,{soundTicks?:NativeAttackSound[]}>>;
    for(const [object,actions] of Object.entries(catalogue))for(const [key,timing] of Object.entries(actions)) {
      expect(nativeAttackAction(Number(object),key==='specialAttack')!.soundTicks).toEqual(timing.soundTicks);
    }
  });
});
