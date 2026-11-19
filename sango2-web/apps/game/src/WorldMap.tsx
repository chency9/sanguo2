import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Application, Assets, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { ScenarioDefinition } from '@sango2/content';
import type { Session } from '@sango2/core';
import { cityOwnership } from './city-ownership';
import './map-ownership.css';

interface Props { scene: ScenarioDefinition; session: Session; selected: string; onSelect: (id: string) => void }
export function WorldMap(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const pointerMoved = useRef(false);
  const latest = useRef(props); latest.current = props;
  const redraw = useRef<() => void>(() => {});
  const camera = useRef<(change: number) => void>(() => {});
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [zoomLabel, setZoomLabel] = useState(100);
  useEffect(() => {
    const node = host.current!;
    let disposed = false, initialized = false, observer: ResizeObserver | undefined;
    const app = new Application();
    let zoom = 1, panX = 0, panY = 0;
    let drag: { x: number; y: number; px: number; py: number } | null = null;
    let moved = false;
    const root = new Container(); const features = new Container();
    const labelLeaders = new Graphics();
    let cityTexture:Texture|undefined,armyTexture:Texture|undefined;
    function layoutLabels() {
      const layer=labels.current;if(!layer||layer.hidden)return;
      const scale=root.scale.x,readableScale=Math.max(.8,Math.min(1,scale));
      layer.style.transform=`translate(${root.x}px,${root.y}px) scale(${scale})`;
      layer.style.setProperty('--label-scale',String(readableScale/scale));
      type Rect={x:number;y:number;w:number;h:number};
      const overlaps=(a:Rect,b:Rect)=>a.x<b.x+b.w+3&&a.x+a.w+3>b.x&&a.y<b.y+b.h+3&&a.y+a.h+3>b.y;
      const {scene,session,selected}=latest.current;
      const placed:Rect[]=[];
      const cities=[...scene.cities].sort((a,b)=>{
        const priority=(id:string)=>id===selected?0:session.cities[id].ownerId===session.factionId?1:2;
        return priority(a.id)-priority(b.id);
      });
      const elements=new Map([...layer.querySelectorAll<HTMLButtonElement>('button')].map(el=>[el.dataset.cityId,el]));
      labelLeaders.clear();
      for(const city of cities) {
        const el=elements.get(city.id);if(!el)continue;
        const x=city.position[0]*scale,y=city.position[1]*scale;
        const w=el.offsetWidth*readableScale,h=el.offsetHeight*readableScale;
        const candidates=[{x:x-w/2,y:y+14*scale},{x:x-w/2,y:y-15*scale-h},
          {x:x+19*scale,y:y-h/2},{x:x-19*scale-w,y:y-h/2}];
        const candidate=candidates.find(p=>!placed.some(r=>overlaps({...p,w,h},r))&&!scene.cities.some(other=>
          other.id!==city.id&&overlaps({...p,w,h},{x:other.position[0]*scale-12*scale,y:other.position[1]*scale-10*scale,w:24*scale,h:20*scale})));
        // At overview scale, omit colliding text; the clickable city emblem stays.
        // Zooming exposes labels again, and selecting any emblem always exposes its name/owner.
        const visible=!!candidate||city.id===selected;
        el.style.visibility=visible?'visible':'hidden';
        if(!visible)continue;
        const p=candidate??candidates[0];placed.push({...p,w,h});
        el.style.left=`${(p.x+w/2)/scale}px`;el.style.top=`${p.y/scale}px`;
        if(p!==candidates[0]) {
          const endX=Math.max(p.x,Math.min(p.x+w,x)),endY=Math.max(p.y,Math.min(p.y+h,y));
          labelLeaders.moveTo(...city.position).lineTo(endX/scale,endY/scale).stroke({color:'#fff1c5',width:1/scale,alpha:.65});
        }
      }
    }
    const fit = () => {
      if (!initialized || disposed) return;
      const w = node.clientWidth, h = node.clientHeight;
      app.renderer.resize(w, h);
      const scale = Math.min(w / 1280, h / 960) * zoom;
      const limitX = Math.max(0, (1280 * scale - w) / 2 + 32);
      const limitY = Math.max(0, (960 * scale - h) / 2 + 32);
      panX = Math.max(-limitX, Math.min(limitX, panX));
      panY = Math.max(-limitY, Math.min(limitY, panY));
      root.scale.set(scale); root.position.set((w - 1280 * scale) / 2 + panX, (h - 960 * scale) / 2 + panY);
      layoutLabels();app.render();
    };
    const down = (e: PointerEvent) => { if (e.button !== 0) return; moved = false; pointerMoved.current=false; drag = { x: e.clientX, y: e.clientY, px: panX, py: panY }; };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) moved = pointerMoved.current = true;
      if (moved) { panX = drag.px + e.clientX - drag.x; panY = drag.py + e.clientY - drag.y; fit(); }
    };
    const up = () => { drag = null; };
    const zoomAt = (next: number, x = node.clientWidth / 2, y = node.clientHeight / 2) => {
      if (!initialized || disposed) return;
      const oldScale = root.scale.x;
      const worldX = (x - root.x) / oldScale, worldY = (y - root.y) / oldScale;
      zoom = Math.max(1, Math.min(4, next));
      const scale = Math.min(node.clientWidth / 1280, node.clientHeight / 960) * zoom;
      panX = x - worldX * scale - (node.clientWidth - 1280 * scale) / 2;
      panY = y - worldY * scale - (node.clientHeight - 960 * scale) / 2;
      fit(); setZoomLabel(Math.round(zoom * 100));
    };
    const wheel = (event: WheelEvent) => {
      // Preserve browser Ctrl+wheel zoom; ordinary wheel zoom is scoped to the map.
      if (event.ctrlKey || !initialized) return;
      event.preventDefault(); drag = null;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1);
      const rect = node.getBoundingClientRect();
      zoomAt(zoom * Math.exp(-Math.max(-600, Math.min(600, delta)) * .0015), event.clientX - rect.left, event.clientY - rect.top);
    };
    const paint = () => {
      if (!initialized || disposed) return;
      features.removeChildren().forEach(child => child.destroy({ children: true }));
      const { scene, session, selected, onSelect } = latest.current;
      const routes = new Graphics();
      for (const road of scene.roads) {
        if (road.restricted) continue;
        const adjacent = road.from === selected || road.to === selected;
        routes.moveTo(...road.points[0]);
        road.points.slice(1).forEach(p => routes.lineTo(...p));
        routes.stroke({ color: adjacent ? '#ffe1a0' : '#eee2ba', width: adjacent ? 3.2 : 1.4, alpha: adjacent ? 0.9 : 0.25 });
      }
      features.addChild(routes);
      for (const city of scene.cities) {
        const owner = cityOwnership(scene,session,city.id);
        const active = city.id === selected;
        const mark = new Container(); mark.position.set(...city.position);
        mark.eventMode = 'static'; mark.cursor = 'pointer';
        const dot = new Graphics();
        if(owner.relation==='own') {
          dot.ellipse(0,3,22,12).fill({color:owner.color,alpha:.4}).stroke({color:'#ffe49a',width:2});
          dot.ellipse(0,3,26,16).stroke({color:owner.color,width:2});
        } else if(owner.relation==='neutral') dot.poly([-20,2,0,-12,20,2,0,16]).stroke({color:'#c8d0cf',width:2});
        else dot.ellipse(0,3,22,12).fill({color:owner.color,alpha:.45}).stroke({color:owner.color,width:2});
        if (active) dot.circle(0, 0, 30).stroke({ color: '#fff1b1', width: 3 });
        if(owner.relation!=='neutral') {
          dot.moveTo(12,3).lineTo(12,-26).stroke({color:'#221509',width:3});
          dot.poly([12,-26,34,-23,31,-10,12,-12]).fill(owner.color).stroke({color:'#251a13',width:2});
        }
        mark.addChild(dot);
        if(cityTexture){const icon=new Sprite(cityTexture);icon.anchor.set(.5,.5);icon.width=28;icon.height=24;if(owner.relation==='neutral'){icon.tint='#a4aaa5';icon.alpha=.65;}mark.addChild(icon);}
        mark.on('pointertap', () => { if (!moved) onSelect(city.id); });
        features.addChild(mark);
      }
      for (const army of session.armies) {
        const road = scene.roads.find(r => r.id === army.roadId)!;
        const points = road.from === army.from ? road.points : [...road.points].reverse();
        const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
        let distance = lengths.reduce((a,b) => a+b, 0) * (1 - army.remainingDays / army.totalDays);
        let x = points[0][0], y = points[0][1];
        for (let i = 0; i < lengths.length; i++) {
          const t = lengths[i] ? Math.min(1, distance / lengths[i]) : 1;
          x = points[i][0] + (points[i+1][0]-points[i][0])*t; y = points[i][1] + (points[i+1][1]-points[i][1])*t;
          if (distance <= lengths[i]) break; distance -= lengths[i];
        }
        const flag = new Graphics().moveTo(x, y+9).lineTo(x,y-16).stroke({ color: '#fff3c7', width: 3 }).poly([x,y-16,x+18,y-10,x,y-4]).fill(scene.factions.find(f=>f.id===army.ownerId)?.color??'#bd5546');
        features.addChild(flag);
        if(armyTexture){const sprite=new Sprite(armyTexture);sprite.anchor.set(.5,1);sprite.position.set(x,y+10);sprite.scale.set(.65);features.addChild(sprite);}
      }
      layoutLabels();app.render();
    };
    redraw.current = paint;
    camera.current = change => { if (change) zoomAt(zoom + change); else { zoom = 1; panX = 0; panY = 0; fit(); setZoomLabel(100); } };
    async function init() {
      try {
        await app.init({ width: node.clientWidth, height: node.clientHeight, background: '#182c35', antialias: true, resolution: Math.min(devicePixelRatio, 2), autoDensity: true, preference: 'webgl', autoStart: false });
        if (disposed) { app.destroy(true, { children: true }); return; }
        initialized = true;
        node.appendChild(app.canvas); app.canvas.setAttribute('aria-hidden', 'true');
        const [texture,cityArt,armyArt] = await Promise.all([Assets.load('/assets/world-map.png'),Assets.load('/assets/city-1.png'),Assets.load('/assets/march/1.png')]);
        if (disposed) return;
        cityTexture=cityArt;armyTexture=armyArt;
        const terrain = new Sprite(texture); terrain.width = 1280; terrain.height = 960;
        root.addChild(terrain, new Graphics().rect(0,0,1280,960).fill({ color: '#182c35', alpha: 0.22 }), labelLeaders, features);
        app.stage.addChild(root); fit(); paint(); setReady(true);
        observer = new ResizeObserver(() => { fit(); app.render(); }); observer.observe(node);
        node.addEventListener('wheel', wheel, { passive: false });
        node.addEventListener('pointerdown', down); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up); window.addEventListener('blur', up);
      } catch (e) { if (!disposed) setError(`地图加载失败：${e instanceof Error ? e.message : '渲染器不可用'}。仍可通过城池列表操作。`); }
    }
    void init();
    return () => {
      disposed = true; observer?.disconnect(); redraw.current = () => {}; camera.current = () => {};
      node.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      node.removeEventListener('wheel', wheel); window.removeEventListener('pointercancel', up); window.removeEventListener('blur', up);
      if (initialized) app.destroy(true, { children: true });
    };
  }, []);
  useEffect(() => redraw.current(), [props.scene, props.session, props.selected,ready]);
  const holdings=props.scene.factions.map(f=>({...f,count:props.scene.cities.filter(c=>props.session.cities[c.id].ownerId===f.id).length})).filter(f=>f.count>0);
  const emptyCount=props.scene.cities.filter(c=>!props.session.cities[c.id].ownerId).length;
  return <section className="map-shell" aria-label="天下地图">
    <div className="map-host" ref={host}><div className="map-city-labels" ref={labels} hidden={!ready}>{props.scene.cities.map(city=>{
      const owner=cityOwnership(props.scene,props.session,city.id);
      return <button type="button" key={city.id} className="map-city-label" data-city-id={city.id} data-relation={owner.relation}
        style={{left:city.position[0],top:city.position[1]+13,'--faction-color':owner.color} as CSSProperties}
        aria-label={`${city.name} · ${owner.label} · ${owner.name}`} aria-pressed={city.id===props.selected}
        onClick={e=>{if(e.detail===0||!pointerMoved.current)props.onSelect(city.id);}}>
        <strong>{city.name}</strong><span className="map-city-owner">{owner.badge}</span>
      </button>;
    })}</div></div>
    {!ready && !error && <div className="map-loading">正在展开山河图…</div>}
    {error && <p className="map-error" role="alert">{error}</p>}
    <div className="map-caption"><strong>天下形势</strong><small>滚轮缩放 · 拖动地图 · 点选城池</small><small>放大可展开密集城池标识</small></div>
    <div className="map-tools"><button onClick={() => camera.current(.35)} aria-label="放大地图">＋</button><button onClick={() => camera.current(-.35)} aria-label="缩小地图">−</button><button onClick={() => camera.current(0)}>全图</button></div>
    <details className="map-factions"><summary>势力图例</summary><ul>{holdings.map(f=><li key={f.id}><i style={{background:f.color}}/><span>{f.id===props.session.factionId?'我方 · ':''}{f.name}</span><b>{f.count}城</b></li>)}<li><i className="neutral"/><span>空城 · 无主</span><b>{emptyCount}城</b></li></ul></details>
    <div className="map-key"><span>◎ 我方</span><span>● 他方 · 标注势力名</span><span>◇ 空城 · 无主</span><output aria-label="地图缩放比例" aria-live="off">{zoomLabel}%</output></div>
  </section>;
}
