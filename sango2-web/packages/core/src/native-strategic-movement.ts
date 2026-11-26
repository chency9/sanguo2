/** Strategic sprite movement/collision boundaries from 1.05+ x86.
 * Positions are signed 16.16 values; source callbacks provide global order. */
import {nativeBelow,type NativeRandomState} from './native-strategic-ai';

export interface NativeStrategicActor {id:string;owner:number|string|null;cooldown:number;x:number;y:number}
export interface NativeStrategicPair {first:string;second:string}
/** Object51 has SPACE 4,4,48,0 and OF_MAN|OF_TRIGGERMAN. Collision callbacks
 * see the proposed location, before that movement is committed. Same-road ids
 * and path-crossing interpolation are not part of the original predicate. */
export function nativeStrategicCollisions(actors:readonly NativeStrategicActor[],moving:string,dx:number,dy:number,existing:readonly NativeStrategicPair[]=[]):NativeStrategicPair[] {
  const own=actors.find(a=>a.id===moving);if(!own)return [];
  const occupied=new Set(existing.flatMap(p=>[p.first,p.second])),added:NativeStrategicPair[]=[];
  for(const other of actors) {
    if(other===own||Math.abs(((own.x+dx)|0)-other.x)>8*65536||Math.abs(((own.y+dy)|0)-other.y)>8*65536||
      own.cooldown>0||other.cooldown>0||own.owner===other.owner||existing.length+added.length>=16||occupied.has(own.id)||occupied.has(other.id))continue;
    added.push({first:own.id,second:other.id});occupied.add(own.id);occupied.add(other.id);
  }
  return added;
}

export interface NativeEncounterEntry extends NativeStrategicPair {kind:'city'|'armies';firstOwner:number|string|null;secondOwner:number|string|null;firstValid:boolean;secondValid:boolean}
export interface NativeEncounterOperation extends NativeStrategicPair {kind:'auto-city'|'auto-armies'|'player-city'|'player-armies'}
/** 0x41152C resolves computers during traversal, then enters the last queued
 * player encounter. A city entry checks only the moving army's lifetime id. */
export function nativeStrategicDispatch(entries:readonly NativeEncounterEntry[],player:number|string,auto=false):NativeEncounterOperation[] {
  const operations:NativeEncounterOperation[]=[];let pending:NativeEncounterOperation|undefined;
  for(const e of entries) {
    if(!e.secondValid||e.kind==='armies'&&!e.firstValid)continue;
    if(!auto&&(e.firstOwner===player||e.secondOwner===player))pending={kind:e.kind==='city'?'player-city':'player-armies',first:e.first,second:e.second};
    else operations.push({kind:e.kind==='city'?'auto-city':'auto-armies',first:e.first,second:e.second});
  }
  if(pending)operations.push(pending);return operations;
}

export const nativeStrategicSpeed=(flags:number)=>flags&2?0:flags&4?3:flags&0x20?0:1;
/** 0x44FDE4 classifies against tangent(midpoint) thresholds rather than
 * rounding atan2. The binary search and integer division are intentional. */
export function nativeStrategicHeading(x:number,y:number,targetX:number,targetY:number):number {
  const dx=targetX-x,dy=targetY-y,width=Math.abs(dx);
  if(width===0)return dy<0?192:64;
  const ratio=Math.trunc(((Math.abs(dy)<<16)>>>0)/width);let low=0,high=64,index=0;
  const slope=(n:number)=>Math.trunc(Math.tan(Math.PI/256*(2*n+1))*65536)|0;
  while(true) {
    const size=high-low;if(size===1){index=size;break;}
    index=low+(size>>>1);
    if(ratio<(slope(index)>>>0)){high=index;if(ratio>=(slope(index-1)>>>0))break;}
    else {low=index;if(ratio<=(slope(index+1)>>>0)){index++;break;}}
  }
  return dx>=0?dy<0?256-index:index:dy>=0?128-index:index+128;
}

export interface NativeStrategicRouteInput {
  path:readonly (readonly [number,number])[];index:number;nextIndex:number;direction:number;
  destination:string;nextCity:string;lastCity:string;owner:number|string;targetOwner:number|string|null;
  cooldown:number;x:number;y:number;speed:number;
}
/** 0x439329 examines integer sprite coordinates before motion. Host operations
 * are returned in execution order; callers must update heading/roads or merge
 * units immediately, not teleport a travelling army into a battle city. */
export function nativeStrategicRouteGate(input:NativeStrategicRouteInput):{canMove:number;index:number;nextIndex:number;operations:('heading'|'enter'|'route'|'queue-city')[]} {
  let {index,nextIndex}=input;const operations:('heading'|'enter'|'route'|'queue-city')[]=[];
  const point=input.path[nextIndex],distance=Math.trunc(Math.hypot(input.x-point[0],input.y-point[1])*65536);
  if(distance>input.speed*131072)return {canMove:1,index,nextIndex,operations};
  index=nextIndex;
  if((index>0||input.direction!==0)&&(index<input.path.length-1||input.direction!==1)) {
    if(input.direction===1&&index<input.path.length){nextIndex=index+1;operations.push('heading');}
    else if(input.direction!==1&&index>0){nextIndex=index-1;operations.push('heading');}
  } else if(input.nextCity!==input.destination) {
    if(input.targetOwner!==input.owner&&input.targetOwner!==null&&input.cooldown<=0)operations.push('queue-city');
    else operations.push('route');
  } else if(input.targetOwner===null||input.targetOwner===input.owner)operations.push('enter');
  else operations.push('queue-city');
  return {canMove:0,index,nextIndex,operations};
}

export interface NativeStrategicAftermath {flags:number;money:number;retreats:number;cooldown:number;timer:number}
/** 0x439141. Retreat destination selection occurs after these two RNG draws,
 * followed by leader/adviser repair and drawing the army flag. */
export function nativeStrategicAftermath(state:{flags:number;money:number;retreats:number},kind:2|4|8|16,rng:NativeRandomState):NativeStrategicAftermath&{operations:string[]} {
  let {flags,money,retreats}=state,cooldown=0,timer=0;const operations:string[]=[];
  if(kind===2){flags=(flags|2)&~4;cooldown=20;timer=240;operations.push('redraw','empty');}
  else if(kind===8)operations.push('remove');
  else {
    flags=(flags|4)&~0x22;cooldown=60;timer=nativeBelow(rng,10)+120;retreats++;
    if(kind===4) {
      money=Math.trunc((Math.imul(money,nativeBelow(rng,2000)+4000)>>>0)/10000);
      operations.push('retreat-route','leader','advisor');
    }
    operations.push('redraw','empty');
  }
  return {flags,money,retreats,cooldown,timer,operations};
}

export interface NativeRetreatCity {id:string;owner:string|null;hidden:boolean;capacity:number;residents:number;neighbors:readonly string[]}
export interface NativeRetreatRouteInput {
  cities:readonly NativeRetreatCity[];ownedOrder:readonly string[];nextCity:string|null;lastCity:string|null;
  oppositeCity:string|null;avoidCity:string|null;leaderCity:string|null;members:number;
}
/** 0x401454's retreat priorities. Neighbor categories use the reference
 * city's owner (0x4010C6), not the retreating faction; this matters near an
 * enemy-controlled endpoint. Hidden neighbors are omitted by 0x4054B9. */
export function nativeStrategicRetreatDestination(input:NativeRetreatRouteInput,rng:NativeRandomState):string|null {
  const get=(id:string|null)=>input.cities.find(c=>c.id===id),opposite=get(input.oppositeCity),last=get(input.lastCity);
  const room=(c:NativeRetreatCity)=>input.members+c.residents<=c.capacity;
  if(input.nextCity&&opposite&&!opposite.hidden&&room(opposite)&&input.avoidCity!==opposite.id)return opposite.id;
  if(last&&(last.owner==='own'||last.owner===null)&&room(last)&&input.avoidCity!==last.id)return last.id;
  const reference=opposite??last;
  const draw=(list:readonly string[])=>list[nativeBelow(rng,list.length)];
  if(reference) {
    const neighbors=reference.neighbors.slice(0,9).map(id=>get(id)!).filter(c=>!c.hidden);
    const same=neighbors.filter(c=>c.owner===reference.owner).map(c=>c.id);
    if(same.length){const id=draw(same);if(id!==input.avoidCity)return id;}
    const empty=neighbors.filter(c=>c.owner===null).map(c=>c.id);
    if(empty.length){const id=draw(empty);if(id!==input.avoidCity)return id;}
    if(input.leaderCity!==null&&input.leaderCity!==input.avoidCity)return input.leaderCity;
    const all=neighbors.map(c=>c.id);
    // 0x401065 draws from the whole list on every iteration, including length1.
    for(let i=0;i<all.length;i++){const at=nativeBelow(rng,all.length);[all[i],all[at]]=[all[at],all[i]];}
    const candidate=all.find(id=>id!==input.avoidCity);if(candidate)return candidate;
  }
  if(input.ownedOrder.length)return draw(input.ownedOrder);
  const visible=input.cities.filter(c=>!c.hidden).map(c=>c.id);return visible.length?draw(visible):null;
}

/** One 0x439A48 source update of a travelling sprite. Movement itself is
 * gated by its six-update animation clock; cooldowns run every update. */
export function nativeStrategicSpriteUpdate(input:{x:number;y:number;heading:number;flags:number;clock:number;frame:number;cooldown:number;timer:number;phase:number;target:readonly number[]}):{
  x:number;y:number;heading:number;flags:number;clock:number;frame:number;cooldown:number;timer:number;armyX:number;armyY:number;speed:number;
} {
  let {x,y,heading,flags,clock,frame,cooldown,timer}=input;
  const move=--clock<=0;if(move){frame++;clock=6;}
  let speed=1;
  if(input.phase===2) {
    speed=nativeStrategicSpeed(flags);
    if(move) {
      const angle=heading*3.1415926/8388608;
      x=(x+Math.trunc(Math.cos(angle)*speed*65536))|0;y=(y+Math.trunc(Math.sin(angle)*speed*65536))|0;
      heading=nativeStrategicHeading(x>>16,y>>16,input.target[0],input.target[1])*65536;
    }
  }
  cooldown=(cooldown-1)|0;timer=((timer-1)<<16)>>16;if(timer===0)flags&=~6;
  return {x,y,heading,flags,clock,frame,cooldown,timer,armyX:x>>16,armyY:y>>16,speed};
}
