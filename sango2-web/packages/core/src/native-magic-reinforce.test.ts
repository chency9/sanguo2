import {describe,it,expect} from 'vitest';
import vectors from '../fixtures/native-magic-reinforce-vectors.json';
import {nativeAdvanceMagicReinforce,nativeCreateMagicReinforce,nativeReinforceDefinition,type NativeMagicReinforceEvent} from './native-magic-reinforce';

describe('original MoreSoldier/BackSoldier source boundary',()=>{
  it('maps all seven wrappers to the original family and amount',()=>{
    expect(nativeReinforceDefinition(5)).toMatchObject({script:509,back:false,amount:17});
    expect(nativeReinforceDefinition(17)).toMatchObject({script:523,back:false,amount:32});
    expect(nativeReinforceDefinition(57)).toMatchObject({script:565,back:false,amount:25});
    expect(nativeReinforceDefinition(81)).toMatchObject({script:584,back:false,amount:42});
    expect(nativeReinforceDefinition(19)).toMatchObject({script:524,back:true,amount:25});
    expect(nativeReinforceDefinition(31)).toMatchObject({script:533,back:true,amount:35});
    expect(nativeReinforceDefinition(37)).toMatchObject({script:541,back:true,amount:45});
  });

  for(const sample of vectors.cases.filter((sample:any)=>sample.input.label==='empty'&&sample.input.live<200&&[5,19,57].includes(sample.input.sequence)&&sample.input.side===0)) {
    it(`matches original spawn count and scan for sequence ${sample.input.sequence} live=${sample.input.live}`,()=>{
      const occupied=new Set<string>();let next=1000;const events:NativeMagicReinforceEvent[]=[];
      const runtime=nativeCreateMagicReinforce(sample.input.sequence,{x:sample.input.x*65536,y:468*65536,z:0},sample.input.side as 0|1,sample.input.level,sample.input.live);
      const world={level:sample.input.level, living:sample.input.live, occupant:(x:number,y:number)=>occupied.has(`${x},${y}`)?1:0, spawn:(x:number,y:number)=>{const key=`${x},${y}`;if(occupied.has(key))return 0;occupied.add(key);return next++;}};
      for(let i=0;i<400&&runtime.phase!=='done';i++)nativeAdvanceMagicReinforce(runtime,[0x12345678,0x87654321],world,e=>events.push(e));
      expect(runtime.phase).toBe('done');expect(runtime.age).toBe(sample.native.ticks);expect(runtime.spawns.map(({x,y})=>[x,y])).toEqual(sample.native.spawned.map(({x,y}:any)=>[x,y]));
      expect(runtime.spawns).toHaveLength(sample.native.spawned.length);expect(events.find(e=>e.host===278)?.args).toEqual([sample.input.side]);
    });
  }

  it('keeps the 200-slot boundary and skips occupied cells in native order',()=>{
    const occupied=new Set(Array.from({length:71},(_,x)=>`${x},7`));let next=500;
    const s=nativeCreateMagicReinforce(5,{x:5328,y:468*65536,z:0},0,40,80);
    const world={level:40,living:80,occupant:(x:number,y:number)=>occupied.has(`${x},${y}`)?1:0,spawn:(x:number,y:number)=>{if(occupied.has(`${x},${y}`))return 0;occupied.add(`${x},${y}`);return next++;}};
    for(let i=0;i<400&&s.phase!=='done';i++)nativeAdvanceMagicReinforce(s,[1,2],world);
    expect(s.spawns.every(({y})=>y!==7)).toBe(true);expect(s.spawns).toHaveLength(17);
  });

  it('matches spawn coordinates and coroutine duration across all 140 native vectors',()=>{
    for(const sample of vectors.cases as any[]) {
      const occupied=new Set<string>(sample.input.occupied.map((p:number[])=>p.join(',')));let next=1000;
      const runtime=nativeCreateMagicReinforce(sample.input.sequence,{x:sample.input.x*65536,y:468*65536,z:0},sample.input.side as 0|1,sample.input.level,sample.input.live);
      const world={level:sample.input.level,living:sample.input.live,occupant:(x:number,y:number)=>occupied.has(`${x},${y}`)?1:0,spawn:(x:number,y:number)=>{const key=`${x},${y}`;if(occupied.has(key))return 0;occupied.add(key);return next++;}};
      for(let i=0;i<400&&runtime.phase!=='done';i++)nativeAdvanceMagicReinforce(runtime,sample.input.rng,world);
      expect(runtime.age).toBe(sample.native.ticks);
      expect(runtime.spawns.map(({t,side,x,y})=>({t,side,x,y}))).toEqual(sample.native.spawned.map(({t,side,x,y}:any)=>({t,side,x,y})));
    }
  });
});
