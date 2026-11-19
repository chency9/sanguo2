import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import type {GameContent} from '@sango2/content';
import fixtures from '../fixtures/native-player-items.json';
import {nativePlayerItem,nativeItemTable} from './native-items';
import {createSession,dispatch,readSession,officerDefinition,previewPlayerItem,type Session} from './index';

describe('player item command 0x424509 original x86 differential',()=>{
  for(const [index,c] of fixtures.cases.entries())it(`player item state and inventory ${index}`,()=>{
    const g=structuredClone(c.input),inventory={...c.inventory} as Record<string,number>;
    nativePlayerItem(g,inventory,c.items,c.itemId,c.ruler);
    expect(g).toEqual(c.output);expect(inventory).toEqual(c.inventoryAfter);expect(c.rngAfter).toEqual(c.rng);
  });
});
const content=JSON.parse(readFileSync(new URL('../../../apps/game/public/assets/content.json',import.meta.url),'utf8')) as GameContent;
const scene=content.scenarios[0],faction=scene.factions[0],table=nativeItemTable(content.items);
function setup(){
  const s=createSession(content,scene.id,faction.id),def=scene.generals.find(d=>s.generals[d.id].ownerId===faction.id&&d.id!==faction.leaderId&&s.generals[d.id].status==='登'&&s.generals[d.id].cityId)!;
  return {s,def,g:s.generals[def.id],stock:s.policy!.search!.inventory[faction.id]};
}
function use(s:Session,id:string,itemId:number){return dispatch(s,{type:'policy-item',cityId:s.generals[id].cityId!,generalId:id,itemId},content);}

describe('player item campaign commands',()=>{
  for(const item of table)it(`all package items commit and restore ${item.id}`,()=>{
    const {s,def,g,stock}=setup();g.level=99;g.forceMask=0;g.battleMask=0;stock[String(item.id)]=2;
    const previous=structuredClone(s),preview=previewPlayerItem(g,def,content.items,stock,false,item.id),after=use(s,def.id,item.id);
    expect(preview.reason).toBe('');expect(preview.applied).toBe(true);expect(s).toEqual(previous);
    expect(after.generals[def.id]).toEqual(preview.after);expect(after.policy!.search!.inventory[faction.id]).toEqual(preview.inventory);
    expect(after.policy!.acted).toEqual(s.policy!.acted);expect(after.nativeAI!.rng).toEqual(s.nativeAI!.rng);
    expect(after.rng).toBe(s.rng);expect(after.cities).toEqual(s.cities);expect(readSession(JSON.parse(JSON.stringify(after)),content)).toEqual(after);
    const view=officerDefinition(after.generals[def.id],def,content.items);
    expect(view.strength).toBe(preview.after.strength);expect(view.intelligence).toBe(preview.after.intelligence);
  });
  it('replaces then unloads THING, preserving native intermediate HP clamp',()=>{
    const {s,def,g,stock}=setup();Object.assign(g,{thingId:54,maxHp:150,hp:150});stock['54']=1;stock['53']=1;
    const after=use(s,def.id,53);expect(after.generals[def.id].hp).toBe(125);expect(after.generals[def.id].maxHp).toBe(125);
    expect(after.policy!.search!.inventory[faction.id]['54']).toBe(2);
    const unloaded=use(after,def.id,0);expect(unloaded.generals[def.id].thingId).toBe(0);expect(unloaded.policy!.search!.inventory[faction.id]['53']).toBe(1);
    expect(unloaded.generals[def.id].weaponId).toBe(g.weaponId);expect(unloaded.generals[def.id].horseId).toBe(g.horseId);
  });
  it('retains native same-item replacement at full stock (99 -> 98)',()=>{
    const {s,def,g,stock}=setup();g.thingId=48;stock['48']=99;
    const after=use(s,def.id,48);expect(after.generals[def.id]).toEqual(g);expect(after.policy!.search!.inventory[faction.id]['48']).toBe(98);
  });
  it('rejects repeated learning and ruler gifts without consuming inventory or state',()=>{
    const {s,def,g,stock}=setup();g.forceMask=1;g.battleMask=1;stock['1']=1;stock['64']=1;
    const leader=s.generals[faction.leaderId!];stock['73']=1;const before=structuredClone(s);
    expect(()=>use(s,def.id,1)).toThrow('已会');expect(()=>use(s,def.id,64)).toThrow('已会');
    expect(()=>use(s,faction.leaderId!,73)).toThrow('君主');expect(leader.ownerId).toBe(faction.id);expect(s).toEqual(before);
  });
  it('learns troops and formations once; items remain visible but unavailable thereafter',()=>{
    const {s,def,g,stock}=setup();g.forceMask=1;g.battleMask=1;stock['2']=2;stock['65']=2;
    let after=use(s,def.id,2);after=use(after,def.id,65);
    expect(after.generals[def.id].forceMask).toBe(3);expect(after.generals[def.id].battleMask).toBe(3);
    expect(after.policy!.search!.inventory[faction.id]['2']).toBe(1);expect(()=>use(after,def.id,2)).toThrow('已会');
    expect(officerDefinition(after.generals[def.id],def,content.items).formations.length).toBe(2);
  });
  it('enforces ownership, location, stock, level and battle guard transactionally',()=>{
    const {s,def,g,stock}=setup();g.level=1;stock['47']=1;const before=structuredClone(s);
    for(const id of [-1,1.5,128,999,NaN])expect(()=>use(s,def.id,id)).toThrow('编号');
    expect(()=>use(s,def.id,14)).toThrow('没有');expect(()=>use(s,def.id,47)).toThrow('等级');
    expect(()=>dispatch(s,{type:'policy-item',cityId:'missing',generalId:def.id,itemId:47},content)).toThrow('我方城池');
    const rival=scene.generals.find(d=>s.generals[d.id].ownerId&&s.generals[d.id].ownerId!==faction.id&&s.generals[d.id].cityId)!;
    expect(()=>dispatch(s,{type:'policy-item',cityId:g.cityId!,generalId:rival.id,itemId:47},content)).toThrow('本城');
    const marching=structuredClone(s);marching.generals[def.id].armyId='march';expect(()=>use(marching,def.id,47)).toThrow('本城');
    const battle=structuredClone(s);battle.battle={} as Session['battle'];expect(()=>use(battle,def.id,47)).toThrow('当前战斗');expect(s).toEqual(before);
  });
  it('allows stock use after council without restoring or spending annual actions',()=>{
    const {s,def,stock}=setup();s.policy!.active=false;s.policy!.acted=[def.id];stock['48']=1;
    const after=use(s,def.id,48);expect(after.policy!.acted).toEqual([def.id]);expect(after.policy!.active).toBe(false);
  });
  it('replaces legacy equipment without subtracting bonuses the old save never applied',()=>{
    const {s,def,g,stock}=setup();g.thingId=48;g.legacyEquipment=[48];stock['49']=1;
    const after=use(s,def.id,49);expect(after.generals[def.id].intelligence).toBe(g.intelligence!+10);
    expect(after.generals[def.id].legacyEquipment).toEqual([]);expect(after.policy!.search!.inventory[faction.id]['48']).toBe(1);
  });
  it('changes native development yields immediately with equipped STR/INT',()=>{
    const {s,def,g,stock}=setup();g.level=99;stock['47']=1;stock['49']=1;
    s.cities[g.cityId!].population=10000;s.cities[g.cityId!].defense=10;s.policy!.governors[g.cityId!]=def.id;
    const equipped=use(use(s,def.id,47),def.id,49),command={type:'policy-develop' as const,cityId:g.cityId!,generalIds:[def.id]};
    const a=dispatch(s,command,content),b=dispatch(equipped,command,content);
    expect(b.policy!.results[0].population).toBeGreaterThan(a.policy!.results[0].population);
    expect(b.policy!.results[0].defense).toBeGreaterThan(a.policy!.results[0].defense);expect(b.nativeAI!.rng).toEqual(a.nativeAI!.rng);
  });
  it('uses player equipment and attack appearance in an actual campaign encounter',()=>{
    const {s:initial,def,g,stock}=setup();let s=initial;g.level=99;stock['47']=1;stock['49']=1;stock['63']=1;
    const from=g.cityId!,road=scene.roads.find(r=>!r.restricted&&(r.from===from||r.to===from))!,to=road.from===from?road.to:road.from;
    const enemy=scene.generals.find(d=>s.generals[d.id].ownerId&&s.generals[d.id].ownerId!==faction.id&&s.generals[d.id].status==='登')!,rival=s.generals[enemy.id];
    s.cities[rival.cityId!].troops-=rival.troops;rival.cityId=to;s.cities[to].ownerId=rival.ownerId;s.cities[to].troops=rival.troops;s.policy!.governors[to]=enemy.id;
    for(const item of [47,49,63])s=use(s,def.id,item);
    const effective=officerDefinition(s.generals[def.id],def,content.items);
    s=dispatch(s,{type:'policy-finish'},content);for(const f of scene.factions)s.nativeAI!.countdowns[f.id]=999;
    s=dispatch(s,{type:'march',from,to,generalIds:[def.id],troops:s.generals[def.id].troops},content);
    for(let i=0;i<20&&!s.battle;i++)s=dispatch(s,{type:'advance',days:30},content);
    expect(s.battle).not.toBeNull();expect(s.battle!.commanders.attacker).toMatchObject({id:def.id,strength:effective.strength,intelligence:effective.intelligence,speed:effective.speed,appearance:effective.appearance});
  });
});
