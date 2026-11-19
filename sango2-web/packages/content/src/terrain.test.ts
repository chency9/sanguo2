import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import {validateContent} from './index';

it('exports every terrain instance and repeated A/B layer from the source catalogue',()=>{
  const root=resolve('apps/game/public/assets');
  const data:unknown=JSON.parse(readFileSync(resolve(root,'content.json'),'utf8'));validateContent(data);
  expect(data.terrains.map(t=>t.id)).toEqual(Array.from({length:12},(_,i)=>i));
  expect(data.terrains.filter(t=>t.name==='城')).toHaveLength(3);
  for(const t of data.terrains) {
    for(const asset of [t.floor,...t.variants.flatMap(v=>[v.background,v.midground,v.foreground])]) {
      const bytes=readFileSync(resolve(root,asset));expect(bytes.subarray(1,4).toString()).toBe('PNG');
      expect(bytes.readUInt32BE(16)).toBeGreaterThan(0);expect(bytes.readUInt32BE(20)).toBeGreaterThan(0);
    }
    expect(existsSync(resolve(root,`battle/music-${String(t.soundtrack).padStart(2,'0')}.mp3`))).toBe(true);
  }
});
