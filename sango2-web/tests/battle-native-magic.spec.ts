import {test,expect,type Page} from '@playwright/test';
import manifest from '../packages/core/src/native-magic-manifest.json' with {type:'json'};

class NativeMagicScreen {
  constructor(readonly page:Page) {}
  get canvas(){return this.page.getByRole('img',{name:'实时战场画面'});}
  async open(sequence:number) {
    const page=this.page;
    await page.route('**/assets/content.json',async route=>{
      const response=await route.fetch(),content=await response.json();
      const generals=content.scenarios[0].generals;
      const caster=generals.find((g:{name:string})=>g.name==='曹操');
      caster.skillLearnset=[{level:1,sequence}];caster.rawSkill=`1, ${sequence}`;caster.mp=150;caster.maxMp=150;
      generals.find((g:{name:string})=>g.name==='張角').skillLearnset=[];
      await route.fulfill({response,json:content});
    });
    const response=await page.request.get('/assets/battle/animations.json'),atlas=await response.json();
    const rectangles=[13001,13003,13005,26001,26002,26004,26005].flatMap(id=>atlas.objects[id].actions.wait.frames.map((frame:{key:string})=>({id,...atlas.frames[frame.key]})));
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
    await page.goto('/');await page.getByRole('button',{name:/执掌何進/}).click();
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
}

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
