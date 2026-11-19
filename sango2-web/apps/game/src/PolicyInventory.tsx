import {useId,useRef,useState} from 'react';
import type {GeneralDefinition,ScenarioDefinition} from '@sango2/content';
import {previewPlayerItem,officerLevel,officerFormations,formationDefinition,officerForceMask,officerUnit,nativeForceNames,type Session,type Command} from '@sango2/core';

export function PolicyInventory({session,scene,items,cityId,officers,execute}:{session:Session;scene:ScenarioDefinition;items:Record<string,string>[];cityId:string;officers:GeneralDefinition[];execute:(command:Command)=>boolean}) {
  const id=useId(),errorRef=useRef<HTMLParagraphElement>(null);
  const [chosen,setChosen]=useState(''),[selected,setSelected]=useState(''),[unitChoice,setUnitChoice]=useState('');
  const officer=officers.find(g=>g.id===chosen)??officers[0],g=officer&&session.generals[officer.id];
  const inventory=session.policy?.search?.inventory[session.factionId]??{},ruler=scene.factions.find(f=>f.id===session.factionId)?.leaderId===officer?.id;
  const preview=(itemId:number)=>g&&officer?previewPlayerItem(g,officer,items,inventory,ruler,itemId):null;
  const state=preview(0)?.before,change=selected===''?null:preview(Number(selected));
  const currentUnit=officer&&g?officerUnit(g,officer):'';
  const learnedUnits=officer&&g?nativeForceNames.filter((_,index)=>Boolean(officerForceMask(g,officer)&(1<<index))):[];
  const selectedUnit=unitChoice||currentUnit;
  const name=(itemId:number)=>items.find(i=>Number(i.SEQUENCE)===itemId)?.NAME??'无';
  const entries=Object.entries(inventory).sort(([a],[b])=>Number(a)-Number(b));
  function switchUnit() {
    if(officer&&selectedUnit!==currentUnit&&execute({type:'policy-unit',cityId,generalId:officer.id,unit:selectedUnit}))setUnitChoice('');
  }
  return <form className="policy-inventory" aria-labelledby={`${id}-heading`} onSubmit={e=>{
    e.preventDefault();if(!officer||selected==='')return;
    if(execute({type:'policy-item',cityId,generalId:officer.id,itemId:Number(selected)}))setSelected('');
    else errorRef.current?.focus();
  }}>
    <h4 id={`${id}-heading`}>势力物品库</h4>
    <p className="policy-hint">搜索所得由全势力共用，每种最多99件。先选武将与物品，再确认分配；替换的旧装备归还物品库。使用物品不占开发或搜索行动。</p>
    <div className="policy-field"><label htmlFor={`${id}-officer`}>分配武将</label><select id={`${id}-officer`} name="generalId" value={officer?.id??''} disabled={!officers.length} onChange={e=>{setChosen(e.target.value);setSelected('');setUnitChoice('');}}>{officers.map(o=><option key={o.id} value={o.id}>{o.name} · 等级{officerLevel(session.generals[o.id],o)}</option>)}</select></div>
    {officer&&state?<section className="policy-equipment" aria-label={`${officer.name}当前装备`}>
      <img src={`/assets/${officer.portrait}`} alt="" width="60" height="72"/>
      <div><strong>{officer.name}</strong><dl><div><dt>兵器</dt><dd>{name(state.weaponId)}</dd></div><div><dt>坐骑</dt><dd>{name(state.horseId)}</dd></div><div><dt>随身物品</dt><dd>{name(state.thingId)}</dd></div></dl>
      <p>武力 {state.strength} · 智力 {state.intelligence} · 速度 {state.speed}<br/>体力 {state.hp}/{state.maxHp} · 技力 {state.mp}/{state.maxMp}<br/>士气 {state.morale} · 忠诚 {state.loyalty} · 疲劳 {state.fatigue}<br/>已会兵种：{nativeForceNames.filter((_,i)=>state.forceMask&(1<<i)).join('、')||'无'}<br/>已会阵形：{officerFormations(g,officer).map(f=>formationDefinition(f).label).join('、')||'无'}</p>
      <div className="policy-unit-switch"><p>出战兵种：{currentUnit}</p>
        <label htmlFor={`${id}-unit`}>当前兵种</label>
        <select id={`${id}-unit`} name="currentUnit" aria-describedby={`${id}-unit-help`} value={selectedUnit} disabled={learnedUnits.length<2} onChange={e=>setUnitChoice(e.target.value)}>{learnedUnits.map(unit=><option key={unit} value={unit}>{unit}</option>)}</select>
        <button type="button" onClick={switchUnit} disabled={!officer||learnedUnits.length<2||selectedUnit===currentUnit}>切换兵种</button>
        <small id={`${id}-unit-help`}>兵符只学习兵种，不会自动切换；切换不耗年度行动、不消耗库存，也不会重置兵员。</small>
      </div></div>
    </section>:<p className="empty">城中暂无在任武将，请选择其他城池。</p>}
    <fieldset className="policy-item-choices"><legend>选择在库物品 · {entries.length}种</legend>
      <div className="policy-results" tabIndex={0} role="region" aria-label="在库物品清单"><table><caption>物品、使用条件与效果</caption><thead><tr><th scope="col">选择物品</th><th scope="col">库存</th><th scope="col">等级 / 条件</th><th scope="col">说明</th></tr></thead><tbody>
        {entries.map(([key,count])=>{const item=items.find(i=>Number(i.SEQUENCE)===Number(key)),reason=preview(Number(key))?.reason;return <tr key={key} data-unavailable={!!reason}>
          <th scope="row"><label htmlFor={`${id}-item-${key}`}><input id={`${id}-item-${key}`} type="radio" name="itemId" value={key} required checked={selected===key} onChange={()=>setSelected(key)} disabled={!officer}/><span>{item?.NAME??key}</span></label></th><td>{count}</td><td>{item?.LEVEL||1}<small>{reason||'可以使用'}</small></td><td>{item?.DESCRIPTION||'—'}</td>
        </tr>;})}
        {!!state?.thingId&&<tr><th scope="row"><label htmlFor={`${id}-item-0`}><input id={`${id}-item-0`} type="radio" name="itemId" value="0" required checked={selected==='0'} onChange={()=>setSelected('0')}/><span>卸下随身物品</span></label></th><td>—</td><td>无等级限制</td><td>{name(state.thingId)}归还物品库；武器和坐骑通过替换归库。</td></tr>}
      </tbody></table></div>
      {!entries.length&&<p className="empty">物品库暂无收藏。派遣武将搜索，所得物品会收入此处。</p>}
    </fieldset>
    <p className="policy-item-preview" id={`${id}-preview`} ref={errorRef} tabIndex={-1}>{change?.reason?`不可使用：${change.reason}`:change&&state?<>
      {selected==='0'?`卸下${name(state.thingId)}`:`${change.consumable?'使用':'装备'}${name(Number(selected))}`}：武力 {state.strength} → {change.after.strength}，智力 {state.intelligence} → {change.after.intelligence}，速度 {state.speed} → {change.after.speed}。<br/>
      体力 {state.hp}/{state.maxHp} → {change.after.hp}/{change.after.maxHp}，技力 {state.mp}/{state.maxMp} → {change.after.mp}/{change.after.maxMp}。<br/>
      士气 {state.morale} → {change.after.morale}，忠诚 {state.loyalty} → {change.after.loyalty}，疲劳 {state.fatigue} → {change.after.fatigue}。
      {change.returnedId>0&&<> {name(change.returnedId)}归库{inventory[String(change.returnedId)]===99?'（库存已满，上限99件）':''}。</>}
    </>:'选择物品后，可在此查看使用条件与属性变化。'}</p>
    <button className="primary" type="submit" aria-describedby={`${id}-preview`} disabled={!officer||!entries.length&&!state?.thingId}>{selected==='0'?'卸下随身物品':change?.consumable?'使用物品':'装备物品'}</button>
  </form>;
}
