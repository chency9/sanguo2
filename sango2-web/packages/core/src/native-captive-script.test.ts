import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {createNativeCaptiveScript,advanceNativeCaptiveScript,validateNativeCaptiveScript,type NativeCaptiveScript,type NativeCaptiveChoice,type NativeCaptiveScriptEvent} from './native-captive-script';
import type {NativeRandomState} from './native-strategic-ai';
const vectors=JSON.parse(readFileSync(new URL('../fixtures/native-captive-script-vectors.json',import.meta.url),'utf8')) as {
  cases:{input:{choice:NativeCaptiveChoice;accepted:boolean;dialogueUpdates:number;rng:NativeRandomState};native:{ticks:number;events:NativeCaptiveScriptEvent[];callback:number;rng:NativeRandomState;samples:{t:number;rng:NativeRandomState;waiting:string;remaining:number}[]}}[];
};
const context={rulerId:'ruler',captiveId:'captive',rulerName:'RULER',captiveName:'CAPTIVE'};
const fail=():never=>{throw new Error('Invalid native captive script');};

describe('original SYSTEM.SO captive scripts',()=>{
  it.each(vectors.cases.map((v,index)=>({...v,index})))('matches every original host, dialogue boundary, RNG and source wait $index',({input:o,native})=>{
    let state=createNativeCaptiveScript(o.choice,o.accepted,context);const rng:NativeRandomState=[...o.rng],events:NativeCaptiveScriptEvent[]=[];
    let release=-1;
    for(const sample of native.samples) {
      if(state.phase==='dialogue'&&sample.t>=release)advanceNativeCaptiveScript(state,rng,{type:'dialogue-next'},e=>events.push(e));
      const before=events.length;
      advanceNativeCaptiveScript(state,rng,{type:'source-tick'},e=>events.push(e));
      if(events.slice(before).some(e=>e.host===10))release=sample.t+o.dialogueUpdates+1;
      expect(rng).toEqual(sample.rng);expect(state.phase).toBe(sample.waiting);expect(state.waitRemaining).toBe(sample.remaining);
      validateNativeCaptiveScript(state,fail);
      state=JSON.parse(JSON.stringify(state));validateNativeCaptiveScript(state,fail);
    }
    expect({ticks:state.age,events,callback:state.callback,rng}).toEqual({ticks:native.ticks,events:native.events,callback:native.callback,rng:native.rng});
    expect(state.phase).toBe('done');
  });
  it.each(['yield','kill','free'] as const)('does not consume future dialogue RNG while waiting for %s presentation',choice=>{
    const rng:NativeRandomState=[12345,6789],state=createNativeCaptiveScript(choice,true,context),initial=[...rng];
    expect(rng).toEqual(initial);advanceNativeCaptiveScript(state,rng,{type:'source-tick'});expect(state.phase).toBe('dialogue');
    const before=[...rng];for(let i=0;i<100;i++)advanceNativeCaptiveScript(state,rng,{type:'source-tick'});
    expect(rng).toEqual(before);expect(state.dialogue).toBeDefined();expect(state.callback).toBeUndefined();
  });
  it('keeps the 20-update source wait and final callback after a saved free dialogue',()=>{
    const state=createNativeCaptiveScript('free',false,context),rng:NativeRandomState=[123,456],events:NativeCaptiveScriptEvent[]=[];
    advanceNativeCaptiveScript(state,rng,{type:'source-tick'},e=>events.push(e));expect(state.dialogue!.messageId).toBeGreaterThanOrEqual(940);expect(state.dialogue!.messageId).toBeLessThanOrEqual(945);
    advanceNativeCaptiveScript(state,rng,{type:'dialogue-next'});advanceNativeCaptiveScript(state,rng,{type:'source-tick'},e=>events.push(e));
    expect(state.phase).toBe('wait');expect(state.waitRemaining).toBe(19);
    const restored:NativeCaptiveScript=JSON.parse(JSON.stringify(state)),rngCopy=[...rng] as NativeRandomState;
    for(let i=0;i<19;i++){advanceNativeCaptiveScript(state,rng,{type:'source-tick'},e=>events.push(e));advanceNativeCaptiveScript(restored,rngCopy,{type:'source-tick'});}
    expect(state.callback).toBeUndefined();advanceNativeCaptiveScript(state,rng,{type:'source-tick'},e=>events.push(e));advanceNativeCaptiveScript(restored,rngCopy,{type:'source-tick'});
    expect(restored).toEqual(state);expect(state.callback).toBe(528);expect(events.at(-1)).toEqual({t:21,host:528,args:[]});
  });
  it('uses the original MESSAGE.INI text with speaker substitutions and no invented dialogue',()=>{
    const state=createNativeCaptiveScript('yield',true,{rulerId:'liu',captiveId:'guan',rulerName:'劉備',captiveName:'關羽'}),rng:NativeRandomState=[1,2];
    advanceNativeCaptiveScript(state,rng,{type:'source-tick'});expect(state.dialogue!.rawText).toMatch(/%[kK]%/);expect(state.dialogue!.text).not.toMatch(/%[KkLlEe]%/);
    expect(state.dialogue!.speakerId).toBe('liu');expect(state.dialogue!.messageId).toBeGreaterThanOrEqual(950);expect(state.dialogue!.messageId).toBeLessThanOrEqual(966);
  });
  it('rejects corrupt script IPs, source clocks, speaker text and wait state',()=>{
    const state=createNativeCaptiveScript('yield',true,context),rng:NativeRandomState=[1,2];advanceNativeCaptiveScript(state,rng,{type:'source-tick'});
    const mutations=[(s:NativeCaptiveScript)=>{s.vm.ip=-1;},(s:NativeCaptiveScript)=>{s.waitRemaining=20;},(s:NativeCaptiveScript)=>{s.age=NaN;},
      (s:NativeCaptiveScript)=>{s.dialogue!.text='invented';},(s:NativeCaptiveScript)=>{s.phase='ready';}];
    for(const mutate of mutations){const copy=structuredClone(state);mutate(copy);expect(()=>validateNativeCaptiveScript(copy,fail)).toThrow();}
  });
});
