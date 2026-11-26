import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {drawNativeBitmapText,loadNativeBitmapFont} from './native-bitmap-font';

/** 0x441134 selects font4 (SANGO.15), inserts two ASCII spaces between a
 * two-character name and uses RGB565 0x7394 for the one-pixel shadow. */
export function NativeBitmapName({name}:{name:string}) {
  const canvas=useRef<HTMLCanvasElement>(null),[ready,setReady]=useState(false),text=name.length===2?`${name[0]}  ${name[1]}`:name;
  const width=[...text].reduce((sum,char)=>sum+(char.charCodeAt(0)<128?8:16),0)+1;
  useEffect(()=>{
    let disposed=false;setReady(false);
    void loadNativeBitmapFont(15).then(font=>{
      const node=canvas.current;if(disposed||!node||[...text].some(char=>!font.characters[char]))return;
      const context=node.getContext('2d')!;context.clearRect(0,0,node.width,node.height);
      drawNativeBitmapText(context,font,text,1,1,'#7371a5');drawNativeBitmapText(context,font,text,0,0,'#fff');setReady(true);
    }).catch(()=>{});
    return()=>{disposed=true;};
  },[text]);
  return <span className="native-bitmap-name" data-font-ready={ready} style={{'--native-name-width':width} as CSSProperties}>
    <canvas ref={canvas} width={width} height="16" aria-hidden="true" hidden={!ready}/><span className={ready?'source-value':undefined}>{name}</span>
  </span>;
}
