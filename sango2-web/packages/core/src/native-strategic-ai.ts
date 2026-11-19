/** Decision kernel transcribed from the hash-pinned 1.05+ executable.
 * Address-level evidence and original-machine differential vectors:
 * web-port-research/tools/native_ai_oracle.py. World/time adapters are separate.
 */
export type NativeRandomState=[number,number];
export const NATIVE_AI_PARAMETERS=[
  [0,70,20000,7,2,6,2,40,50,30,20,2,20,30,50,400],
  [200,78,17000,6,2,6,2,45,60,35,30,3,30,30,40,500],
  [500,85,14000,5,2,6,2,50,70,45,35,4,35,30,35,600],
  [2000,90,11000,5,2,6,2,55,80,50,40,5,40,30,30,700],
  [4000,99,8000,4,2,6,2,60,85,55,50,6,60,30,10,800],
] as const;
/** 0x450132: ADD of masked shifts, NOT rotate. At shift zero the value doubles. */
export function nativeRandom(state:NativeRandomState):number {
  let a=(state[0]+1)>>>0,b=(state[1]-1)>>>0;
  b=((b>>> (a&31))+(b<< (32-(a&31))))>>>0;
  a=((a<< (b&31))+(a>>> (32-(b&31))))>>>0;
  state[0]=a;state[1]=b;return (a+b)>>>0;
}
export function nativeBelow(state:NativeRandomState,bound:number):number {
  return bound===0?0:nativeRandom(state)%(bound>>>0);
}
/** 0x468740: cumulative lottery, including a real idle entry. */
export function nativeWeightedChoice(weights:readonly number[],state:NativeRandomState):number {
  const sum=weights.reduce((n,w)=>(n+w)>>>0,0);
  if(!sum)return -1;
  let value=nativeBelow(state,sum)|0;
  for(let i=0;i<weights.length;i++){if(value<weights[i])return i;value=(value-weights[i])|0;}
  return -1;
}
/** 0x401065 / 0x40D299: every element swaps against the whole list. Not Fisher-Yates. */
export function nativeShuffle<T>(items:T[],state:NativeRandomState):void {
  for(let i=0;i<items.length;i++){const j=nativeBelow(state,items.length);[items[i],items[j]]=[items[j],items[i]];}
}
export interface NativeOfficerReadiness {
  hp:number;maxHp:number;mp:number;maxMp:number;
  troops:number;maxTroops:number;reserve:number;maxReserve:number;
}
export interface NativeStrategicCity {
  owner:'ai'|'player'|'rival'|null;visible:boolean;capacity:number;money:number;
  kind:number;hasGovernor:boolean;generals:NativeOfficerReadiness[];neighbors:number[];
}
export interface NativeStrategySnapshot {
  profile:number;rng:NativeRandomState;cities:NativeStrategicCity[];
  /** Values read at 0x40C965. Omission uses a documented Web fallback and emits a gap. */
  cooperationComparisons?:boolean[];
}
/** Native candidate storage is seven signed integers, capped at 64 entries.
 * kind, source, destination, secondSource, officerCount, secondCount, weight.
 * Index -1 represents the native null pointer.
 */
export type NativeCandidate=[number,number,number,number,number,number,number];
export interface NativeStrategyDecision {
  candidates:NativeCandidate[];chosen:number;rngAfterGeneration:NativeRandomState;rngAfterChoice:NativeRandomState;
  unresolvedCooperationReads:number;
}
const trunc=Math.trunc;
/** 0x40C47C: all three inclusive thresholds must pass. */
export function nativeOfficerReady(g:NativeOfficerReadiness,profile:number):boolean {
  const p=NATIVE_AI_PARAMETERS[profile];
  return 100*(g.troops+g.reserve)>=p[8]*(g.maxTroops+g.maxReserve)&&100*g.hp>=p[9]*g.maxHp&&100*g.mp>=p[10]*g.maxMp;
}
/** 0x4017E1 / 0x401864: player adjacency counts three, other non-own cities one. */
export function nativeBorder(city:NativeStrategicCity,cities:readonly NativeStrategicCity[],includeEmpty=false):number {
  let count=0;
  for(const i of city.neighbors.slice(0,9)) {
    const next=cities[i];if(next.kind===1)continue;
    if(next.owner!==city.owner&&(includeEmpty||next.owner!==null))count+=next.owner==='player'?3:1;
  }
  return count;
}
/** 0x401B84. Input counters use native active-route / non-arrival semantics. */
export const nativeCanDispatch=(allComputerRouteArmies:number,ownUnarrivedRouteArmies:number)=>allComputerRouteArmies<7&&ownUnarrivedRouteArmies<2;

/** 0x40CBB6 and callees; draws happen during generation, even for rejected candidates. */
export function nativeStrategyDecision(input:NativeStrategySnapshot):NativeStrategyDecision {
  if(!Number.isInteger(input.profile)||!NATIVE_AI_PARAMETERS[input.profile])throw new Error('Invalid native AI profile');
  const p=NATIVE_AI_PARAMETERS[input.profile],cities=input.cities,rng:NativeRandomState=[...input.rng];
  const candidates:NativeCandidate[]=[];
  let scratchIndex=0,unresolvedCooperationReads=0;
  const add=(...row:NativeCandidate)=>{if(candidates.length<64)candidates.push(row);};
  const adjacent=(c:NativeStrategicCity)=>c.neighbors.slice(0,9).filter(i=>cities[i].kind!==1);
  const border=(c:NativeStrategicCity)=>nativeBorder(c,cities);
  const readyCount=(c:NativeStrategicCity)=>Math.min(c.generals.filter(g=>nativeOfficerReady(g,input.profile)).length,c.generals.length-1);
  function attack(from:number,to:number) { // 0x40C635
    const source=cities[from],target=cities[to];
    if(!target.visible&&(!source.visible||nativeBelow(rng,128)!==0))return;
    const ready=readyCount(source);
    const required=target.hasGovernor?target.generals.length+nativeBelow(rng,3)+1:0;
    const count=Math.min(target.hasGovernor?required:nativeBelow(rng,2)+1,ready,5,source.generals.length-1);
    if(count===0)return;
    if(count<required) {
      if(ready<required) {
        for(const second of adjacent(target)) {
          if(cities[second].owner!=='ai'||second===from)continue;
          const readySecond=readyCount(cities[second]);
          if(readySecond+ready<required)continue;
          const captured=input.cooperationComparisons?.[scratchIndex++];
          if(captured===undefined)unresolvedCooperationReads++;
          // The original compares uninitialized locals. Explicit zero-stack fallback is false.
          let firstCount:number,secondCount:number;
          if(captured??false){firstCount=Math.min(ready,trunc(required/2),5);secondCount=Math.min(required-firstCount,readySecond,5);}
          else{secondCount=Math.min(readySecond,trunc(required/2),5);firstCount=Math.min(required-secondCount,ready,5);}
          if(firstCount+secondCount>=required)add(7,from,to,second,firstCount,secondCount,target.owner==='player'?200:50);
        }
      } else add(7,from,to,from,Math.min(trunc(required/2),5),Math.min(required-trunc(required/2),5),target.owner==='player'?200:50);
    } else {
      add(target.owner==='player'?4:target.owner?5:8,from,to,-1,count,0,
        target.owner==='player'?200:target.owner?100:trunc(80/(border(source)+1)));
    }
  }
  cities.forEach((city,i)=>{
    if(city.owner!=='ai')return;
    const b=border(city),count=city.generals.length;
    // 0x40BFCE: money-transfer candidate is retained although dispatcher case 1 does nothing.
    if(b!==0&&city.money<p[0]) {
      const maximum=city.generals.reduce((n,g)=>n+g.maxTroops+g.maxReserve,0);
      const current=city.generals.reduce((n,g)=>n+g.troops+g.reserve,0);
      if(maximum===0)throw new Error('Native 0x40BFCE division by zero: invalid city snapshot');
      if(trunc(100*current/maximum)<=p[1])for(const j of adjacent(city)) {
        const source=cities[j];if(source.owner!=='ai')continue;
        if(border(source)>=b){if(source.generals.length>=p[3]&&source.money>p[2])add(1,j,i,-1,0,0,60);}
        else if(source.money>p[2])add(1,j,i,-1,0,0,80);
      }
    }
    // 0x40C1E4 / 0x40C157: reinforce a frontier using native officer-count imbalance.
    if(b!==0&&count<city.capacity)for(const j of adjacent(city)) {
      const source=cities[j],n=source.generals.length,sb=border(source);
      if(source.owner!=='ai'||n<=p[4]||!(sb===0&&count<p[5]||count-n<p[6]*(b-sb)))continue;
      let amount=p[6]*(b-sb)-(count-n);if(amount&1)amount++;
      amount=Math.min(trunc(amount/2),city.capacity-count,n-1,5);
      if(amount>0)add(3,j,i,-1,amount,0,80);
    }
    // 0x40CAF1. Do not reorder neighbors: their random draws are observable state.
    if(nativeBorder(city,cities,true)!==0)for(const j of adjacent(city))if(cities[j].owner!=='ai')attack(i,j);
    // 0x40C34D: depleted pass garrisons relocate; this is not a generic retreat rule.
    if(city.kind===2&&city.generals.reduce((n,g)=>n+g.troops+g.reserve,0)<trunc(50*city.generals.reduce((n,g)=>n+g.maxTroops+g.maxReserve,0)/100)) {
      for(const j of adjacent(city)) {
        const target=cities[j];if(target.owner!=='ai'||target.generals.length>=target.capacity)continue;
        const amount=Math.min(target.capacity-target.generals.length,count,5);
        if(amount>0)add(9,i,j,-1,amount,0,80);
      }
    }
  });
  const rngAfterGeneration:NativeRandomState=[...rng];
  const chosen=nativeWeightedChoice([...candidates.map(c=>c[6]),800],rng); // 0x40CC10
  return {candidates,chosen,rngAfterGeneration,rngAfterChoice:[...rng],unresolvedCooperationReads};
}

/** 0x41AEC6 / 0x40D52F. Units are strategic callback invocations, not days. */
export function nativeNextDecisionCountdown(previous:number,executedKind?:number):number {
  const next=previous-1;if(next>0)return next;
  return (executedKind===3?600:executedKind===7?480:[4,5,8,9].includes(executedKind??0)?840:next)+120;
}
