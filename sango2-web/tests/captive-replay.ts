/** Rebuild UI saves through the current campaign/battle/capture entry points.
 * Source content is fetched by the test; no environment variable or stale
 * node_modules cache is required. Only the battle knockdowns are prescribed. */
import type {GameContent} from '../packages/content/src/index';
import {createSession,dispatch,validateSession,type Session} from '../packages/core/src/index';
import {battleGeneral} from '../packages/core/src/battle';
import {ensureDomesticSearch} from '../packages/core/src/native-policy-actions';
import {refreshPolicyGovernors} from '../packages/core/src/native-policy';

function check(condition:unknown,message:string):asserts condition {if(!condition)throw new Error(`Captive replay: ${message}`);}
export function buildCaptiveReplays(content:GameContent):{pending:Session;endgame:Session} {
  const scene=content.scenarios[0],rulers=new Set(scene.factions.map(f=>f.leaderId));
  const player=scene.factions.find(f=>!f.special&&scene.roads.some(road=>{
    const a=scene.cities.find(city=>city.id===road.from)!,b=scene.cities.find(city=>city.id===road.to)!;
    const enemy=a.ownerId===f.id?b.ownerId:b.ownerId===f.id?a.ownerId:null;
    return !road.restricted&&!!enemy&&enemy!==f.id&&scene.cities.filter(city=>city.ownerId===enemy).length>1;
  }));check(player,'no opposing source faction and road');
  let s=dispatch(createSession(content,scene.id,player.id),{type:'policy-finish'},content);
  const road=scene.roads.find(road=>!road.restricted&&[road.from,road.to].some(id=>s.cities[id].ownerId===player.id)&&[road.from,road.to].some(id=>s.cities[id].ownerId&&s.cities[id].ownerId!==player.id&&scene.cities.filter(city=>city.ownerId===s.cities[id].ownerId).length>1));check(road,'no usable frontier');
  const from=s.cities[road.from].ownerId===player.id?road.from:road.to,to=road.from===from?road.to:road.from,enemy=s.cities[to].ownerId!;
  const back=scene.cities.find(city=>city.id!==to&&city.ownerId===enemy)!.id;
  const actor=scene.generals.find(g=>s.generals[g.id].ownerId===player.id&&s.generals[g.id].status==='登'&&!rulers.has(g.id));
  const prisoners=scene.generals.filter(g=>s.generals[g.id].ownerId===enemy&&s.generals[g.id].status==='登'&&!rulers.has(g.id)).slice(0,2);
  check(actor&&prisoners.length===2,'need an attacker and two non-ruler prisoners');
  const synchronize=(session:Session)=>{
    for(const city of scene.cities)session.cities[city.id].troops=Object.values(session.generals).filter(g=>g.cityId===city.id&&!g.armyId&&g.ownerId===session.cities[city.id].ownerId&&g.status==='登').reduce((n,g)=>n+g.troops,0);
    for(const id of Object.keys(session.nativeAI!.countdowns))session.nativeAI!.countdowns[id]=999;
    ensureDomesticSearch(session,scene,content.items);refreshPolicyGovernors(session,scene);
  };
  const marchToBattle=(session:Session,officerId:string)=>{
    let next=dispatch(session,{type:'march',from,to,generalIds:[officerId],troops:session.generals[officerId].troops},content);
    for(let i=0;i<30&&!next.battle;i++) {
      if(next.policy?.active)next=dispatch(next,{type:'policy-finish'},content);
      next=dispatch(next,{type:'advance',days:30},content);
    }
    check(next.battle,'source army never reached the encounter');return next;
  };
  for(const g of Object.values(s.generals))if(g.cityId===to)g.cityId=back;
  s.generals[actor.id].cityId=from;
  for(const [i,def] of prisoners.entries())Object.assign(s.generals[def.id],{cityId:to,loyalty:i===0?100:0,hp:Math.min(80,def.hp)});
  synchronize(s);s=marchToBattle(s,actor.id);
  for(let round=0;round<8;round++) {
    s=dispatch(s,{type:'battle-command',command:{type:'start'}},content);battleGeneral(s.battle!,'defender').hp=0;
    s=dispatch(s,{type:'battle-tick',steps:1},content);if(s.battle!.phase==='finished')break;
    s=dispatch(s,{type:'battle-command',command:{type:'next-round',commanderId:s.battle!.commanders.attacker.id}},content);
  }
  check(s.battle?.phase==='finished','prescribed battle did not finish');
  s.battle.rosters.defender[0].commander.loyalty=100;s.battle.rosters.defender[1].commander.loyalty=0;
  let pending:Session|undefined;
  for(let seed=1;seed<200;seed++) {
    const attempt=structuredClone(s);attempt.battle!.opponentAI!.rng=[seed,0x87654321];
    const result=dispatch(attempt,{type:'battle-finish'},content);
    if(result.pendingCaptive&&!result.pendingCaptive.current.accepted){pending=result;break;}
  }
  check(pending,'could not construct source refusal branch');validateSession(pending,content);
  let ended=dispatch(createSession(content,scene.id,player.id),{type:'policy-finish'},content),ruler=player.leaderId!;
  ended.generals[ruler].cityId=from;synchronize(ended);ended=marchToBattle(ended,ruler);
  ended=dispatch(ended,{type:'battle-command',command:{type:'start'}},content);battleGeneral(ended.battle!,'attacker').hp=0;
  ended=dispatch(ended,{type:'battle-tick',steps:1},content);ended=dispatch(ended,{type:'battle-finish'},content);
  check(ended.endgame?.result==='defeat'&&ended.endgame.reason==='ruler-lost','ruler-loss ending was not produced');validateSession(ended,content);
  return {pending,endgame:ended};
}
