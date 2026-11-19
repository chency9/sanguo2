import {useState} from 'react';
import type {ScenarioDefinition} from '@sango2/content';
import {stationedGenerals,policyGovernorId,nativeTroopCapacity,type Session,type Command} from '@sango2/core';
import './policy.css';

const number=(n:number)=>new Intl.NumberFormat('zh-CN').format(n);
type ActionResult={ok:boolean;message:string};
export function PolicyScreen({session,scene,initialCityId,onCommand,onClose}:{session:Session;scene:ScenarioDefinition;initialCityId:string;onCommand:(command:Command)=>ActionResult;onClose:()=>void}) {
  const cities=scene.cities.filter(c=>session.cities[c.id].ownerId===session.factionId);
  const [cityId,setCityId]=useState(initialCityId),[section,setSection]=useState<'develop'|'governor'|'recruit'|'results'>('develop');
  const [selected,setSelected]=useState<string[]>([]),[chosen,setChosen]=useState(''),[amount,setAmount]=useState(1);
  const [feedback,setFeedback]=useState<ActionResult|null>(null);
  const city=cities.find(c=>c.id===cityId)??cities[0],policy=session.policy;
  if(!policy)return <div className="policy-migrate"><p>此存档沿用早期的每日经营规则。启用年度内政后，每将每年可开发一次，赋税改为年度结算；现有资源、兵员和进度保留。</p><button className="primary" onClick={()=>{const r=onCommand({type:'policy-enable'});setFeedback(r);}}>启用年度内政</button><p role="status">{feedback?.message}</p></div>;
  if(!city)return <p className="empty">当前没有可以经营的城池。</p>;
  const state=session.cities[city.id],ids=stationedGenerals(session,city.id),officers=ids.map(id=>scene.generals.find(g=>g.id===id)!);
  const idle=ids.filter(id=>!policy.acted.includes(id)),governor=scene.generals.find(g=>g.id===policyGovernorId(session,scene,city.id));
  const officer=officers.find(g=>g.id===chosen)??officers[0],current=officer&&session.generals[officer.id];
  const capacity=officer?nativeTroopCapacity(officer.level??20):{active:0,reserve:0},pool=session.nativeAI?.reserves[city.id]??0;
  const maximum=current?Math.max(0,Math.min(pool,Math.max(0,capacity.active)+capacity.reserve-current.troops)):0;
  function execute(command:Command) {const result=onCommand(command);setFeedback(result);return result.ok;}
  return <div className="policy-screen">
    <div className="policy-palace"><div className="policy-scroll"><span>{scene.factions.find(f=>f.id===session.factionId)?.name} · {policy.year}年</span><strong>內 政 議 事</strong><p>{policy.active?'治城理政，积蓄国力。':'本年内政已毕，整军待发。'}</p></div></div>
    <div className="policy-body"><aside className="policy-council"><label>治下城池<select ref={element=>{element?.setAttribute("autofocus","");}} value={city.id} onChange={e=>{setCityId(e.target.value);setSelected([]);setChosen('');setAmount(1);setFeedback(null);}}>{cities.map(c=><option key={c.id} value={c.id}>{c.name} · {stationedGenerals(session,c.id).length}将</option>)}</select></label>
      <nav aria-label="内政命令">{([['develop','开发'],['governor','任命太守'],['recruit','部队征兵'],['results','内政报告']] as const).map(([id,label])=><button key={id} aria-pressed={section===id} onClick={()=>{setSection(id);setFeedback(null);}}>{label}<span aria-hidden="true">›</span></button>)}</nav>
      <div className="policy-governor">{governor&&<img src={`/assets/${governor.portrait}`} alt="" width="100" height="120"/>}<span>现任太守<strong>{governor?.name??'暂无'}</strong>{governor&&<small>智力 {governor.intelligence}</small>}</span></div>
    </aside><section className="policy-orders"><header className="policy-city-heading"><h3>{city.name}{city.nativeFlags===2&&<small>关隘</small>}</h3><span>{policy.active?`尚有 ${idle.length} 将未行动`:'本年内政已结束'}</span></header>
      <dl className="policy-stats"><div><dt>金钱</dt><dd>{number(state.money)}</dd></div><div><dt>人口</dt><dd>{number(state.population)}</dd></div><div><dt>城防</dt><dd>{state.defense}<small> / 999</small></dd></div><div><dt>预备兵</dt><dd>{pool}</dd></div></dl>
      {section==='develop'&&<form onSubmit={e=>{e.preventDefault();if(execute({type:'policy-develop',cityId:city.id,generalIds:selected}))setSelected([]);}}><div className="policy-command-heading"><h4>开发城池</h4><button type="button" disabled={!policy.active||!idle.length} onClick={()=>setSelected(selected.length===idle.length?[]:idle)}>{selected.length===idle.length&&idle.length?'取消全选':'全选未行动武将'}</button></div><p className="policy-hint">每将本轮可行动一次。人口收益看执行武将智力，城防收益看武力；太守智力同时影响两项收益。开发不扣金钱。{city.nativeFlags===2?'关隘只提升城防。':''}</p>
        <fieldset className="policy-officers"><legend>选择执行武将</legend>{officers.map(g=><label key={g.id} data-acted={policy.acted.includes(g.id)}><input type="checkbox" checked={selected.includes(g.id)} disabled={!policy.active||policy.acted.includes(g.id)} onChange={e=>setSelected(e.target.checked?[...selected,g.id]:selected.filter(id=>id!==g.id))}/><img src={`/assets/${g.portrait}`} alt="" width="40" height="48"/><span><strong>{g.name}</strong><small>武 {g.strength} · 智 {g.intelligence}</small></span><em>{policy.acted.includes(g.id)?'已行动':'待命'}</em></label>)}{!officers.length&&<p>城中暂无在任武将。</p>}</fieldset>
        <button className="primary" disabled={!policy.active||!selected.length}>执行开发{selected.length?` · ${selected.length}将`:''}</button></form>}
      {section==='governor'&&<form onSubmit={e=>{e.preventDefault();if(officer)execute({type:'policy-governor',cityId:city.id,generalId:officer.id});}}><h4>任命太守</h4><p className="policy-hint">太守必须驻守本城，其智力会影响开发人口和城防的收益。任命不会恢复本轮已经使用的行动。</p><label className="policy-field">太守人选<select value={officer?.id??''} disabled={!policy.active||!officers.length} onChange={e=>setChosen(e.target.value)}>{officers.map(g=><option key={g.id} value={g.id}>{g.name} · 智力{g.intelligence} · 武力{g.strength}</option>)}</select></label><button className="primary" disabled={!policy.active||!officer||officer.id===governor?.id}>任命为太守</button></form>}
      {section==='recruit'&&<form onSubmit={e=>{e.preventDefault();if(officer)execute({type:'policy-recruit',cityId:city.id,generalId:officer.id,amount});}}><h4>部队征兵</h4><p className="policy-hint">从城内预备池补充部队，不再支付征募费用。城内在征战期间花费每兵100金补充预备池，速度受人口与城防影响。</p><label className="policy-field">配兵武将<select value={officer?.id??''} disabled={!officers.length} onChange={e=>{setChosen(e.target.value);setAmount(1);}}>{officers.map(g=><option key={g.id} value={g.id}>{g.name} · 现有{session.generals[g.id].troops}兵</option>)}</select></label><p className="policy-hint">{officer?`${officer.name}统兵上限 ${Math.max(0,capacity.active)+capacity.reserve}，目前可补 ${maximum} 兵。`:'城中暂无在任武将。'}</p><label className="policy-field">补充兵数<input type="number" min="1" max={maximum||1} value={amount} disabled={!maximum} required onChange={e=>setAmount(Number(e.target.value))}/></label><button className="primary" disabled={!maximum||!Number.isInteger(amount)||amount<1||amount>maximum}>补充部队</button></form>}
      {section==='results'&&<div className="policy-results" tabIndex={0}><table><caption>内政开发记录 · 最近100次</caption><thead><tr><th scope="col">年度</th><th scope="col">城市 / 武将</th><th scope="col">人口增加</th><th scope="col">城防增加</th></tr></thead><tbody>{policy.results.map((r,i)=><tr key={i}><td>{r.year}</td><th scope="row">{scene.cities.find(c=>c.id===r.cityId)?.name} · {scene.generals.find(g=>g.id===r.generalId)?.name}</th><td>+{number(r.population)}</td><td>+{r.defense}</td></tr>)}</tbody></table>{!policy.results.length&&<p className="empty">尚无开发记录。选择武将执行开发后，可在此查看成果。</p>}</div>}
      <p className={`policy-feedback ${feedback&&!feedback.ok?'error':''}`} role="status">{feedback?.message??''}</p>
    </section></div>
    <footer className="policy-footer"><p>{policy.active?'结束内政后返回征战；下一年度重新获得行动机会。':'可查看经营报告，并从城内预备池继续配兵。'}</p>{policy.active?<button className="primary" onClick={()=>{if(execute({type:'policy-finish'}))onClose();}}>内政終了 · 返回征战</button>:<button onClick={onClose}>返回地图</button>}</footer>
  </div>;
}
