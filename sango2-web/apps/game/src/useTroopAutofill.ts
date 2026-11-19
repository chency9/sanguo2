import {useEffect,useRef,useState} from 'react';
import type {Command,Session} from '@sango2/core';

type Result={ok:boolean;message:string};
type Pending={cityId:string;generalId:string;maximum:number};

/** The original button starts on event 4; mouse release does not cancel it.
 * One source update adds one soldier. Browser cadence is capped at 60 updates/s;
 * it deliberately does not catch up a hidden tab in a burst. */
export function useTroopAutofill(getSession:()=>Session,onCommand:(command:Command)=>Result) {
  const live=useRef({getSession,onCommand});live.current={getSession,onCommand};
  const pending=useRef<Pending|null>(null),frame=useRef<number|null>(null),last=useRef<number|null>(null);
  const [active,setActive]=useState(false);
  function clear() {
    if(frame.current!==null)cancelAnimationFrame(frame.current);
    frame.current=null;last.current=null;pending.current=null;
  }
  function finish() {
    const job=pending.current;if(!job)return;
    // Clear before dispatch: closing a window or a command must never finish twice.
    clear();setActive(false);
    live.current.onCommand({type:'policy-troops-fill',cityId:job.cityId,generalId:job.generalId,mode:'finish'});
  }
  function update(time:number) {
    frame.current=null;const job=pending.current;if(!job)return;
    const period=1000/60,elapsed=last.current===null?period:time-last.current;
    if(elapsed>=period) {
      last.current=time-elapsed%period;
      const s=live.current.getSession(),g=s.generals[job.generalId],pool=s.nativeAI?.reserves[job.cityId]??0;
      // As in the original, consuming the last soldier leaves the pending flag
      // set until the next update discovers the boundary.
      const count=g?.troopSlots?g.troopSlots.active+g.troopSlots.reserve:g?.troops??0;
      if(!g||pool<=0||count>=job.maximum){finish();return;}
      if(!live.current.onCommand({type:'policy-troops-fill',cityId:job.cityId,generalId:job.generalId,mode:'step'}).ok) {
        clear();setActive(false);return;
      }
    }
    frame.current=requestAnimationFrame(update);
  }
  function start(cityId:string,generalId:string,maximum:number) {
    // Re-activation of the same native button only sets the same flag again.
    if(pending.current?.cityId===cityId&&pending.current.generalId===generalId)return;
    finish();pending.current={cityId,generalId,maximum};setActive(true);
    if(document.hidden||window.matchMedia('(prefers-reduced-motion: reduce)').matches)finish();
    else frame.current=requestAnimationFrame(update);
  }
  const finishRef=useRef(finish);finishRef.current=finish;
  useEffect(()=>{
    const visibility=()=>{if(document.hidden)finishRef.current();};
    const leaving=()=>finishRef.current();
    const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
    const reduce=()=>{if(motion.matches)finishRef.current();};
    document.addEventListener('visibilitychange',visibility);
    window.addEventListener('pagehide',leaving);
    motion.addEventListener('change',reduce);
    return ()=>{
      document.removeEventListener('visibilitychange',visibility);
      window.removeEventListener('pagehide',leaving);
      motion.removeEventListener('change',reduce);
      finishRef.current();
    };
  },[]);
  return {active,start,finish};
}
