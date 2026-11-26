import {afterEach,describe,it,expect,vi} from 'vitest';
import type {GameContent} from '@sango2/content';
import {createSession,dispatch,readSession,validateSession,officerDefinition,type Session} from './index';
import * as tactical from './battle';

const content=(defenders=1):GameContent=>({
  version:1,id:'rival-entry',sourceHash:'d'.repeat(64),skills:[],strategies:[],items:[],terrains:[],
  scenarios:[{id:'era',title:'电脑互战回归',year:184,
    factions:['p','a','d'].map(id=>({id,name:id,leaderId:null,color:'#fff',select:1,special:false})),
    cities:['home','origin','target'].map((id,i)=>({id,name:id,ownerId:['p','a','d'][i],governorId:null,
      position:[i*100,0] as [number,number],money:0,population:100000,defense:0})),
    roads:[{id:'road',from:'origin',to:'target',length:120,points:[[100,0],[200,0]],restricted:false}],
    generals:['player','invader',...Array.from({length:defenders},(_,i)=>`defender-${i}`)].map((id,i)=>({
      id,name:id,portrait:'portraits/001.png',strength:80,intelligence:70,hp:100,mp:40,loyalty:90,
      status:'登',cityId:i===0?'home':i===1?'origin':'target',ownerId:i===0?'p':i===1?'a':'d',
      weapon:'',horse:'',item:'',unit:'刀',forceMask:8191,formations:['方'],rawSkill:'',rawStrategy:'',sourceLine:1,
      level:40,appearance:{body:600,weapon:700,horse:900,soldier:100,generalAttack:{hitTick:12,ticks:30},soldierAttack:{hitTick:12,ticks:30}}
    }))
  }]
});

function marching(c:GameContent):Session {
  let s=dispatch(createSession(c,'era','a'),{type:'policy-finish'},c);
  for(const id of Object.keys(s.nativeAI!.countdowns))s.nativeAI!.countdowns[id]=900;
  Object.assign(s.generals.invader,{currentUnit:'弩',forceMask:8191,morale:83,fatigue:27,loyalty:76});
  Object.assign(s.nativeAI!.recovery.invader,{fatigue:1000,moraleGain:1000,loyaltyGain:1000});
  s=dispatch(s,{type:'march',from:'origin',to:'target',generalIds:['invader'],troops:80},c);
  s.factionId='p';return s;
}

afterEach(()=>vi.restoreAllMocks());

describe('computer encounters share player campaign state',()=>{
  it('uses effective equipment/unit definitions and writes all participant conditions back',()=>{
    const c=content(),s=marching(c),scene=c.scenarios[0];
    const expected=officerDefinition(s.generals.invader,scene.generals[1],c.items);
    const originalTick=tactical.tickBattle;
    let entry:tactical.BattleState|undefined,finished:tactical.BattleState|undefined;
    // Force only the opponent defeat event. Deployment, round settlement and
    // campaign persistence remain the real code paths under test.
    vi.spyOn(tactical,'tickBattle').mockImplementation(b=>{
      entry=structuredClone(b);b.tick=1199;
      tactical.battleGeneral(b,'defender').hp=0;originalTick(b,1);finished=structuredClone(b);
    });
    const next=dispatch(s,{type:'advance',days:2},c);
    expect(entry!.attackerAI).toBeDefined();expect(entry!.commanders.attacker.appearance).toEqual(expected.appearance);
    expect(entry!.commanders.attacker.unit).toBe('弩');expect(entry!.troopDeployment!.attacker).toEqual({active:80,reserve:0});
    const result=finished!.rosters.attacker.find(m=>m.commander.id==='invader')!.commander;
    expect(result.fatigue).toBeGreaterThan(27);
    expect(next.generals.invader).toMatchObject({hp:result.hp,mp:result.mp,morale:result.morale,fatigue:result.fatigue,loyalty:result.loyalty});
    expect(next.battle).toBeNull();expect(next.cities.target.ownerId).toBe('a');validateSession(next,c);
    expect(readSession(JSON.parse(JSON.stringify(next)),c)).toEqual(next);
  });

  it('finishes every garrison round instead of surrendering after the ninth',()=>{
    const c=content(11),s=marching(c),originalTick=tactical.tickBattle,defeated:string[]=[];
    vi.spyOn(tactical,'tickBattle').mockImplementation(b=>{
      defeated.push(b.commanders.defender.id);tactical.battleGeneral(b,'defender').hp=0;originalTick(b,1);
    });
    const next=dispatch(s,{type:'advance',days:2},c);
    expect(defeated).toHaveLength(11);expect(new Set(defeated).size).toBe(11);
    expect(next.cities.target.ownerId).toBe('a');expect(next.armies).toEqual([]);validateSession(next,c);
  });

  it('keeps automatic battles deterministic after loading an in-transit campaign',()=>{
    const c=content(),s=marching(c),copy=readSession(JSON.parse(JSON.stringify(s)),c);
    const a=dispatch(s,{type:'advance',days:2},c),b=dispatch(copy,{type:'advance',days:2},c);
    expect(a).toEqual(b);validateSession(a,c);
  });
});
