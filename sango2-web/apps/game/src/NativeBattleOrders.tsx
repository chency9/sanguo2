import {useId,useState} from 'react';
import {NATIVE_COMMAND_LABELS,type BattleState,type BattleCommand} from '@sango2/core';

const divisions=[{id:256,name:'全军'},{id:257,name:'全体士兵'},{id:1,name:'前军'},{id:2,name:'后军'},
  {id:3,name:'左军'},{id:4,name:'右军'},{id:5,name:'中军'},{id:0,name:'主将'}];
type Command=Extract<BattleCommand,{type:'native-order'}>['command'];
export function NativeBattleOrders({battle,onCommand,enabled}:{battle:BattleState;onCommand:(command:BattleCommand)=>void;enabled:boolean}) {
  const [division,setDivision]=useState(256),[tactic,setTactic]=useState<Command>(2);
  const hintId=useId(),selectId=useId();
  const available=NATIVE_COMMAND_LABELS.map((label,id)=>({label,id:id as Command})).filter(o=>![0,256].includes(division)||[0,1,2,8].includes(o.id));
  const selected=available.some(o=>o.id===tactic)?tactic:2;
  const alive=battle.units.filter(u=>u.side==='attacker'&&u.hp>0&&!u.escaped&&(division===256||division===257&&!u.general||u.nativeDivision===division));
  const commands=new Set(alive.map(u=>battle.nativeCommands!.attacker.orders[u.nativeDivision!]));
  const current=commands.size===1?NATIVE_COMMAND_LABELS[[...commands][0]]:commands.size?'分队军令不同':'无在场兵员';
  const canIssue=enabled&&!(battle.nativeCommands!.attacker.flags&4);
  const issue=(command:Command)=>{if(canIssue)onCommand({type:'native-order',division,command});};
  return <div className="native-orders">
    <div className="command-selection"><h2>军 令</h2><div role="group" aria-label="选择部队">{divisions.map(d=>
      <button key={d.id} type="button" aria-pressed={division===d.id} onClick={()=>setDivision(d.id)}>{d.name}</button>)}</div></div>
    <div className="command-actions" role="group" aria-label="下达军令">
      <button type="button" disabled={!canIssue} onClick={()=>issue(1)}>前进迎敌</button>
      <button type="button" disabled={!canIssue} onClick={()=>issue(0)}>原地待命</button>
      <button type="button" disabled={!canIssue} onClick={()=>issue(8)}>撤离战场</button>
      <label htmlFor={selectId}>战术军令</label><select id={selectId} value={selected} aria-describedby={hintId} disabled={!canIssue} onChange={e=>setTactic(Number(e.target.value) as Command)}>
        {available.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}
      </select><button type="button" disabled={!canIssue} onClick={()=>issue(selected)}>下达战术</button>
    </div>
    <p id={hintId} className="native-order-status">{divisions.find(d=>d.id===division)!.name} · 在场 {alive.length} · {current}{battle.nativeCommands!.attacker.flags&4?' · 全军正在撤离':selected===8?' · 撤退作用于全军，不能中止':''}</p>
  </div>;
}
