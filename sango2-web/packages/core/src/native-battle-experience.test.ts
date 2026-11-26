import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import type {GeneralDefinition} from '@sango2/content';
import type {GeneralState} from './index';
import {applyOfficerExperience} from './native-progression';
import {
  nativeRoundMerit,nativeVictoryMeritBonus,nativeBattleExperience,
  nativeParticipantDisposition,nativeFactionDisposition,
  type NativeRoundMeritMember,type NativeRoundMeritResult,type NativeRoundKind,type NativeBattleDisposition,
} from './native-battle-experience';

interface AwardMember extends NativeBattleDisposition {
  level:number;experience:number;merit:number;status:number;generalStatus:number;
  strength:number;intelligence:number;baseHp:number;baseMp:number;maxHp:number;maxMp:number;
  hp:number;mp:number;active:number;reserve:number;
}
interface AwardOutput extends NativeBattleDisposition {
  level:number;experience:number;maxHp:number;maxMp:number;hp:number;mp:number;active:number;reserve:number;
}
const vectors=JSON.parse(readFileSync(new URL('../fixtures/native-battle-experience-vectors.json',import.meta.url),'utf8')) as {
  exeSha256:string;
  roundCases:{input:{members:[NativeRoundMeritMember,NativeRoundMeritMember];kind:NativeRoundKind;rng:number[]};native:{first:NativeRoundMeritResult;second:NativeRoundMeritResult;rng:number[]}}[];
  bonusCases:{input:{winners:{merit:number;status:number;level:number}[];losers:{merit:number;status:number;level:number}[];rng:number[]};native:{bonus:number;merits:number[];rng:number[]}}[];
  awardCases:{input:{rosters:AwardMember[][];factionExperience:number[];result:0|1|2;rng:number[]};native:{rosters:AwardOutput[][];factionExperience:number[];rng:number[]}}[];
};

describe('native 1.05+ encounter experience',()=>{
  it('pins the executable used to generate these original x86 results',()=>{
    expect(vectors.exeSha256).toBe('1098558aaea96ae552753df786a8d3910df08fda11c8219dfa133ca001d8e419');
  });
  it.each(vectors.roundCases.map((v,index)=>({...v,index})))('matches original duel merit, status and signed battle records $index',({input:o,native})=>{
    const result=nativeRoundMerit(o.members[0],o.members[1],o.kind);
    expect({...result,rng:o.rng}).toEqual(native);
  });
  it.each(vectors.bonusCases.map((v,index)=>({...v,index})))('shares the original victory bonus with the full winning roster $index',({input:o,native})=>{
    expect({...nativeVictoryMeritBonus(o.winners,o.losers.map(m=>m.level)),rng:o.rng}).toEqual(native);
  });
  it.each(vectors.awardCases.map((v,index)=>({...v,index})))('matches original awards, ordinary growth and complete participant/faction condition changes $index',({input:o,native})=>{
    const factionExperience=[...o.factionExperience];
    const rosters=o.rosters.map((members,side)=>members.map(m=>{
      const award=nativeBattleExperience(m.merit,m.experience,factionExperience[side]);factionExperience[side]=award.factionExperience;
      const def:GeneralDefinition={id:'g',name:'g',portrait:'',strength:m.strength,intelligence:m.intelligence,hp:m.maxHp,mp:m.maxMp,
        baseHp:m.baseHp,baseMp:m.baseMp,level:m.level,loyalty:90,status:'登',cityId:null,ownerId:null,weapon:'',horse:'',item:'',unit:'刀',formations:[],rawSkill:'',rawStrategy:'',sourceLine:1};
      const state:GeneralState={ownerId:null,cityId:null,armyId:null,status:'登',hp:m.hp,mp:m.mp,troops:m.active+m.reserve,
        troopSlots:{active:m.active,reserve:m.reserve},level:m.level,experience:m.experience,maxHp:m.maxHp,maxMp:m.maxMp};
      applyOfficerExperience(state,def,award.experience);
      let condition=nativeParticipantDisposition(m,side===0?'first':'second',o.result);
      if(o.result!==0&&m.generalStatus===1)condition=nativeFactionDisposition(condition,o.result===side+1);
      return {level:state.level!,experience:state.experience!,maxHp:state.maxHp!,maxMp:state.maxMp!,hp:state.hp,mp:state.mp,
        active:state.troopSlots!.active,reserve:state.troopSlots!.reserve,
        morale:condition.morale,fatigue:condition.fatigue,loyalty:condition.loyalty,constancy:condition.constancy};
    }));
    expect({rosters,factionExperience,rng:o.rng}).toEqual(native);
  });
  it('applies both experience strategies symmetrically and includes pre-strategy casualties',()=>{
    const member:NativeRoundMeritMember={level:20,initialActive:100,initialReserve:50,active:90,reserve:30,merit:0,status:0,
      settlementFlags:0x2000,experienceModifier:30};
    const result=nativeRoundMerit(member,member,3);
    // 10*6+20*12+17*20=640, then 130% on either side.
    expect([result.first.gain,result.second.gain]).toEqual([832,832]);
  });
  it('counts withdrawn winning members when sharing the final bonus',()=>{
    expect(nativeVictoryMeritBonus([{merit:0},{merit:100}],[20,40])).toEqual({bonus:960,merits:[960,1060]});
    expect(()=>nativeVictoryMeritBonus([],[])).toThrow(RangeError);
  });
  it('keeps retreat and surrender experience distinct from general knockdown',()=>{
    const member:NativeRoundMeritMember={level:20,initialActive:0,initialReserve:0,active:0,reserve:0,merit:0,status:0};
    expect(nativeRoundMerit(member,member,1).first.gain).toBe(1020);
    expect(nativeRoundMerit(member,member,2).first.gain).toBe(680);
    expect(nativeRoundMerit(member,member,5).first.gain).toBe(340);
    expect(nativeRoundMerit(member,member,4).first.gain).toBe(680);
  });
});
