import {useEffect,useId,useRef,useState} from 'react';
import {battleStrategyOptions,type BattleState,type BattleCommand} from '@sango2/core';

export function BattleStrategyDialog({battle,onCommand,onClose}:{battle:BattleState;onCommand:(command:BattleCommand)=>void;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),id=useId();
  const current=battle.strategies?.choices.attacker;
  const [advisor,setAdvisor]=useState(current?.advisorId??battle.rosters.attacker[0].commander.id);
  const [sequence,setSequence]=useState(current?.sequence??0);
  const general=battle.rosters.attacker.find(m=>m.commander.id===advisor)!.commander;
  const options=battleStrategyOptions(general);
  useEffect(()=>{const d=dialog.current!;d.showModal();return()=>d.close();},[]);
  return <dialog ref={dialog} className="round-dialog" aria-labelledby={`${id}-title`} onCancel={onClose}>
    <form className="round-selection strategy-selection" aria-labelledby={`${id}-title`} onSubmit={e=>{
      e.preventDefault();onCommand({type:'strategy',advisorId:advisor,sequence});onClose();
    }}>
      <h2 id={`${id}-title`}>军 师 献 策</h2>
      <p id={`${id}-help`}>计策在擂鼓时生效，出战前可重新选择。</p>
      <fieldset className="strategy-fields"><legend>战前计议</legend>
        <label htmlFor={`${id}-advisor`}>本军军师</label>
        <select id={`${id}-advisor`} name="advisor" value={advisor} onChange={e=>{setAdvisor(e.target.value);setSequence(0);}}>
          {battle.rosters.attacker.map(m=><option key={m.commander.id} value={m.commander.id}>{m.commander.name} · 智力 {m.commander.intelligence}</option>)}
        </select>
        <label htmlFor={`${id}-strategy`}>军师计策</label>
        <select id={`${id}-strategy`} name="strategy" value={sequence} aria-describedby={`${id}-help`} onChange={e=>setSequence(Number(e.target.value))}>
          <option value="0">不用军师技</option>
          {options.map(s=><option key={s.sequence} value={s.sequence} disabled={!s.supported}>{s.name}{s.level?['','（初）','（中）','（高）'][s.level]:''}{s.supported?'':' · 暂不可用'}</option>)}
        </select>
        {options.length===0&&<p>此将尚未习得军师技。</p>}
      </fieldset>
      <div className="round-actions"><button type="submit" className="primary">确认计策</button><button type="button" onClick={onClose}>返回布阵</button></div>
    </form>
  </dialog>;
}
