import {test,expect,type Page} from '@playwright/test';

class BattleCameraPage {
  constructor(readonly page:Page) {}
  get canvas(){return this.page.getByRole('img',{name:'实时战场画面'});}
  get surface(){return this.page.getByRole('group',{name:'拖动战场镜头',exact:true});}
  async open() {
    await this.page.goto('/');
    await this.page.getByRole('button',{name:/执掌何進/}).click();
    await this.page.getByRole('button',{name:'演武场',exact:true}).click();
    await expect(this.page.getByRole('button',{name:'擂鼓开战'})).toBeEnabled();
    await expect(this.canvas).toHaveAttribute('data-projection','native-perspective-v1');
  }
  async cameraX(){return Number(await this.canvas.getAttribute('data-camera-x'));}
  async installDrawProbe() {
    await this.page.addInitScript(()=>{
      const state=window as unknown as {battleDrawProbe:Record<string,{a:number;d:number;zoom:string|undefined}>};
      state.battleDrawProbe={};
      const original=CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage=function(this:CanvasRenderingContext2D,image:CanvasImageSource,...args:number[]) {
        (original as Function).call(this,image,...args);
        if(!(image instanceof HTMLImageElement)||this.canvas.getAttribute('aria-label')!=='实时战场画面')return;
        const key=image.src.endsWith('/floor.png')?'floor':image.src.includes('/background-')?'background':image.src.includes('/foreground-')?'foreground':/\/battle\/atlas-/.test(image.src)?'sprite':undefined;
        if(key){const m=this.getTransform();state.battleDrawProbe[key]={a:Math.abs(m.a),d:Math.abs(m.d),zoom:this.canvas.dataset.cameraZoom};}
      } as typeof original;
    });
  }
  async drawProbe(){return this.page.evaluate(()=>(window as unknown as {battleDrawProbe:Record<string,{a:number;d:number;zoom:string|undefined}>}).battleDrawProbe);}
}

for(const width of [1440,390])test(`native camera drag, keyboard, minimap and focus at ${width}px`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width,height:width===390?844:900});
  const scene=new BattleCameraPage(page);await scene.open();
  const tick=await scene.canvas.getAttribute('data-simulation-tick'),commands=await scene.canvas.getAttribute('data-native-commands');
  const own=await scene.cameraX();
  await page.getByRole('button',{name:'敌军主将',exact:true}).click();
  await expect.poll(()=>scene.cameraX()).toBeGreaterThan(own);
  await scene.surface.focus();await page.keyboard.press('Home');
  await expect.poll(()=>scene.cameraX()).toBe(own);
  await page.keyboard.press('ArrowRight');await expect.poll(()=>scene.cameraX()).toBe(own+64);
  const rect=(await scene.surface.boundingBox())!;
  await page.mouse.move(rect.x+rect.width*.6,rect.y+rect.height*.5);await page.mouse.down();
  await page.mouse.move(rect.x+rect.width*.6-80,rect.y+rect.height*.5,{steps:8});await page.mouse.up();
  await expect.poll(()=>scene.cameraX()).toBeGreaterThan(own+64);
  const minimap=page.getByRole('img',{name:'战场兵力分布'}),map=(await minimap.boundingBox())!;
  const clickX=Math.round(map.x+map.width*.75);
  await page.mouse.click(clickX,Math.round(map.y+map.height*.5));
  await expect.poll(()=>scene.cameraX()).toBe(96*Math.floor((clickX-map.x)/map.width*71)+48);
  await page.getByLabel('战场视距').selectOption('1.5');await expect(scene.canvas).toHaveAttribute('data-camera-zoom','1.5');
  await scene.surface.focus();await page.keyboard.press('Home');
  await expect(scene.canvas).toHaveAttribute('data-camera-zoom','1');
  await expect.poll(()=>scene.cameraX()).toBe(own);
  await expect(scene.canvas).toHaveAttribute('data-simulation-tick',tick!);
  await expect(scene.canvas).toHaveAttribute('data-native-commands',commands!);
  await expect(page.getByRole('button',{name:'我军主将',exact:true})).toHaveAttribute('aria-pressed','true');
  for(const button of await page.getByRole('group',{name:'战场镜头',exact:true}).getByRole('button').all()) {
    expect(await button.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;})).toBe(true);
  }
  await page.screenshot({path:`docs/screenshots/native-camera-${width}.png`});
  expect(errors).toEqual([]);
});

test('full armies retain camera controls through live native projectiles and casualties',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/assets/content.json',async route=>{
    const response=await route.fetch(),content=await response.json();
    for(const general of content.scenarios[0].generals)if(['曹操','張角'].includes(general.name))general.level=40;
    await route.fulfill({response,json:content});
  });
  const scene=new BattleCameraPage(page);await scene.open();
  await expect(scene.canvas).toHaveAttribute('data-field-troops','400');
  await page.getByRole('button',{name:'交锋前线',exact:true}).click();
  await page.getByLabel('战场视距').selectOption('0.65');
  await page.screenshot({path:'docs/screenshots/native-camera-armies.png'});
  await page.getByRole('button',{name:'前进迎敌',exact:true}).click();
  await page.getByRole('button',{name:'擂鼓开战'}).click();
  await page.getByLabel('战场速度').selectOption('4');
  await expect.poll(async()=>Number(await scene.canvas.getAttribute('data-casualties')),{timeout:25000}).toBeGreaterThan(0);
  await page.getByRole('button',{name:'暂停战斗',exact:true}).click();
  await page.getByLabel('战场视距').selectOption('1');
  await expect(page.getByRole('button',{name:'继续战斗',exact:true})).toBeEnabled();
  await page.screenshot({path:'docs/screenshots/native-camera-combat.png'});
  expect(errors).toEqual([]);
});

for(const width of [1440,390])test(`scenery, ground and sprites share zoom without advancing battle at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:width===390?844:900});
  const scene=new BattleCameraPage(page);await scene.installDrawProbe();await scene.open();
  await expect.poll(async()=>Object.keys(await scene.drawProbe()).sort()).toEqual(['background','floor','foreground','sprite']);
  const baseline=await scene.drawProbe(),tick=await scene.canvas.getAttribute('data-simulation-tick');
  for(const zoom of [.65,1.5,1]) {
    await page.getByLabel('战场视距').selectOption(String(zoom));
    await expect.poll(async()=>{
      const draws=await scene.drawProbe();
      return Object.entries(draws).every(([key,m])=>Math.abs(m.a/baseline[key].a-zoom)<.000001&&Math.abs(m.d/baseline[key].d-zoom)<.000001);
    }).toBe(true);
    await expect(scene.canvas).toHaveAttribute('data-simulation-tick',tick!);
    if(zoom===.65) {
      // Read actual pixels above the panoramic artwork. Stretching its first
      // row produced conspicuous vertical bands across this newly exposed sky.
      const sky=await scene.canvas.evaluate(node=>{
        const canvas=node as HTMLCanvasElement,rect=canvas.getBoundingClientRect(),ratio=canvas.width/rect.width;
        const heading=node.closest('main')!.querySelector('header')!.getBoundingClientRect();
        const y=Math.floor((heading.bottom-rect.top+8)*ratio),ctx=canvas.getContext('2d')!;
        return [.15,.5,.85].map(x=>Array.from(ctx.getImageData(Math.floor(canvas.width*x),y,1,1).data));
      });
      expect(sky[0][3]).toBe(255);expect(sky[0]).toEqual(sky[1]);expect(sky[1]).toEqual(sky[2]);
    }
    await page.screenshot({path:`docs/screenshots/synced-zoom-${width}-${zoom}.png`});
  }
});
