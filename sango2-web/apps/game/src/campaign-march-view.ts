import type {ScenarioDefinition} from '@sango2/content';
import type {Army,Session} from '@sango2/core';
import {nativeCampaignNextCity} from '../../../packages/core/src/campaign-native-movement';

/** UI estimate only. Movement always follows the saved source sprite state. */
export function plannedMarchDays(session:Session,scene:ScenarioDefinition,from:string,to:string,legacyLength:number):number {
  if(session.movementRules!=='native-strategic-v1')return Math.max(2,Math.ceil(legacyLength/60));
  let current=from,length=0;
  for(let visited=0;current!==to&&visited<scene.cities.length;visited++) {
    const next=nativeCampaignNextCity(scene,current,to)?.next;if(!next||next===current)break;
    const road=scene.roads.find(r=>r.from===current&&r.to===next||r.to===current&&r.from===next);if(!road)break;
    for(let i=1;i<road.points.length;i++)length+=Math.hypot(road.points[i][0]-road.points[i-1][0],road.points[i][1]-road.points[i-1][1]);
    current=next;
  }
  return Math.max(1,Math.ceil(length*6/10));
}
export function armyTravelDescription(army:Army):string {
  const movement=army.nativeMovement;
  if(!movement)return `还需 ${army.remainingDays} 天`;
  const state=movement.flags&2?'整军停驻':movement.flags&4?'撤退中':'行军中';
  return `${state} · 预计约 ${army.remainingDays} 天`;
}
