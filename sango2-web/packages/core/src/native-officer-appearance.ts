/** Annual officer appearances from 0x423020/0x423681/0x4235EA/0x423476.
 * POS is a five-period location schedule, not a birth year. Native status 4096
 * is distinct from 8192: an officer who disappears is no longer reconsidered.
 * Script presentation and recruitment growth are explicit synchronous hooks. */
import {nativeBelow,type NativeRandomState} from './native-strategic-ai';

export const NATIVE_APPEARANCE_DENOMINATORS=[3,7,9,8,12] as const;
export function nativeAppearancePeriod(year:number):{stage:number;forced:boolean;denominator:number} {
  const stage=year<187?0:year<195?1:year<205?2:year<214?3:4;
  return {stage,forced:year===194||year===204||year===213,denominator:NATIVE_APPEARANCE_DENOMINATORS[stage]};
}
export interface NativeAppearanceOfficer {
  id:string;status:number;cityId:string|null;ownerId:string|null;relativeId:string|null;
  locations:readonly (string|null)[];acted?:boolean;
}
export interface NativeAppearanceCity {id:string;ownerId:string|null;capacity:number;officerCount:number;hidden?:boolean}
export interface NativeAppearanceFaction {id:string;leaderId:string|null;cityOrder:readonly string[]}
export interface NativeAppearanceWorld {
  officers:readonly NativeAppearanceOfficer[];cities:readonly NativeAppearanceCity[];
  factions:readonly NativeAppearanceFaction[];playerFactionId:string;
}
export interface NativeAppearanceEvent {
  officerId:string;kind:'appear'|'disappear'|'family';cityId:string|null;
  ownerId:string|null;relativeId?:string;notify?:boolean;
}
export function nativeAppearanceEligible(status:number,hasLocation:boolean):boolean {
  return status===8192&&hasLocation||status===8&&!hasLocation;
}
/** Executes one successful probability branch. Existing family affiliations
 * determine the join destination; city names and historical assumptions do not. */
export function nativeApplyOfficerAppearance(officer:NativeAppearanceOfficer,plannedCityId:string|null,world:NativeAppearanceWorld,rng:NativeRandomState):NativeAppearanceEvent|null {
  if(plannedCityId===null) {
    officer.cityId=null;officer.status=4096;
    return {officerId:officer.id,kind:'disappear',cityId:null,ownerId:officer.ownerId};
  }
  if(officer.cityId!==null||officer.relativeId===null) {
    officer.cityId=plannedCityId;officer.status=8;
    return {officerId:officer.id,kind:'appear',cityId:plannedCityId,ownerId:officer.ownerId};
  }
  const relative=world.officers.find(g=>g.id===officer.relativeId);
  if(!relative||relative.status!==1||relative.ownerId===null)return null;
  const faction=world.factions.find(f=>f.id===relative.ownerId);
  if(!faction)return null;
  const leader=world.officers.find(g=>g.id===faction.leaderId);
  let cityId=relative.cityId??leader?.cityId??null;
  if(cityId===null) {
    if(!faction.cityOrder.length)return null;
    cityId=faction.cityOrder[nativeBelow(rng,faction.cityOrder.length)];
  }
  let target=world.cities.find(c=>c.id===cityId);
  if(!target)return null;
  // 0x4230ED: computers redirect a full city to the first visible owned city
  // with room, falling back to the requested city when every city is full.
  if(relative.ownerId!==world.playerFactionId&&target.officerCount>=target.capacity)
    target=world.cities.find(c=>!c.hidden&&c.ownerId===relative.ownerId&&c.officerCount<c.capacity)??target;
  officer.cityId=target.id;officer.ownerId=target.ownerId;officer.status=1;officer.acted=true;target.officerCount++;
  return {officerId:officer.id,kind:'family',cityId:target.id,ownerId:officer.ownerId,relativeId:relative.id,notify:relative.ownerId===world.playerFactionId};
}
/** The callback runs between officers, preserving growth RNG and mutations
 * visible to later family members. Input order is the original global list
 * adapter; skipping an ineligible officer never consumes a random number. */
export function runNativeAnnualAppearance(year:number,world:NativeAppearanceWorld,rng:NativeRandomState,apply:(event:NativeAppearanceEvent)=>void=()=>{}):NativeAppearanceEvent[] {
  const period=nativeAppearancePeriod(year),events:NativeAppearanceEvent[]=[];
  for(const officer of world.officers) {
    if(officer.status!==8&&officer.status!==8192)continue;
    const location=officer.locations[period.stage]??null;
    if(!nativeAppearanceEligible(officer.status,location!==null))continue;
    if(!period.forced&&nativeBelow(rng,period.denominator)!==0)continue;
    const event=nativeApplyOfficerAppearance(officer,location,world,rng);
    if(event){events.push(event);apply(event);}
  }
  return events;
}
