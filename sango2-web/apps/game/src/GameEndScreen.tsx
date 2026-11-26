import {useEffect,useRef} from 'react';
import type {Session} from '@sango2/core';
import type {ScenarioDefinition} from '@sango2/content';
import './game-end.css';

export function GameEndScreen({session,scene,onNew,onSave}:{session:Session;scene:ScenarioDefinition;onNew:()=>void;onSave:()=>void}) {
  const heading=useRef<HTMLHeadingElement>(null),won=session.endgame!.result==='victory';
  useEffect(()=>{heading.current?.focus();},[won]);
  return <main className="game-end-screen" aria-labelledby="game-end-heading">
    <img src="/assets/ui/title.png" width="640" height="480" alt=""/>
    <section>
      <p>{scene.title} · {scene.factions.find(f=>f.id===session.factionId)?.name}</p>
      <h1 ref={heading} tabIndex={-1} id="game-end-heading">{won?'一 統 天 下':'霸 業 未 成'}</h1>
      <p>{won?'天下诸侯已尽归一统。':'主公已离开本势力，此局征战结束。'}</p>
      <p>征战 {session.day} 天 · 我方 {Object.values(session.cities).filter(c=>c.ownerId===session.factionId).length} 城</p>
      <nav aria-label="结局菜单"><button type="button" onClick={onSave}>存读档</button><button type="button" onClick={onNew}>再起征程</button></nav>
    </section>
  </main>;
}
