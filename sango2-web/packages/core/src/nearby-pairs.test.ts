import {it,expect} from 'vitest';
import {nearbyPairs} from './nearby-pairs';

it('preserves brute-force pair order when corrections move actors across bucket boundaries',()=>{
  let seed=174;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const source=Array.from({length:200},(_,id)=>({id,x:random()*1200,y:150+random()*360}));
  const a=structuredClone(source),b=structuredClone(source),visited:number[][]=[],reference:number[][]=[];
  const separate=(log:number[][])=>(p:typeof a[number],q:typeof a[number])=>{
    const dx=p.x-q.x,dy=p.y-q.y;if(Math.abs(dx)>=44||Math.abs(dy)>=40)return;
    log.push([p.id,q.id]);const offset=dx>=0?12:-12;p.x+=offset;q.x-=offset;p.y+=5;q.y-=5;
  };
  for(let step=0;step<10;step++) {
    nearbyPairs(a,separate(visited));
    for(let i=0;i<b.length;i++)for(let j=0;j<i;j++)separate(reference)(b[i],b[j]);
  }
  expect(visited).toEqual(reference);expect(a).toEqual(b);
});
