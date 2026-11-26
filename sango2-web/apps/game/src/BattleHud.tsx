import type { CSSProperties } from 'react';
import { battleGeneral, battleSurvivors, battleFieldTroops, battleRemainingUpdates, nativeCountdown, CHARGE_LIMIT, INITIAL_CHARGE, nativeGaugeWidth, battleMovementCell, type BattleState } from '@sango2/core';
import {battleScenePoints,nativeClampCamera,type NativeCamera} from '@sango2/core';
import {NativeBitmapName} from './NativeBitmapName';

const troopIcon=(unit:string)=>({'刀':1,'槍':2,'關':3,'大':3,'弓':4,'鏈':5,'鍊':5,'飛':6,'武':7,'蠻':8,'鐵':9,'籐':10,'賊':11,'黃':11,'弩':12,'女':13}[unit[0]]);

/** FONTS06: 5×7 WS; FONTS07: 6×9 WB. Keep real text for assistive tech. */
function SourceNumber({text,small=false}:{text:string;small?:boolean}) {
  return <><span className="source-value">{text}</span><span className={`source-digits ${small?'small':''}`} aria-hidden="true">{[...text].map((char,i)=>/[/0-9]/.test(char)
    ?<img key={i} alt="" src={`/assets/ui/fonts/${small?'ws':'wb'}-${char.charCodeAt(0)}.png`}/>
    :<span key={i}>{char}</span>)}</span></>;
}

/** Static EXE 0x441212 / 0x440F59: 640x480 HUD starts at y=344.
 * Responsive scaling remains a Web adaptation, not a runtime pixel comparison. */
function VitalGauge({name,value,maximum,kind,side}:{name:string;value:number;maximum:number;kind:'hp'|'mp';side:'attacker'|'defender'}) {
  const {track,fill}=nativeGaugeWidth(maximum,value),right=side==='defender';
  const style={'--track':track,'--fill':fill} as CSSProperties;
  return <div className={`source-vital source-${kind}-gauge`} style={style} role="meter" aria-label={`${name}${kind==='hp'?'体力':'技力'}`} aria-valuemin={0} aria-valuemax={Math.max(1,maximum)} aria-valuenow={value} aria-valuetext={`${value} / ${maximum}`}>
    <img className="vital-frame" alt="" src={`/assets/ui/${right?'war06':'war05'}.png`}/>
    <div className="vital-clip"><img alt="" src={`/assets/ui/${right?(kind==='hp'?'war04':'war03'):(kind==='hp'?'war02':'war01')}.png`}/></div>
    {!right&&<img className="vital-cap" alt="" src="/assets/ui/war07.png"/>}
  </div>;
}
export function BattleHud({battle:b,onLocate,camera}:{battle:BattleState;onLocate?:(x:number,y:number)=>void;camera?:NativeCamera}) {
  const countdown=nativeCountdown(battleRemainingUpdates(b));
  const points=battleScenePoints(b),native=b.deploymentRules==='native-tables-v1';
  const cameraX=Math.max(3,Math.min(67,Math.trunc((camera?.x??4000)/96))),cameraY=Math.max(3,Math.min(10,Math.trunc((camera?.y??339)/72)+2));
  return <section className="battle-hud" aria-label="双方战况"><div className="source-hud">
    {(['attacker','defender'] as const).map(side=>{
      const c=b.commanders[side],g=battleGeneral(b,side),troops=b.troopDeployment?battleFieldTroops(b,side):battleSurvivors(b,side),charge=c.charge??INITIAL_CHARGE;
      const chargePixels=Math.trunc(132*charge/CHARGE_LIMIT);
      // 0x441212: right fill excludes the 29-pixel hilt. SHP anchor is x=161.
      const chargeClip=chargePixels<=0?'inset(100%)':side==='attacker'
        ?`inset(0 ${(162-29-chargePixels)/162*100}% 10% 0)`
        :`inset(0 ${30/162*100}% 10% ${(132-chargePixels)/162*100}%)`;
      return <div className={`source-combatant ${side}`} key={side}>
        <img className="source-portrait" src={`/assets/${c.portrait}`} alt={c.name} width="100" height="120"/>
        <img className="source-portrait-frame" src="/assets/ui/war08.png" alt="" width="100" height="120"/>
        <h2 className="source-name" data-short={c.name.length===2} data-long={c.name.length===4}><NativeBitmapName name={c.name}/></h2>
        <span className="source-level" data-testid={`battle-${side}-level`}><span className="source-value">等级 </span><SourceNumber text={c.level===undefined?'—':String(c.level).padStart(2,'0')}/></span>
        <div className="source-sword" data-full={charge===CHARGE_LIMIT}>
          <progress className="source-value" aria-label={`${c.name}集气`} value={charge} max={CHARGE_LIMIT}/>
          <img alt="" src={`/assets/ui/${side==='attacker'?'war0a':'war0c'}.png`}/>
          <img alt="" src={`/assets/ui/${side==='attacker'?'war09':'war0b'}.png`} style={{clipPath:chargeClip}}/>
        </div>
        <VitalGauge name={c.name} value={g.hp} maximum={g.maxHp} kind="hp" side={side}/>
        <VitalGauge name={c.name} value={c.mp} maximum={c.maxMp??c.mp} kind="mp" side={side}/>
        <span className="source-hp"><SourceNumber small text={`${Math.ceil(g.hp)}/${g.maxHp}`}/></span>
        <span className="source-mp"><SourceNumber small text={`${c.mp}/${c.maxMp??c.mp}`}/></span>
        <span className="source-strength"><span className="source-value">武力 </span><SourceNumber text={String(c.strength).padStart(3,' ')}/></span>
        <span className="source-intelligence"><span className="source-value">智力 </span><SourceNumber text={String(c.intelligence).padStart(3,' ')}/></span>
        <span className="source-unit">{troopIcon(c.unit)?<img src={`/assets/ui/force${String(troopIcon(c.unit)).padStart(2,'0')}.png`} alt={`${c.unit}兵`}/>:c.unit}</span>
        <span className="source-troops"><b data-testid={`battle-${side}-troops`}><SourceNumber text={String(troops)}/></b><small> / {b.troopDeployment?b.troopDeployment[side].active+b.troopDeployment[side].reserve:b.initial[side]} 兵</small></span>
      </div>;
    })}
    <div className="battle-clock" role="timer" aria-label="交战倒计时" aria-live="off" data-count={countdown.count} style={{'--clock-x':countdown.x,'--clock-width':countdown.glyphs.length*19} as CSSProperties}>
      <span className="source-value">{countdown.count}</span><div className="source-clock-digits" aria-hidden="true">{countdown.glyphs.map((code,i)=><img key={i} alt="" src={`/assets/ui/fonts/tnum-${code}.png`}/>)}</div>
    </div>
    <svg className="source-minimap" viewBox="0 0 142 28" role="img" aria-label="战场兵力分布" shapeRendering="crispEdges"
      onClick={e=>{if(!native||!onLocate)return;const r=e.currentTarget.getBoundingClientRect(),x=Math.floor((e.clientX-r.left)/r.width*71),y=Math.floor((r.bottom-e.clientY)/r.height*14)-2;const c=nativeClampCamera({x:96*x+48,y:72*y+36});onLocate(c.x,c.y);}}>
      <title>绿色为我军，红色为敌军，白色为主将，黄色框为镜头；点击定位，或用战场方向键移动。</title>
      <rect width="142" height="28" fill="#000"/>
      {b.units.filter(u=>u.hp>0&&!u.escaped&&!u.movement?.exiting).map(u=><rect key={u.id}
        x={native?(u.movement?.x??Math.trunc(points.get(u.id)!.x/65536/96))*2:battleMovementCell(u).x*2}
        y={native?26-(u.movement?.y??Math.trunc(points.get(u.id)!.y/65536/72))*2:battleMovementCell(u).y*2}
        width="2" height="2" fill={native&&u.general?'#ffffff':u.side==='attacker'?'#00ff00':'#ff0000'}/>)}
      {native&&<path d={`M ${(cameraX-3)*2} ${26-(cameraY+3)*2} h 14 v 14 h -14 Z`} fill="none" stroke="#ffe000" strokeWidth="1" pointerEvents="none"/>}
    </svg>
    <p className="source-message" aria-live="polite">第 {b.round} 阵 · {b.log[0]}</p>
  </div></section>;
}
