import {useId,useState} from 'react';
import type {GeneralDefinition} from '@sango2/content';
import {allocateBattleTroops,nativeTroopCapacity,nativeReserveCapacity,nativeTransferTroops,officerLevel,type Session,type Command} from '@sango2/core';

export function PolicyAllocation({session,officer,cityId,execute,autofill}:{session:Session;officer:GeneralDefinition;cityId:string;execute:(command:Command)=>boolean;autofill:{active:boolean;start:(cityId:string,generalId:string,maximum:number)=>void;finish:()=>void}}) {
  const id=useId(),[draft,setDraft]=useState<string|null>(null),[amount,setAmount]=useState('1');
  const g=session.generals[officer.id],cap=nativeTroopCapacity(officerLevel(g,officer));
  const slots=allocateBattleTroops(g.troops,officerLevel(g,officer),g.troopSlots),current=slots.active+slots.reserve;
  const maximum=Math.max(0,cap.active)+cap.reserve,pool=session.nativeAI?.reserves[cityId]??0,poolCapacity=nativeReserveCapacity(session.cities[cityId].population);
  const input={...slots,maxActive:Math.max(0,cap.active),maxReserve:cap.reserve,pool,poolCapacity};
  const choice=draft??String(current),target=Number(choice),valid=choice!==''&&Number.isInteger(target)&&target>=0&&target<=maximum;
  const preview=nativeTransferTroops(input,valid?target:current),canAdd=nativeTransferTroops(input,current+1).pool!==pool,canReturn=nativeTransferTroops(input,Math.max(0,current-1)).pool!==pool;
  const canRecruit=Math.max(0,Math.min(pool,maximum-g.troops));
  function adjust(value:number) {
    if(execute({type:'policy-troops',cityId,generalId:officer.id,target:value}))setDraft(null);
  }
  return <section className="policy-allocation" aria-label="兵力调配">
    <form aria-labelledby={`${id}-heading`} onSubmit={e=>{e.preventDefault();if(valid)adjust(target);}}>
      <h5 id={`${id}-heading`}>调整部队兵力</h5>
      <p className="policy-hint" id={`${id}-help`}>补兵和退兵都先调整现役，再调整预备。城市预备池满时停止退兵；所有操作均不扣金钱或年度行动。</p>
      <p className="policy-allocation-pool">城内预备池 <strong>{pool} / {poolCapacity}</strong><span>统兵上限 {maximum}</span></p>
      <label className="policy-field" htmlFor={`${id}-target`}>目标兵数</label>
      <input id={`${id}-target`} type="number" name="target" min="0" max={maximum} step="1" required value={choice} aria-describedby={`${id}-help ${id}-preview`} onChange={e=>setDraft(e.target.value)}/>
      <label className="policy-range-label" htmlFor={`${id}-range`}>兵力滑条</label>
      <input id={`${id}-range`} type="range" name="troopRange" min="0" max={maximum} step="1" value={valid?target:current} aria-describedby={`${id}-preview`} onChange={e=>setDraft(e.target.value)}/>
      <p className="policy-allocation-preview" id={`${id}-preview`}>调整后：现役 {preview.active} · 预备 {preview.reserve}<br/>城内预备池 {preview.pool}{valid&&preview.active+preview.reserve!==target?' · 已到可分配边界':''}</p>
      <button type="submit" className="primary">调整兵力</button>
      <div className="policy-allocation-actions" role="group" aria-label="快捷配兵">
        <button type="button" disabled={!canReturn} onClick={()=>adjust(Math.max(0,current-1))}>退回一兵</button>
        <button type="button" disabled={!canAdd} onClick={()=>adjust(Math.min(maximum,current+1))}>补充一兵</button>
        <button type="button" disabled={!canReturn} onClick={()=>adjust(0)}>尽量退回</button>
        <button type="button" disabled={!canAdd} onClick={()=>{setDraft(null);autofill.start(cityId,officer.id,maximum);}}>补满部队</button>
      </div>
      <p className="policy-fill-status" aria-live="polite">{autofill.active?'正在补兵 · 先现役，后预备':'点击补满后逐兵调配，切换武将或离开时完成剩余补兵。'}</p>
      {autofill.active&&<button type="button" onClick={autofill.finish}>立即完成补兵</button>}
    </form>
    {!!slots.overflow&&<p className="policy-hint">另有 {slots.overflow} 名旧存档营中兵员，调整现役/预备时继续保留。</p>}
    <form className="policy-recruit-exact" aria-label="按数量补兵" onSubmit={e=>{e.preventDefault();execute({type:'policy-recruit',cityId,generalId:officer.id,amount:Number(amount)});}}>
      <label className="policy-field" htmlFor={`${id}-amount`}>补充兵数</label>
      <input id={`${id}-amount`} type="number" name="amount" min="1" max={canRecruit||1} step="1" required disabled={!canRecruit} value={amount} onChange={e=>setAmount(e.target.value)}/>
      <button type="submit" disabled={!canRecruit}>补充部队</button>
    </form>
  </section>;
}
