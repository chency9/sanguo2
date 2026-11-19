import {describe,it,expect} from 'vitest';
import {createBattle,commandBattle,tickBattle,validateBattle,type BattleState} from './battle';
import {prepareBattleMovement,planBattleMovement,advanceBattleMovement} from './battle-movement';
import {issueNativeCommand} from './battle-commands';

const commander=(id:string)=>({id,name:id,portrait:'',strength:80,intelligence:80,hp:100,mp:40,unit:'刀',level:40});
function fresh(troops=20) {
  return createBattle({id:'movement',attacker:commander('a'),defender:commander('d'),attackingTroops:troops,defendingTroops:troops,seed:184});
}
function uniqueCells(b:BattleState) {
  const cells=b.units.filter(u=>u.hp>0&&!u.escaped&&u.movement&&!u.movement.exiting).map(u=>`${u.movement!.x},${u.movement!.y}`);
  expect(new Set(cells).size).toBe(cells.length);
}

describe('saved native movement in the Web battle',()=>{
  it('updates a blocked ally early, claims the freed cell, and does not advance that ally a second time',()=>{
    const b=commandBattle(fresh(10),{type:'start'});delete b.deploymentRules;delete b.nativeCommands;b.movementRules='native-grid-v2';delete b.attackRules;delete b.projectileRules;delete b.projectiles;delete b.magicRules;prepareBattleMovement(b);b.opponentAI!.countdown=60;
    const own=b.units.filter(u=>!u.general&&u.side==='attacker'),enemies=b.units.filter(u=>u.side==='defender');
    const place=(u:typeof own[number],x:number,y:number)=>{
      Object.assign(u.movement!,{x,y,previousX:x,previousY:y,px:(96*x+48)*65536,py:(72*y+36)*65536});
      u.x=(x+.5)/71*1200;u.y=150+y/13*360;u.order='hold';
    };
    enemies.forEach((u,i)=>place(u,50+i,6));
    const root=own[0],ally=own[1];place(root,35,6);place(ally,36,6);
    let index=2;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&!(dx===1&&dy===0))place(own[index++],35+dx,6+dy);
    place(own[index],20,0);root.order='advance';ally.order='advance';
    const v1=structuredClone(b);v1.movementRules='native-grid-v1';tickBattle(v1);tickBattle(b);
    expect(v1.units.find(u=>u.id===root.id)!.movement!.x).toBe(35);
    expect(root.movement).toMatchObject({x:36,y:6,updatedAt:3,remaining:37});
    expect(ally.movement).toMatchObject({updatedAt:3,remaining:37});expect(ally.actionTick).toBe(1);
    uniqueCells(b);validateBattle(b);
  });
  it('keeps v1 snapshots on their existing update order and rejects future update timestamps',()=>{
    let b=fresh();delete b.deploymentRules;delete b.nativeCommands;b.movementRules='native-grid-v1';delete b.attackRules;delete b.projectileRules;delete b.projectiles;delete b.magicRules;b=commandBattle(b,{type:'start'});tickBattle(b,5);
    expect(b.units.every(u=>u.movement?.updatedAt===undefined)).toBe(true);validateBattle(b);
    const restored=JSON.parse(JSON.stringify(b));tickBattle(b,10);tickBattle(restored,10);expect(restored).toEqual(b);
    const newer=commandBattle(fresh(),{type:'start'});tickBattle(newer);newer.units[0].movement!.updatedAt=4;
    expect(()=>validateBattle(newer)).toThrow();
  });
  it('resolves dense deployment projections without losing units, moving artwork, or drawing random numbers',()=>{
    const b=fresh(200),rng=[...b.opponentAI!.rng],positions=b.units.map(u=>[u.x,u.y]);
    prepareBattleMovement(b);uniqueCells(b);
    expect(b.units).toHaveLength(402);expect(b.units.map(u=>[u.x,u.y])).toEqual(positions);expect(b.opponentAI!.rng).toEqual(rng);validateBattle(b);
  });
  it('reserves the next cell before any movement and integrates exactly forty fixed-point updates',()=>{
    const b=fresh(1);prepareBattleMovement(b);
    const u=b.units.find(u=>!u.general&&u.side==='attacker')!,target=b.units.find(u=>!u.general&&u.side==='defender')!;
    const original={...u.movement!},position=[u.x,u.y];issueNativeCommand(b,'attacker',u.nativeDivision!,1);
    planBattleMovement(b,u,target);
    expect([u.x,u.y]).toEqual(position);expect([u.movement!.x,u.movement!.y]).not.toEqual([original.x,original.y]);
    expect([u.movement!.previousX,u.movement!.previousY]).toEqual([original.x,original.y]);uniqueCells(b);
    const vx=u.movement!.vx,vy=u.movement!.vy,rng=[...b.opponentAI!.rng];
    advanceBattleMovement(u,39);expect(u.movement!.remaining).toBe(1);
    advanceBattleMovement(u,3);expect(u.movement!.remaining).toBe(0);
    expect(u.movement!.px).toBe(original.px+40*vx);expect(u.movement!.py).toBe(original.py+40*vy);expect(b.opponentAI!.rng).toEqual(rng);
  });
  it('never double-books a cell during pursuit and resumes an unfinished segment identically',()=>{
    let b=commandBattle(fresh(),{type:'order',division:'all',order:'advance'});b=commandBattle(b,{type:'start'});
    tickBattle(b,11);expect(b.units.some(u=>(u.movement?.remaining??0)>0)).toBe(true);
    const restored:BattleState=JSON.parse(JSON.stringify(b));validateBattle(restored);
    for(let i=0;i<150;i++){tickBattle(b);tickBattle(restored);uniqueCells(b);}
    expect(restored).toEqual(b);
    expect(b.units.filter(u=>u.x< -100||u.x>1300||u.y<0||u.y>600).map(u=>({id:u.id,x:u.x,y:u.y}))).toEqual([]);
    validateBattle(b);
  });
  it('keeps full-capacity active and reserve soldiers readable while their reserved cells converge',()=>{
    const b=commandBattle(commandBattle(fresh(200),{type:'order',division:'all',order:'advance'}),{type:'start'});
    for(let step=0;step<500&&b.phase==='fighting';step++) {
      tickBattle(b);if(step%40!==0)continue;uniqueCells(b);
      const live=b.units.filter(u=>!u.general&&u.hp>0&&!u.escaped);
      for(let i=0;i<live.length;i++)for(let j=0;j<i;j++)if(live[i].side===live[j].side)
        expect(Math.hypot((live[i].x-live[j].x)/24,(live[i].y-live[j].y)/27)).toBeGreaterThan(.7);
    }
    validateBattle(b);
  // 500 updates plus over half a million spacing assertions: allow CPU
  // contention in the full suite without relaxing any simulation checks.
  },15000);
  it('finishes the in-progress step when orders change instead of drawing a new direction',()=>{
    let b=commandBattle(commandBattle(fresh(1),{type:'order',division:'all',order:'advance'}),{type:'start'});tickBattle(b);
    const u=b.units.find(u=>!u.general&&u.side==='attacker')!,before={...u.movement!},rng=[...b.opponentAI!.rng];
    b=commandBattle(b,{type:'order',division:'all',order:'hold'});tickBattle(b);
    const m=b.units.find(a=>a.id===u.id)!.movement!;
    expect(m.remaining).toBe(before.remaining-3);expect(m.px).toBe(before.px+3*before.vx);expect(b.opponentAI!.rng).toEqual(rng);
  });
  it('releases a retreating unit at the boundary and only completes escape after its step',()=>{
    const b=fresh(1),u=b.units.find(u=>!u.general&&u.side==='attacker')!;prepareBattleMovement(b);
    Object.assign(u.movement!,{x:0,previousX:0,px:48*65536});u.x=0;issueNativeCommand(b,'attacker',u.nativeDivision!,8);
    planBattleMovement(b,u,undefined);expect(u.movement!.exiting).toBe(true);expect(u.escaped).toBe(false);
    advanceBattleMovement(u,39);expect(u.escaped).toBe(false);advanceBattleMovement(u,1);expect(u.escaped).toBe(true);validateBattle(b);
  });
  it('keeps older saves on continuous movement without adding reservation state',()=>{
    let b=fresh();delete b.deploymentRules;delete b.nativeCommands;delete b.movementRules;delete b.attackRules;delete b.projectileRules;delete b.projectiles;delete b.magicRules;b=commandBattle(commandBattle(b,{type:'order',division:'all',order:'advance'}),{type:'start'});
    tickBattle(b,20);expect(b.units.every(u=>u.movement===undefined)).toBe(true);validateBattle(b);
  });
  it('rejects corrupt fixed-point state and duplicate live reservations',()=>{
    const b=fresh();prepareBattleMovement(b);
    for(const change of [(m:NonNullable<typeof b.units[number]['movement']>)=>{m.remaining=41;},(m:NonNullable<typeof b.units[number]['movement']>)=>{m.px=NaN;},(m:NonNullable<typeof b.units[number]['movement']>)=>{m.x=71;}]) {
      const bad=structuredClone(b);change(bad.units[0].movement!);expect(()=>validateBattle(bad)).toThrow();
    }
    const duplicate=structuredClone(b);duplicate.units[1].movement={...duplicate.units[0].movement!};expect(()=>validateBattle(duplicate)).toThrow();
    const orphan=structuredClone(b);delete orphan.movementRules;expect(()=>validateBattle(orphan)).toThrow();
  });
});
