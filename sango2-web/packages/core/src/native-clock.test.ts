import {describe,it,expect} from 'vitest';
import {createBattle,commandBattle,tickBattle,validateBattle,battleRemainingUpdates,battleStepDuration, nativeCountdown} from './battle';

const commander=(id:string)=>({id,name:id,portrait:'portraits/001.png',strength:80,intelligence:80,hp:100,mp:40,unit:'刀'});
const fresh=()=>createBattle({id:'clock',attacker:commander('a'),defender:commander('b'),attackingTroops:0,defendingTroops:0,seed:1});

describe('native battle countdown',()=>{
  it('uses the original Chinese numeral glyphs and coordinates at digit boundaries',()=>{
    for(const [count,glyphs,x] of [[0,[48],308],[9,[57],308],[10,[58],308],[11,[58,49],299],[19,[58,57],299],[20,[50,58],299],[21,[50,58,49],289],[90,[57,58],299],[99,[57,58,57],289]] as const) {
      expect(nativeCountdown(count*120)).toEqual({count,glyphs:[...glyphs],x});
    }
    expect(nativeCountdown(11879).count).toBe(98);
    expect(nativeCountdown(-1).count).toBe(0);
    expect(nativeCountdown(60000).count).toBe(99);
  });
  it('starts at 11880 source updates and expires only at zero, preserving the final count in a save',()=>{
    let b=fresh();tickBattle(b,100);
    expect(battleRemainingUpdates(b)).toBe(11880);
    expect(battleStepDuration(b)).toBe(51/1024);
    b=commandBattle(b,{type:'start'});
    // Both generals hold: timeout is tested without movement or combat ending the round.
    b.units.forEach(u=>u.order='hold');
    // Clock regression only: move the decision countdown beyond each single step,
    // so original AI cannot issue a general charge and end this fixture in combat.
    for(let i=0;i<3959;i++){b.opponentAI!.countdown=60;tickBattle(b);}
    expect(b.phase).toBe('fighting');expect(battleRemainingUpdates(b)).toBe(3);
    expect(()=>validateBattle(b)).not.toThrow();
    const loaded=JSON.parse(JSON.stringify(b));tickBattle(loaded);
    expect(battleRemainingUpdates(loaded)).toBe(0);expect(loaded.phase).toBe('finished');
    expect(()=>validateBattle(loaded)).not.toThrow();
  });
  it('keeps old saves on their original 20 Hz and 180-second expiry and rejects an unknown clock',()=>{
    const b=commandBattle(fresh(),{type:'start'});delete b.timing;
    b.tick=3599;b.units.forEach(u=>u.order='hold');
    expect(battleStepDuration(b)).toBe(.05);expect(battleRemainingUpdates(b)).toBe(3);
    tickBattle(b);expect(b.phase).toBe('finished');expect(()=>validateBattle(b)).not.toThrow();
    expect(()=>validateBattle({...b,timing:'guess'})).toThrow();
  });
});
