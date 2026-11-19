import {describe,it,expect} from 'vitest';
import {chargeIncrement,nativeSkillCost,nativeGaugeWidth,CHARGE_LIMIT,INITIAL_CHARGE} from './native-battle-rules';
import {createBattle,commandBattle,tickBattle,validateBattle,battleGeneral} from './battle';

const commander={id:'a',name:'甲',portrait:'',strength:81,intelligence:97,hp:80,mp:40,unit:'刀'};
const fresh=()=>createBattle({id:'native',attacker:commander,defender:{...commander,id:'b'},attackingTroops:0,defendingTroops:0,seed:7});
describe('static EXE rules',()=>{
  it('uses the larger attribute and truncates each modifier as x86 integer arithmetic',()=>{
    expect([-3,-2,-1,0,1,2,3].map(m=>chargeIncrement(81,97,m))).toEqual([48,64,73,97,126,145,194]);
    expect(chargeIncrement(97,81)).toBe(97);
  });
  it('applies native MP and POWER cost floors without interpreting ATTACK as damage',()=>{
    expect(nativeSkillCost(40,120000,20,100)).toEqual({mp:20,charge:0});
    expect(nativeSkillCost(40,120000,18,100,66)).toEqual({mp:22,charge:40800});
    expect(nativeSkillCost(5,100,20,100)).toEqual({mp:0,charge:0});
  });
  it('scales capacity against 150, then current value against capacity',()=>{
    expect(nativeGaugeWidth(100,50)).toEqual({track:71,fill:35});
    expect(nativeGaugeWidth(200,100)).toEqual({track:107,fill:53});
    expect(nativeGaugeWidth(0,0)).toEqual({track:0,fill:0});
  });
  it('starts at half charge, does not charge during deployment, and caps in battle',()=>{
    let b=fresh();expect(b.commanders.attacker.charge).toBe(INITIAL_CHARGE);
    tickBattle(b,200);expect(b.commanders.attacker.charge).toBe(INITIAL_CHARGE);
    b=commandBattle(b,{type:'start'});battleGeneral(b,'defender').order='hold';
    tickBattle(b);expect(b.commanders.attacker.charge).toBe(60291);
    tickBattle(b,200);tickBattle(b,200);expect(b.commanders.attacker.charge).toBe(CHARGE_LIMIT);
    const restored=JSON.parse(JSON.stringify(b));validateBattle(restored);tickBattle(restored);tickBattle(b);expect(restored).toEqual(b);
  });
  it('accepts earlier saves without charge/maxMp and rejects corrupt new fields',()=>{
    const old=fresh();delete old.commanders.attacker.charge;delete old.commanders.attacker.maxMp;
    expect(()=>validateBattle(old)).not.toThrow();
    const b=fresh();b.commanders.attacker.charge=120001;expect(()=>validateBattle(b)).toThrow();
    b.commanders.attacker.charge=NaN;expect(()=>validateBattle(b)).toThrow();
    b.commanders.attacker.charge=60000;b.commanders.attacker.maxMp=1;expect(()=>validateBattle(b)).toThrow();
  });
});
