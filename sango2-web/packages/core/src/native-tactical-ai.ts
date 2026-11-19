/** Original 0x402EA5 scoring. Inputs are native grid/state observations, not pixels.
 * Floating ratios are stored as float32 globals before scoring (x87 evidence).
 */
export interface NativeTacticalObservation {
  hp:number;maxHp:number;entryHp:number;enemyHp:number;enemyMaxHp:number;
  strength:number;enemyStrength:number;troops:number;enemyTroops:number;initialTroops:number;
  formationMask:number;unitClass:number;enemyUnitClass:number;distanceX:number;
  flags:number;enemyFlags:number;blockedFlags:number;canAdvance:boolean;canCast:boolean;
  hasDirectSkill:boolean;hasAreaSkill:boolean;hasHealSkill:boolean;hasReinforceSkill:boolean;
  betweenUnits:number;nearbyEnemies:number;elapsedSinceCharge:number;restrictRetreat:boolean;
}
const tier=(ratio:number,a:number,b:number,c:number,d:number,e=0)=>ratio<.0825?a:ratio<.16?b:ratio<.24?c:ratio<.33?d:e;
/** 0x403D2F: reserve the first roster slot by capping its weight at ten. */
export function nativeCommanderWeights(members:readonly {hp:number;mp:number;troops:number;strength:number;intelligence:number;available:boolean}[],uniform=false,uncappedLeader=false):number[] {
  const weights=members.map(m=>m.available?m.hp+m.mp+m.troops+m.strength+m.intelligence:0);
  if(!uncappedLeader&&weights[0]>10)weights[0]=10;
  return uniform?members.map(m=>m.available?10:0):weights;
}
/** 0x403E6D: seven native formations, filtered by the general's learned bitmask. */
export function nativeFormationWeights(troops:number,capacity:number,unitMask:number,unitClass:number,learned:number):number[] {
  const ratio=capacity===0?0:Math.fround(troops/capacity),w=[55,50,50,50,50,50,50];
  w[1]+=ratio<.15?40:ratio<.3?30:ratio<.4?20:ratio<.5?10:0;
  if([4,2,256].includes(unitMask))w[2]+=30;if(troops>50)w[2]+=troops-40;
  if(unitClass===3){w[2]=Math.max(0,w[2]-100);w[3]+=150;}
  for(let i=4;i<7;i++){
    if([1,128,512].includes(unitMask))w[i]+=15;
    if(troops>70)w[i]-=troops-70;
    if(troops<25)w[i]-=[30,50,40][i-4];
  }
  return w.map((n,i)=>(learned&(1<<i))?Math.max(1,n):0);
}
export function nativeTacticalWeights(o:NativeTacticalObservation):number[] {
  const hp=Math.fround(o.hp/o.maxHp),enemyHp=Math.fround(o.enemyHp/o.enemyMaxHp),entry=Math.fround(o.hp/o.entryHp);
  const t=o.troops,e=o.enemyTroops,own=o.unitClass,enemy=o.enemyUnitClass,close=o.distanceX<=3;
  let mask=255;
  if(!o.canAdvance)mask=251;
  if(!o.canCast)mask&=~16;
  if(o.flags&4)mask=0;
  if(o.flags&1)mask&=0xf1;
  if(o.flags&2)mask&=~32;
  if(o.enemyFlags&4||o.blockedFlags&4)mask&=~64;
  if(t<=0)mask&=0xf1;
  if(o.restrictRetreat)mask&=~64;
  const w=[100,0,0,0,0,0,0];
  if(mask&2){if(o.formationMask===8)w[1]+=60;if(e>2*t)w[1]+=2*(e-t);if(own===3)w[1]+=240;}
  if(mask&4){
    w[2]+=12;if(o.formationMask===4)w[2]+=150;
    if(enemy===3&&own!==3)w[2]+=1000;if(enemy===2&&own===1)w[2]+=300;
    if(t>=e)w[2]+=6*(t-e);if(t>50)w[2]+=t-50;
    if(own===3&&enemy!==3)w[2]=Math.max(0,w[2]-100);
    if(enemy===3&&o.betweenUnits<=1)w[2]+=100;
    if(o.enemyFlags&4)w[2]+=10000;if(o.flags&2)w[2]+=1000;if(close)w[2]+=300;
  }
  if(mask&8){
    if(t>4*e)w[3]+=10*(t-e);if(e<=5)w[3]+=100*(5-e);
    if(enemy===3&&own!==3)w[3]+=200;if(enemy===2&&own===1)w[3]+=100;
    if(own===3&&enemy!==3)w[3]=Math.max(0,w[3]-100);
    if(enemy===3&&o.betweenUnits<=1)w[3]+=50;
    if(o.enemyFlags&4)w[3]+=10000;if(o.flags&2)w[3]+=500;
    w[3]+=10*o.nearbyEnemies;if(close&&!(mask&4))w[3]+=100;
  }
  if(mask&16){
    if(o.hasDirectSkill)w[4]+=tier(enemyHp,400,160,80,50)+30;
    if(o.hasAreaSkill)w[4]+=6+(o.enemyFlags&1?30:0)+6*e;
    if(o.hasHealSkill)w[4]+=tier(hp,200,60,30,12);
    if(o.hasReinforceSkill&&o.initialTroops-t>10)w[4]+=2*(o.initialTroops-t);
  }
  if(mask&32){
    if(e<20&&(o.flags&1)&&o.elapsedSinceCharge>300&&o.strength*o.hp+500>o.enemyStrength*o.enemyHp)w[5]+=8;
    if(e<5&&t<5){w[5]+=3;if(o.strength*o.hp-200>o.enemyStrength*o.enemyHp)w[5]+=15;}
    if(t<3){w[5]+=50-Math.trunc(e/2);if(hp>.9)w[5]+=40;w[5]+=hp>.8?20:hp>.5?10:0;}
    w[5]+=tier(enemyHp,200,60,50,30,enemyHp<.5?10:0);
    w[5]=Math.trunc(w[5]*hp);if(o.enemyFlags&4)w[5]+=10000;
  }
  if(mask&64){
    if(t===0&&e>0){if(enemy===3){if(hp<.5&&enemyHp>.8)w[6]+=30;}else if(hp<.5&&e>=20)w[6]+=Math.trunc(e/3);}
    w[6]+=tier(hp,60,30,15,6)-tier(enemyHp,50,25,12,4);w[6]=Math.max(0,w[6]);
    if(w[6]!==0&&entry>.33)w[6]=Math.trunc(w[6]*(entry>.66?(entry>.85?.4:.6):.8));
  }
  return w;
}
export interface NativeSkillChoice {
  sequence:number;mp:number;flags:number;attack:number;
}
/** 0x402A79: eight skill slots plus idle weight 1. Cell counts come from native grid. */
export function nativeSkillWeights(skills:readonly NativeSkillChoice[],mp:number,hpRatio:number,troopRatio:number,enemyHpRatio:number,
  distanceX:number,counts:{line:number;edges:number;near:number;enemyTroops:number}):number[] {
  hpRatio=Math.fround(hpRatio);troopRatio=Math.fround(troopRatio);enemyHpRatio=Math.fround(enemyHpRatio);
  const weights=Array<number>(9).fill(0);weights[8]=1;
  for(let i=0;i<Math.min(8,skills.length);i++) {
    const s=skills[i];if(!s.sequence||mp<s.mp)continue;
    let w=10*(i+1),hits=0;
    if(s.flags&0x100)w=hpRatio<.7?w+Math.trunc(w*(.7-hpRatio)):0;
    else if(s.flags&0x200)w=troopRatio<.4?w+Math.trunc(2*w*(.4-troopRatio)):0;
    else {
      if(s.flags&0x10)hits=Math.trunc(s.attack/2);
      if(s.flags&0x20)w+=tier(enemyHpRatio,400,60,30,12,6);
      if(s.flags&0x40){if(distanceX===1){w+=50;hits=8;}else w=0;}
      if(s.flags&2)hits+=counts.line;
      else if(s.flags&4)hits+=counts.edges;
      else if(s.flags&8)hits+=counts.near;
      else if(s.flags&1)hits+=Math.trunc(counts.enemyTroops/3);
      w=Math.trunc(hits*w/4);
    }
    weights[i]=w;
  }
  return weights;
}
