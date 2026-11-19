import {describe,it,expect} from 'vitest';
import {createBattle,commandBattle,tickBattle,battleGeneral,validateBattle,type BattleState} from './battle';
import {advanceBattleNativeMagic,battleScriptCameraLocked} from './battle-native-magic';
import {prepareBattleMovement} from './battle-movement';

function ready(sequence=2) {
  const c=(id:string)=>({id,name:id,portrait:'portraits/001.png',strength:80,intelligence:80,hp:100,maxHp:100,mp:150,maxMp:150,unit:'刀',level:1,skillLearnset:[{level:1,sequence}]});
  const b=commandBattle(createBattle({id:'camera',attacker:c('a'),defender:{...c('d'),skillLearnset:[]},attackingTroops:0,defendingTroops:0,seed:184}),{type:'start'});
  prepareBattleMovement(b);b.commanders.attacker.charge=120000;return b;
}
function script(b:BattleState) {if(b.activeScript?.kind!=='native-shoot')throw new Error('Expected native shoot');return b.activeScript.runtime;}
function source(b:BattleState,count=1) {
  for(let i=0;i<count;i++){b.tick++;advanceBattleNativeMagic(b,()=>{});}
}

describe('spell camera execution in actual battle state',()=>{
  it('takes ownership at cast and writes the source camera only at update 40',()=>{
    const b=commandBattle(ready(),{type:'skill',sequence:2});
    expect(battleScriptCameraLocked(b)).toBe(true);expect(script(b).camera).toBeUndefined();
    source(b,40);expect(script(b).camera).toBeUndefined();
    source(b);const m=battleGeneral(b,'attacker').movement!;
    expect(script(b).camera).toEqual({x:(m.px>>16)+180,y:(m.py>>16)-120+script(b).cameraJitter});
    validateBattle(b);
  });
  it('starts the appended LockCamera in the weapon creation update before object motion',()=>{
    const b=commandBattle(ready(),{type:'skill',sequence:2});source(b,70);
    expect(script(b).cameraTrack).toBeUndefined();
    source(b);expect(script(b).cameraTrack).toMatchObject({kind:'lock',waiting:true,drift:0});
    const x=script(b).camera!.x;source(b,18);
    expect(script(b).camera!.x).toBeGreaterThan(x);
    expect(script(b).cameraTrack).toMatchObject({kind:'lock'});validateBattle(b);
  });
  it('runs the appended return camera immediately when a newborn arrow is outside the world',()=>{
    let b=ready();
    battleGeneral(b,'attacker').movement!.px=6768*65536;
    battleGeneral(b,'defender').movement!.px=3408*65536;
    b=commandBattle(b,{type:'skill',sequence:2});source(b,71);
    expect(script(b).phase).toBe('after');expect(script(b).weapon!.alive).toBe(false);
    expect(script(b).camera).toEqual({x:6830,y:script(b).camera!.y}); // 6948 + (3408-6948)/30
    expect(script(b).camera!.x).toBeGreaterThan(6560); // Host 256 does not clamp.
    expect(script(b).cameraTrack).toMatchObject({kind:'move',remaining:29});
    source(b,30);expect(script(b).cameraTrack).toBeUndefined();validateBattle(b);
    source(b,80);expect(b.activeScript).toBeUndefined();expect(battleScriptCameraLocked(b)).toBe(false);
  });
  it('preserves camera and RNG through lock, hit, return and brightness recovery saves',()=>{
    for(const at of [1,14,24,30,42,52,65,85]) {
      const b=commandBattle(ready(59),{type:'skill',sequence:59});
      for(let i=0;i<at;i++){b.opponentAI!.countdown=60;tickBattle(b);}
      validateBattle(b);const restored=JSON.parse(JSON.stringify(b)) as BattleState;validateBattle(restored);
      for(let i=0;i<160;i++) {
        b.opponentAI!.countdown=60;restored.opponentAI!.countdown=60;tickBattle(b);tickBattle(restored);
        expect(restored).toEqual(b);
      }
    }
  });
  it('does not consume additional RNG or alter damage, unit state or end time',()=>{
    const current=commandBattle(ready(),{type:'skill',sequence:2}),previous=structuredClone(current);delete previous.cameraRules;
    for(let i=0;i<300;i++) {
      source(current);source(previous);
      expect(current.opponentAI!.rng).toEqual(previous.opponentAI!.rng);
      expect(current.units).toEqual(previous.units);
      expect(current.commanders).toEqual(previous.commanders);
      const s=current.activeScript?.kind==='native-shoot'?structuredClone(current.activeScript):undefined;
      if(s){delete s.runtime.cameraTrack;s.runtime.camera=previous.activeScript?.kind==='native-shoot'?previous.activeScript.runtime.camera:undefined;}
      expect(s).toEqual(previous.activeScript);
    }
  });
  it.each(['rule','owner','side','remaining','number'])('rejects corrupt camera %s',field=>{
    const b=commandBattle(ready(),{type:'skill',sequence:2});source(b,71);const s=script(b);
    if(field==='rule')b.cameraRules='future' as 'native-script-v1';
    if(field==='owner')delete b.cameraRules;
    if(field==='side'&&s.cameraTrack?.kind==='lock')s.cameraTrack.side=0;
    if(field==='remaining')s.cameraTrack={kind:'move',x:0,y:0,dx:0,dy:0,targetX:0,targetY:0,remaining:31};
    if(field==='number')s.camera!.x=NaN;
    expect(()=>validateBattle(b)).toThrow();
  });
  it('leaves pre-camera-rule saved battles on their existing view behavior',()=>{
    const old=ready();delete old.cameraRules;
    const b=commandBattle(old,{type:'skill',sequence:2});source(b,90);
    expect(battleScriptCameraLocked(b)).toBe(false);expect(script(b).cameraTrack).toBeUndefined();validateBattle(b);
  });
});
