/** Original encounter settlement. Addresses refer to the hash-pinned 1.05+
 * executable. A member's soldier snapshot is captured by 0x43A1C4 BEFORE
 * military strategies, refreshed for each duel, and excludes overflow troops. */
export type NativeRoundKind=1|2|3|4|5;
export interface NativeBattleRecord {wins:number;losses:number;streak:number;bestStreak:number}
export function isNativeBattleRecord(value:unknown):value is NativeBattleRecord {
  if(!value||typeof value!=='object')return false;
  const record=value as NativeBattleRecord;
  return (['wins','losses','streak','bestStreak'] as const).every(k=>Number.isInteger(record[k])&&record[k]>=-32768&&record[k]<=32767);
}
export interface NativeRoundMeritMember {
  level:number;initialActive:number;initialReserve:number;active:number;reserve:number;
  merit:number;status:number;settlementFlags?:number;experienceModifier?:number;
  record?:NativeBattleRecord;
}
export interface NativeRoundMeritResult {
  gain:number;merit:number;status:number;record:NativeBattleRecord;
}
const short=(n:number)=>(n<<16)>>16;
const div=(n:number,d:number)=>Math.trunc((n|0)/d);
const add=(a:number,b:number)=>(a+b)|0;
const multiply=(a:number,b:number)=>Math.imul(a,b);
const emptyRecord=():NativeBattleRecord=>({wins:0,losses:0,streak:0,bestStreak:0});

/** 0x4084C9 uses signed 16-bit counters, including the streak comparison. */
export function nativeBattleRecord(record:NativeBattleRecord|undefined,outcome:-1|0|1):NativeBattleRecord {
  const next={...(record??emptyRecord())};
  if(outcome===1) {
    next.wins=short(next.wins+1);next.streak=short(next.streak+1);
    if(next.streak>next.bestStreak)next.bestStreak=next.streak;
  } else {
    if(outcome===-1)next.losses=short(next.losses+1);
    next.streak=0;
  }
  return next;
}

/** Merit portion of 0x41048D. The first member is the winner for kinds
 * 1 (knockdown), 2 (retreat), and 5 (surrender). 3 is timeout; 4 is the
 * separate automatic-combat draw. Signed multiplication wraps BEFORE division. */
export function nativeRoundMerit(first:NativeRoundMeritMember,second:NativeRoundMeritMember,kind:NativeRoundKind):{
  first:NativeRoundMeritResult;second:NativeRoundMeritResult;
} {
  const casualties=(m:NativeRoundMeritMember)=>Math.max(0,add(multiply(12,add(m.initialReserve,-short(m.reserve))),multiply(6,add(m.initialActive,-short(m.active)))));
  let firstGain=casualties(second),secondGain=casualties(first);
  let firstStatus=first.status,secondStatus=second.status;
  let firstOutcome:-1|0|1=0,secondOutcome:-1|0|1=0;
  const firstLevel=short(first.level),secondLevel=short(second.level);
  if(kind===1) {
    firstGain=add(firstGain,div(multiply(6528,secondLevel),128));secondGain=div(secondGain,2);
    secondStatus=3;firstOutcome=1;secondOutcome=-1;
  } else if(kind===2) {
    firstGain=add(firstGain,multiply(34,secondLevel));secondGain=add(secondGain,div(multiply(1088,firstLevel),128));
    secondStatus=2;firstOutcome=1;secondOutcome=-1;
  } else {
    firstGain=add(firstGain,div(multiply(34,secondLevel),2));secondGain=add(secondGain,div(multiply(34,firstLevel),2));
    if(kind===5){secondStatus=6;firstOutcome=1;}
    else {firstStatus=2;secondStatus=2;}
  }
  if(kind===4){firstGain=multiply(firstGain,2);secondGain=multiply(secondGain,2);}
  // Assembly adds 0x64 on BOTH sides. The decompiler's first `pointer+50`
  // expression is a misidentified int16 pointer, not a 50% base multiplier.
  if((first.settlementFlags??0)&0x2000)firstGain=div(multiply(add(first.experienceModifier??0,100),firstGain),100);
  if((second.settlementFlags??0)&0x2000)secondGain=div(multiply(add(second.experienceModifier??0,100),secondGain),100);
  return {
    first:{gain:firstGain,merit:add(first.merit,firstGain)>>>0,status:firstStatus,record:nativeBattleRecord(first.record,firstOutcome)},
    second:{gain:secondGain,merit:add(second.merit,secondGain)>>>0,status:secondStatus,record:nativeBattleRecord(second.record,secondOutcome)},
  };
}

/** 0x410989: EVERY winning roster member shares 32 * sum(losing levels)
 * divided by the full winning roster count. Withdrawn members still share it. */
export function nativeVictoryMeritBonus(winners:readonly {merit:number}[],losingLevels:readonly number[]):{bonus:number;merits:number[]} {
  if(winners.length===0)throw new RangeError('Native victory requires a nonempty winning roster');
  const total=losingLevels.reduce((sum,level)=>add(sum,short(level)),0);
  const bonus=div(multiply(32,total),winners.length);
  return {bonus,merits:winners.map(m=>add(m.merit,bonus)>>>0)};
}

/** 0x40FA92 gives BOTH sides twice their accumulated merit. Call ordinary
 * officer progression with `experience`, preserving current HP/MP/soldiers.
 * Faction battle experience at +44 receives the same uint32 addition. */
export function nativeBattleExperience(merit:number,experience:number,factionExperience:number):{
  awarded:number;experience:number;factionExperience:number;
} {
  const awarded=multiply(2,merit)>>>0;
  return {awarded,experience:add(experience,awarded)>>>0,factionExperience:add(factionExperience,awarded)>>>0};
}

export interface NativeBattleDisposition {morale:number;fatigue:number;loyalty:number;constancy:number}
const clampCondition=(n:number)=>Math.max(0,Math.min(100,short(n)));
/** Participant portion of 0x40FA92 + 0x40856A. Side is the ORIGINAL roster
 * order. First-side losing loyalty loses (10-CONSTANCY), second loses twice. */
export function nativeParticipantDisposition(state:NativeBattleDisposition,side:'first'|'second',result:0|1|2):NativeBattleDisposition {
  if(result===0)return {...state};
  const won=result===(side==='first'?1:2);
  const loyaltyGain=won?3:-(10-short(state.constancy))*(side==='first'?1:2);
  return {...state,morale:clampCondition(state.morale+(won?5:-10)),fatigue:clampCondition(state.fatigue),loyalty:clampCondition(state.loyalty+loyaltyGain)};
}
/** 0x40F9B1 / 0x40FA1C then affect every status=1 officer of either faction,
 * including participants when still status=1. They run AFTER participant effects. */
export function nativeFactionDisposition(state:NativeBattleDisposition,won:boolean):NativeBattleDisposition {
  return {...state,morale:clampCondition(state.morale+(won?1:-2)),fatigue:clampCondition(state.fatigue),
    loyalty:clampCondition(state.loyalty+(won?1:-Math.trunc((8-short(state.constancy))/2)))};
}
