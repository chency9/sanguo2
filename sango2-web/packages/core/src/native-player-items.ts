import type {GeneralDefinition} from '@sango2/content';
import type {GeneralState} from './index';
import {nativeItemTable,nativePlayerItem} from './native-items';
import {materializeOfficer,unloadOfficerEquipment} from './native-officer-runtime';

/** A detached preview runs the same operation as commit, including legacy-save
 * baselines and native intermediate HP/MP clamps during a replacement. */
export function previewPlayerItem(g:GeneralState,def:GeneralDefinition,items:readonly Record<string,string>[],stock:Record<string,number>,ruler:boolean,itemId:number) {
  const after=structuredClone(g),before=structuredClone(materializeOfficer(after,def,items)),inventory={...stock};
  const item=nativeItemTable(items).find(i=>i.id===itemId);
  let reason='';
  if(!Number.isInteger(itemId)||itemId<0||itemId>=128||itemId!==0&&!item)reason='物品编号无效。';
  else if(itemId===0&&!before.thingId)reason='此武将没有可卸下的随身物品。';
  else if(item) {
    if(!(inventory[String(itemId)]>0))reason='物品库中没有这件物品。';
    else if(before.level<item.level)reason=`需要等级${item.level}，当前等级${before.level}。`;
    else if(item.forceMask&before.forceMask)reason='已会此物品所授的兵种。';
    else if(item.battleMask&before.battleMask)reason='已会此物品所授的阵形。';
    else if(item.loyalty&&ruler)reason='君主不能使用改变忠诚的物品。';
  }
  const result=reason?{applied:false,returnedId:0}:nativePlayerItem(after as typeof before,inventory,nativeItemTable(items),itemId,ruler,unloadOfficerEquipment);
  return {before,after,inventory,reason,consumable:!!(item?.flags&&item.flags&1),...result};
}
