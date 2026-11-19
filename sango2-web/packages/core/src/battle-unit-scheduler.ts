import type {BattleState,BattleUnit} from './battle';
import {battleMovementCell,planBattleMovement,type BattleYieldContext} from './battle-movement';
import {nativeUnitDecision,nativeSearchTarget,nativePrepareAttack} from './native-unit-clock';
import {nativeGridIndex} from './native-battle-grid';
import {nativeMovementRange} from './native-movement';
import {battleAttackAction} from './native-attack-animation';
import {launchBattleProjectile,advanceBattleProjectiles} from './battle-projectiles';

export interface BattleUnitCallbacks {
  sourceStep?:()=>void;
  unitType:(u:BattleUnit)=>number;
  hit:(u:BattleUnit,target:BattleUnit,forced:boolean,projectile:boolean)=>boolean|void;
  escaped:(u:BattleUnit)=>void;
}
/** Per-source-update unit clock/target adapter. Global AI, effects and casualty
 * lists still run in the outer three-update group; non-attack animations,
 * mixed object ordering and general movement-speed stats remain parity work. */
export function updateBattleUnits(b:BattleState,callbacks:BattleUnitCallbacks):void {
  for(let step=0;step<3&&b.phase==='fighting';step++) {
    callbacks.sourceStep?.();
    const tick=(b.tick-1)*3+step+1,active=new Set<number>();
    const context:BattleYieldContext={tick,active,update};
    function update(u:BattleUnit):void {
      const m=u.movement;
      if(b.phase!=='fighting'||!m||u.hp<=0||u.escaped||m.updatedAt===tick||active.has(u.id))return;
      const c=m.clock!;active.add(u.id);
      try {
        if(m.exiting) {
          integrate(u);if(m.remaining===0){u.escaped=true;callbacks.escaped(u);}return;
        }
        if(u.status&&u.status.until>b.tick) {
          m.vx=0;m.vy=0;u.action='wait';u.actionTick=0;u.target=null;c.actionAge=0;return;
        }
        // General speed is not yet exposed by content/SAV conversion. Equal
        // speeds are an explicit adapter, never fabricated officer statistics.
        const result=nativeUnitDecision(c,{general:u.general,retreat:u.order==='retreat',speed:0,enemySpeed:0});
        if(result.stopped){m.vx=0;m.vy=0;u.action='wait';c.actionAge=0;}
        if(result.ready) {
          m.previousX=m.x;m.previousY=m.y;
          const occupants=new Map<number,BattleUnit>();
          for(const other of b.units)if(other.hp>0&&!other.escaped&&!other.movement?.exiting) {
            const cell=battleMovementCell(other);occupants.set(nativeGridIndex(cell.x,cell.y),other);
          }
          const input={x:m.x,y:m.y,unit:callbacks.unitType(u),general:u.general,reserve:u.nativeReserve===true,retreat:u.order==='retreat',facing:m.facing};
          const distance=nativeSearchTarget(c,input,b.opponentAI!.rng,(x,y)=>{
            const other=occupants.get(nativeGridIndex(x,y));return other?(other.side===u.side?'ally':'enemy'):undefined;
          });
          const attack=nativePrepareAttack(c,input,distance,b.opponentAI!.rng);
          const target=attack.attack?occupants.get(nativeGridIndex(m.x+distance,m.y)):undefined;
          if(target) {
            // 0x43CCE3 / 0x43C1E7: center the event and stop its velocity.
            m.px=(96*m.x+48)*65536;m.py=(72*m.y+36)*65536;m.vx=0;m.vy=0;m.remaining=0;
            m.facing=distance>0?0:0x800000;u.action='attack';u.target=target.id;u.hit=false;c.actionAge=0;c.special=attack.special;
            if(b.attackRules)c.attackEvent=0;
          } else {
            let nearest:BattleUnit|undefined,best=Infinity;
            for(const other of b.units)if(other.side!==u.side&&other.hp>0&&!other.escaped) {
              const cell=battleMovementCell(other),d=(cell.x-m.x)**2+(cell.y-m.y)**2;
              if(d<best){best=d;nearest=other;}
            }
            const before=u.action;planBattleMovement(b,u,nearest,input.unit,context);
            if(before!==u.action)c.actionAge=0;u.target=null;
          }
        } else integrate(u);
        c.actionAge++;
        if(u.action==='attack') {
          const appearance=b.commanders[u.side].appearance;
          const timing=appearance?.[u.general?'generalAttack':u.nativeReserve?'reserveSoldierAttack':'soldierAttack']??appearance?.soldierAttack;
          const native=battleAttackAction(b,u)?.timing;
          // The original parser attaches messages to a node, and its stepper
          // fires them on entry. Persist the event cursor for save/resume.
          const due=native?native.hitTicks.slice(c.attackEvent??0).filter(t=>t<=c.actionAge).length:
            !u.hit&&c.actionAge>=Math.max(1,timing?.hitTick??21)?1:0;
          for(let event=0;event<due;event++) {
            if(native)c.attackEvent=(c.attackEvent??0)+1;
            u.hit=true;
            const direction=m.facing?-1:1;
            const at=(distance:number)=>b.units.find(other=>other.hp>0&&!other.escaped&&!other.movement?.exiting&&battleMovementCell(other).x===m.x+direction*distance&&battleMovementCell(other).y===m.y);
            // 0x43D686/0x43D76C re-read the adjacent cell at the hit event.
            let target=at(1),projectile=false;
            if(!target&&u.general){const second=at(2);if(second?.general&&second.order==='retreat')target=second;}
            else if(!target&&nativeMovementRange(callbacks.unitType(u),u.nativeReserve===true,u.general)>1) {
              if(b.projectileRules){launchBattleProjectile(b,u,callbacks.unitType(u),tick);continue;}
              // Legacy snapshots keep their immediate damage adapter.
              target=b.units.find(other=>other.id===u.target&&other.hp>0&&!other.escaped);projectile=true;
            }
            if(target&&target.side!==u.side)callbacks.hit(u,target,!u.general&&!projectile&&c.special&&nativeMovementRange(callbacks.unitType(u),u.nativeReserve===true)<=1,projectile);
          }
          if(c.actionAge>=(native?.ticks??timing?.ticks??60)){u.action='wait';c.actionAge=0;u.target=null;}
        }
        u.actionTick=Math.floor(c.actionAge/3);
      } finally {m.updatedAt=tick;active.delete(u.id);}
    }
    function integrate(u:BattleUnit) {
      const m=u.movement!;
      m.px=(m.px+m.vx)|0;m.py=(m.py+m.vy)|0;m.remaining=Math.max(0,m.remaining-1);
      // Keep held artwork fixed unless its source event actually moves.
      // Preserve the saved display-spacing offset. Resetting it on every
      // source update repeatedly packs the same actors back into narrow cells.
      if(m.vx||m.vy){u.x+=m.vx/65536/96/71*1200;u.y+=m.vy/65536/72/13*360;}
    }
    for(const u of b.units)update(u);
    if(b.phase==='fighting')advanceBattleProjectiles(b,(u,target)=>callbacks.hit(u,target,false,false)===true);
  }
  // Existing corpse fade is grouped and independent of source attack clocks.
  for(const u of b.units)if(u.hp<=0)u.actionTick++;
}
