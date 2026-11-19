/** Search / recruitment / autonomy kernels from the pinned 1.05+ EXE.
 * Object lists, inventory and officer growth are supplied by the campaign adapter. */
import {nativeBelow,nativeWeightedChoice,type NativeRandomState} from './native-strategic-ai';

export interface SearchItem {id:number;flags:number;searchType:number;rate:number;level:number}
export type SearchRoute={kind:'none'}|{kind:'item'}|{kind:'officer';generalId:string;cityId:string};
export interface SearchArea {home:string;category:number;neighbors:string[];wild:Record<string,string[]|undefined>}
/** 0x426D8C. All five valid RATE rows are [50,30,20,33,66]. An empty
 * talent list consumes the 66:33 lottery and then ALWAYS searches for an item. */
export function nativeSearchRoute(area:SearchArea,rng:NativeRandomState):SearchRoute {
  const kind=nativeWeightedChoice([50,30,20],rng);
  if(kind===1)return {kind:'item'};
  if(kind!==0)return {kind:'none'};
  const neighbors=area.neighbors.slice(0,9),count=neighbors.length+2;
  let cityId=area.home;
  for(let attempt=0;attempt<count;attempt++) {
    const draw=nativeBelow(rng,count);cityId=draw<2?area.home:neighbors[draw-2];
    if(area.wild[cityId]?.length)break;
  }
  const candidates=area.wild[cityId]??[];
  if(!candidates.length) {nativeWeightedChoice([66,33],rng);return {kind:'item'};}
  const index=nativeBelow(rng,candidates.length+1);
  return index===candidates.length?{kind:'none'}:{kind:'officer',generalId:candidates[index],cityId};
}
const short=(n:number)=>(n<<16)>>16;
/** 0x408EE2. Unconfigured slots have zero RATE, not the INI loader's default100. */
export function nativeSearchItem(items:readonly SearchItem[],found:readonly number[],level:number,rng:NativeRandomState):number {
  const weights=Array<number>(128).fill(0);
  for(const item of items) {
    if(item.id<0||item.id>=128)continue;
    let weight=0;const difference=Math.abs(level-item.level);
    if(!(item.flags&2&&found.includes(item.id))) {
      if(item.searchType===1)weight=difference>4?0:difference?Math.trunc(item.rate/difference):item.rate;
      else if(item.searchType===2)weight=level<item.level-4?0:level>=item.level?item.rate:Math.trunc(item.rate/difference);
      else weight=item.rate;
    }
    weights[item.id]=short(weight);
  }
  let draw=nativeBelow(rng,weights.reduce((a,b)=>a+b,0));
  for(let id=0;id<128;id++){if(draw<weights[id])return id;draw-=weights[id];}
  return -1;
}
export type RecruitmentCode=16|17|18|19;
/** 0x426C69. The searcher's INT has no role in the persuasion lottery. */
export function nativeRecruitDisposition(owner:string,loyalFaction:string|null,loyalLeaderOwner:string|null,intelligence:number,rng:NativeRandomState):RecruitmentCode {
  if(loyalFaction===owner)return 17;
  if(loyalFaction&&loyalLeaderOwner===loyalFaction)return 19;
  if(!loyalFaction||loyalLeaderOwner!==owner) {
    if(nativeWeightedChoice([intelligence>90?intelligence-30:60,40],rng)!==0)return 18;
  }
  return 16;
}
/** 0x426B44: player roster, descending EXP, ruler promoted first, top third.
 * The original stores the multiplication as a 32-bit unsigned integer. */
export function nativeRecruitExperience(roster:readonly {id:string;experience:number}[],ruler:string|null,rng:NativeRandomState):number {
  const ordered=roster.toSorted((a,b)=>(b.experience|0)-(a.experience|0)),index=ordered.findIndex(g=>g.id===ruler);
  if(index>0)ordered.unshift(...ordered.splice(index,1));
  const count=Math.max(1,Math.trunc(ordered.length/3));
  const sum=ordered.slice(0,count).reduce((n,g)=>(n+g.experience)|0,0);
  const average=Math.trunc(sum/count),base=Math.trunc(Math.imul(3,average)/4);
  return Math.trunc((Math.imul(base,nativeBelow(rng,30)+90)>>>0)/100);
}
export type AutonomyMode=0|1|2|3|4;
/** 0x427701. Mode4 consumes its city lottery even when everyone already acted.
 * Officers joined by a callback are not added to this traversal snapshot. */
export function nativeAutonomy(cities:readonly {id:string;mode:AutonomyMode;officers:string[]}[],acted:Set<string>,rng:NativeRandomState,execute:(cityId:string,generalId:string,action:'develop'|'search')=>void):number {
  let count=0;
  for(const city of cities) {
    if(!city.mode)continue;
    const develop=city.mode===1?20:city.mode===2?80:city.mode===4?nativeBelow(rng,60)+20:50;
    for(const id of city.officers) {
      if(!acted.has(id)){execute(city.id,id,nativeBelow(rng,100)>=develop?'search':'develop');count++;}
      acted.add(id);
    }
  }
  return count;
}
