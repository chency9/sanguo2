import {describe,expect,it} from 'vitest';
import vectors from '../fixtures/native-projection-vectors.json';
import {nativeProject,nativeProjectionTables,nativeClampCamera,nativeDepth,nativeSpriteScale,nativeSpriteFacing,nativeGroundBands} from './native-projection';

describe('hash-pinned original perspective and camera',()=>{
  it('matches all 4096 native table entries',()=>{
    const table=nativeProjectionTables();
    expect(table.y.map((y,i)=>[y,table.scale[i]])).toEqual(vectors.tables);
  });
  it.each(vectors.points.map((v,index)=>({...v,index})))('matches original projection $index',v=>{
    expect(nativeProject(v.input,v.input.camera)).toEqual(v.native);
  });
  it.each(vectors.bounds.map((v,index)=>({...v,index})))('matches original camera limits $index',v=>{
    expect(nativeClampCamera(v.input)).toEqual(v.native);
  });
  it.each(vectors.render.map((v,index)=>({...v,index})))('matches original render submission $index',v=>{
    const p=nativeProject(v.input,v.input.camera),scale=nativeSpriteScale(p.scale,v.input.objectScale);
    const result=p.x < -96||p.x>736||(p.y>>>0)>720?null:{x:p.x,y:p.y,depth:nativeDepth(v.input.y),scaleX:scale*nativeSpriteFacing(v.input.facing),scaleY:scale};
    expect(result).toEqual(v.native);
  });
  it('creates monotonic perspective ground bands with source depth and world rows',()=>{
    const bands=nativeGroundBands({x:4000,y:339});
    expect(bands.length).toBe(124);
    expect(bands[0].screenY).toBe(96);
    expect(bands.at(-1)!.screenY).toBe(342);
    expect(bands.every((band,index)=>index===0||band.depth<=bands[index-1].depth)).toBe(true);
    expect(bands.every(band=>Number.isInteger(band.worldY)&&band.scale>0)).toBe(true);
  });
});
