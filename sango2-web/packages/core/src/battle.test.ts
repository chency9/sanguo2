import { describe,it,expect } from 'vitest';
import { createBattle,commandBattle,tickBattle,battleSurvivors,battleFieldTroops,battleGeneral,validateBattle,CHARGE_LIMIT,type BattleState } from './battle';
import {issueNativeCommand} from './battle-commands';
const commander=(id:string,unit='刀',rawSkill='')=>({id,name:id,portrait:'portraits/001.png',strength:80,intelligence:80,hp:100,mp:40,unit,rawSkill,level:20,formations:['方','錐']});
const fresh=()=>createBattle({id:'test',attacker:commander('a'),defender:commander('b','弓'),attackingTroops:100,defendingTroops:100,seed:184});
const start=(b:BattleState)=>commandBattle(commandBattle(b,{type:'order',division:'all',order:'advance'}),{type:'start'});
const chargedSkillBattle=(sequence:number,attackingTroops=24,defendingTroops=24)=>{
  const attacker={...commander('a','刀',`1, ${sequence}`),mp:100,level:1,skillLearnset:[{level:1,sequence}]};
  let b=createBattle({id:`skill-${sequence}`,attacker,defender:commander('b','槍'),attackingTroops,defendingTroops,seed:184});
  b=commandBattle(b,{type:'start'});b.commanders.attacker.charge=CHARGE_LIMIT;
  return b;
};
// Pre-native-deployment saves had 100 on-field soldiers and reinforcement waves.
function legacy(b:BattleState):BattleState {delete b.nativeCommands;delete b.troopDeployment;delete b.deploymentRules;b.formation='line';return b;}
describe('real-time battle',()=>{
  it.each(['line','wedge','square'] as const)('leaves visible space between all 100 soldiers in %s formation',formation=>{
    const b=commandBattle(fresh(),{type:'formation',formation});
    for(const side of ['attacker','defender'] as const) {
      const soldiers=b.units.filter(u=>u.side===side&&!u.general);
      expect(soldiers).toHaveLength(100);
      // A readable body needs roughly 32 x 36 world units, excluding weapons.
      for(let i=0;i<soldiers.length;i++)for(let j=0;j<i;j++) {
        const a=soldiers[i],c=soldiers[j];
        expect(Math.hypot((a.x-c.x)/32,(a.y-c.y)/36)).toBeGreaterThanOrEqual(1);
      }
    }
  });
  it('does not simulate before the player starts and applies formation without adding soldiers',()=>{
    const b=fresh();tickBattle(b,100);expect(b.tick).toBe(0);
    const formed=commandBattle(b,{type:'formation',formation:'wedge'});
    expect(battleSurvivors(formed,'attacker')).toBe(100);
    expect(formed.units.find(u=>!u.general)?.x).not.toBe(b.units.find(u=>!u.general)?.x);
    expect(()=>validateBattle(formed)).not.toThrow();
  });
  it('executes the verified IncreaseHP chain point by point and waits between writes',()=>{
    let b=createBattle({id:'heal',attacker:{...commander('a','刀','1, 1'),hp:60,maxHp:100},defender:commander('b'),attackingTroops:0,defendingTroops:0,seed:184});
    b=commandBattle(b,{type:'start'});for(let i=0;i<260;i++)tickBattle(b);
    expect(b.commanders.attacker.charge).toBe(120000);
    delete b.healRules; // Legacy saves keep the previous immediate loop.
    b=commandBattle(b,{type:'skill',sequence:1});expect(b.commanders.attacker.mp).toBe(20);
    expect(b.activeScript?.kind).toBe('heal');
    if(b.activeScript?.kind!=='heal')throw new Error('expected heal script');
    expect(b.activeScript.nextPoint).toBe(1);
    tickBattle(b);expect(battleGeneral(b,'attacker').hp).toBe(61);
    expect(b.activeScript?.kind).toBe('heal');
    if(b.activeScript?.kind!=='heal')throw new Error('expected heal script');
    expect(b.activeScript.wait).toBe(0);
    tickBattle(b);expect(battleGeneral(b,'attacker').hp).toBe(62);
    for(let i=0;i<28;i++)tickBattle(b);
    expect(battleGeneral(b,'attacker').hp).toBe(90);expect(b.activeScript).toBeUndefined();
    expect(()=>validateBattle(b)).not.toThrow();
  });
  it('executes inferred area magic against real field soldiers and survives JSON replay',()=>{
    let b=chargedSkillBattle(3);const before=battleFieldTroops(b,'defender');
    b=commandBattle(b,{type:'skill',sequence:3});expect(b.activeScript?.kind).toBe('magic-area');
    const restored=JSON.parse(JSON.stringify(b)) as BattleState;validateBattle(restored);
    tickBattle(b,8);tickBattle(restored,8);
    expect(restored).toEqual(b);expect(b.activeScript).toBeUndefined();expect(battleFieldTroops(b,'defender')).toBeLessThan(before);
  });
  it('executes inferred reinforce magic by returning lost soldiers through the gate',()=>{
    let b=chargedSkillBattle(5,8,30);
    b.units.filter(u=>u.side==='attacker'&&!u.general).slice(0,4).forEach(u=>{u.hp=0;u.action='death';});
    const before=battleSurvivors(b,'attacker');
    b=commandBattle(b,{type:'skill',sequence:5});expect(b.activeScript?.kind).toBe('magic-reinforce');
    tickBattle(b,8);
    expect(b.activeScript).toBeUndefined();expect(battleSurvivors(b,'attacker')).toBeGreaterThan(before);expect(()=>validateBattle(b)).not.toThrow();
  });
  it('executes inferred status magic and blocks the affected general until expiry',()=>{
    let b=chargedSkillBattle(104,0,0);let target=battleGeneral(b,'defender');issueNativeCommand(b,'defender',0,1);target.action='attack';target.actionTick=7;
    b=commandBattle(b,{type:'skill',sequence:104});expect(b.activeScript?.kind).toBe('magic-status');
    for(let i=0;i<8;i++)tickBattle(b);
    target=battleGeneral(b,'defender');
    expect(target.status?.kind).toBe('stunned');expect(target.status?.until).toBeGreaterThan(b.tick);
    target.action='attack';target.actionTick=7;tickBattle(b);
    expect(target.action).toBe('wait');expect(target.actionTick).toBe(0);expect(()=>validateBattle(b)).not.toThrow();
  });
  it('uses actual individual casualties, animates attacks and completes without autoresolve',()=>{
    const b=start(fresh());let sawAttack=false;
    for(let i=0;i<3600&&b.phase!=='finished';i++){tickBattle(b);sawAttack ||= b.units.some(u=>u.action==='attack');}
    expect(sawAttack).toBe(true);expect(b.phase).toBe('finished');
    expect(battleSurvivors(b,'attacker')+battleSurvivors(b,'defender')).toBeLessThan(200);
    expect(()=>validateBattle(b)).not.toThrow();
  });
  it.each(['刀','弓'])('does not pile up allied soldiers when a hundred soldiers converge on %s enemies',unit=>{
    const b=start(createBattle({id:'crowd',attacker:commander('a'),defender:commander('b',unit),attackingTroops:100,defendingTroops:100,seed:184}));
    for(let step=0;step<800&&b.phase==='fighting';step++) {
      tickBattle(b);
      if(step%40!==0)continue;
      const live=b.units.filter(u=>!u.general&&u.hp>0&&!u.escaped);
      for(let i=0;i<live.length;i++)for(let j=0;j<i;j++)if(live[i].side===live[j].side) {
        expect(Math.hypot((live[i].x-live[j].x)/32,(live[i].y-live[j].y)/36)).toBeGreaterThan(.7);
      }
    }
  });
  it('separates coincident attacking allies without moving a held unit',()=>{
    const b=start(createBattle({id:'coincident',attacker:commander('a'),defender:commander('b'),attackingTroops:2,defendingTroops:2,seed:184}));
    // This saved-layout fixture assigns two different orders inside one division.
    delete b.nativeCommands;
    const [held,moving]=b.units.filter(u=>u.side==='attacker'&&!u.general);
    held.order='hold';moving.x=held.x;moving.y=held.y;moving.action='attack';
    const position={x:held.x,y:held.y};tickBattle(b);
    expect({x:held.x,y:held.y}).toEqual(position);
    expect(Math.hypot(moving.x-held.x,moving.y-held.y)).toBeGreaterThan(20);
  });
  it('waits at occupied reserve gates without losing or stacking reinforcements',()=>{
    let b=createBattle({id:'gates',attacker:commander('a'),defender:commander('b'),attackingTroops:250,defendingTroops:0,seed:1});
    b=commandBattle(legacy(b),{type:'start'});
    const soldiers=b.units.filter(u=>u.side==='attacker'&&!u.general);
    soldiers.slice(0,10).forEach((u,row)=>{u.x=40;u.y=150+row*40;});
    soldiers.slice(10,20).forEach(u=>{u.hp=0;u.action='death';});
    tickBattle(b,40);
    expect(b.reserves.attacker).toBe(150);expect(battleSurvivors(b,'attacker')).toBe(240);
    soldiers.slice(0,10).forEach(u=>{u.x=150;});
    tickBattle(b,40);
    // The held general still occupies one entrance; only nine ranks can enter.
    expect(b.reserves.attacker).toBe(141);expect(battleSurvivors(b,'attacker')).toBe(240);
    battleGeneral(b,'attacker').x=110;tickBattle(b,40);
    expect(b.reserves.attacker).toBe(140);expect(battleSurvivors(b,'attacker')).toBe(240);
    expect(()=>validateBattle(b)).not.toThrow();
  });
  it('resuming a mid-battle JSON snapshot produces the same outcome',()=>{
    const b=start(fresh());tickBattle(b,200);tickBattle(b,100);
    const restored:unknown=JSON.parse(JSON.stringify(b));validateBattle(restored);
    for(let i=0;i<18;i++){tickBattle(b,200);tickBattle(restored,200);}
    expect(restored).toEqual(b);
  });
  it('preserves independent general retreat in legacy command saves',()=>{
    let b=fresh();delete b.nativeCommands;b=start(b);b=commandBattle(b,{type:'order',division:'general',order:'retreat'});
    expect(b.units.filter(u=>u.side==='attacker'&&!u.general).every(u=>u.order==='advance')).toBe(true);
    for(let i=0;i<3960&&b.phase==='fighting';i++)tickBattle(b);
    expect(b.winner).toBe('defender');expect(battleGeneral(b,'attacker').escaped).toBe(true);
  });
  it('keeps reserve counts exact when deploying replacement soldiers',()=>{
    const b=commandBattle(legacy(createBattle({id:'reserves',attacker:commander('a'),defender:commander('b'),attackingTroops:250,defendingTroops:250,seed:1})),{type:'start'});
    // This fixture tests replenishment through ten free gates; the separate
    // occupied-gate test covers a general blocking one of those entrances.
    battleGeneral(b,'attacker').x=110;
    expect(b.reserves.attacker).toBe(150);expect(battleSurvivors(b,'attacker')).toBe(250);
    b.units.filter(u=>u.side==='attacker'&&!u.general).slice(0,10).forEach(u=>{u.hp=0;u.action='death';});
    tickBattle(b,40);expect(b.reserves.attacker).toBe(140);expect(battleSurvivors(b,'attacker')).toBe(240);
  });
  it('invalid or corrupt tactical states are rejected',()=>{
    const b=fresh();b.units[0].x=NaN;expect(()=>validateBattle(b)).toThrow();
    const duplicate=fresh();duplicate.units.push(duplicate.units[0]);expect(()=>validateBattle(duplicate)).toThrow();
    expect(()=>tickBattle(fresh(),-1)).toThrow();
  });
  it('validates native effect ownership while preserving legacy coordinate-only effects',()=>{
    const b=fresh();
    const source=b.units.find(u=>u.side==='attacker'&&!u.general)!;
    const target=b.units.find(u=>u.side==='defender'&&!u.general)!;
    b.effects.push({id:b.nextId++,kind:'arrow',x:source.x,y:source.y-25,toX:target.x,toY:target.y-23,ticks:7,sourceId:source.id,targetId:target.id});
    expect(()=>validateBattle(b)).not.toThrow();
    const restored=JSON.parse(JSON.stringify(b)) as BattleState;
    expect(restored.effects[0].sourceId).toBe(source.id);
    expect(restored.effects[0].targetId).toBe(target.id);
    validateBattle(restored);
    const invalid=JSON.parse(JSON.stringify(b)) as BattleState;
    invalid.effects[0].targetId=999999;
    expect(()=>validateBattle(invalid)).toThrow();
    const legacyEffect=JSON.parse(JSON.stringify(b)) as BattleState;
    delete legacyEffect.effects[0].sourceId;delete legacyEffect.effects[0].targetId;
    expect(()=>validateBattle(legacyEffect)).not.toThrow();
  });
  it('keeps expired corpse records while a saved effect still references them',()=>{
    const b=commandBattle(fresh(),{type:'start'}),source=b.units.find(u=>!u.general&&u.side==='attacker')!;
    source.hp=0;source.action='death';source.actionTick=49;
    b.effects.push({id:b.nextId++,kind:'hit',x:source.x,y:source.y,toX:source.x,toY:source.y,ticks:3,sourceId:source.id,targetId:source.id,targetZ:36});
    tickBattle(b);expect(source.actionTick).toBeGreaterThanOrEqual(50);
    expect(b.units.some(u=>u.id===source.id)).toBe(true);validateBattle(b);
    const restored=JSON.parse(JSON.stringify(b)) as BattleState;validateBattle(restored);
    tickBattle(b,2);tickBattle(restored,2);
    expect(restored).toEqual(b);expect(b.effects).toHaveLength(0);
    expect(b.units.some(u=>u.id===source.id)).toBe(false);validateBattle(b);
  });
  it.each([NaN,-1,1.5,2001])('rejects an invalid saved effect height %s',targetZ=>{
    const b=fresh();b.effects.push({id:b.nextId++,kind:'hit',x:40,y:330,toX:40,toY:330,ticks:10,targetZ});
    expect(()=>validateBattle(b)).toThrow();
  });
  it('validates standalone fixed-point effect origins',()=>{
    const b=fresh();b.effects.push({id:b.nextId++,kind:'hit',x:40,y:330,toX:40,toY:330,ticks:10,point:{x:48*65536,y:468*65536,z:0}});
    validateBattle(b);b.effects[0].point!.x=Infinity;expect(()=>validateBattle(b)).toThrow();
  });
  it.each([{sequence:2,height:48},{sequence:3,height:24},{sequence:104,height:36}])('records distinct impact height for skill $sequence',({sequence,height})=>{
    let b=chargedSkillBattle(sequence);delete b.magicRules;b=commandBattle(b,{type:'skill',sequence});
    for(let step=0;step<20&&!b.effects.length;step++)tickBattle(b);
    expect(b.effects.some(e=>e.targetZ===height&&e.targetId!==undefined)).toBe(true);validateBattle(b);
  });
});
