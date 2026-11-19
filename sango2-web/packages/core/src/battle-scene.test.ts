import {expect,it} from 'vitest';
import {createBattle,commandBattle,tickBattle,NATIVE_FORMATIONS,type BattleCommander,type BattleEffect} from './battle';
import {prepareBattleMovement} from './battle-movement';
import {battleUnitScenePosition,battleScenePoints,battleFocusCamera,battleEffectScenePoints,battleGroundTextureSpans,battleScenerySpans} from './battle-scene';
import {nativeProject} from './native-projection';

const commander=(id:string):BattleCommander=>({id,name:id,portrait:'portraits/001.png',strength:80,intelligence:80,hp:100,mp:40,unit:'刀',level:40});
const create=()=>createBattle({id:'projection',attacker:commander('a'),defender:commander('d'),attackingTroops:200,defendingTroops:200,seed:184});
it('renders the same physical position regardless of old sprite spacing offsets',()=>{
  const b=create();prepareBattleMovement(b);
  const u=b.units.find(u=>!u.general)!;
  const camera={x:4000,y:339};
  const expected=battleUnitScenePosition(b,u,camera);
  u.x+=200;u.y-=120;
  expect(battleUnitScenePosition(b,u,camera)).toEqual(expected);
});
it('previews every original formation without moving units or consuming randomness',()=>{
  for(const formation of NATIVE_FORMATIONS) {
    const initial=create();initial.commanders.attacker.formations=NATIVE_FORMATIONS.map(f=>f.id);
    const b=commandBattle(initial,{type:'formation',formation:formation.id}),snapshot=JSON.stringify(b);
    const preview=battleScenePoints(b);expect(JSON.stringify(b)).toBe(snapshot);
    prepareBattleMovement(b);expect(battleScenePoints(b)).toEqual(preview);
  }
});
it('keeps original formation display points available when late units have no movement yet',()=>{
  const b=create();b.commanders.attacker.formations=NATIVE_FORMATIONS.map(f=>f.id);
  prepareBattleMovement(b);
  const before=battleScenePoints(b),late=b.units.find(u=>!u.general)!;
  delete late.movement;late.x+=400;late.y-=120;
  expect(battleScenePoints(b).get(late.id)).toEqual(before.get(late.id));
});
it('renders corpses at flight coordinates and shares the projectile projection origin',()=>{
  const b=create();prepareBattleMovement(b);const u=b.units.find(u=>!u.general)!,camera=battleFocusCamera(b,'attacker');
  const m=u.movement!;
  const point={x:m.px,y:m.py,z:0};
  expect(battleUnitScenePosition(b,u,camera)).toEqual(nativeProject(point,camera));
  u.casualty={flight:{...point,x:point.x+65536*30,z:65536*54,vx:0,vy:0,vz:0},facing:0,origin:{x:m.px,y:m.py},born:0};
  expect(battleUnitScenePosition(b,u,camera)).toEqual(nativeProject(u.casualty.flight,camera));
});
it('does not change the saved battle or replay when camera projections run between ticks',()=>{
  let viewed=commandBattle(create(),{type:'start'}),untouched=structuredClone(viewed);
  for(let tick=0;tick<16;tick++) {
    for(const side of ['attacker','defender'] as const) {
      const camera=battleFocusCamera(viewed,side);
      for(const point of battleScenePoints(viewed).values())nativeProject(point,camera);
    }
    tickBattle(viewed,1);tickBattle(untouched,1);
  }
  expect(viewed).toEqual(untouched);
});
it('preserves legacy fallback coordinates through save reload',()=>{
  const b=create();delete b.deploymentRules;
  const before=battleScenePoints(b),restored=JSON.parse(JSON.stringify(b));
  expect(battleScenePoints(restored)).toEqual(before);
  prepareBattleMovement(restored);expect(battleScenePoints(restored)).toEqual(before);
});
it.each([23,24,36,48])('keeps the saved effect height %i on the actual actor during camera motion',height=>{
  const b=create();prepareBattleMovement(b);
  const u=b.units.find(u=>!u.general)!,effect:BattleEffect={id:b.nextId++,kind:'hit',x:0,y:0,toX:0,toY:0,ticks:8,targetId:u.id,targetZ:height};
  b.effects.push(effect);u.x+=200;u.y-=120;
  const snapshot=JSON.stringify(b),points=battleScenePoints(b),actor=points.get(u.id)!;
  for(const side of ['attacker','defender'] as const) {
    const camera=battleFocusCamera(b,side),target=battleEffectScenePoints(effect,points).target!;
    expect(target).toEqual({...actor,z:actor.z+height*65536});
    expect(nativeProject(target,camera)).toEqual(nativeProject({...actor,z:height*65536},camera));
  }
  expect(JSON.stringify(b)).toBe(snapshot);
});
it('keeps gate effects fixed while unrelated actors move, and leaves legacy fallback explicit',()=>{
  const b=create(),point={x:48*65536,y:468*65536,z:0};
  const effect:BattleEffect={id:b.nextId++,kind:'hit',x:40,y:330,toX:40,toY:330,ticks:10,point};
  const before=battleEffectScenePoints(effect,battleScenePoints(b));
  b.units.forEach(u=>{u.x+=50;u.y+=20;});
  expect(battleEffectScenePoints(effect,battleScenePoints(b))).toEqual(before);
  expect(before).toEqual({source:point,target:point});expect(before.target).not.toBe(point);
  delete effect.point;
  expect(battleEffectScenePoints(effect,battleScenePoints(b))).toEqual({source:undefined,target:undefined});
});
it('wraps every ground strip without gaps across wide and zoomed viewports',()=>{
  for(const scale of [.05,.3,1,2])for(const left of [-600,-172,0]) {
    const right=640-left,spans=battleGroundTextureSpans(6560,scale,left,right,128);
    expect(spans[0].x).toBe(left);
    expect(spans.at(-1)!.x+spans.at(-1)!.width).toBeCloseTo(right);
    for(const [i,s] of spans.entries()) {
      expect(s.sourceX).toBeGreaterThanOrEqual(0);expect(s.sourceX+s.sourceWidth).toBeLessThanOrEqual(128+1e-9);
      expect(s.width).toBeGreaterThan(0);expect(s.width/s.sourceWidth).toBeCloseTo(scale*4);
      if(i)expect(s.x).toBeCloseTo(spans[i-1].x+spans[i-1].width);
    }
  }
});
it('samples the same world-ground landmark as the viewport widens',()=>{
  const sample=(left:number,right:number,camera=4000)=>{
    const spans=battleGroundTextureSpans(camera,.7,left,right,256),s=spans.find(s=>s.x<=320&&s.x+s.width>320)!;
    return s.sourceX+(320-s.x)/(.7*4);
  };
  expect(sample(-400,1040)).toBeCloseTo(sample(0,640));
  expect(sample(-400,1040,4004)-sample(-400,1040)).toBeCloseTo(1);
});
it('preserves the exact central source panorama and mirrors only outside its original edges',()=>{
  expect(battleScenerySpans(45,0,640,730)).toEqual([{sourceX:45,width:640,x:0,mirror:false}]);
  const spans=battleScenerySpans(45,-1000,1500,730);
  for(const [i,s] of spans.entries()) {
    expect(s.width).toBeGreaterThan(0);expect(s.sourceX).toBeGreaterThanOrEqual(0);expect(s.sourceX+s.width).toBeLessThanOrEqual(730);
    if(i)expect(s.x).toBe(spans[i-1].x+spans[i-1].width);
  }
  expect(spans[0].x).toBe(-1000);expect(spans.at(-1)!.x+spans.at(-1)!.width).toBe(1500);
  const centre=spans.find(s=>s.x<=0&&s.x+s.width>=640)!;
  expect(centre.mirror).toBe(false);expect(centre.sourceX+(0-centre.x)).toBe(45);
});
