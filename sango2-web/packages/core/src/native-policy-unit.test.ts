import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import type {GameContent} from '@sango2/content';
import {createSession,dispatch,readSession,nativeForceNames,officerDefinition,type Session} from './index';
import {battleAttackAction,nativeAttackAction} from './native-attack-animation';

const content=JSON.parse(readFileSync(new URL('../../../apps/game/public/assets/content.json',import.meta.url),'utf8')) as GameContent;
const scene=content.scenarios[0],faction=scene.factions[0];
function setup() {
  const s=createSession(content,scene.id,faction.id),def=scene.generals.find(g=>g.name==='曹操')!,g=s.generals[def.id];
  const from=g.cityId!,road=scene.roads.find(r=>!r.restricted&&(r.from===from||r.to===from))!,to=road.from===from?road.to:road.from;
  const enemy=scene.generals.find(d=>s.generals[d.id].ownerId&&s.generals[d.id].ownerId!==faction.id&&s.generals[d.id].status==='登')!,rival=s.generals[enemy.id];
  s.cities[rival.cityId!].troops-=rival.troops;rival.cityId=to;s.cities[to].ownerId=rival.ownerId;s.cities[to].troops=rival.troops;s.policy!.governors[to]=enemy.id;
  s.cities[from].troops+=200-g.troops;Object.assign(g,{level:40,troops:200,troopSlots:{active:100,reserve:100},forceMask:8191});
  return {s,def,g,from,to};
}

describe('selected troops from council to campaign battle',()=>{
  for(const [index,unit] of nativeForceNames.entries())it(`fields ${unit} active and reserve soldiers with their own source animations`,()=>{
    const {s:initial,def,g,from,to}=setup(),before=structuredClone(initial);let s=initial;
    s=dispatch(s,{type:'policy-unit',cityId:from,generalId:def.id,unit},content);
    const expected={...before.generals[def.id],currentUnit:unit};
    expect(s.generals[def.id]).toEqual(expected);expect(s.cities).toEqual(before.cities);
    expect(s.policy).toEqual(before.policy);expect(s.nativeAI).toEqual(before.nativeAI);expect(s.rng).toBe(before.rng);
    expect(initial).toEqual(before);
    const view=officerDefinition(s.generals[def.id],def,content.items);
    expect(view).toMatchObject({unit,appearance:{soldier:100+index}});
    for(const [object,key] of [[100+index,'soldierAttack'],[140+index,'reserveSoldierAttack']] as const) {
      const timing=nativeAttackAction(object,false)!;
      expect(view.appearance![key]).toEqual({hitTick:timing.hitTicks[0],ticks:timing.ticks});
    }
    s=dispatch(s,{type:'policy-finish'},content);for(const f of scene.factions)s.nativeAI!.countdowns[f.id]=999;
    s=dispatch(s,{type:'march',from,to,generalIds:[def.id],troops:g.troops},content);
    for(let i=0;i<20&&!s.battle;i++)s=dispatch(s,{type:'advance',days:30},content);
    expect(s.battle).not.toBeNull();const battle=s.battle!;
    expect(battle.commanders.attacker).toMatchObject({id:def.id,unit,appearance:{soldier:100+index}});
    const active=battle.units.find(u=>u.side==='attacker'&&!u.general&&!u.nativeReserve)!;
    const reserve=battle.units.find(u=>u.side==='attacker'&&!u.general&&u.nativeReserve)!;
    expect(battleAttackAction(battle,active)?.object).toBe(100+index);
    expect(battleAttackAction(battle,reserve)?.object).toBe(140+index);
    expect(readSession(JSON.parse(JSON.stringify(s)),content)).toEqual(s);
  });
  it('keeps selection after council and rejects invalid, enemy, marching and in-battle requests atomically',()=>{
    const {s,def,g,from}=setup();s.policy!.active=false;s.policy!.acted=[def.id];
    const switched=dispatch(s,{type:'policy-unit',cityId:from,generalId:def.id,unit:'槍'},content);
    expect(switched.policy).toEqual(s.policy);expect(switched.generals[def.id].currentUnit).toBe('槍');
    const before=structuredClone(s),command={type:'policy-unit' as const,cityId:from,generalId:def.id,unit:'槍'};
    for(const unit of ['', 'unknown', 1, null])expect(()=>dispatch(s,{...command,unit:unit as string},content)).toThrow('兵种无效');
    expect(()=>dispatch(s,{...command,cityId:'missing'},content)).toThrow('我方城池');
    const rival=scene.generals.find(d=>s.generals[d.id].ownerId&&s.generals[d.id].ownerId!==faction.id)!;
    expect(()=>dispatch(s,{...command,generalId:rival.id},content)).toThrow('本城');
    const marching=structuredClone(s);marching.generals[def.id].armyId='army-1';expect(()=>dispatch(marching,command,content)).toThrow('本城');
    const fighting=structuredClone(s);fighting.battle={} as Session['battle'];expect(()=>dispatch(fighting,command,content)).toThrow('当前战斗');
    expect(g.currentUnit).toBeUndefined();expect(s).toEqual(before);
  });
  it('preserves old saves and refuses corrupt or unlearned selected troops',()=>{
    const s=createSession(content,scene.id,faction.id),def=scene.generals.find(g=>g.name==='曹操')!,g=s.generals[def.id];
    expect(readSession(JSON.parse(JSON.stringify(s)),content)).toEqual(s);
    expect(officerDefinition(g,def,content.items).unit).toBe(def.unit);
    for(const currentUnit of ['', 'unknown', '槍', 1, null]) {
      const damaged=structuredClone(s);Object.assign(damaged.generals[def.id],{currentUnit,forceMask:1});
      expect(()=>readSession(damaged,content)).toThrow();
    }
  });
});
