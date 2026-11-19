import {describe,it,expect} from 'vitest';
import vectors from '../fixtures/native-magic-camera-vectors.json';
import {nativeCreateMoveCamera,nativeCreateLockCamera,nativeAdvanceMagicCamera,type NativeMagicCamera} from './native-magic-camera';

describe('original SO camera scripts through the x86 VM',()=>{
  for(const [index,{input,native}] of vectors.cases.entries())it(`${input.name} snapshot ${index}`,()=>{
    const camera={x:input.camera[0],y:input.camera[1]},trace:number[][]=[];
    let state:NativeMagicCamera|undefined=input.name==='MoveCamera'?nativeCreateMoveCamera(camera,{x:input.args[0],y:input.args[1]},input.args[2]):nativeCreateLockCamera(input.args[3] as 0|1,input.args[1],input.args[2]);
    const path=input.path;
    for(let tick=0;tick<1200&&state;tick++) {
      const object={x:(path?.object[0]??0)+(path?.objectVelocity[0]??0)*tick,y:(path?.object[1]??0)+(path?.objectVelocity[1]??0)*tick,alive:tick<(path?.deathAt??10000)};
      const enemy={x:(path?.enemy[0]??0)+(path?.enemyVelocity[0]??0)*tick,y:(path?.enemy[1]??0)+(path?.enemyVelocity[1]??0)*tick};
      // Isolated oracle records spawn; the native scheduler's same-tick child
      // execution is verified separately by battle integration tests.
      if(state.kind==='lock'&&(!object.alive||state.waiting&&(state.side===0?state.previousX<=enemy.x:state.previousX>=enemy.x))) {
        const event=native.events.find(e=>'child' in e);
        expect(event).toEqual({t:tick,child:'MoveCamera',args:[enemy.x,enemy.y-120,30,0]});
        state=undefined;
      } else state=nativeAdvanceMagicCamera(state,camera,object,enemy);
      trace.push([camera.x,camera.y]);
    }
    expect(trace).toEqual(native.trace);expect(trace.length).toBe(native.ticks);expect(native.rng).toEqual([1,2]);
  });
});
