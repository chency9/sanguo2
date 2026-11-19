/** Item arithmetic and annual inventory traversal from 0x4088FA / 0x408BDC /
 * 0x408E0E / 0x4024F8. Notification callbacks do not change officer data. */
import {nativeBelow,type NativeRandomState} from './native-strategic-ai';

export interface NativeItem {
  id:number;flags:number;level:number;strength:number;intelligence:number;maxHp:number;maxMp:number;
  forceMask:number;battleMask:number;speed:number;hp:number;mp:number;morale:number;loyalty:number;fatigue:number;
}
export interface NativeItemOfficer {
  level:number;strength:number;intelligence:number;maxHp:number;maxMp:number;hp:number;mp:number;
  morale:number;loyalty:number;fatigue:number;speed:number;forceMask:number;battleMask:number;
  weaponId:number;horseId:number;thingId:number;
}
export const nativeShort=(n:number)=>(n<<16)>>16;
export function nativeItemTable(items:readonly Record<string,string>[]):NativeItem[] {
  const n=(s:string|undefined,fallback=0)=>s?.trim()&&Number.isFinite(Number(s))?nativeShort(Number(s)):fallback;
  return items.map(row=>({id:n(row.SEQUENCE),flags:((row.ATTRIB??'').includes('USED')?1:0)|((row.ATTRIB??'').includes('ONLYONE')?2:0)|
    ({JEWEL_WEAPON:16,JEWEL_HORSE:32,JEWEL_THING:64}[row.TYPE]??0),level:n(row.LEVEL,1),
    strength:n(row.STR),intelligence:n(row.INT),maxHp:n(row.MAXHP),maxMp:n(row.MAXMP),forceMask:n(row.FORCE),battleMask:n(row.BATTLE),
    speed:n(row.SPEED),hp:n(row.HP),mp:n(row.MP),morale:n(row.SPIRIT),loyalty:n(row.LOYAL),fatigue:n(row.TIRE)}))
    .filter(row=>row.id>0&&row.id<128);
}
export function nativeItemSlot(flags:number):'weaponId'|'horseId'|'thingId'|null {
  return flags&16?'weaponId':flags&32?'horseId':flags&64?'thingId':null;
}
export function nativeCanUseItem(g:NativeItemOfficer,item:NativeItem,ruler:boolean):boolean {
  return item.id>=0&&item.id<128&&g.level>=item.level&&!(item.forceMask&g.forceMask)&&!(item.battleMask&g.battleMask)&&(!item.loyalty||!ruler);
}
export function nativeApplyItem(g:NativeItemOfficer,item:NativeItem,remove=false):boolean {
  if(item.id<0||item.id>=128||(!remove&&g.level<item.level))return false;
  for(const key of ['strength','intelligence','maxHp','maxMp','hp','mp','morale','loyalty','fatigue','speed'] as const)
    g[key]=nativeShort(g[key]+(remove?-item[key]:item[key]));
  g.hp=Math.max(1,Math.min(g.hp,g.maxHp));g.mp=Math.max(1,Math.min(g.mp,g.maxMp));
  for(const key of ['morale','loyalty','fatigue'] as const)g[key]=Math.max(0,Math.min(100,g[key]));
  // Unloading never revokes learned troops/formations, including equipment grants.
  if(!remove){g.forceMask|=item.forceMask;g.battleMask|=item.battleMask;}
  const slot=nativeItemSlot(item.flags);if(slot)g[slot]=remove?0:item.id;
  return true;
}
export interface AnnualItemUse {officerId:string;itemId:number;returnedId:number}
const emptyItem:NativeItem={id:0,flags:0,level:0,strength:0,intelligence:0,maxHp:0,maxMp:0,forceMask:0,battleMask:0,speed:0,hp:0,mp:0,morale:0,loyalty:0,fatigue:0};
/** Caller supplies the native EXP order with its ruler moved to the front. */
export function nativeAnnualInventory(officers:readonly {id:string;state:NativeItemOfficer;ruler:boolean}[],inventory:Record<string,number>,items:readonly NativeItem[],rng:NativeRandomState,
  unload:(g:NativeItemOfficer,item:NativeItem)=>void=(g,item)=>{nativeApplyItem(g,item,true);}):AnnualItemUse[] {
  const table=new Map(items.map(item=>[item.id,item])),used:AnnualItemUse[]=[];
  for(const {id,state:g,ruler} of officers)for(let itemId=127;itemId>=0;itemId--) {
    if(!inventory[String(itemId)])continue;
    const item=table.get(itemId);if(!item)continue;
    // 0x408710 returns flags & 0xF0. Consequently 0x4024F8's USED-bit
    // branch is unreachable in this executable. Preserve its lack of RNG
    // consumption and consumable usage rather than "fixing" the original.
    const flags=item.flags&0xf0,slot=nativeItemSlot(flags),old=slot?g[slot]:0;
    if(slot?old>=itemId:!(flags&1)||nativeBelow(rng,8)!==0)continue;
    if(!nativeCanUseItem(g,item,ruler))continue;
    if(slot)unload(g,table.get(old)??emptyItem);
    nativeApplyItem(g,item);
    if(old>0)inventory[String(old)]=Math.min(99,(inventory[String(old)]??0)+1);
    if(--inventory[String(itemId)]===0)delete inventory[String(itemId)];
    used.push({officerId:id,itemId,returnedId:old});
  }
  return used;
}
