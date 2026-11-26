import masks from './native-map-mask.json';
import {nativeSceneryTerrain,nativeSceneryVariant} from './native-scenery';
import type {NativeRandomState} from './native-strategic-ai';

/** 0x40EC0A uses each army's integer world position and signed midpoint,
 * followed by POS/2 sampling of the current seasonal native terrain mask. */
export function nativeRoadBattleScenery(first:readonly [number,number],second:readonly [number,number],day:number,rng:NativeRandomState,mode:'a'|'b'|'random'='random'):{terrainId:number;variant:'a'|'b'} {
  const x=Math.trunc(Math.trunc((Math.trunc(first[0])+Math.trunc(second[0]))/2)/2),y=Math.trunc(Math.trunc((Math.trunc(first[1])+Math.trunc(second[1]))/2)/2);
  const season=Math.floor((Math.max(0,day)%360)/90),row=masks.seasons[season][y];
  if(!row||x<0||x>=masks.width)throw new Error('道路交战位置超出原地图掩码。');
  let pixel=x,terrain=-1;
  for(let i=0;i<row.length;i+=2){if(pixel<row[i+1]){terrain=row[i];break;}pixel-=row[i+1];}
  if(terrain<0)throw new Error('道路交战地形掩码资料无效。');
  return {terrainId:nativeSceneryTerrain(terrain),variant:nativeSceneryVariant(mode,rng)};
}
