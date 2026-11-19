import {describe,it,expect} from 'vitest';
import {createBattle,commandBattle,tickBattle,battleGeneral,validateBattle,type BattleState} from './battle';
import {advanceBattleNativeMagic,battleMagicLocked,battleScriptCameraLocked} from './battle-native-magic';
import {prepareBattleMovement} from './battle-movement';

function ready(sequence=1) {
  const c={id:'a',name:'a',portrait:'portraits/001.png',strength:80,intelligence:80,hp:40,maxHp:100,mp:150,maxMp:150,unit:'刀',level:1,skillLearnset:[{level:1,sequence}]};
  let b=createBattle({id:'native-heal',attacker:c,defender:{...c,id:'d',hp:100,skillLearnset:[]},attackingTroops:0,defendingTroops:0,seed:184});
  b=commandBattle(b,{type:'start'});prepareBattleMovement(b);b.commanders.attacker.charge=120000;
  return commandBattle(b,{type:'skill',sequence});
}
const step=(b:BattleState)=>{b.opponentAI!.countdown=60;tickBattle(b);};
function heal(b:BattleState) {if(b.activeScript?.kind!=='native-heal')throw new Error('Expected native heal');return b.activeScript.runtime;}
function source(b:BattleState,count:number) {for(let i=0;i<count;i++){b.tick++;advanceBattleNativeMagic(b,()=>{throw new Error('Heal cannot damage');});}}

describe('native Heal in actual battle snapshots',()=>{
  it.each([1,60])('runs sequence %s through its original preparation and child scripts',sequence=>{
    const b=ready(sequence),caster=battleGeneral(b,'attacker');
    expect(heal(b).age).toBe(0);source(b,40);expect(caster.hp).toBe(40);expect(battleMagicLocked(b,caster)).toBe(false);
    const m=caster.movement!;m.px=1234*65536;m.py=504*65536;
    source(b,1);expect(heal(b).camera).toEqual({x:1234,y:384});expect(m.clock!.deferred).toBe(200);
    expect(battleMagicLocked(b,caster)).toBe(true);expect(battleScriptCameraLocked(b)).toBe(true);
    source(b,99);expect(caster.hp).toBe(40);
    // IncreaseHP samples HP at its own start, not when the cast was requested.
    caster.hp=20;source(b,1);expect(caster.hp).toBe(21);source(b,1);expect(caster.hp).toBe(21);
    caster.hp=7;source(b,1);expect(caster.hp).toBe(22);
    source(b,149);expect(battleMagicLocked(b,caster)).toBe(false);
    source(b,100);expect(b.activeScript).toBeUndefined();expect(battleScriptCameraLocked(b)).toBe(false);
    expect(caster.hp).toBe(sequence===1?50:55);validateBattle(b);
  });
  it('keeps its original waits and random child scripts even when already at maximum HP',()=>{
    const b=ready(),caster=battleGeneral(b,'attacker');caster.hp=100;source(b,200);
    expect(caster.hp).toBe(100);expect(heal(b).objects.length).toBeGreaterThan(31);
    expect(heal(b).phase).toBe('heal');source(b,192);expect(b.activeScript).toBeUndefined();validateBattle(b);
  });
  it.each([1,14,21,24,34,47,66,94,110,126])('restores every pending child and random state after grouped step %s',at=>{
    const b=ready(60);for(let i=0;i<at;i++)step(b);validateBattle(b);
    const restored=JSON.parse(JSON.stringify(b)) as BattleState;validateBattle(restored);
    for(let i=0;i<140;i++){step(b);step(restored);expect(restored).toEqual(b);}validateBattle(b);
  });
  it('preserves the legacy immediate loop when the new saved rule is absent',()=>{
    let b=ready();delete b.activeScript;delete b.healRules;b.commanders.attacker.charge=120000;
    b=commandBattle(b,{type:'skill',sequence:1});expect(b.activeScript?.kind).toBe('heal');step(b);
    expect(battleGeneral(b,'attacker').hp).toBe(41);validateBattle(b);
  });
  it.each(['amount','owner','rule','task','due','handle','resource','camera','rng-value'])('rejects corrupt heal %s',field=>{
    const b=ready();source(b,150);const s=heal(b);
    if(field==='amount')s.amount++;
    if(field==='owner'&&b.activeScript?.kind==='native-heal')b.activeScript.casterId=battleGeneral(b,'defender').id;
    if(field==='rule')delete b.healRules;
    if(field==='task')(s.tasks[0] as {kind:string}).kind='unknown';
    if(field==='due')s.tasks[0].due=-1;
    if(field==='handle')s.objects[0].handle++;
    if(field==='resource')s.objects[0].object=13001;
    if(field==='camera')s.camera!.x=NaN;
    if(field==='rng-value')s.tasks[0].args.push(NaN);
    expect(()=>validateBattle(b)).toThrow();
  });
});
