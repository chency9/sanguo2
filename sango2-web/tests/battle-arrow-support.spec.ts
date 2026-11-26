import {test,expect,type Page} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import {finishInitialPolicy} from './campaign-fixture';
import manifest from '../packages/core/src/native-magic-manifest.json' with {type:'json'};
import type {BattleState} from '../packages/core/src/battle';

class ArrowBattleScreen {
  constructor(readonly page:Page) {}
  get canvas(){return this.page.getByRole('img',{name:'实时战场画面'});}
  async observeDraws() {
    const atlas=await (await this.page.request.get('/assets/battle/animations.json')).json();
    const rectangles=[10015,...Array.from({length:18},(_,i)=>16001+i)].flatMap(id=>atlas.objects[id].actions.wait.frames.map((f:{key:string})=>({id,...atlas.frames[f.key]})));
    await this.page.addInitScript(({rectangles})=>{
      const state=window as unknown as {arrowDraws:Record<number,number>;arrowBlends:Record<number,string>};state.arrowDraws={};state.arrowBlends={};
      const original=CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage=function(this:CanvasRenderingContext2D,image:CanvasImageSource,...args:number[]) {
        (original as Function).call(this,image,...args);
        if(!(image instanceof HTMLImageElement)||this.canvas.getAttribute('aria-label')!=='实时战场画面')return;
        // Left/right arrow objects share original SHP rectangles. Count
        // every matching source-art alias; saved objects assert identity.
        const sprites=rectangles.filter(r=>image.src.endsWith(`/battle/${r.page}`)&&args[0]===r.x&&args[1]===r.y&&args[2]===r.w&&args[3]===r.h);
        for(const sprite of sprites){state.arrowDraws[sprite.id]=(state.arrowDraws[sprite.id]??0)+1;state.arrowBlends[sprite.id]=this.globalCompositeOperation;}
      } as typeof original;
    },{rectangles});
  }
  async openCampaign(sequence:number) {
    const page=this.page;await this.observeDraws();
    await page.route('**/assets/content.json',async route=>{
      const response=await route.fetch(),content=await response.json();
      for(const scene of content.scenarios) {
        for(const faction of scene.factions)faction.flagNumber=999;
        for(const general of scene.generals) {
          general.level=20;general.skillLearnset=general.ownerId==='f-01'?[{level:1,sequence}]:[];
          general.rawSkill=general.ownerId==='f-01'?`1, ${sequence}`:'';general.mp=150;general.maxMp=150;
          if(general.name==='張角'){const city=scene.cities.find((c:{name:string})=>c.name==='壺關');general.cityId=city.id;general.ownerId=city.ownerId;}
        }
      }
      await route.fulfill({response,json:content});
    });
    await page.goto('/');await page.getByRole('button',{name:/执掌何進/}).click();await finishInitialPolicy(page,true);
    await page.getByRole('button',{name:'调兵出征'}).click();
    const destination=page.getByLabel('行军目标');await destination.selectOption({label:(await destination.getByRole('option').filter({hasText:'壺關'}).textContent())!});
    await page.getByLabel(/出征兵力/).fill('60');await page.getByRole('button',{name:'下令出征'}).click();
    for(let i=0;i<3;i++)await page.getByRole('button',{name:'下一天',exact:true}).click();
    await expect(page.getByRole('heading',{name:'壺關之战'})).toBeVisible();await expect(page.getByRole('button',{name:'擂鼓开战'})).toBeEnabled({timeout:15000});
    await page.getByRole('button',{name:'擂鼓开战'}).click();await page.getByRole('button',{name:'暂停战斗',exact:true}).click();
    await page.getByRole('button',{name:'战中存档'}).click();
    const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'导出当前战役'}).click();
    const path=await (await downloadPromise).path(),value=JSON.parse(await readFile(path!,'utf8')),b=value.session.battle as BattleState;
    let ally=0,enemy=0;const occupied=new Set<string>();
    for(const u of b.units) {
      let x:number,y:number;
      if(u.general){x=u.side==='attacker'?10:45;y=6;}
      else {let index=u.side==='attacker'?ally++:enemy++;x=(u.side==='attacker'?2:40)+Math.floor(index/12);y=1+index%12;
        while(occupied.has(`${x},${y}`)||x===45&&y===6){index=u.side==='attacker'?ally++:enemy++;x=(u.side==='attacker'?2:40)+Math.floor(index/12);y=1+index%12;}}
      occupied.add(`${x},${y}`);u.x=(x+.5)/71*1200;u.y=150+y/13*360;u.target=null;u.order='hold';u.action='wait';u.actionTick=0;u.hit=false;
      u.movement={x,y,previousX:x,previousY:y,px:(x*96+48)*65536,py:(y*72+36)*65536,vx:0,vy:0,remaining:0,facing:u.side==='attacker'?0:0x800000,exiting:false,clock:{decision:1,attack:0,deferred:0,actionAge:0,special:false}};
    }
    for(const side of ['attacker','defender'] as const){b.nativeCommands![side].orders.fill(0);b.nativeCommands![side].flags=0;b.nativeCommands![side].target=null;}
    b.orders={general:'hold',front:'hold',rear:'hold'};b.commanders.attacker.charge=120000;b.opponentAI!.countdown=60;
    await page.getByLabel('导入存档',{exact:true}).setInputFiles({name:'arrow-support-fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
    await expect(page.getByRole('button',{name:'继续战斗',exact:true})).toBeEnabled();
  }
  async snapshot(){return this.canvas.evaluate(n=>({tick:n.dataset.simulationTick,age:n.dataset.magicScriptAge,camera:n.dataset.scriptCamera,objects:n.dataset.arrowSupportObjects,divisor:n.dataset.arrowSupportDivisor,brightness:n.dataset.sceneBrightness,palette:n.dataset.scenePalette}));}
  async draws(id:number){return this.page.evaluate(id=>(window as unknown as {arrowDraws:Record<number,number>}).arrowDraws[id]??0,id);}
}

for(const [sequence,width] of [[30,1440],[45,390]])test(`ArrowSupport${sequence} draws real archers and arrows with point damage and resumable source state at${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:width===390?844:900});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const screen=new ArrowBattleScreen(page);await screen.openCampaign(sequence);
  const before=Number(await page.getByTestId('battle-defender-troops').textContent());
  await page.getByRole('button',{name:new RegExp(manifest.find(m=>m.sequence===sequence)!.name)}).click();
  await expect(screen.canvas).toHaveAttribute('data-magic-script-kind','native-arrow-support');
  await expect(screen.canvas).toHaveAttribute('data-magic-script-phase','darken');
  await page.getByLabel('战场速度').selectOption('1');await page.getByRole('button',{name:'继续战斗',exact:true}).click();
  await expect(screen.canvas).toHaveAttribute('data-scene-palette','12');
  await expect.poll(()=>screen.draws(16002),{timeout:15000}).toBeGreaterThan(0);
  await expect.poll(()=>screen.draws(16003),{timeout:15000}).toBeGreaterThan(0);
  await expect.poll(()=>screen.draws(16007),{timeout:15000}).toBeGreaterThan(0);
  if(sequence===30)await expect.poll(()=>screen.draws(10015),{timeout:15000}).toBeGreaterThan(0);
  else await expect.poll(async()=>Number(await page.getByTestId('battle-defender-troops').textContent()),{timeout:15000}).toBeLessThan(before);
  await page.getByRole('button',{name:'暂停战斗',exact:true}).click();
  expect(Number(await page.getByTestId('battle-defender-troops').textContent())).toBeLessThan(before);
  await expect(screen.canvas).toHaveAttribute('data-camera-owner','script');
  expect(await page.evaluate(()=>(window as unknown as {arrowBlends:Record<number,string>}).arrowBlends[16007])).toBe('source-over');
  if(sequence===30)expect(await page.evaluate(()=>(window as unknown as {arrowBlends:Record<number,string>}).arrowBlends[10015])).toBe('screen');
  const snapshot=await screen.snapshot();expect(await screen.canvas.evaluate(n=>({x:Number(n.dataset.cameraX),y:Number(n.dataset.cameraY)}))).toEqual(JSON.parse(snapshot.camera!));
  await mkdir('../docs/images',{recursive:true});const screenshot=`../docs/images/arrow-support-${sequence}.png`;await page.screenshot({path:screenshot});await testInfo.attach('arrow-support-rendered.png',{path:screenshot,contentType:'image/png'});
  await page.getByRole('button',{name:'战中存档'}).click();
  // The test explicitly owns slot one; the other slots are unrelated.
  await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).first().click();await expect(page.getByRole('dialog').getByRole('status')).toContainText('已保存');
  await page.reload();await page.getByRole('button',{name:'关闭对话框'}).click();await page.getByRole('button',{name:'存读档',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'读取',exact:true}).first().click();await expect(page.getByRole('button',{name:'继续战斗',exact:true})).toBeEnabled();
  expect(await screen.snapshot()).toEqual(snapshot);
  await page.getByLabel('战场速度').selectOption('4');await page.getByRole('button',{name:'继续战斗',exact:true}).click();
  await expect(screen.canvas).toHaveAttribute('data-magic-script-kind','idle',{timeout:20000});await expect(screen.canvas).toHaveAttribute('data-arrow-support-objects','[]');
  await expect(screen.canvas).toHaveAttribute('data-camera-owner','normal');await expect(screen.canvas).toHaveAttribute('data-scene-palette','16');await expect(screen.canvas).toHaveAttribute('data-scene-brightness','16');
  expect(errors).toEqual([]);
});
