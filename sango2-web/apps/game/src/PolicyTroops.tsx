import {useId} from 'react';
import type {GeneralDefinition} from '@sango2/content';
import {officerForceMask,officerUnit,nativeForceNames,nativeForceLabels,allocateBattleTroops,officerLevel,type Session,type Command} from '@sango2/core';

/** Original 0x41719C offers all 13 types and commits on activation. */
export function PolicyTroops({session,officer,cityId,execute}:{session:Session;officer:GeneralDefinition;cityId:string;execute:(command:Command)=>boolean}) {
  const id=useId(),g=session.generals[officer.id],learned=officerForceMask(g,officer),unit=officerUnit(g,officer);
  const slots=allocateBattleTroops(g.troops,officerLevel(g,officer),g.troopSlots);
  return <section className="policy-troops" aria-label={`${officer.name}部队兵种`}>
    <div className="policy-troop-officer"><img src={`/assets/${officer.portrait}`} alt="" width="100" height="120"/>
      <div><h4>{officer.name}</h4><p>出战兵种：{nativeForceLabels[nativeForceNames.indexOf(unit as typeof nativeForceNames[number])]}</p>
        <dl><div><dt>现役兵</dt><dd>{slots.active}</dd></div><div><dt>预备兵</dt><dd>{slots.reserve}</dd></div></dl>
      </div>
      <p className="policy-hint" id={`${id}-help`}>点击已学兵种即可出战。兵员保持不变，不耗金钱、库存或年度行动；使用兵符可学习其他兵种。</p>
    </div>
    <fieldset className="policy-troop-choices" aria-describedby={`${id}-help`}><legend>选择出战兵种</legend>
      {nativeForceNames.map((name,index)=>{
        const available=Boolean(learned&(1<<index)),selected=unit===name;
        return <button type="button" key={name} aria-pressed={selected} disabled={!available}
          onClick={()=>execute({type:'policy-unit',cityId,generalId:officer.id,unit:name})}>
          <span className="policy-troop-marker" aria-hidden="true">{selected?'◆':''}</span>
          <span>{nativeForceLabels[index]}</span><small>{selected?'出战':available?'已学会':'未学会'}</small>
        </button>;
      })}
    </fieldset>
  </section>;
}
