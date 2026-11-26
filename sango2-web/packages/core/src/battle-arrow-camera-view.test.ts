import {describe,it,expect} from 'vitest';
import {resolveBattleCamera,type BattleCameraState} from '../../../apps/game/src/BattleCamera';
import {createBattle,commandBattle,tickBattle,battleGeneral,validateBattle} from './battle';

describe('actual ArrowSupport view camera before its first original host256',()=>{
  it('freezes the current camera until source update20 rather than jumping to a synthetic origin',()=>{
    const commander=(id:string)=>({id,name:id,portrait:'portraits/001.png',strength:80,intelligence:80,hp:100,maxHp:100,mp:150,maxMp:150,unit:'刀',level:40,skillLearnset:[{level:1,sequence:4}]});
    let b=commandBattle(createBattle({id:'arrow-camera',attacker:commander('a'),defender:{...commander('d'),skillLearnset:[]},attackingTroops:0,defendingTroops:0,seed:184}),{type:'start'});
    b.commanders.attacker.charge=120000;
    const camera:BattleCameraState={x:3408,y:144,follow:null,zoom:1},before=resolveBattleCamera(b,camera);
    b=commandBattle(b,{type:'skill',sequence:4});expect(b.activeScript?.kind).toBe('native-arrow-support');
    expect(resolveBattleCamera(b,camera)).toEqual(before);
    for(let i=0;i<6;i++){tickBattle(b);expect(resolveBattleCamera(b,camera)).toEqual(before);}
    expect(b.activeScript?.kind==='native-arrow-support'&&b.activeScript.runtime.camera).toBeUndefined();
    tickBattle(b);
    const caster=battleGeneral(b,'attacker').movement!,written={x:caster.px>>16,y:(caster.py>>16)-120};
    expect(resolveBattleCamera(b,camera)).toEqual(written);expect(written).not.toEqual({x:0,y:0});validateBattle(b);
  });
});
