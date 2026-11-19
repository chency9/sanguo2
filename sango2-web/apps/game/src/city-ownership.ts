import type { ScenarioDefinition } from '@sango2/content';
import type { Session } from '@sango2/core';

/** Always read live ownership: source scenario ownership becomes stale after capture. */
export function cityOwnership(scene:ScenarioDefinition,session:Session,id:string) {
  const ownerId=session.cities[id].ownerId;
  const owner=scene.factions.find(f=>f.id===ownerId);
  const relation=!ownerId?'neutral':ownerId===session.factionId?'own':'other';
  const name=owner?.name??(ownerId?'未知势力':'无主');
  return {relation,name,color:owner?.color??'#bfc2bc',
    label:relation==='own'?'我方':relation==='neutral'?'空城':'他方',
    badge:relation==='own'?`我·${name}`:relation==='neutral'?'空城':name};
}
