/** Source campaign replay, rebuilt in Vite from the actual converted content.
 * Only starting map coordinates and the last step of one tactical retreat are
 * prescribed; dispatch owns marching, collision, battle entry and settlement. */
import type {GameContent} from '../packages/content/src/index';
import {createSession,dispatch,validateSession,type Session,type Army} from '../packages/core/src/index';
import {battleGeneral} from '../packages/core/src/battle';
import {nativeCampaignNextCity} from '../packages/core/src/campaign-native-movement';
import {nativeStrategicHeading} from '../packages/core/src/native-strategic-movement';
import {issueNativeCommand} from '../packages/core/src/battle-commands';
import {prepareBattleMovement} from '../packages/core/src/battle-movement';

function check(condition:unknown,message:string):asserts condition {if(!condition)throw new Error(`Movement replay: ${message}`);}
export function buildMovementReplays(content:GameContent) {
  const scene=content.scenarios[0];
  const road=scene.roads.find(road=>{
    const a=scene.cities.find(c=>c.id===road.from)!,b=scene.cities.find(c=>c.id===road.to)!;
    return !road.restricted&&a.ownerId&&b.ownerId&&a.ownerId!==b.ownerId&&
      scene.generals.some(g=>g.cityId===a.id&&g.ownerId===a.ownerId&&g.status==='登')&&
      scene.generals.some(g=>g.cityId===b.id&&g.ownerId===b.ownerId&&g.status==='登')&&
      nativeCampaignNextCity(scene,a.id,b.id)?.next===b.id&&nativeCampaignNextCity(scene,b.id,a.id)?.next===a.id;
  });check(road,'no source frontier with two resident armies');
  const owner=scene.cities.find(c=>c.id===road.from)!.ownerId!,enemy=scene.cities.find(c=>c.id===road.to)!.ownerId!;
  let s=dispatch(createSession(content,scene.id,owner),{type:'policy-finish'},content);
  for(const id of Object.keys(s.nativeAI!.countdowns))s.nativeAI!.countdowns[id]=999;
  const initial=structuredClone(s);
  for(const [factionId,from,to] of [[owner,road.from,road.to],[enemy,road.to,road.from]]) {
    s.factionId=factionId;
    const actor=scene.generals.find(g=>g.cityId===from&&s.generals[g.id].ownerId===factionId&&s.generals[g.id].status==='登'&&s.generals[g.id].troops>0);
    check(actor,'source resident has no troops');
    s=dispatch(s,{type:'march',from,to,generalIds:[actor.id],troops:s.generals[actor.id].troops},content);
  }
  s.factionId=owner;
  s=dispatch(s,{type:'advance',days:1},content);check(!s.battle&&s.armies.length===2,'frontier met before the first travel day');
  const travelling=structuredClone(s);
  // Place both saved source sprites six pixels apart in an interior segment.
  // Their actual AABB collision, not a forced battle constructor, opens combat.
  const segment=road.points.slice(1).map((point,i)=>({i:i+1,a:road.points[i],b:point,length:Math.hypot(point[0]-road.points[i][0],point[1]-road.points[i][1])})).sort((a,b)=>b.length-a.length)[0];
  check(segment.length>20,'source road has no interior segment');
  const dx=(segment.b[0]-segment.a[0])/segment.length,dy=(segment.b[1]-segment.a[1])/segment.length;
  const center=[(segment.a[0]+segment.b[0])/2,(segment.a[1]+segment.b[1])/2];
  for(const army of s.armies) {
    const m=army.nativeMovement!;check(army.roadId===road.id,'source path chose another road');
    const forward=army.from===road.from,sign=forward?-1:1,next=forward?segment.b:segment.a;
    m.px=Math.round((center[0]+sign*3*dx)*65536);m.py=Math.round((center[1]+sign*3*dy)*65536);
    m.point=forward?segment.i-1:segment.i;m.nextPoint=forward?segment.i:segment.i-1;
    m.heading=nativeStrategicHeading(m.px>>16,m.py>>16,next[0],next[1])*65536;
    m.frameCountdown=1;m.cooldown=-40;
  }
  s=dispatch(s,{type:'advance',days:1},content);
  check(s.battle?.roadEncounter&&s.nativeMovementClock,'actual source update did not freeze into a road encounter');
  const encounter=structuredClone(s);
  s=dispatch(s,{type:'battle-command',command:{type:'start'}},content);
  prepareBattleMovement(s.battle!);
  // Preserve the real capture rule. A withdrawing commander has status 2,
  // so this movement test does not need to drive the separate prisoner screen.
  issueNativeCommand(s.battle!,'defender',257,8);
  const retreating=battleGeneral(s.battle!,'defender'),motion=retreating.movement!;
  motion.exiting=true;motion.remaining=1;motion.vx=0;motion.vy=0;
  s=dispatch(s,{type:'battle-tick',steps:1},content);check(s.battle?.phase==='finished','prescribed final retreat step did not finish combat');
  const finished=structuredClone(s);
  s=dispatch(s,{type:'battle-finish'},content);check(!s.battle&&!s.pendingCaptive&&s.armies.length===2,'retreat settlement did not keep both travelling armies');
  const aftermath=structuredClone(s);
  const sourceFlags=(a:Army)=>a.nativeMovement!.flags;
  check(s.armies.some(a=>sourceFlags(a)&2)&&s.armies.some(a=>sourceFlags(a)&4),'source victory/retreat flags were lost');
  for(const state of [initial,travelling,encounter,finished,aftermath]) {
    check(state.movementRules==='native-strategic-v1'&&state.captureRules==='native-capture-v1','source rule marker was removed');
    validateSession(state,content);
  }
  return {initial,travelling,encounter,finished,aftermath,from:road.from,to:road.to,roadId:road.id};
}
