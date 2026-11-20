import {finishInitialPolicy} from './campaign-fixture';
import {test,expect,type Page} from '@playwright/test';
import manifest from '../packages/core/src/native-magic-manifest.json' with {type:'json'};
import {readFile} from 'node:fs/promises';
import type {BattleState} from '../packages/core/src/battle';

class NativeMagicScreen {
  constructor(readonly page:Page) {}
  get canvas(){return this.page.getByRole('img',{name:'实时战场画面'});}
  async observeMagicDraws() {
    const page=this.page;
    const response=await page.request.get('/assets/battle/animations.json'),atlas=await response.json();
    const rectangles=[13001,13003,13005,26001,26002,26004,26005,18002,18003,18004,10016].flatMap(id=>atlas.objects[id].actions.wait.frames.map((frame:{key:string})=>({id,...atlas.frames[frame.key]})));
    await page.addInitScript(({rectangles})=>{
      const state=window as unknown as {nativeMagicDraws:Record<string,number>;nativeMagicBlends:Record<string,string>};state.nativeMagicDraws={};state.nativeMagicBlends={};
      const original=CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage=function(this:CanvasRenderingContext2D,image:CanvasImageSource,...args:number[]) {
        (original as Function).call(this,image,...args);
        if(!(image instanceof HTMLImageElement)||this.canvas.getAttribute('aria-label')!=='实时战场画面')return;
        const sprite=rectangles.find(r=>image.src.endsWith(`/battle/${r.page}`)&&args[0]===r.x&&args[1]===r.y&&args[2]===r.w&&args[3]===r.h);
        if(sprite){state.nativeMagicDraws[sprite.id]=(state.nativeMagicDraws[sprite.id]??0)+1;state.nativeMagicBlends[sprite.id]=this.globalCompositeOperation;}
      } as typeof original;
    },{rectangles});
  }
  async open(sequence:number, levels?:{attacker:number;defender:number;chargeIntelligence?:number;meleeDefender?:boolean}) {
    const page=this.page;
    await page.route('**/assets/content.json',async route=>{
      const response=await route.fetch(),content=await response.json();
      const generals=content.scenarios[0].generals;
      const caster=generals.find((g:{name:string})=>g.name==='曹操');
      caster.skillLearnset=[{level:1,sequence}];caster.rawSkill=`1, ${sequence}`;caster.mp=150;caster.maxMp=150;
      const defender=generals.find((g:{name:string})=>g.name==='張角');
      defender.skillLearnset=[];
      if(levels){caster.level=levels.attacker;defender.level=levels.defender;if(levels.chargeIntelligence)caster.intelligence=levels.chargeIntelligence;}
      if(levels?.meleeDefender)for(const general of generals)if(general.unit==='弓'&&general.appearance)general.appearance.soldier=100;
      await route.fulfill({response,json:content});
    });
    await this.observeMagicDraws();
    await page.goto('/');await page.getByRole('button',{name:/执掌何進/}).click();await finishInitialPolicy(page);
    await page.getByRole('button',{name:'演武场',exact:true}).click();
    await expect(page.getByRole('button',{name:'擂鼓开战'})).toBeEnabled();
    await expect(this.canvas).toHaveAttribute('data-magic-rules','native-shoot-v1');
  }
  async cast(sequence:number) {
    const name=manifest.find(m=>m.sequence===sequence)!.name;
    const skill=this.page.getByRole('button',{name:new RegExp(name)});
    await this.page.getByLabel('战场速度').selectOption('4');
    await this.page.getByRole('button',{name:'擂鼓开战'}).click();
    await expect(skill).toBeEnabled({timeout:15000});
    await this.page.getByRole('button',{name:'暂停战斗',exact:true}).click();
    await skill.click();await expect(this.canvas).toHaveAttribute('data-magic-script-kind','native-shoot');
    await expect(this.canvas).toHaveAttribute('data-magic-script-phase','darken');
    await this.page.getByLabel('战场速度').selectOption('1');
    await this.page.getByRole('button',{name:'继续战斗',exact:true}).click();
    await expect(this.canvas).toHaveAttribute('data-magic-script-phase','flight');
    await this.page.getByRole('button',{name:'暂停战斗',exact:true}).click();
  }
  async castHeal(sequence:number) {
    const page=this.page,name=manifest.find(m=>m.sequence===sequence)!.name;
    const skill=page.getByRole('button',{name:new RegExp(name)});
    await page.getByLabel('战场速度').selectOption('4');await page.getByRole('button',{name:'擂鼓开战'}).click();
    await expect(skill).toBeEnabled({timeout:15000});await page.getByRole('button',{name:'暂停战斗',exact:true}).click();
    await skill.click();await expect(this.canvas).toHaveAttribute('data-magic-script-kind','native-heal');
    await expect(this.canvas).toHaveAttribute('data-magic-script-phase','darken');
    await page.getByLabel('战场速度').selectOption('1');await page.getByRole('button',{name:'继续战斗',exact:true}).click();
    await expect(this.canvas).toHaveAttribute('data-magic-script-phase','heal');
    await expect.poll(async()=>Number(await this.canvas.getAttribute('data-magic-script-age'))).toBeGreaterThanOrEqual(170);
    await page.getByRole('button',{name:'暂停战斗',exact:true}).click();
  }
  async openReinforceCampaign(sequence=5) {
    const page=this.page;
    await page.route('**/assets/content.json',async route=>{
      const response=await route.fetch(),content=await response.json();
      for(const scenario of content.scenarios) {
        for(const faction of scenario.factions)faction.flagNumber=999;
        for(const general of scenario.generals) {
          general.level=20;
          general.skillLearnset=general.ownerId==='f-01'?[{level:1,sequence}]:[];
          general.rawSkill=general.ownerId==='f-01'?`1, ${sequence}`:'';
          general.mp=150;general.maxMp=150;
          // A real opposing commander and army keep the point-collision
          // campaign fixture independent of the fallback empty-city garrison.
          if(sequence!==5&&general.name==='張角') {
            const city=scenario.cities.find((city:{name:string})=>city.name==='壺關')!;
            general.cityId=city.id;general.ownerId=city.ownerId;
          }
        }
      }
      await route.fulfill({response,json:content});
    });
    await page.goto('/');await page.getByRole('button',{name:/执掌何進/}).click();await finishInitialPolicy(page);
    await page.getByRole('button',{name:'调兵出征'}).click();
    const destination=page.getByLabel('行军目标');
    await destination.selectOption({label:(await destination.getByRole('option').filter({hasText:'壺關'}).textContent())!});
    await page.getByLabel(/出征兵力/).fill('60');await page.getByRole('button',{name:'下令出征'}).click();
    for(let i=0;i<3;i++)await page.getByRole('button',{name:'下一天',exact:true}).click();
    await expect(page.getByRole('heading',{name:'壺關之战'})).toBeVisible();
    await expect(page.getByRole('button',{name:'擂鼓开战'})).toBeEnabled();
  }
  async openExplodeCampaign(sequence=23) {
    await this.observeMagicDraws();await this.openReinforceCampaign(sequence);
    const page=this.page;
    await page.getByRole('button',{name:'擂鼓开战'}).click();await page.getByRole('button',{name:'暂停战斗',exact:true}).click();
    await page.getByRole('button',{name:'战中存档'}).click();
    const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'导出当前战役'}).click();
    const download=await downloadPromise,path=await download.path();expect(path).toBeTruthy();
    const value=JSON.parse(await readFile(path!,'utf8')),battle=value.session.battle as BattleState;
    // This fixture changes only the saved starting positions and charge. It
    // exercises actual UI import and spell collision without waiting for an
    // AI army to happen to walk into one of the source's small blast cells.
    const occupied=new Set<string>();let allied=0,enemy=0;
    for(const unit of battle.units) {
      let x:number,y:number;
      if(unit.general){x=unit.side==='attacker'?25:26;y=6;}
      else if(unit.side==='attacker'){const i=allied++;x=3+Math.floor(i/12);y=1+i%12;}
      else {let i=enemy++;x=21+Math.floor(i/12);y=1+i%12;while((x===25||x===26)&&y===6||occupied.has(`${x},${y}`)){i=enemy++;x=21+Math.floor(i/12);y=1+i%12;}}
      occupied.add(`${x},${y}`);unit.x=(x+.5)/71*1200;unit.y=150+y/13*360;
      unit.target=null;unit.order='hold';unit.action='wait';unit.actionTick=0;unit.hit=false;
      unit.movement={x,y,previousX:x,previousY:y,px:(96*x+48)*65536,py:(72*y+36)*65536,vx:0,vy:0,remaining:0,facing:unit.side==='attacker'?0:0x800000,exiting:false,clock:{decision:1,attack:0,deferred:0,actionAge:0,special:false}};
    }
    for(const side of ['attacker','defender'] as const){battle.nativeCommands![side].orders.fill(0);battle.nativeCommands![side].flags=0;battle.nativeCommands![side].target=null;}
    battle.orders={general:'hold',front:'hold',rear:'hold'};battle.commanders.attacker.charge=120000;
    battle.opponentAI!.countdown=60;
    await page.getByLabel('导入存档',{exact:true}).setInputFiles({name:'explode-point-fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
    await expect(page.getByRole('button',{name:'继续战斗',exact:true})).toBeEnabled();
  }
}

for(const [sequence,width] of [[7,1440],[16,1440],[23,390]]) {
  test(`native ExplodeRound ${sequence} draws its original circle, fire and smoke at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:width===390?844:900});
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    const screen=new NativeMagicScreen(page);await screen.open(sequence,{attacker:20,defender:20,chargeIntelligence:10000});
    const skill=page.getByRole('button',{name:new RegExp(manifest.find(m=>m.sequence===sequence)!.name)});
    await page.getByLabel('战场速度').selectOption('4');await page.getByRole('button',{name:'擂鼓开战'}).click();
    await expect(skill).toBeEnabled();await page.getByRole('button',{name:'暂停战斗',exact:true}).click();await skill.click();
    await expect(screen.canvas).toHaveAttribute('data-magic-script-kind','native-explode');
    await page.getByLabel('战场速度').selectOption('1');await page.getByRole('button',{name:'继续战斗',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>((window as unknown as {nativeMagicDraws:Record<string,number>}).nativeMagicDraws[18004]??0)),{timeout:15000}).toBeGreaterThan(0);
    await page.getByRole('button',{name:'暂停战斗',exact:true}).click();
    for(const id of [18002,18003,18004]) {
      expect(await page.evaluate(id=>(window as unknown as {nativeMagicDraws:Record<string,number>}).nativeMagicDraws[id]??0,id)).toBeGreaterThan(0);
      expect(await page.evaluate(id=>(window as unknown as {nativeMagicBlends:Record<string,string>}).nativeMagicBlends[id],id)).toBe('screen');
    }
    const snapshot=await screen.canvas.evaluate(node=>({tick:node.dataset.simulationTick,age:node.dataset.magicScriptAge,camera:node.dataset.scriptCamera,objects:node.dataset.explodeObjects}));
    await page.getByLabel('战场视距').selectOption('0.65');await expect(screen.canvas).toHaveAttribute('data-camera-zoom','0.65');
    expect(await screen.canvas.evaluate(node=>({tick:node.dataset.simulationTick,age:node.dataset.magicScriptAge,camera:node.dataset.scriptCamera,objects:node.dataset.explodeObjects}))).toEqual(snapshot);
    await page.screenshot({path:`docs/screenshots/native-explode-${sequence}-${width}.png`});
    await page.getByLabel('战场速度').selectOption('4');await page.getByRole('button',{name:'继续战斗',exact:true}).click();
    await expect(screen.canvas).toHaveAttribute('data-magic-script-kind','idle',{timeout:15000});
    await expect(screen.canvas).toHaveAttribute('data-scene-brightness','16');await expect(screen.canvas).toHaveAttribute('data-camera-owner','normal');
    expect(errors).toEqual([]);
  });
}

test('native ExplodeRound point collisions, fire and source state survive a real campaign save',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const screen=new NativeMagicScreen(page);await screen.openExplodeCampaign();
  const before=Number(await page.getByTestId('battle-defender-troops').textContent());expect(before).toBeGreaterThan(0);
  await page.getByRole('button',{name:/虎咆陽炎/}).click();
  await expect(screen.canvas).toHaveAttribute('data-magic-script-kind','native-explode');
  await page.getByLabel('战场速度').selectOption('1');await page.getByRole('button',{name:'继续战斗',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>((window as unknown as {nativeMagicDraws:Record<string,number>}).nativeMagicDraws[10016]??0)),{timeout:15000}).toBeGreaterThan(0);
  await page.getByRole('button',{name:'暂停战斗',exact:true}).click();
  expect(Number(await page.getByTestId('battle-defender-troops').textContent())).toBeLessThan(before);
  const snapshot=await screen.canvas.evaluate(node=>({tick:node.dataset.simulationTick,age:node.dataset.magicScriptAge,camera:node.dataset.scriptCamera,objects:node.dataset.explodeObjects,divisor:node.dataset.explodeHitDivisor}));
  await page.getByRole('button',{name:'战中存档'}).click();
  // The first of the three independent slots is explicitly saved and read.
  await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).first().click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('已保存');await page.reload();
  await page.getByRole('button',{name:'关闭对话框'}).click();await page.getByRole('button',{name:'存读档',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'读取',exact:true}).first().click();
  await expect(page.getByRole('button',{name:'继续战斗',exact:true})).toBeEnabled();
  expect(await screen.canvas.evaluate(node=>({tick:node.dataset.simulationTick,age:node.dataset.magicScriptAge,camera:node.dataset.scriptCamera,objects:node.dataset.explodeObjects,divisor:node.dataset.explodeHitDivisor}))).toEqual(snapshot);
  await page.screenshot({path:'docs/screenshots/native-explode-campaign.png'});
  await page.getByLabel('战场速度').selectOption('4');await page.getByRole('button',{name:'继续战斗',exact:true}).click();
  await expect(screen.canvas).toHaveAttribute('data-magic-script-kind','idle',{timeout:15000});
  await expect(screen.canvas).toHaveAttribute('data-explode-objects','[]');expect(errors).toEqual([]);
});

test('full troops preserve the native no-room spell and release its camera without creating soldiers',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  // Accelerate charging in this isolated input so no battle casualty can
  // change the full-army precondition before the native no-room branch.
  const scene=new NativeMagicScreen(page);await scene.open(5,{attacker:20,defender:1,chargeIntelligence:10000,meleeDefender:true});
  const canvas=scene.canvas,skill=page.getByRole('button',{name:/伏兵組陣/});
  await page.getByLabel('战场速度').selectOption('4');await page.getByRole('button',{name:'擂鼓开战'}).click();
  await expect.poll(async()=>skill.getAttribute('data-skill-state'),{timeout:20000}).toBe('available');
  await page.getByRole('button',{name:'暂停战斗',exact:true}).click();
  await expect(page.getByTestId('battle-attacker-troops')).toHaveText('100');
  await skill.click();
  await expect(canvas).toHaveAttribute('data-magic-script-kind','native-reinforce');
  await expect(canvas).toHaveAttribute('data-magic-script-phase','darken');
  await expect(canvas).toHaveAttribute('data-camera-owner','script');
  await expect(page.getByRole('meter',{name:'曹操技力'})).toHaveAttribute('aria-valuenow',String(150-manifest.find(m=>m.sequence===5)!.mp));
  await page.getByRole('button',{name:'继续战斗',exact:true}).click();
  await expect(canvas).toHaveAttribute('data-magic-script-kind','idle',{timeout:10000});
  await expect(canvas).toHaveAttribute('data-reinforce-units','0');
  await expect(canvas).toHaveAttribute('data-camera-owner','normal');
  await expect(canvas).toHaveAttribute('data-scene-brightness','16');await expect(canvas).toHaveAttribute('data-scene-palette','16');
  await page.getByRole('button',{name:'暂停战斗',exact:true}).click();
  expect(errors).toEqual([]);
});

test('reinforce camera, shade and fading soldiers survive a campaign save and finish fully visible',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const screen=new NativeMagicScreen(page);await screen.openReinforceCampaign();
  const canvas=screen.canvas,skill=page.getByRole('button',{name:/伏兵組陣/});
  await page.getByLabel('战场速度').selectOption('4');await page.getByRole('button',{name:'擂鼓开战'}).click();
  await expect(skill).toBeEnabled({timeout:15000});await page.getByRole('button',{name:'暂停战斗',exact:true}).click();
  await skill.click();await expect(canvas).toHaveAttribute('data-magic-script-kind','native-reinforce');
  await page.getByLabel('战场速度').selectOption('1');await page.getByRole('button',{name:'继续战斗',exact:true}).click();
  await expect.poll(async()=>Number(await canvas.getAttribute('data-reinforce-fading'))).toBeGreaterThan(0);
  await page.getByRole('button',{name:'暂停战斗',exact:true}).click();
  await expect(canvas).toHaveAttribute('data-scene-palette','8');
  await page.screenshot({path:'docs/screenshots/native-reinforce-1440.png'});
  await expect(page.getByRole('button',{name:'敌军主将',exact:true})).toBeDisabled();
  const snapshot=await canvas.evaluate(node=>({tick:node.dataset.simulationTick,age:node.dataset.magicScriptAge,camera:node.dataset.scriptCamera,brightness:node.dataset.sceneBrightness,palette:node.dataset.scenePalette,fading:node.dataset.reinforceFading,count:node.dataset.reinforceUnits}));
  const projected=await canvas.evaluate(node=>({x:Number(node.dataset.cameraX),y:Number(node.dataset.cameraY)}));
  expect(projected).toEqual(JSON.parse(snapshot.camera!));
  await page.getByRole('button',{name:'战中存档'}).click();
  // The first of the three independent slots is the one explicitly saved here.
  await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).first().click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('已保存');
  const saved=await page.evaluate(()=>new Promise<unknown>((resolve,reject)=>{
    const request=indexedDB.open('sango2-web',1);request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const db=request.result,transaction=db.transaction('saves','readonly'),slot=transaction.objectStore('saves').get(1);transaction.oncomplete=()=>{db.close();resolve(slot.result);};transaction.onerror=()=>{db.close();reject(transaction.error);};};
  }));
  await testInfo.attach('native-reinforce-save.json',{body:Buffer.from(JSON.stringify(saved)),contentType:'application/json'});
  await page.reload();
  await page.getByRole('button',{name:'关闭对话框'}).click();await page.getByRole('button',{name:'存读档',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'读取',exact:true}).first().click();
  await expect(page.getByRole('button',{name:'继续战斗',exact:true})).toBeEnabled();
  expect(await canvas.evaluate(node=>({tick:node.dataset.simulationTick,age:node.dataset.magicScriptAge,camera:node.dataset.scriptCamera,brightness:node.dataset.sceneBrightness,palette:node.dataset.scenePalette,fading:node.dataset.reinforceFading,count:node.dataset.reinforceUnits}))).toEqual(snapshot);
  await page.getByLabel('战场速度').selectOption('4');await page.getByRole('button',{name:'继续战斗',exact:true}).click();
  await expect(canvas).toHaveAttribute('data-magic-script-kind','idle',{timeout:15000});
  await expect(canvas).toHaveAttribute('data-reinforce-fading','0');
  await expect(canvas).toHaveAttribute('data-scene-brightness','16');await expect(canvas).toHaveAttribute('data-scene-palette','16');
  await expect(canvas).toHaveAttribute('data-camera-owner','normal');expect(errors).toEqual([]);
});

for(const [sequence,light,ball,width] of [[1,26001,26004,1440],[60,26002,26005,390]]) {
  test(`native heal ${sequence} draws original holy objects and preserves its paused script at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:width===390?844:900});
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    const screen=new NativeMagicScreen(page);await screen.open(sequence);await screen.castHeal(sequence);
    await expect(screen.canvas).toHaveAttribute('data-camera-owner','script');
    await expect(screen.canvas).toHaveAttribute('data-magic-script-phase','heal');
    await expect.poll(()=>page.evaluate(ids=>ids.map(id=>(window as unknown as {nativeMagicDraws:Record<string,number>}).nativeMagicDraws[id]??0),[light,ball])).toEqual([expect.any(Number),expect.any(Number)]);
    for(const id of [light,ball]) {
      expect(await page.evaluate(id=>(window as unknown as {nativeMagicDraws:Record<string,number>}).nativeMagicDraws[id]??0,id)).toBeGreaterThan(0);
      expect(await page.evaluate(id=>(window as unknown as {nativeMagicBlends:Record<string,string>}).nativeMagicBlends[id],id)).toBe('screen');
    }
    const snapshot=await screen.canvas.evaluate(n=>({age:n.dataset.magicScriptAge,tick:n.dataset.simulationTick,camera:n.dataset.scriptCamera}));
    await page.getByLabel('战场视距').selectOption('0.65');await expect(screen.canvas).toHaveAttribute('data-camera-zoom','0.65');
    expect(await screen.canvas.evaluate(n=>({age:n.dataset.magicScriptAge,tick:n.dataset.simulationTick,camera:n.dataset.scriptCamera}))).toEqual(snapshot);
    await page.screenshot({path:`docs/screenshots/native-heal-${sequence}-${width}.png`});
    await page.getByLabel('战场速度').selectOption('4');await page.getByRole('button',{name:'继续战斗',exact:true}).click();
    await expect(screen.canvas).toHaveAttribute('data-magic-script-kind','idle',{timeout:15000});
    await expect(screen.canvas).toHaveAttribute('data-camera-owner','normal');expect(errors).toEqual([]);
  });
}

for(const [sequence,object,width] of [[2,13001,1440],[13,13003,1440],[52,13001,390],[59,13005,390]]) {
  test(`native skill ${sequence} draws original object ${object} at ${width}px and holds its source clock while paused`,async({page})=>{
    await page.setViewportSize({width,height:width===390?844:900});
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    const scene=new NativeMagicScreen(page);await scene.open(sequence);await scene.cast(sequence);
    await expect(scene.canvas).toHaveAttribute('data-magic-object',String(object));
    await expect(scene.canvas).toHaveAttribute('data-camera-owner','script');
    await expect(page.getByRole('button',{name:'敌军主将',exact:true})).toBeDisabled();
    const projected=await scene.canvas.evaluate(node=>({x:Number(node.dataset.cameraX),y:Number(node.dataset.cameraY)}));
    expect(projected).toEqual(JSON.parse((await scene.canvas.getAttribute('data-script-camera'))!));
    await expect.poll(()=>page.evaluate(id=>(window as unknown as {nativeMagicDraws:Record<string,number>}).nativeMagicDraws[id]??0,object)).toBeGreaterThan(0);
    expect(await page.evaluate(id=>(window as unknown as {nativeMagicBlends:Record<string,string>}).nativeMagicBlends[id],object)).toBe(object===13003?'screen':'source-over');
    const snapshot=await scene.canvas.evaluate(node=>({phase:node.dataset.magicScriptPhase,age:node.dataset.magicScriptAge,weaponAge:node.dataset.magicWeaponAge,tick:node.dataset.simulationTick}));
    await page.getByLabel('战场视距').selectOption('0.65');
    await expect(scene.canvas).toHaveAttribute('data-camera-zoom','0.65');
    const surface=page.getByRole('group',{name:'拖动战场镜头',exact:true});
    await expect(surface).toHaveAttribute('aria-disabled','true');
    await surface.dispatchEvent('keydown',{key:'ArrowRight',bubbles:true});
    await page.getByRole('img',{name:'战场兵力分布'}).click({position:{x:10,y:10}});
    expect(await scene.canvas.evaluate(node=>({x:Number(node.dataset.cameraX),y:Number(node.dataset.cameraY)}))).toEqual(projected);
    expect(await scene.canvas.evaluate(node=>({phase:node.dataset.magicScriptPhase,age:node.dataset.magicScriptAge,weaponAge:node.dataset.magicWeaponAge,tick:node.dataset.simulationTick}))).toEqual(snapshot);
    await page.screenshot({path:`docs/screenshots/native-magic-${sequence}-${width}.png`});
    await page.getByRole('button',{name:'继续战斗',exact:true}).click();
    await expect.poll(async()=>Number(await scene.canvas.getAttribute('data-camera-x'))).not.toBe(projected.x);
    await expect(scene.canvas).toHaveAttribute('data-magic-script-kind','idle',{timeout:20000});
    await expect(scene.canvas).toHaveAttribute('data-camera-owner','normal');
    await expect(page.getByRole('button',{name:'敌军主将',exact:true})).toBeEnabled();
    expect(errors).toEqual([]);
  });
}
