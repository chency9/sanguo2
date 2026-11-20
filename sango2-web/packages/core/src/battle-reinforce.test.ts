import {describe,it,expect} from 'vitest';
import {createBattle,commandBattle,tickBattle,battleSkillUnavailable,battleSurvivors,battleTeamSurvivors,validateBattle,CHARGE_LIMIT,type BattleState} from './battle';
import {prepareBattleMovement} from './battle-movement';
import {advanceBattleNativeMagic} from './battle-native-magic';
import {issueNativeCommand} from './battle-commands';
import {battleScenePoints} from './battle-scene';

function ready(level=20,troops=40,sequence=5,unit='刀') {
  const commander=(id:string)=>({id,name:id,portrait:'portraits/001.png',strength:80,intelligence:80,hp:100,maxHp:100,mp:1000,maxMp:1000,unit,level,skillLearnset:[{level:1,sequence}]});
  let b=createBattle({id:'reinforce',attacker:commander('a'),defender:{...commander('d'),skillLearnset:[]},attackingTroops:troops,defendingTroops:0,seed:184});
  b=commandBattle(b,{type:'start'});prepareBattleMovement(b);b.commanders.attacker.charge=CHARGE_LIMIT;
  return b;
}
function sourceSteps(b:BattleState,count:number) {
  for(let i=0;i<count&&b.activeScript;i++) {b.tick++;advanceBattleNativeMagic(b,()=>{});}
}
function cast(b:BattleState,sequence=5) {b.commanders.attacker.charge=CHARGE_LIMIT;return commandBattle(b,{type:'skill',sequence});}

describe('native reinforce battle integration',()=>{
  it('can replenish a short starting army before it takes any casualties',()=>{
    const b=ready();expect(battleSkillUnavailable(b,5)).toBeNull();
    const next=cast(b);sourceSteps(next,61);
    expect(battleSurvivors(next,'attacker')).toBe(57);validateBattle(next);
  });
  it('allows a full army to spend MP and take the original short no-room branch',()=>{
    let b=ready(20,100);expect(battleSkillUnavailable(b,5)).toBeNull();
    const mp=b.commanders.attacker.mp;b=cast(b);
    expect(b.commanders.attacker.mp).toBeLessThan(mp);sourceSteps(b,60);
    expect(b.activeScript?.kind).toBe('native-reinforce');
    sourceSteps(b,1);if(b.activeScript?.kind!=='native-reinforce')throw new Error('Expected native reinforce');
    expect(b.activeScript.runtime.requested).toBe(0);expect(b.activeScript.runtime.casterLocked).toBe(false);
    sourceSteps(b,108);expect(b.activeScript).toBeUndefined();
    expect(battleSurvivors(b,'attacker')).toBe(100);expect(b.units.some(u=>u.reinforceHandle!==undefined)).toBe(false);
    validateBattle(b);
  });
  it('reserves each created cell immediately and uses real battle object ids',()=>{
    const b=cast(ready());const firstId=b.nextId;sourceSteps(b,61);
    const added=b.units.filter(u=>u.reinforceHandle!==undefined);
    expect(added).toHaveLength(17);
    expect(added.map(u=>u.reinforceHandle)).toEqual(added.map(u=>u.id));
    expect(added.map(u=>u.id)).toEqual(Array.from({length:17},(_,i)=>firstId+i));
    expect(new Set(added.map(u=>`${u.movement!.x},${u.movement!.y}`)).size).toBe(17);
    validateBattle(b);
  });
  it('keeps previously revealed troops fully visible during a second cast',()=>{
    let b=cast(ready());sourceSteps(b,400);
    const first=b.units.filter(u=>u.reinforceHandle!==undefined).map(u=>u.id);
    expect(first).toHaveLength(17);expect(b.units.filter(u=>first.includes(u.id)).every(u=>u.reinforceAlpha===16)).toBe(true);
    b=cast(b);sourceSteps(b,61);
    expect(b.units.filter(u=>first.includes(u.id)).every(u=>u.reinforceAlpha===16)).toBe(true);
    expect(b.units.filter(u=>u.reinforceHandle!==undefined&&!first.includes(u.id)).every(u=>u.reinforceAlpha===0)).toBe(true);
    validateBattle(b);
  });
  it('preserves the caster soldier class for reinforcement archers',()=>{
    const b=cast(ready(20,40,5,'弓'));sourceSteps(b,61);
    expect(b.units.filter(u=>u.reinforceHandle!==undefined).every(u=>u.ranged)).toBe(true);
    validateBattle(b);
  });
  it('puts every new soldier under the first division command',()=>{
    let b=ready();issueNativeCommand(b,'attacker',1,1);issueNativeCommand(b,'attacker',2,0);
    b=cast(b);sourceSteps(b,61);
    const added=b.units.filter(u=>u.reinforceHandle!==undefined);
    expect(added).toHaveLength(17);expect(added.every(u=>u.nativeDivision===1&&u.division==='front'&&u.order==='advance')).toBe(true);
    validateBattle(b);
  });
  it('reuses the earliest dead record without replacing its saved corpse id',()=>{
    let b=cast(ready());sourceSteps(b,400);
    const victim=b.units.find(u=>u.nativeSoldierSlot===0)!;
    victim.hp=0;victim.action='death';victim.actionTick=0;
    b.effects.push({id:b.nextId++,kind:'hit',x:victim.x,y:victim.y,toX:victim.x,toY:victim.y,ticks:10,targetId:victim.id});
    b=cast(b);sourceSteps(b,61);
    const replacement=b.units.find(u=>u.hp>0&&u.nativeSoldierSlot===0)!;
    expect(replacement.id).not.toBe(victim.id);expect(replacement.reinforceHandle).toBe(replacement.id);
    expect(b.units.find(u=>u.id===victim.id)?.hp).toBe(0);
    expect(b.effects[0].targetId).toBe(victim.id);validateBattle(b);
    const snapshot=JSON.stringify(b);expect(battleScenePoints(b).size).toBe(b.units.length);expect(JSON.stringify(b)).toBe(snapshot);
  });
  it('keeps at most 200 living records through repeated casts and casualty reuse',()=>{
    let b=ready(40,0,37);
    for(let i=0;i<5;i++){b=cast(b,37);sourceSteps(b,400);validateBattle(b);}
    expect(battleSurvivors(b,'attacker')).toBe(200);
    expect(b.troopDeployment!.attacker.active).toBe(200);
    b.units.filter(u=>u.side==='attacker'&&!u.general).slice(0,30).forEach(u=>{u.hp=0;u.action='death';});
    b=cast(b,37);sourceSteps(b,400);
    expect(battleSurvivors(b,'attacker')).toBe(200);
    expect(b.troopDeployment!.attacker.active).toBe(200);
    expect(new Set(b.units.filter(u=>u.side==='attacker'&&!u.general&&u.hp>0).map(u=>u.nativeSoldierSlot)).size).toBe(200);
    validateBattle(b);expect(battleScenePoints(b).size).toBe(b.units.length);
  });
  it('replays actual partially revealed units and record slots after JSON restore',()=>{
    const b=cast(ready());sourceSteps(b,111);validateBattle(b);
    const copy=JSON.parse(JSON.stringify(b)) as BattleState;validateBattle(copy);
    const before=[...b.opponentAI!.rng];
    sourceSteps(b,400);sourceSteps(copy,400);
    expect(copy).toEqual(b);expect(b.opponentAI!.rng).toEqual(before);
    expect(b.units.filter(u=>u.reinforceHandle!==undefined).every(u=>u.reinforceAlpha===16)).toBe(true);
    validateBattle(b);
  });
  it('reconnects synthetic handles from the previously published in-flight save',()=>{
    const b=cast(ready());sourceSteps(b,111);
    if(b.activeScript?.kind!=='native-reinforce')throw new Error('Expected native reinforce');
    for(const visual of b.activeScript.runtime.visuals) {
      const unit=b.units.find(u=>u.id===visual.id)!;const old=visual.id;
      visual.id+=100000;unit.reinforceHandle=visual.id;delete unit.nativeSoldierSlot;
      for(const spawn of b.activeScript.runtime.spawns)if(spawn.handle===old)spawn.handle=visual.id;
    }
    validateBattle(b);const copy=JSON.parse(JSON.stringify(b)) as BattleState;
    sourceSteps(copy,400);
    expect(copy.units.filter(u=>u.reinforceHandle!==undefined).every(u=>u.reinforceHandle===u.id&&u.reinforceAlpha===16)).toBe(true);
    validateBattle(copy);
  });
  it('retains the earlier executor for saves without the source unit clock',()=>{
    let b=ready();
    delete b.movementRules;delete b.nativeCommands;delete b.troopDeployment;delete b.deploymentRules;
    delete b.magicRules;delete b.healRules;delete b.cameraRules;delete b.generalRules;
    delete b.casualtyRules;delete b.detached;delete b.attackRules;delete b.projectileRules;delete b.projectiles;
    for(const unit of b.units)delete unit.movement;
    b.formation='line';b.units.filter(u=>!u.general&&u.side==='attacker').slice(0,2).forEach(u=>{u.hp=0;u.action='death';});
    b=cast(b);expect(b.activeScript?.kind).toBe('magic-reinforce');expect(b.reinforceRules).toBeUndefined();
    tickBattle(b,8);expect(b.activeScript).toBeUndefined();validateBattle(b);
  });
  it.each(['duplicate-slot','negative-slot','alpha','script'])('rejects a corrupted saved reinforcement %s',field=>{
    const b=cast(ready());sourceSteps(b,111);
    const added=b.units.filter(u=>u.reinforceHandle!==undefined);
    if(field==='duplicate-slot')added[1].nativeSoldierSlot=added[0].nativeSoldierSlot;
    if(field==='negative-slot')added[0].nativeSoldierSlot=-1;
    if(field==='alpha')added[0].reinforceAlpha=NaN;
    if(field==='script'&&b.activeScript?.kind==='native-reinforce')b.activeScript.runtime.script=524;
    expect(()=>validateBattle(b)).toThrow('战场存档无效。');
  });
  it('caps active and reserve survivors separately when the round ends',()=>{
    let b=cast(ready(40,110,37),37);sourceSteps(b,400);
    expect(b.units.filter(u=>u.side==='attacker'&&!u.general&&u.hp>0&&!u.nativeReserve)).toHaveLength(145);
    b=commandBattle(b,{type:'order',division:'general',order:'retreat'});
    // A defeated enemy general ends this round without moving any soldier.
    b.units.find(u=>u.side==='defender'&&u.general)!.hp=0;
    tickBattle(b);expect(b.phase).toBe('finished');
    expect(b.rosters.attacker[0].troopSlots).toEqual({active:100,reserve:10});
    expect(b.rosters.attacker[0].troops).toBe(110);
    expect(battleTeamSurvivors(b,'attacker')).toBe(110);validateBattle(b);
  });
  it('keeps earned soldiers valid across three successive commanders',()=>{
    let b=ready(40,0,37);
    for(const side of ['attacker','defender'] as const) {
      for(let i=1;i<3;i++)b.rosters[side].push({commander:{...b.commanders[side],id:`${side}-${i}`},troops:0,withdrawn:false});
    }
    for(let round=0;round<3;round++) {
      if(round>0){b=commandBattle(b,{type:'next-round',commanderId:`attacker-${round}`});b=commandBattle(b,{type:'start'});prepareBattleMovement(b);}
      for(let i=0;i<2;i++){b=cast(b,37);sourceSteps(b,400);}
      b.units.find(u=>u.general&&u.side==='defender')!.hp=0;
      tickBattle(b);validateBattle(b);
    }
    expect(b.phase).toBe('finished');expect(battleTeamSurvivors(b,'attacker')).toBe(270);
    expect(b.rosters.attacker.map(m=>m.troopSlots)).toEqual(Array(3).fill({active:90,reserve:0}));
  });
});
