import type {ScenarioDefinition,RoadDefinition} from '@sango2/content';
import type {Session,Army} from './index';
import {nativeCityCapacity} from './native-ai-campaign';
import {nativeBelow} from './native-strategic-ai';
import {nativeStrategicHeading,nativeStrategicSpeed,nativeStrategicRouteGate,nativeStrategicCollisions,nativeStrategicDispatch,nativeStrategicAftermath,nativeStrategicRetreatDestination,type NativeRetreatCity} from './native-strategic-movement';

export interface NativeCampaignMovement {
  version:1;px:number;py:number;heading:number;point:number;nextPoint:number;direction:0|1;
  lastCityId:string;nextCityId:string;destinationId:string;avoidCityId:string|null;
  flags:number;cooldown:number;timer:number;frameCountdown:number;frame:number;retreats:number;
}
export type NativeCampaignArmy=Army&{nativeMovement?:NativeCampaignMovement};
export interface NativeCampaignEncounter {kind:'city'|'armies';firstId:string;secondId:string}
export interface NativeCampaignMovementHooks {
  /** Computer resolutions finish synchronously. Player entry sets s.battle. */
  encounter:(entry:NativeCampaignEncounter)=>void;
  /** Runs after all sprite updates, before the queued encounter resolutions. */
  afterMovement?:()=>void;
}
const getMovement=(army:Army)=>(army as NativeCampaignArmy).nativeMovement;
const neighbors=(scene:ScenarioDefinition,id:string)=>scene.roads.filter(r=>r.from===id||r.to===id).slice(0,9).map(r=>r.from===id?r.to:r.from);
const opposite=(road:RoadDefinition,id:string)=>road.from===id?road.to:road.to===id?road.from:null;
const short=(n:number)=>(n<<16)>>16;

/** Original relaxation order: cities in source order, roads in their original
 * nine-slot neighbor order; all roads participate, including special paths. */
export function nativeCampaignNextCity(scene:ScenarioDefinition,from:string,to:string):{next:string;distance:number}|null {
  if(from===to)return {next:from,distance:0};
  const distances=new Map(scene.cities.map(c=>[c.id,65536])),active=new Set<string>([from]),parents=new Map<string,string>();distances.set(from,0);
  let target=65536;
  while(active.size) {
    let updates=0;
    for(const city of scene.cities)if(active.has(city.id)) {
      if(distances.get(city.id)!<target)for(const road of scene.roads.filter(r=>r.from===city.id||r.to===city.id).slice(0,9)) {
        const other=opposite(road,city.id)!,distance=distances.get(city.id)!+road.length;
        if(distance<distances.get(other)!&&distance<target){distances.set(other,distance);parents.set(other,city.id);active.add(other);updates++;}
      }
      active.delete(city.id);
    }
    target=distances.get(to)??65536;if(!updates)break;
  }
  if(target===65536)return null;
  let next=to;while(parents.get(next)!==from){const parent=parents.get(next);if(!parent)return null;next=parent;}
  return {next,distance:target};
}
function roadTo(scene:ScenarioDefinition,from:string,to:string){return scene.roads.find(r=>r.from===from&&r.to===to||r.from===to&&r.to===from);}
function headingToPoint(army:Army,road:RoadDefinition){const m=getMovement(army)!,point=road.points[m.nextPoint];m.heading=nativeStrategicHeading(m.px>>16,m.py>>16,point[0],point[1])*65536;}
function setRoad(scene:ScenarioDefinition,army:Army,from:string,next:string) {
  const m=getMovement(army)!,road=roadTo(scene,from,next);if(!road||road.points.length<2)return false;
  army.roadId=road.id;m.nextCityId=next;m.direction=road.from===from?1:0;
  m.point=m.direction===1?0:road.points.length-1;m.nextPoint=m.point+(m.direction===1?1:-1);headingToPoint(army,road);return true;
}
/** Supports normal departures and new one-officer or retreating groups built
 * at a city by the capture/defeated-city adapter. Does not allocate troops. */
export function initNativeCampaignMovement(scene:ScenarioDefinition,army:Army,options:{cityId?:string;position?:readonly [number,number];destinationId?:string}={}):boolean {
  const from=options.cityId??army.from,destination=options.destinationId??army.to,route=nativeCampaignNextCity(scene,from,destination),origin=options.position??scene.cities.find(c=>c.id===from)?.position;
  if(!route||!origin)return false;
  const m:NativeCampaignMovement={version:1,px:origin[0]*65536,py:origin[1]*65536,heading:0,point:0,nextPoint:0,direction:1,lastCityId:from,nextCityId:route.next,destinationId:destination,avoidCityId:null,
    flags:0,cooldown:0,timer:0,frameCountdown:6,frame:0,retreats:0};
  (army as NativeCampaignArmy).nativeMovement=m;army.from=from;army.to=destination;
  if(route.next!==from&&!setRoad(scene,army,from,route.next)){delete (army as NativeCampaignArmy).nativeMovement;return false;}
  army.totalDays=army.remainingDays=Math.max(1,Math.ceil(route.distance*6/10));return true;
}
export function nativeCampaignArmyPosition(army:Army):[number,number]|null {const m=getMovement(army);return m?[m.px/65536,m.py/65536]:null;}
function updateEstimate(scene:ScenarioDefinition,army:Army) {
  const m=getMovement(army)!;const road=scene.roads.find(r=>r.id===army.roadId);if(!road)return;
  const points=m.direction===1?road.points.slice(m.nextPoint):road.points.slice(0,m.nextPoint+1).reverse();
  let length=points.length?Math.hypot(points[0][0]-m.px/65536,points[0][1]-m.py/65536):0;
  for(let i=1;i<points.length;i++)length+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);
  const onward=nativeCampaignNextCity(scene,m.nextCityId,m.destinationId);length+=onward?.distance??0;
  const speed=Math.max(1,nativeStrategicSpeed(m.flags)),halt=m.flags&2?Math.max(0,m.timer):0;
  army.remainingDays=Math.max(1,Math.ceil((length*6/speed+halt)/10));army.totalDays=Math.max(army.totalDays,army.remainingDays);
}
function enterCity(s:Session,scene:ScenarioDefinition,army:Army,cityId:string):boolean {
  const city=s.cities[cityId],ids=army.generalIds.filter(id=>s.generals[id].status==='登'),residents=Object.values(s.generals).filter(g=>g.cityId===cityId&&!g.armyId&&g.status==='登');
  if(ids.length+(city.ownerId?residents.length:0)>nativeCityCapacity(city.population))return false;
  const wasEmpty=city.ownerId===null;city.ownerId=army.ownerId;city.troops+=ids.reduce((sum,id)=>sum+s.generals[id].troops,0);city.money+=army.treasury??0;
  for(const id of army.generalIds){const g=s.generals[id];g.cityId=cityId;g.armyId=null;}
  s.armies=s.armies.filter(a=>a.id!==army.id);
  if(s.policy) {
    if(wasEmpty||!s.policy.governors[cityId])s.policy.governors[cityId]=ids[0]??null;
    const order=s.policy.search?.residentOrder[cityId];if(order)for(const id of army.generalIds){const at=order.indexOf(id);if(at>=0)order.splice(at,1);order.unshift(id);}
  }
  const commander=scene.generals.find(g=>g.id===ids[0]);
  const faction=scene.factions.find(f=>f.id===army.ownerId)?.name??'该势力';
  s.chronicle.unshift({id:s.nextId++,day:s.day,kind:wasEmpty&&army.ownerId===s.factionId?'victory':'march',text:`${commander?.name??'部队'}抵达${scene.cities.find(c=>c.id===cityId)!.name}${wasEmpty?`，城池归属${faction}`:'，余部归入驻军'}。`});s.chronicle.length=Math.min(100,s.chronicle.length);return true;
}
/** 0x43955A changes direction along the current road toward the endpoint
 * closest in graph distance to the requested destination; ties choose from. */
export function retargetNativeCampaignArmy(scene:ScenarioDefinition,army:Army,destination:string):boolean {
  const m=getMovement(army)!,road=scene.roads.find(r=>r.id===army.roadId);if(!m||!road)return false;
  const from=nativeCampaignNextCity(scene,road.from,destination)?.distance??65536,to=nativeCampaignNextCity(scene,road.to,destination)?.distance??65536;
  const direction:0|1=from>to?1:0;m.destinationId=destination;army.to=destination;m.nextCityId=direction===1?road.to:road.from;
  if(direction!==m.direction){[m.point,m.nextPoint]=[m.nextPoint,m.point];m.direction=direction;}
  headingToPoint(army,road);updateEstimate(scene,army);return true;
}
/** One source callback. Newly allocated sprites wait until the next snapshot.
 * Queue collection happens before AI/recovery and resolution happens after it. */
export function runNativeCampaignMovement(s:Session,scene:ScenarioDefinition,hooks:NativeCampaignMovementHooks):NativeCampaignEncounter[] {
  if(s.battle)return [];
  const entries:NativeCampaignEncounter[]=[],used=new Set<string>();
  const enqueue=(entry:NativeCampaignEncounter)=>{
    const first=`${entry.kind==='city'?'city':'army'}:${entry.firstId}`,second=`army:${entry.secondId}`;
    if(entries.length<16&&!used.has(first)&&!used.has(second)){entries.push(entry);used.add(first);used.add(second);}
  };
  for(const army of [...s.armies]) {
    const m=getMovement(army);if(!m||!s.armies.includes(army))continue;
    if(!army.generalIds.some(id=>s.generals[id].status==='登')){s.armies=s.armies.filter(a=>a!==army);continue;}
    const road=scene.roads.find(r=>r.id===army.roadId);
    const animate=--m.frameCountdown<=0;if(animate){m.frame++;m.frameCountdown=6;}
    // A newly formed return group can already stand at its destination.
    // A marching army retreating toward its previous city has the same city
    // IDs, but distinct route points and must still walk back to the endpoint.
    if(m.nextCityId===m.lastCityId&&m.destinationId===m.lastCityId&&m.point===m.nextPoint){enterCity(s,scene,army,m.destinationId);continue;}
    if(!road)continue;
    const gate=nativeStrategicRouteGate({path:road.points,index:m.point,nextIndex:m.nextPoint,direction:m.direction,destination:m.destinationId,nextCity:m.nextCityId,lastCity:m.lastCityId,
      owner:army.ownerId,targetOwner:s.cities[m.nextCityId].ownerId,cooldown:m.cooldown,x:m.px>>16,y:m.py>>16,speed:nativeStrategicSpeed(m.flags)});
    m.point=gate.index;m.nextPoint=gate.nextIndex;
    for(const operation of gate.operations) {
      if(operation==='heading')headingToPoint(army,road);
      else if(operation==='enter')enterCity(s,scene,army,m.destinationId);
      else if(operation==='queue-city')enqueue({kind:'city',firstId:m.nextCityId,secondId:army.id});
      else {
        const onward=nativeCampaignNextCity(scene,m.nextCityId,m.destinationId);
        if(onward&&onward.next!==m.nextCityId)setRoad(scene,army,m.nextCityId,onward.next);
      }
    }
    if(!s.armies.includes(army))continue;
    if(animate&&gate.canMove===1) {
      const angle=m.heading*3.1415926/8388608,speed=nativeStrategicSpeed(m.flags),dx=Math.trunc(Math.cos(angle)*speed*65536),dy=Math.trunc(Math.sin(angle)*speed*65536);
      const actors=s.armies.filter(a=>!!getMovement(a)).map(a=>({id:a.id,owner:a.ownerId,cooldown:getMovement(a)!.cooldown,x:getMovement(a)!.px,y:getMovement(a)!.py}));
      const already=entries.map(e=>({first:e.kind==='armies'?e.firstId:`city:${e.firstId}`,second:e.secondId}));
      for(const pair of nativeStrategicCollisions(actors,army.id,dx,dy,already))enqueue({kind:'armies',firstId:pair.first,secondId:pair.second});
      m.px=(m.px+dx)|0;m.py=(m.py+dy)|0;headingToPoint(army,road);
    }
    m.cooldown=(m.cooldown-1)|0;m.timer=short(m.timer-1);if(m.timer===0)m.flags&=~6;updateEstimate(scene,army);
  }
  hooks.afterMovement?.();
  const operations=nativeStrategicDispatch(entries.map(e=>{
    const first=e.kind==='city'?s.cities[e.firstId]:s.armies.find(a=>a.id===e.firstId),second=s.armies.find(a=>a.id===e.secondId);
    return {kind:e.kind,first:e.firstId,second:e.secondId,firstOwner:first?.ownerId??null,secondOwner:second?.ownerId??null,firstValid:!!first,secondValid:!!second};
  }),s.factionId);
  for(const operation of operations) {
    if(s.battle||s.endgame)break;
    hooks.encounter({kind:operation.kind.endsWith('city')?'city':'armies',firstId:operation.first,secondId:operation.second});
  }
  return entries;
}
function retreatCities(s:Session,scene:ScenarioDefinition):NativeRetreatCity[] {
  return scene.cities.map(def=>({id:def.id,owner:s.cities[def.id].ownerId,hidden:def.nativeFlags===1,capacity:nativeCityCapacity(s.cities[def.id].population),
    residents:Object.values(s.generals).filter(g=>g.cityId===def.id&&!g.armyId&&g.status==='登').length,neighbors:neighbors(scene,def.id)}));
}
export function settleNativeArmyAftermath(s:Session,scene:ScenarioDefinition,army:Army,kind:2|4|8|16):void {
  const m=getMovement(army);if(!m||!s.nativeAI)return;
  const result=nativeStrategicAftermath({flags:m.flags,money:army.treasury??0,retreats:m.retreats},kind,s.nativeAI.rng);
  if(kind===8){s.armies=s.armies.filter(a=>a!==army);return;}
  Object.assign(m,{flags:result.flags,cooldown:result.cooldown,timer:result.timer,retreats:result.retreats});army.treasury=result.money;
  if(kind===4) {
    const road=scene.roads.find(r=>r.id===army.roadId),cities=retreatCities(s,scene).map(c=>({...c,owner:c.owner===army.ownerId?'own':c.owner}));
    const owned=scene.cities.filter(c=>s.cities[c.id].ownerId===army.ownerId).map(c=>c.id),old=s.nativeAI.cityOrder[army.ownerId]??[];
    const destination=nativeStrategicRetreatDestination({cities,ownedOrder:[...owned.filter(id=>!old.includes(id)).reverse(),...old.filter(id=>owned.includes(id))],nextCity:m.nextCityId,lastCity:m.lastCityId,
      oppositeCity:road?opposite(road,m.nextCityId):null,avoidCity:m.avoidCityId,leaderCity:s.generals[scene.factions.find(f=>f.id===army.ownerId)?.leaderId??'']?.cityId??null,
      members:army.generalIds.filter(id=>s.generals[id].status==='登').length},s.nativeAI.rng);
    if(destination)retargetNativeCampaignArmy(scene,army,destination);
  }
  updateEstimate(scene,army);
}
/** Defeated-city retreat target 0x4012CD; categories are relative to the city
 * owner and consume a draw even for a one-element candidate list. */
export function nativeDefeatedCityRetreat(s:Session,scene:ScenarioDefinition,cityId:string):string|null {
  if(!s.nativeAI)return null;const city=s.cities[cityId],all=retreatCities(s,scene),near=neighbors(scene,cityId).map(id=>all.find(c=>c.id===id)!).filter(c=>!c.hidden);
  for(const candidates of [near.filter(c=>c.owner===city.ownerId),near.filter(c=>c.owner===null),near,all.filter(c=>c.owner===city.ownerId),all.filter(c=>!c.hidden)])
    if(candidates.length)return candidates[nativeBelow(s.nativeAI.rng,candidates.length)].id;
  return null;
}
export function validateNativeCampaignMovement(scene:ScenarioDefinition,army:Army,fail:()=>never):void {
  const m=getMovement(army);if(m===undefined)return;const city=(id:unknown)=>typeof id==='string'&&scene.cities.some(c=>c.id===id),integer=(n:unknown,min:number,max:number)=>typeof n==='number'&&Number.isInteger(n)&&n>=min&&n<=max;
  const road=scene.roads.find(r=>r.id===army.roadId),stationary=m&&m.nextCityId===m.lastCityId&&m.destinationId===m.lastCityId&&m.point===m.nextPoint;
  if(!m||m.version!==1||!integer(m.px,-2147483648,2147483647)||!integer(m.py,-2147483648,2147483647)||!integer(m.heading,0,16777216)||
    !city(m.lastCityId)||!city(m.nextCityId)||!city(m.destinationId)||m.avoidCityId!==null&&!city(m.avoidCityId)||m.destinationId!==army.to||
    ![0,1].includes(m.direction)||!stationary&&!road||!integer(m.point,0,road?road.points.length-1:0)||!integer(m.nextPoint,0,road?road.points.length-1:0)||
    !integer(m.flags,0,65535)||!integer(m.cooldown,-2147483648,2147483647)||!integer(m.timer,-32768,32767)||!integer(m.frameCountdown,-2147483648,6)||
    !integer(m.frame,0,4294967295)||!integer(m.retreats,0,32767))fail();
}
