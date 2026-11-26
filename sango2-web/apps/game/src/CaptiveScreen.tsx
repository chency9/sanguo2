import {useEffect,useRef,useState} from 'react';
import type {ScenarioDefinition} from '@sango2/content';
import {officerLevel,officerMaxHp,officerMaxMp,type Session} from '@sango2/core';
import './captives.css';

interface Props {
  session:Session;scene:ScenarioDefinition;
  onChoice:(choice:'yield'|'kill'|'free')=>{ok:boolean;message:string};
  onSave:()=>void;
  onScriptTick:()=>void;onDialogueNext:()=>void;blocked:boolean;
}

/** Native YIELD/D8_A/D8_B artwork and 640×480 panel coordinates. The
 * simulation owns the prepared persuasion result, including across reloads. */
export function CaptiveScreen({session,scene,onChoice,onSave,onScriptTick,onDialogueNext,blocked}:Props) {
  const pending=session.pendingCaptive!,current=pending.current;
  const def=scene.generals.find(g=>g.id===current.id)!,stored=session.generals[current.id];
  const commander=session.battle!.rosters[pending.side][current.index].commander;
  const state={...stored,hp:commander.hp,mp:commander.mp,loyalty:commander.loyalty??stored.loyalty,
    fatigue:commander.fatigue??stored.fatigue,morale:commander.morale??stored.morale};
  const heading=useRef<HTMLHeadingElement>(null),[message,setMessage]=useState('');
  useEffect(()=>{setMessage('');heading.current?.focus();},[current.id]);
  const remaining=session.battle!.rosters[pending.side].filter(member=>member.battleStatus===3).length;
  const ruler=scene.factions.find(f=>f.leaderId===def.id&&f.id===state.ownerId);
  const script=pending.script,dialogue=script?.dialogue,dialogueButton=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!script||script.phase==='dialogue'||blocked)return;
    const timer=window.setInterval(onScriptTick,1000/60);return()=>clearInterval(timer);
  },[!!script,script?.phase,blocked]);
  useEffect(()=>{if(dialogue)dialogueButton.current?.focus();},[dialogue?.messageId,dialogue?.speakerId]);
  function choose(choice:'yield'|'kill'|'free') {const result=onChoice(choice);setMessage(result.ok?'':result.message);}
  return <main className="captive-screen" aria-labelledby="captive-heading">
    <div className="captive-stage">
      <img className="captive-background" src="/assets/ui/captives.png" width="640" height="480" alt="军营中候命的将士与营帐"/>
      <h1 id="captive-heading" ref={heading} tabIndex={-1} className="visually-hidden">武将招降 · {def.name}</h1>
      <section className="captive-choices" aria-label="处置俘虏">
        <img src="/assets/ui/captive-panel-a.png" width="112" height="138" alt="武将招降"/>
        <button type="button" disabled={!!script} onClick={()=>choose('yield')}>招 降</button>
        <button type="button" disabled={!!script} onClick={()=>choose('kill')}>斬 首</button>
        <button type="button" disabled={!!script} onClick={()=>choose('free')}>釋 放</button>
      </section>
      {dialogue&&<section className="captive-dialogue" aria-label="俘将对白">
        <img src={`/assets/${scene.generals.find(g=>g.id===dialogue.speakerId)?.portrait??def.portrait}`} width="100" height="120" alt={scene.generals.find(g=>g.id===dialogue.speakerId)?.name??def.name}/>
        <div><h2>{scene.generals.find(g=>g.id===dialogue.speakerId)?.name??def.name}</h2><p role="status">{dialogue.text}</p>
          <button type="button" ref={dialogueButton} onClick={onDialogueNext}>继续对白</button></div>
      </section>}
      <section className="captive-profile" aria-label={`${def.name}的资料`}>
        <img className="captive-panel" src="/assets/ui/captive-panel-b.png" width="226" height="432" alt=""/>
        <img className="captive-portrait" src={`/assets/${def.portrait}`} width="100" height="120" alt={def.name}/>
        <div className="captive-details">
          <h2>{def.name}{ruler&&<small>君主</small>}</h2>
          <dl>
            <div><dt>忠誠</dt><dd>{ruler?'—':state.loyalty??def.loyalty}</dd></div>
            <div><dt>等級</dt><dd>{officerLevel(state,def)}</dd></div>
            <div><dt>武力</dt><dd>{commander.strength}</dd></div>
            <div><dt>智力</dt><dd>{commander.intelligence}</dd></div>
            <div><dt>士氣</dt><dd>{state.morale??80}</dd></div>
            <div><dt>疲勞</dt><dd>{state.fatigue??0}</dd></div>
            <div><dt>體力</dt><dd>{state.hp}/{officerMaxHp(state,def)}</dd></div>
            <div><dt>技力</dt><dd>{state.mp}/{officerMaxMp(state,def)}</dd></div>
          </dl>
          <p className="captive-result" role="status">{message||(!script&&session.chronicle[0]?.text.includes(`${def.name}不肯归降`)?session.chronicle[0].text:`尚有 ${remaining} 将候审`)}</p>
        </div>
      </section>
    </div>
    <nav className="captive-toolbar" aria-label="战后菜单"><span>战后处置</span><button type="button" onClick={onSave}>存读档</button></nav>
  </main>;
}
