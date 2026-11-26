import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import type {GameContent} from '@sango2/content';
import {createSession} from './index';
import {createCampaignRoadBattle,settleCampaignRoadBattle,resolveComputerRoadBattle,type CampaignRoadBattle} from './campaign-road-battle';
import {initNativeCampaignMovement,type NativeCampaignArmy} from './campaign-native-movement';
import {nativeRoadBattleScenery} from './campaign-native-scenery';
import {battleGeneral,commandBattle,tickBattle,validateBattle} from './battle';
import {nativeBattleExperience} from './native-battle-experience';
import {applyOfficerExperience,officerExperience} from './native-progression';

const content=JSON.parse(readFileSync(new URL('../../../apps/game/public/assets/content.json',import.meta.url),'utf8')) as GameContent,scene=content.scenarios[0];
function setup(computer=false) {
  const faction=scene.factions.find(f=>!f.special&&scene.cities.some(c=>c.ownerId===f.id))!.id,s=createSession(content,scene.id,faction);
  const staffed=(id:string)=>scene.generals.some(g=>s.generals[g.id].cityId===id&&s.generals[g.id].status==='登'&&s.generals[g.id].ownerId===s.cities[id].ownerId);
  const road=scene.roads.find(r=>staffed(r.from)&&staffed(r.to)&&s.cities[r.from].ownerId&&s.cities[r.to].ownerId&&s.cities[r.from].ownerId!==s.cities[r.to].ownerId)!,firstOwner=s.cities[road.from].ownerId!,secondOwner=s.cities[road.to].ownerId!;
  const armies=[road.from,road.to].map((from,index)=>{
    const owner=index?secondOwner:firstOwner,id=scene.generals.find(g=>s.generals[g.id].cityId===from&&s.generals[g.id].ownerId===owner&&s.generals[g.id].status==='登')!.id,g=s.generals[id];
    const a:NativeCampaignArmy={id:`army-${s.nextId++}`,ownerId:owner,from,to:index?road.from:road.to,roadId:road.id,generalIds:[id],troops:g.troops,totalDays:1,remainingDays:1};
    s.cities[from].troops-=g.troops;g.cityId=null;g.armyId=a.id;s.armies.push(a);initNativeCampaignMovement(scene,a);
    const middle=road.points[Math.trunc(road.points.length/2)];a.nativeMovement!.px=(middle[0]+index*3)*65536;a.nativeMovement!.py=middle[1]*65536;return a;
  });
  if(computer)s.factionId=scene.factions.find(f=>f.id!==firstOwner&&f.id!==secondOwner&&!f.special)!.id;
  else s.factionId=secondOwner;
  return {s,first:armies[0],second:armies[1]};
}
describe('real campaign road battles',()=>{
  it('maps the second collision team to the player without treating the encounter as a siege',()=>{
    const {s,first,second}=setup(),b=createCampaignRoadBattle(s,scene,first,second,content.items)!;
    expect(b.roadEncounter).toEqual({firstArmyId:first.id,secondArmyId:second.id,firstSide:'defender'});
    expect(b.commanders.attacker.id).toBe(second.generalIds[0]);expect(b.commanders.defender.id).toBe(first.generalIds[0]);
    expect(b.cityId).toBeNull();expect(b.fortifications).toBeUndefined();expect(b.attackerAI).toBeUndefined();
    expect(b.scenery!.terrainId).toBeGreaterThanOrEqual(0);expect(b.scenery!.terrainId).toBeLessThan(12);
  });
  it('writes the tactical result once then leaves the defeated army on the road',()=>{
    const {s,first,second}=setup(),b=createCampaignRoadBattle(s,scene,first,second,content.items)!;
    b.phase='finished';b.winner='attacker';let calls=0;
    settleCampaignRoadBattle(s,scene,b,()=>{calls++;for(const a of [first,second])for(const id of a.generalIds)s.generals[id].troops=4;});
    expect(calls).toBe(1);expect(first.nativeMovement!.flags&4).toBe(4);expect(second.nativeMovement!.flags&2).toBe(2);
    expect(first.troops).toBe(4);expect(second.troops).toBe(4);expect(s.generals[first.generalIds[0]].cityId).toBeNull();expect(s.armies).toContain(first);
  });
  it('runs a computer-versus-computer road battle through actual tactical ticks',()=>{
    const {s,first,second}=setup(true);let settled:CampaignRoadBattle|undefined;
    const before=Object.fromEntries([first,second].flatMap(a=>a.generalIds).map(id=>[id,s.generals[id].experience??0]));
    const b=resolveComputerRoadBattle(s,scene,first,second,content.items,value=>{
      settled=value;
      for(const side of ['attacker','defender'] as const)for(const member of value.rosters[side]) {
        const g=s.generals[member.commander.id],def=scene.generals.find(d=>d.id===member.commander.id)!;g.hp=member.commander.hp;g.mp=member.commander.mp;g.troops=member.troops;
        const award=nativeBattleExperience(member.merit??0,officerExperience(g,def),s.policy!.annual!.battleExperience[g.ownerId!]??0);
        applyOfficerExperience(g,def,award.experience);s.policy!.annual!.battleExperience[g.ownerId!]=award.factionExperience;
      }
    })!;
    expect(settled).toBe(b);expect(b.phase).toBe('finished');expect(b.tick).toBeGreaterThan(0);expect(b.attackerAI).toBeDefined();
    expect(b.roadEncounter).toBeDefined();expect(b.history.length).toBeGreaterThan(0);expect(s.chronicle[0].text).toContain('道路交战');
    expect(Object.entries(before).some(([id,experience])=>s.generals[id].experience!>experience)).toBe(true);
    expect(Object.values(s.policy!.annual!.battleExperience).some(experience=>experience>0)).toBe(true);
  });
  it('retains the two strategic armies and merit across actual commander rotation and JSON continuation',()=>{
    const {s,first,second}=setup(),third=scene.generals.find(d=>s.generals[d.id].ownerId===first.ownerId&&d.id!==first.generalIds[0])!,g=s.generals[third.id];
    if(g.cityId)s.cities[g.cityId].troops-=g.troops;g.cityId=null;g.armyId=first.id;first.generalIds.push(third.id);first.troops+=g.troops;
    let b=createCampaignRoadBattle(s,scene,first,second,content.items)!;const identity=structuredClone(b.roadEncounter);
    b=commandBattle(b,{type:'start'});battleGeneral(b,'defender').hp=0;tickBattle(b);expect(b.phase).toBe('intermission');
    expect(b.rosters.attacker.some(m=>(m.merit??0)>0)).toBe(true);
    const saved=JSON.parse(JSON.stringify(b));validateBattle(saved);
    b=commandBattle(b,{type:'next-round',commanderId:b.commanders.attacker.id});
    expect(b.roadEncounter).toEqual(identity);expect(b).toEqual(commandBattle(saved,{type:'next-round',commanderId:saved.commanders.attacker.id}));
    expect(b.round).toBe(2);expect(b.cityId).toBeNull();expect(b.fortifications).toBeUndefined();validateBattle(b);
  });
  it('samples the two armies actual position with per-season source mask values',()=>{
    const city=scene.cities.find(c=>c.battleSceneryBySeason&&![1,2].includes(c.battleSceneryBySeason[0].terrainId))!;
    for(let season=0;season<4;season++) {
      const rng:[number,number]=[184,0x87654321];
      const scenery=nativeRoadBattleScenery(city.position,city.position,season*90,rng,'a');
      expect(scenery).toEqual({terrainId:city.battleSceneryBySeason![season].terrainId,variant:'a'});expect(rng).toEqual([184,0x87654321]);
    }
  });
});
