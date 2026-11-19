import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { scenarioById, type GameContent, type ScenarioDefinition } from '@sango2/content';
import { adjacentRoads, createSession, dispatch, gameDate, RULES, stationedGenerals, readSession, createBattle, nativeTroopCapacity, officerLevel, officerMaxHp, officerMaxMp, officerExperience, officerDefinition, commandBattle, tickBattle, type BattleState, type BattleCommand, type Command, type Session } from '@sango2/core';
import { exportGame, importGame, listSaves, saveGame, type SaveSlot } from './storage';
import { cityOwnership } from './city-ownership';
import {PolicyScreen} from './PolicyScreen';

const WorldMap = lazy(() => import('./WorldMap').then(module => ({ default: module.WorldMap })));
const BattleView = lazy(() => import('./BattleView').then(module => ({ default: module.BattleView })));

const number = (n: number) => new Intl.NumberFormat('zh-CN').format(n);
function Portrait({ path, name, small = false }: { path: string; name: string; small?: boolean }) {
  return <img className={small ? 'portrait small' : 'portrait'} src={`/assets/${path}`} alt={name} width="100" height="120" loading="lazy" />;
}
function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (!ref.current?.open) ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={wide ? 'modal wide' : 'modal'} aria-label={title} onClose={onClose}>
    <header className="modal-heading"><div><span className="eyebrow">山河棋局 · 三国群英传 II</span><h2>{title}</h2></div><button className="icon-button" onClick={() => ref.current?.close()} aria-label="关闭对话框">×</button></header>
    {children}
  </dialog>;
}
function NewGame({ content, onStart, replacing }: { content: GameContent; onStart: (s: Session) => void; replacing: boolean }) {
  const [scenarioId, setScenario] = useState(content.scenarios[0].id);
  const scene = scenarioById(content, scenarioId);
  const factions = scene.factions.filter(f => !f.special && scene.cities.some(c => c.ownerId === f.id));
  const [factionId, setFaction] = useState(factions[0].id);
  const chosen = factions.find(f => f.id === factionId) ?? factions[0];
  const leader = scene.generals.find(g => g.id === chosen.leaderId);
  return <div className="new-game">
    <div className="era-banner"><img src="/assets/ui/army-banner.png" alt="原版群英列阵" width="640" height="175"/><div><strong>三國群英傳 <b>II</b></strong><span>黄巾烽火起，英雄逐鹿时</span></div></div>
    <p className="intro">群雄并起，山河待定。择一时局，领一方诸侯。</p>
    <div className="era-list" role="group" aria-label="选择剧本">{content.scenarios.map(s => <button key={s.id} aria-pressed={s.id === scenarioId} onClick={() => { setScenario(s.id); setFaction(s.factions.find(f => !f.special && s.cities.some(c => c.ownerId === f.id))!.id); }}><span>{s.year}</span><strong>{s.title}</strong></button>)}</div>
    <div className="faction-pick"><div><h3>选择势力</h3><div className="faction-grid">{factions.map(f => <button key={f.id} aria-pressed={f.id === chosen.id} onClick={() => setFaction(f.id)}><i style={{ background: f.color }} />{f.name}<small>{scene.cities.filter(c => c.ownerId === f.id).length} 城</small></button>)}</div></div>
      <aside className="leader-preview">{leader && <Portrait path={leader.portrait} name={leader.name} />}<h3>{chosen.name}</h3><p>{leader ? `武 ${leader.strength} / 智 ${leader.intelligence}` : '据城而起'}</p><small>{scene.cities.filter(c => c.ownerId === chosen.id).map(c => c.name).join(' · ')}</small></aside>
    </div>
    <footer className="modal-footer"><p>{replacing ? '开启新局会替换当前进度，请先保存。' : '择一方诸侯，统率军队，与天下群雄争夺六十城。'}</p><button className="primary" onClick={() => onStart(createSession(content, scene.id, chosen.id))}>执掌{chosen.name} · 开始征程 →</button></footer>
  </div>;
}
function March({ session, scene, cityId, onMarch }: { session: Session; scene: ScenarioDefinition; cityId: string; onMarch: (c: Command) => void }) {
  const roads = adjacentRoads(scene, cityId).filter(r => !r.restricted);
  const [roadId, setRoad] = useState(roads[0]?.id ?? '');
  const generals = stationedGenerals(session, cityId);
  const [selected, setSelected] = useState<string[]>(generals.slice(0, 1));
  const [troops, setTroops] = useState(Math.min(200, session.cities[cityId].troops));
  const [allocation,setAllocation]=useState<Record<string,number>|null>(null);
  const shares=allocation??Object.fromEntries(selected.map((id,i)=>[id,Math.floor(troops/selected.length)+(i<troops%selected.length?1:0)]));
  const road = roads.find(r => r.id === roadId);
  const destination = road && scene.cities.find(c => c.id === (road.from === cityId ? road.to : road.from));
  const owner = destination && session.cities[destination.id].ownerId;
  const hostile = owner && owner !== session.factionId;
  return <form onSubmit={e => { e.preventDefault(); if (destination) onMarch({ type: 'march', from: cityId, to: destination.id, generalIds: selected, troops,troopsByGeneral:shares }); }}>
    <label className="field">行军目标<select value={roadId} onChange={e => setRoad(e.target.value)}>{roads.map(r => { const c = scene.cities.find(c => c.id === (r.from === cityId ? r.to : r.from))!; return <option value={r.id} key={r.id}>{c.name} · {scene.factions.find(f => f.id === session.cities[c.id].ownerId)?.name ?? '无主'} · {Math.max(2, Math.ceil(r.length / RULES.roadUnitsPerDay))} 天</option>; })}</select></label>
    <fieldset><legend>出征武将 · 首位为主将（最多五人）</legend><div className="general-choices">{generals.map(id => { const g = scene.generals.find(g => g.id === id)!; return <label key={id} className={selected.includes(id) ? 'checked' : ''}><input type="checkbox" checked={selected.includes(id)} disabled={session.generals[id].hp<=0||(!selected.includes(id) && selected.length === 5)} onChange={e => {setAllocation(null);setSelected(e.target.checked ? [...selected, id] : selected.filter(x => x !== id));}} /><Portrait small path={g.portrait} name={g.name} /><span>{g.name}<small>武 {g.strength} · 智 {g.intelligence}</small></span>{selected[0] === id && <b>主</b>}</label>; })}</div></fieldset>
    <label className="field">出征兵力（可用 {number(session.cities[cityId].troops)}）<input type="number" min="1" max={session.cities[cityId].troops} required value={troops} onChange={e => {setAllocation(null);setTroops(Number(e.target.value));}} /></label>
    <p className="notice">{hostile ? `敌城驻军 ${number(session.cities[destination!.id].troops)} 人。抵达后进入实时战场，可指挥前军、后军与主将，战后按实际余兵结算。` : owner ? '抵达后，武将和兵力将归入目标城池。' : '抵达后占领无主城池，武将与兵力驻扎当地。'}</p>
    {selected.length>0&&<fieldset className="troop-allocation"><legend>各将配兵 · 可单独调整</legend>{selected.map(id=>{const g=scene.generals.find(g=>g.id===id)!;return <label key={id}><span>{g.name}<small>体 {session.generals[id].hp} / {officerMaxHp(session.generals[id],g)} · {g.unit}兵</small></span><input aria-label={`${g.name}配兵`} type="number" min="0" max={session.cities[cityId].troops} required value={shares[id]} onChange={e=>{const next={...shares,[id]:Number(e.target.value)};setAllocation(next);setTroops(Object.values(next).reduce((a,b)=>a+b,0));}}/></label>;})}<p>合计 {troops} 人。首将先出阵，其余武将候阵；城内余兵重新分配给留守武将。</p></fieldset>}
    <footer className="modal-footer"><p>沿原版道路行军，推进日期后移动。</p><button className="primary" disabled={!destination || !selected.length || troops < 1}>下令出征 →</button></footer>
  </form>;
}
function Roster({ scene, session }: { scene: ScenarioDefinition; session: Session }) {
  const [query, setQuery] = useState(''); const [scope, setScope] = useState('own');
  const generals = scene.generals.filter(g => (scope === 'all' || session.generals[g.id].ownerId === session.factionId) && g.name.includes(query.trim()));
  return <><div className="filters"><label>检索武将<input type="search" placeholder="输入武将姓名" value={query} onChange={e => setQuery(e.target.value)} /></label><label>名册范围<select value={scope} onChange={e => setScope(e.target.value)}><option value="own">我方武将</option><option value="all">剧本全名册</option></select></label><span>{generals.length} 位武将</span></div>
    <div className="table-scroll officer-table-scroll" tabIndex={0} role="region" aria-labelledby="officer-table-caption"><table><caption id="officer-table-caption">武将名册 · 当前人物状态</caption><thead><tr><th scope="col">武将</th><th scope="col">所在 / 状态</th><th scope="col">武力</th><th scope="col">智力</th><th scope="col">等级 / 经验</th><th scope="col">体力 / 技力</th><th scope="col">士气 / 疲劳 / 忠诚</th><th scope="col">兵种</th><th scope="col">装备</th></tr></thead><tbody>{generals.map(g => { const state = session.generals[g.id]; return <tr key={g.id}><th scope="row"><span className="officer-name"><Portrait small path={g.portrait} name="" />{g.name}</span></th><td>{state.armyId ? '行军中' : scene.cities.find(c => c.id === state.cityId)?.name ?? '未出场'}<small>{state.status === '登' ? scene.factions.find(f => f.id === state.ownerId)?.name : state.status === '野' ? '在野' : '未登场'}</small></td><td className="power">{g.strength}</td><td>{g.intelligence}</td><td>等级 {officerLevel(state,g)}<small>经验 {officerExperience(state,g)}</small></td><td>体 {state.hp} / {officerMaxHp(state,g)}<small>技 {state.mp} / {officerMaxMp(state,g)} · 兵 {state.troops}</small></td><td>士气 {state.morale??80}<small>疲劳 {state.fatigue??0} · 忠诚 {state.loyalty??90}</small></td><td>{g.unit || '—'}</td><td>{[g.weapon,g.horse,g.item].filter(x => x && x !== '無').join(' · ') || '—'}</td></tr>; })}</tbody></table>{!generals.length && <p className="empty">未找到对应武将。</p>}</div></>;
}
function Saves({ content, session, onLoad, notify }: { content: GameContent; session: Session; onLoad: (s: Session) => void; notify: (m: string) => void }) {
  const [savedMessage,setSavedMessage]=useState('');
  const [slots, setSlots] = useState<SaveSlot[]>([]); const [busy, setBusy] = useState(true); const [error, setError] = useState('');
  useEffect(() => { listSaves().then(setSlots).catch(e => setError(String(e.message))).finally(() => setBusy(false)); }, []);
  async function save(slot: number) {
    setBusy(true); setError('');
    try { const saved = await saveGame(slot, session, slots.find(s => s.slot === slot)?.revision ?? 0); setSlots(prev => [...prev.filter(s => s.slot !== slot), saved]); notify('战役已保存到此浏览器。');setSavedMessage('战役已保存到此浏览器。'); }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败。'); } finally { setBusy(false); }
  }
  return <><p className="intro">三席军机簿，留待来日再战。</p><p className="muted">存档保存在当前浏览器。读取或导入会替换当前进度；清理浏览器数据前请导出备份。</p>
    <div className="save-slots">{[1,2,3].map(id => { const slot = slots.find(s => s.slot === id); const scene = slot && content.scenarios.find(s => s.id === slot.session?.scenarioId); return <section key={id}><span className="slot-number">0{id}</span><div><h3>{slot ? `${scene?.title ?? '未知剧本'} · ${scene?.factions.find(f => f.id === slot.session?.factionId)?.name ?? '未知势力'}` : '空白军机簿'}</h3><p>{slot ? `第 ${slot.session?.day ?? '?'} 天 · ${new Date(slot.savedAt).toLocaleString('zh-CN')}` : '尚未保存战役'}</p></div><button disabled={busy} onClick={() => void save(id)}>{slot ? '覆盖保存' : '保存'}</button><button disabled={busy || !slot} onClick={() => { try { onLoad(readSession(slot!.session, content)); } catch (e) { setError(e instanceof Error ? e.message : '存档无效'); } }}>读取</button></section>; })}</div>
    {error && <p role="alert" className="error">{error}</p>}<p role="status">{savedMessage}</p>
    <footer className="modal-footer"><button onClick={() => { exportGame(session); notify('已导出当前战役。'); }}>导出当前战役</button><label className="file-button">导入存档<input aria-label="导入存档" type="file" accept="application/json,.json" disabled={busy} onChange={async e => { const file = e.target.files?.[0]; if (!file) return; setBusy(true); try { onLoad(await importGame(file, content)); } catch (error) { setError(error instanceof Error ? error.message : '导入失败'); } finally { setBusy(false); e.target.value = ''; } }} /></label></footer>
  </>;
}

type Panel = 'new' | 'roster' | 'saves' | 'march' | 'help' | 'reports' | 'policy' | null;
export function App({ content }: { content: GameContent }) {
  const [session, setSession] = useState(() => createSession(content, content.scenarios[0].id, content.scenarios[0].factions[0].id));
  const sessionRef = useRef(session);
  const sourceScene = scenarioById(content, session.scenarioId);
  const scene=useMemo(()=>({...sourceScene,generals:sourceScene.generals.map(d=>officerDefinition(session.generals[d.id],d,content.items))}),[sourceScene,session,content.items]);
  const [selected, setSelected] = useState(() => scene.cities.find(c => c.ownerId === session.factionId)!.id);
  const [panel, setPanel] = useState<Panel>('new'); const [started, setStarted] = useState(false);
  const [running, setRunning] = useState(false); const [speed, setSpeed] = useState(1);
  const [cityScope, setCityScope] = useState('own'); const [cityQuery, setCityQuery] = useState('');
  const [message, setMessage] = useState('择一方诸侯，开启你的征程。');
  const [music, setMusic] = useState(false); const audio = useRef<HTMLAudioElement>(null);
  const [training,setTraining]=useState<BattleState|null>(null);const trainingRef=useRef<BattleState|null>(null);
  const city = scene.cities.find(c => c.id === selected) ?? scene.cities[0];
  const state = session.cities[city.id];
  const faction = scene.factions.find(f => f.id === session.factionId)!;
  const cityOwner = scene.factions.find(f => f.id === state.ownerId);
  const leader = scene.generals.find(g => g.id === faction.leaderId);
  const isOwn = state.ownerId === session.factionId;
  const stationed = stationedGenerals(session, city.id).map(id => scene.generals.find(g => g.id === id)!);
  const ownCities = scene.cities.filter(c => session.cities[c.id].ownerId === session.factionId);
  const incoming=session.armies.filter(a=>a.ownerId!==session.factionId&&session.cities[a.to].ownerId===session.factionId);
  const totals = ownCities.reduce((t,c) => ({ money: t.money + session.cities[c.id].money, troops: t.troops + session.cities[c.id].troops }), { money: 0, troops: 0 });
  const date = gameDate(session, scene);
  const cityList = scene.cities.filter(c => (cityScope === 'all' || session.cities[c.id].ownerId === session.factionId) && c.name.includes(cityQuery.trim()));
  const actionReason = !isOwn ? '此城不属我方' : !stationed.length ? '城中暂无武将' : session.policy?.active?'当前为内政阶段，请先内政終了，再出征。':'';
  function commit(next: Session) { sessionRef.current = next; setSession(next); }
  function run(command: Command) {
    try { const before=sessionRef.current,next = dispatch(before, command, content); commit(next); if(next.battle){setRunning(false);if(!before.battle)setMessage(next.chronicle[0].text);}if(next.policy?.active&&!before.policy?.active){setRunning(false);setPanel('policy');}if (!['advance','battle-tick','battle-command'].includes(command.type)) setMessage(next.chronicle[0].text);return {ok:true,message:next.chronicle[0].text}; }
    catch (e) { const message=e instanceof Error ? e.message : '命令执行失败';setRunning(false);setMessage(message);return {ok:false,message}; }
  }
  function load(next: Session) {
    trainingRef.current=null;setTraining(null);
    commit(next); const nextScene = scenarioById(content, next.scenarioId);
    setSelected(nextScene.cities.find(c => next.cities[c.id].ownerId === next.factionId)?.id ?? nextScene.cities[0].id);
    setRunning(false); setPanel(next.policy?.active?'policy':null); setStarted(true); setCityScope('own'); setCityQuery(''); setMessage(next.policy?.active?'进入内政。选择武将开发城池、任命太守或补充部队。':'战役已就绪。选择城池，下达军令。');
  }
  useEffect(() => {
    if (!running || panel || session.battle || training || session.policy?.active) return;
    const id = window.setInterval(() => run({ type: 'advance', days: 1 }), 2000 / speed);
    return () => clearInterval(id);
  }, [running, speed, panel, !!session.battle, !!training,session.policy?.active]);
  useEffect(() => { const pause = () => { if (document.hidden) setRunning(false); }; document.addEventListener('visibilitychange', pause); return () => document.removeEventListener('visibilitychange', pause); }, []);
  async function toggleMusic() {
    if (!audio.current) return;
    if (music) { audio.current.pause(); setMusic(false); }
    else try { audio.current.volume = .3; await audio.current.play(); setMusic(true); } catch { setMessage('音乐暂时无法播放，请检查浏览器声音权限。'); }
  }
  function practice(multiple=false) {
    const attacker=scene.generals.find(g=>g.name==='曹操')??leader??scene.generals[0];
    const defender=scene.generals.find(g=>g.name==='張角')??scene.generals.find(g=>g.ownerId&&g.ownerId!==session.factionId)??scene.generals[1];
    const drillCommander=(general:typeof attacker,unit:string)=>{
      const source=scene.generals.find(g=>g.unit===unit&&g.appearance)?.appearance;
      return {...general,morale:session.generals[general.id].morale??80,fatigue:session.generals[general.id].fatigue??0,loyalty:session.generals[general.id].loyalty??90,unit,appearance:general.appearance&&source?{...general.appearance,soldier:source.soldier,soldierAttack:source.soldierAttack,reserveSoldierAttack:source.reserveSoldierAttack}:undefined};
    };
    const troopCount=(level=20)=>{const cap=nativeTroopCapacity(level);return Math.max(0,cap.active)+cap.reserve;};
    const a=drillCommander(attacker,'刀'),d=drillCommander(defender,'弓');
    const secondary=scene.generals.find(g=>g.name==='關羽')??scene.generals[2];
    const rival=scene.generals.find(g=>g.name==='呂布')??scene.generals[3];
    const b=createBattle({id:'practice',attacker:a,defender:d,attackingTroops:troopCount(a.level),defendingTroops:troopCount(d.level),seed:184,scenery:{terrainId:5,variant:'a'},
      rosters:multiple?{attacker:[a,drillCommander(secondary,secondary.unit)].map(commander=>({commander,troops:troopCount(commander.level),withdrawn:false})),defender:[d,drillCommander(rival,rival.unit)].map(commander=>({commander,troops:troopCount(commander.level),withdrawn:false}))}:undefined});
    trainingRef.current=b;setTraining(b);setRunning(false);setPanel(null);
  }
  function battleCommand(command:BattleCommand) {
    if(trainingRef.current){const b=commandBattle(trainingRef.current,command);trainingRef.current=b;setTraining(b);}
    else run({type:'battle-command',command});
  }
  function battleTick(steps:number) {
    if(trainingRef.current){const b=structuredClone(trainingRef.current);tickBattle(b,steps);trainingRef.current=b;setTraining(b);}
    else run({type:'battle-tick',steps});
  }
  const activeBattle=training??session.battle;
  const terrain=activeBattle?content.terrains.find(t=>t.id===(activeBattle.scenery?.terrainId??0)):undefined;
  const musicSource=activeBattle?`/assets/battle/music-${String(terrain?.soundtrack??6).padStart(2,'0')}.mp3`:'/assets/music.mp3';
  useEffect(()=>{
    const player=audio.current;if(!player)return;
    let cancelled=false;player.src=musicSource;
    if(music)void player.play().catch(()=>{if(!cancelled){setMusic(false);setMessage('音乐未能播放，请再次点击音乐按钮。');}});
    return()=>{cancelled=true;};
  },[musicSource]);
  return <div className="app">
    <header className="topbar"><a className="brand" href="#realm"><span className="seal">群</span><span><strong>三國群英傳 <b>II</b></strong><small>修正版 1.05+ · WEB 重制</small></span></a><div className="edition"><span>乱世逐鹿</span><small>{scene.title} · {faction.name}</small></div><nav aria-label="游戏菜单"><button disabled={!started||!!activeBattle} onClick={()=>setPanel('policy')}>内政经营</button><button onClick={() => setPanel('new')}>新征程</button><button disabled={!!activeBattle} onClick={()=>practice()}>演武场</button><button disabled={!!activeBattle} onClick={()=>practice(true)}>双将演武</button><button onClick={() => setPanel('saves')}>存读档</button><button onClick={() => setPanel('help')}>玩法说明</button><button className="music-button" aria-pressed={music} onClick={() => void toggleMusic()}>{music ? '♫ 音乐开' : '♪ 音乐关'}</button></nav></header>
    {activeBattle?<Suspense fallback={<div className="boot">正在进入战场…</div>}><BattleView skills={content.skills} terrains={content.terrains} music={music} onMusic={()=>void toggleMusic()} key={activeBattle.id} battle={activeBattle} cityName={training?'校场':scene.cities.find(c=>c.id===activeBattle.cityId)?.name??'城池'} training={!!training} blocked={!!panel} onCommand={battleCommand} onTick={battleTick} onSave={()=>{if(training)setMessage('演武不写入战役存档。');else setPanel('saves');}} onLeave={()=>{trainingRef.current=null;setTraining(null);}} onFinish={()=>{if(training){trainingRef.current=null;setTraining(null);}else run({type:'battle-finish'});}}/></Suspense>:<main id="realm" className="realm">
      <aside className="empire"><div className="faction-header">{leader && <Portrait path={leader.portrait} name={leader.name} />}<div><span className="eyebrow">主 公</span><h1>{faction.name}</h1><p><i style={{ background: faction.color }} />据守 {ownCities.length} 城</p></div></div>
        <div className="empire-totals"><div><span>府库总金</span><strong>{number(totals.money)}</strong></div><div><span>城内驻军</span><strong>{number(totals.troops)}</strong></div></div>
        <button className="roster-link" onClick={() => setPanel('roster')}><span>武将名册</span><b>{Object.values(session.generals).filter(g => g.ownerId === session.factionId).length} <span>→</span></b></button>
        <div className="cities-heading"><h2>城池</h2><select aria-label="城池范围" value={cityScope} onChange={e => setCityScope(e.target.value)}><option value="own">我方领地</option><option value="all">天下诸城</option></select></div>
        <input className="city-search" type="search" aria-label="搜索城池" placeholder="寻一座城…" value={cityQuery} onChange={e => setCityQuery(e.target.value)} />
        <div className="city-list" aria-label="城池列表">{cityList.map(c => { const cs = session.cities[c.id],owner=cityOwnership(scene,session,c.id); return <button key={c.id} aria-pressed={c.id === city.id} onClick={() => setSelected(c.id)}><i style={{ background: owner.color }} /><span className="city-list-name">{c.name}<em>{owner.label} · {owner.name}</em></span><small>{number(cs.troops)} 兵</small></button>; })}{!cityList.length && <p className="empty">没有符合条件的城池</p>}</div>
        <p className="sidebar-note">天下六十城<br />一城一策，步步为营。</p>
      </aside>
      <section className="map-column"><div className="campaign-bar"><div><span className="eyebrow">建业纪年</span><strong>{date.year}<small> 年 </small>{date.month}<small> 月 </small>{date.day}<small> 日</small></strong></div><div className="time-controls"><button aria-pressed={running} disabled={!started||session.policy?.active} onClick={() => setRunning(!running)}>{running ? 'Ⅱ 暂停' : '▶ 推进'}</button><button disabled={!started||session.policy?.active} onClick={() => run({ type: 'advance', days: 1 })}>下一天</button><select aria-label="时间速度" value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value="1">一倍速</option><option value="2">二倍速</option><option value="4">四倍速</option></select></div></div>
        {incoming.length>0&&<section className="invasion-notice" aria-label="敌军来袭"><strong>敌军来袭</strong>{incoming.map(a=><button key={a.id} onClick={()=>setSelected(a.to)}>{scene.factions.find(f=>f.id===a.ownerId)?.name} → {scene.cities.find(c=>c.id===a.to)?.name} · {a.troops}兵 · {a.remainingDays}天后抵达</button>)}</section>}
        <Suspense fallback={<section className="map-shell"><p className="map-loading">正在准备地图…</p></section>}><WorldMap scene={scene} session={session} selected={city.id} onSelect={setSelected} /></Suspense>
        <section className="chronicle"><div className="section-title"><h2>军情纪要</h2><button onClick={() => setPanel('reports')}>战报 {session.reports.length} ↗</button></div><div className="chronicle-items">{session.chronicle.slice(0,4).map(e => <p key={e.id} className={e.kind}><time>第 {e.day} 天</time><span>{e.text}</span></p>)}</div></section>
      </section>
      <aside className="city-panel" aria-label="城池详情"><div className="city-title"><span className="eyebrow">城 池 军 机</span><div><h2>{city.name}</h2><span className="owner-tag" style={{ borderColor: cityOwner?.color }}>{cityOwner?.name ?? '无主之城'}</span></div><p>{isOwn ? '我方领地 · 可下达军令' : state.ownerId ? '他方领地 · 沿道路出征攻取' : '无人据守 · 可派兵进驻'}</p></div>
        <dl className="city-stats"><div><dt>金钱</dt><dd data-testid="city-money">{number(state.money)}<small>金</small></dd></div><div><dt>人口</dt><dd>{number(state.population)}</dd></div><div><dt>城防</dt><dd>{number(state.defense)}</dd></div><div><dt>驻军</dt><dd data-testid="city-troops">{number(state.troops)}<small>人</small></dd></div></dl>
        <div className="city-actions"><button disabled={!started||!isOwn} onClick={()=>setPanel('policy')}>内政经营<small>{session.policy?.active?'议政中':'城务 / 配兵'}</small></button><button className="primary march-action" disabled={!started||!!actionReason||state.troops<1||!adjacentRoads(scene,city.id).some(r=>!r.restricted)} onClick={()=>setPanel('march')}>调兵出征 <span>→</span></button><p>{actionReason||'每年内政，每将一次行动。城内预备兵可随时补充到部队。'}</p></div>
        <section className="officers"><div className="section-title"><h3>驻城武将</h3><span>{stationed.length} 人</span></div><div className="officer-list">{stationed.map(g => <div className="officer" key={g.id}><Portrait small path={g.portrait} name={g.name} /><div><strong>{g.name}</strong><small>武 <b>{g.strength}</b> · 智 {g.intelligence}</small></div><span>{g.unit}<small>体 {session.generals[g.id].hp} · 兵 {session.generals[g.id].troops}</small></span></div>)}{!stationed.length && <p className="empty">城中暂无在任武将</p>}</div></section>
        {session.armies.length > 0 && <section className="marching" aria-label="在途部队"><h3>在途部队</h3>{session.armies.map(a => {
          const ours=a.ownerId===session.factionId,incoming=!ours&&session.cities[a.to].ownerId===session.factionId;
          const owner=scene.factions.find(f=>f.id===a.ownerId)!;
          return <p key={a.id} data-incoming={incoming}><strong>{incoming?'敌军来袭 · ':ours?'我军 · ':'他方 · '}{owner.name}</strong><span>{scene.generals.find(g=>g.id===a.generalIds[0])?.name} → {scene.cities.find(c=>c.id===a.to)?.name}</span><small>{a.troops} 兵 · 还需 {a.remainingDays} 天</small><progress value={a.totalDays-a.remainingDays} max={a.totalDays} aria-label={`${owner.name}军行军进度`}/></p>;
        })}</section>}
      </aside>
    </main>}
    <footer className="statusbar"><span role="status">{message}</span><span>v0.4 · 全屏战场开发版</span></footer>
    <audio ref={audio} loop preload="none" />
    {panel && <Modal key={panel} title={{ new: '择时而起', roster: '群英名册', saves: '军机存档', march: `${city.name} · 调兵出征`, help: '行军用兵 · 先行版说明', reports: '历次战报',policy:'内政经营' }[panel]} wide={panel === 'new' || panel === 'roster' || panel === 'policy'} onClose={() => setPanel(null)}>
      {panel === 'policy' && <PolicyScreen session={session} scene={scene} items={content.items} initialCityId={city.id} onCommand={run} onClose={()=>setPanel(null)}/>}
      {panel === 'new' && <NewGame content={content} onStart={load} replacing={started} />}
      {panel === 'march' && <March session={session} scene={scene} cityId={city.id} onMarch={command => { run(command); setPanel(null); }} />}
      {panel === 'roster' && <Roster scene={scene} session={session} />}
      {panel === 'saves' && <Saves content={content} session={session} onLoad={load} notify={setMessage} />}
      {panel === 'help' && <div className="help"><p className="intro">从一城出发，重走群雄逐鹿之路。</p><ol><li>在「新征程」选择时代和势力。点选地图或左侧列表查看城池。</li><li>新局先处理年度内政：选择武将开发、任命太守或配兵，再点「内政終了」返回征战。每将每年可行动一次，开发不扣金钱；部队从城内预备池补兵。</li><li>选择驻城武将和兵力，沿相邻道路出征。点「下一天」或「推进」让部队行进。</li><li>友城接收增援，无主城归入领地，敌城进入实时战场。结果见军情与战报。</li><li>随时暂停并存档。导出的 JSON 可在其他浏览器导入。</li></ol><h3>当前已接入</h3><p>五个原版剧本、每剧本 60 城 / 401 条武将记录 / 116 条道路、原地图与头像、武将基础属性与装备资料。</p><h3>实时战场</h3><p>点击「演武场」可按武将等级体验步兵对弓兵，「双将演武」可练习轮番出阵；出征敌城抵达后也会进入战场。选择前军、后军或主将下达前进、待命、撤退命令，开战前可布阵。单将败退、撤离或倒计时耗尽收兵后，本将退出交锋；仍有可战武将时继续选将出阵，体力与余兵不会重置。所有交锋结束后统一结算，也可在两阵之间全军收兵。战中可暂停并存档。现役兵与预备兵在开战时共同上场：20级以前现役上限为等级乘5，20级起现役上限100，之后每级增加5名预备兵，40级达到200人。旧版存档中超出统兵上限的兵员暂留营中，战后保留；图像与动画来自原包，攻击触发点来自原始动作脚本，普攻命中、伤害与兵种克制已按原程序规则接入，移动、碰撞和完整阵形仍在校准。每阵战后会累积疲劳，驻城休整可恢复；高疲劳会降低士气，低士气会影响忠诚。军师鼓舞和打击士气只在本阵生效，离间造成的忠诚损失则会保留。武将名册可查看当前状态。</p><h3>尚未复刻</h3><p>完整武将技与军师技效果、俘虏招降、特殊坐骑与历史事件仍在补齐。内政页面已提供开发、搜索人才与宝物、城池自治、太守任命、预备池配兵及报告；物品库可分配装备、使用兵符/阵书/赏赐、替换归库和卸下随身物品。学会新兵种后，可在物品库中选择当前兵种并确认切换，出征部队随之更新。电脑跨年会搜索或开发、追赶经验、均衡经验和换装。完整漏项与验收条件已登记在仓库的一比一复刻总账。其他势力按性格、战况和行动冷却决定进攻、增援或暂不行动；玩家城池遇袭进入守城战，诸侯之间采用后台战斗结算。</p><h3>本版规则</h3><p>新局按武将等级填满现役与预备兵槽，城市预备池初始为0；开发按执行武将武力/智力及太守智力计算收益，人口上限100万，城防上限999，关隘不增加人口。城内会自动花费100金补充一名预备兵，补充速度受人口与城防影响；电脑军团会从预备池补兵。启用年度内政后，非关隘每年收入为人口乘75除10000取整，再加2250金。旧存档可在内政经营中主动切换年度规则。每月 30 天，每年 360 天；行军速度为每日 60 道路单位，至少 2 天。</p><p>上述行军、自动太守接任与年度事件顺序仍含 Web 适配规则，不代表整个游戏已完成还原。战败余部即时返回出发城。保留特殊道路但暂不开放通行。</p><p>地图支持滚轮围绕鼠标缩放、拖动、按钮放大和复位；也可用键盘操作左侧城池列表。音乐需主动开启。</p></div>}
      {panel === 'reports' && <div className="reports"><p className="notice">先行版战报 · 由实时战斗的胜负和实际剩余兵力结算；旧版历史战报保留。</p>{session.reports.map(r => <article key={r.id}><span className={r.won ? 'victory' : 'defeat'}>{r.won ? '捷' : '退'}</span><div><h3>{r.text}</h3><p>第 {r.day} 天 · 出征 {r.attackingTroops} / 守军 {r.defendingTroops} / 我方余兵 {r.survivors}</p></div></article>)}{!session.reports.length && <p className="empty">尚无交战。兵戈未动，先谋后行。</p>}</div>}
    </Modal>}
  </div>;
}
