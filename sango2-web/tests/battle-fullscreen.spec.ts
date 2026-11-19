import {test,expect,type Page} from '@playwright/test';

class BattleScreen {
  constructor(readonly page:Page) {}
  async open(multiple=false) {
    await this.page.goto('/');
    await this.page.getByRole('button',{name:/执掌何進/}).click();
    await this.page.getByRole('button',{name:multiple?'双将演武':'演武场',exact:true}).click();
    if(multiple)await this.page.getByRole('dialog',{name:'点将出阵'}).getByRole('button',{name:'确认出阵'}).click();
    await expect(this.page.getByRole('button',{name:'擂鼓开战'})).toBeEnabled();
  }
  async openArcherCampaign() {
    const page=this.page;
    await page.route('**/assets/content.json',async route=>{
      const response=await route.fetch(),content=await response.json();
      // Exercise the actual campaign save flow with enough archers to have
      // in-flight objects when paused. Native AI has its own unmodified tests.
      for(const scene of content.scenarios) {
        for(const faction of scene.factions)faction.flagNumber=999;
        for(const general of scene.generals)if(general.appearance){general.unit='弓';general.appearance.soldier=103;general.level=40;}
      }
      await route.fulfill({response,json:content});
    });
    await page.goto('/');await page.getByRole('button',{name:/执掌何進/}).click();
    await page.getByRole('button',{name:'调兵出征'}).click();
    const destination=page.getByLabel('行军目标');
    await destination.selectOption({label:(await destination.getByRole('option').filter({hasText:'壺關'}).textContent())!});
    await page.getByLabel(/出征兵力/).fill('60');await page.getByRole('button',{name:'下令出征'}).click();
    for(let i=0;i<3;i++)await page.getByRole('button',{name:'下一天',exact:true}).click();
    await expect(page.getByRole('heading',{name:'壺關之战'})).toBeVisible();
  }
  async checkDisplay() {
    const page=this.page;
    const viewport=page.viewportSize()!;
    const bounds=await page.getByRole('img',{name:'实时战场画面'}).boundingBox();
    expect(bounds).toEqual({x:0,y:0,width:viewport.width,height:viewport.height});
    await expect(page.getByRole('navigation',{name:'游戏菜单'})).toBeHidden();
    expect(await page.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}))).toEqual(viewport);
    const canvas=page.getByRole('img',{name:'实时战场画面'});
    await expect(canvas).toHaveAttribute('data-sprite-scale-x',/.+/);
    expect(await canvas.getAttribute('data-sprite-scale-x')).toBe(await canvas.getAttribute('data-sprite-scale-y'));
    const ground=Number(await canvas.getAttribute('data-ground-y')),feet=Number(await canvas.getAttribute('data-rear-feet-y'));
    expect(ground).toBeGreaterThanOrEqual(0);expect(feet).toBeGreaterThan(ground);
    for(const control of await page.getByRole('main').getByRole('button').all()) {
      if(!await control.isVisible())continue;
      expect(await control.evaluate(el=>{
        const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&(hit===el||el.contains(hit));
      }),await control.innerText()).toBe(true);
    }
  }
}

test('formation choices follow the selected commander and retain a valid default',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const screen=new BattleScreen(page);await screen.open(true);
  const formation=page.getByLabel('战场阵形');
  await expect(formation).toHaveValue('yuan');
  expect(await formation.getByRole('option').evaluateAll(options=>options.map(option=>(option as HTMLOptionElement).value))).toEqual(['yuan','xuan']);
  await expect(formation).toHaveAccessibleDescription('曹操 · 已习得 2 阵');
  await formation.selectOption('xuan');await expect(formation).toHaveValue('xuan');
  await page.getByRole('button',{name:'点将出阵',exact:true}).click();
  const selection=page.getByRole('dialog',{name:'点将出阵'});
  await selection.getByRole('radio',{name:/關羽/}).check();await selection.getByRole('button',{name:'确认出阵'}).click();
  await expect(formation).toHaveAccessibleDescription('關羽 · 已习得 2 阵');
  expect(await formation.getByRole('option').evaluateAll(options=>options.map(option=>(option as HTMLOptionElement).value))).toEqual(['fang','yan']);
  await expect(formation).toHaveValue('fang');await screen.checkDisplay();
  expect(errors).toEqual([]);
});

test('in-flight source projectiles survive campaign save and reload while paused',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)errors.push(`${response.status()} ${response.url()}`);});
  const screen=new BattleScreen(page);await screen.openArcherCampaign();
  const canvas=page.getByRole('img',{name:'实时战场画面'});
  await page.getByRole('button',{name:'前进迎敌'}).click();await page.getByRole('button',{name:'擂鼓开战'}).click();
  await page.getByLabel('战场速度').selectOption('4');
  await expect.poll(async()=>Number(await canvas.getAttribute('data-projectiles')),{timeout:20000}).toBeGreaterThan(0);
  await page.getByRole('button',{name:'暂停战斗',exact:true}).click();
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const count=(await canvas.getAttribute('data-projectiles'))!,clock=(await canvas.getAttribute('data-projectile-clock'))!;
  expect(Number(count)).toBeGreaterThan(0);
  await page.getByRole('button',{name:'战中存档'}).click();
  // The first of the three independent save slots is explicitly under test.
  await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).first().click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('已保存');await page.reload();
  await page.getByRole('button',{name:'关闭对话框'}).click();await page.getByRole('button',{name:'存读档',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'读取',exact:true}).first().click();
  await expect(page.getByRole('button',{name:'继续战斗',exact:true})).toBeEnabled();
  await expect(canvas).toHaveAttribute('data-projectile-rules','native-projectiles-v1');
  await expect(canvas).toHaveAttribute('data-projectiles',count);await expect(canvas).toHaveAttribute('data-projectile-clock',clock);
  await page.screenshot({path:'docs/screenshots/native-projectiles-restored.png'});
  await page.getByRole('button',{name:'继续战斗',exact:true}).click();
  await expect(canvas).not.toHaveAttribute('data-projectile-clock',clock);expect(errors).toEqual([]);
});

for(const viewport of [{width:1440,height:900},{width:390,height:844}]) {
  test(`five-division commands are keyboard operable at ${viewport.width}px`,async({page})=>{
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewportSize(viewport);const screen=new BattleScreen(page);await screen.open();
    const wing=page.getByRole('button',{name:'左军',exact:true});await wing.focus();await page.keyboard.press('Enter');
    await expect(wing).toHaveAttribute('aria-pressed','true');
    await page.getByLabel('战术军令').selectOption('6');
    const send=page.getByRole('button',{name:'下达战术'});await send.focus();await page.keyboard.press('Space');
    const canvas=page.getByRole('img',{name:'实时战场画面'});
    await expect(canvas).toHaveAttribute('data-native-commands','[0,0,0,6,0,0,0,0]');
    await page.getByRole('button',{name:'全体士兵',exact:true}).click();
    await page.getByLabel('战术军令').selectOption('7');await send.click();
    await expect(canvas).toHaveAttribute('data-native-commands','[0,7,7,7,7,7,7,7]');
    await page.getByRole('button',{name:'主将',exact:true}).click();
    await expect(page.getByLabel('战术军令').getByRole('option')).toHaveText(['待命','前进','后退','撤退']);
    await screen.checkDisplay();await page.screenshot({path:`docs/screenshots/native-commands-${viewport.width}.png`});
    await page.getByRole('button',{name:'擂鼓开战'}).click();
    await expect(canvas).toHaveAttribute('data-moving-units',/^[1-9]\d*$/);
    expect(errors).toEqual([]);
  });
  test(`native active and reserve soldiers deploy together at ${viewport.width}px`,async({page})=>{
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{if(response.status()>=400)errors.push(`${response.status()} ${response.url()}`);});
    // Full-capacity fixture; unmodified Cao Cao remains level 2 in other tests.
    await page.route('**/assets/content.json',async route=>{
      const response=await route.fetch(),content=await response.json();
      for(const general of content.scenarios[0].generals)if(['曹操','張角'].includes(general.name))general.level=40;
      await route.fulfill({response,json:content});
    });
    await page.setViewportSize(viewport);const screen=new BattleScreen(page);await screen.open();await screen.checkDisplay();
    await expect(page.getByRole('img',{name:'实时战场画面'})).toHaveAttribute('data-field-troops','400');
    await expect(page.getByTestId('battle-attacker-troops')).toHaveText('200');
    await expect(page.getByTestId('battle-defender-troops')).toHaveText('200');
    await expect(page.getByRole('img',{name:'战场兵力分布'}).locator('rect')).toHaveCount(403);
    await page.getByRole('button',{name:'两军名册'}).click();
    await expect(page.getByText('在场 200 · 现役 100 · 预备 100',{exact:true})).toHaveCount(2);
    await page.getByRole('button',{name:'两军名册'}).click();
    await page.screenshot({path:`docs/screenshots/native-troops-${viewport.width}.png`});
    await page.getByRole('button',{name:'前进迎敌'}).click();await page.getByRole('button',{name:'擂鼓开战'}).click();
    await page.getByLabel('战场速度').selectOption('4');
    await expect.poll(async()=>Number(await page.getByTestId('battle-attacker-troops').textContent()),{timeout:20000}).toBeLessThan(200);
    const canvas=page.getByRole('img',{name:'实时战场画面'});
    await expect(canvas).toHaveAttribute('data-movement-rules','native-grid-v3');
    await expect(canvas).toHaveAttribute('data-attack-rules','native-actions-v1');
    await expect(canvas).toHaveAttribute('data-projectile-rules','native-projectiles-v1');
    await expect.poll(async()=>Number(await canvas.getAttribute('data-projectiles')),{timeout:20000}).toBeGreaterThan(0);
    await expect.poll(async()=>Number(await canvas.getAttribute('data-special-attacks')),{timeout:20000}).toBeGreaterThan(0);
    await expect.poll(async()=>Number(await canvas.getAttribute('data-moving-units'))).toBeGreaterThan(0);
    await expect.poll(async()=>Number(await canvas.getAttribute('data-detached-objects')),{timeout:20000}).toBeGreaterThan(0);
    await page.getByRole('button',{name:'暂停战斗',exact:true}).click();
    // Painting two frames must not advance the simulation or consume events.
    const snapshot=await canvas.evaluate(node=>({tick:node.dataset.simulationTick,detached:node.dataset.detachedObjects,moving:node.dataset.movingUnits,projectiles:node.dataset.projectiles,projectileClock:node.dataset.projectileClock}));
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    expect(await canvas.evaluate(node=>({tick:node.dataset.simulationTick,detached:node.dataset.detachedObjects,moving:node.dataset.movingUnits,projectiles:node.dataset.projectiles,projectileClock:node.dataset.projectileClock}))).toEqual(snapshot);
    await page.screenshot({path:`docs/screenshots/native-troops-combat-${viewport.width}.png`});
    expect(errors).toEqual([]);
  });
}

test('source sword represents charge independently of HP and MP',async({page})=>{
  const screen=new BattleScreen(page);await screen.open();
  const charge=page.getByRole('progressbar',{name:'曹操集气'});
  const hp=page.getByRole('meter',{name:'曹操体力'}),mp=page.getByRole('meter',{name:'曹操技力'});
  await expect(charge).toHaveAttribute('value','60000');
  await expect(charge).toHaveAttribute('max','120000');
  await expect(hp).toHaveAttribute('aria-valuenow',await hp.getAttribute('aria-valuemax')??'');
  await expect(mp).toHaveAttribute('aria-valuenow',await mp.getAttribute('aria-valuemax')??'');
  await page.getByRole('button',{name:'擂鼓开战'}).click();
  await expect.poll(async()=>Number(await charge.getAttribute('value'))).toBeGreaterThan(60000);
  await page.getByRole('button',{name:'暂停战斗',exact:true}).click();
  const before=await charge.getAttribute('value');
  await page.getByRole('button',{name:'主将',exact:true}).click();
  await page.getByRole('button',{name:'原地待命'}).click();
  await expect(charge).toHaveAttribute('value',before!);
  await page.screenshot({path:'docs/screenshots/native-hud-charge.png'});
});

test('source learning gates and level-derived vitals agree with the HUD',async({page})=>{
  const screen=new BattleScreen(page);await screen.open();
  await expect(page.getByTestId('battle-attacker-level')).toHaveText('等级 02');
  const clock=page.getByRole('timer',{name:'交战倒计时'});
  await expect(clock).toHaveAttribute('data-count','99');
  await expect(clock.locator('img')).toHaveCount(3);
  await expect.poll(()=>clock.locator('img').evaluateAll(images=>images.every(img=>(img as HTMLImageElement).complete&&(img as HTMLImageElement).naturalWidth>0))).toBe(true);
  await expect(page.getByRole('meter',{name:'曹操体力'})).toHaveAttribute('aria-valuemax','86');
  await expect(page.getByRole('meter',{name:'曹操技力'})).toHaveAttribute('aria-valuemax','47');
  await expect(page.getByRole('button',{name:/火箭.*尚未开战/})).toBeDisabled();
  await expect(page.getByRole('button',{name:/命療術/})).toHaveCount(0);
  const minimap=page.getByRole('img',{name:'战场兵力分布'});
  await expect(minimap).toBeVisible();
  // SVG rects are the actual two-pixel army dots plus the black background.
  await expect(minimap.locator('rect')).toHaveCount(23);
  await page.screenshot({path:'docs/screenshots/native-hud-learning.png'});
});

test('learned healing skill reports charge and MP gates and consumes MP once',async({page})=>{
  // Controlled fixture for a verified script; Cao Cao's real level-one skill is 火箭.
  await page.route('**/assets/content.json',async route=>{
    const response=await route.fetch();const content=await response.json();
    const cao=content.scenarios[0].generals.find((g:{name:string})=>g.name==='曹操');
    cao.skillLearnset=[{level:1,sequence:1}];cao.rawSkill='1, 1';cao.mp=20;
    await route.fulfill({response,json:content});
  });
  const screen=new BattleScreen(page);await screen.open();
  const skill=page.getByRole('button',{name:/命療術/});
  await expect(skill).toContainText('尚未开战');await expect(skill).toBeDisabled();
  await page.getByLabel('战场速度').selectOption('4');
  await page.getByRole('button',{name:'擂鼓开战'}).click();
  await expect(skill).toContainText('集气未满');
  await expect(skill).toBeEnabled({timeout:15000});
  await page.getByRole('button',{name:'暂停战斗',exact:true}).click();
  await skill.click();
  const canvas=page.getByRole('img',{name:'实时战场画面'});
  await expect(canvas).toHaveAttribute('data-magic-script-kind','heal');
  await expect(canvas).toHaveAttribute('data-magic-script-phase','heal');
  await expect(canvas).toHaveAttribute('data-magic-script-age',/^[0-9]+$/);
  await expect(page.getByRole('meter',{name:'曹操技力'})).toHaveAttribute('aria-valuenow','0');
  await expect(skill).toContainText('正在施法');await expect(skill).toBeDisabled();
  await page.getByRole('button',{name:'继续战斗',exact:true}).click();
  await expect(skill).toContainText('技力不足');await expect(skill).toBeDisabled();
});

for(const viewport of [{width:1920,height:1080},{width:1440,height:900},{width:1024,height:768},{width:844,height:390},{width:390,height:844},{width:320,height:568}]) {
  test(`battle fills ${viewport.width}x${viewport.height} without clipping controls or stretching sprites`,async({page})=>{
    await page.setViewportSize(viewport);
    const screen=new BattleScreen(page);await screen.open();await screen.checkDisplay();
    await page.screenshot({path:`docs/screenshots/fullscreen-${viewport.width}x${viewport.height}.png`});
    await page.getByRole('button',{name:'主将',exact:true}).click();
    await page.getByRole('button',{name:'原地待命'}).click();
    await expect(page.getByRole('region',{name:'双方战况'})).toContainText('主将待命');
    await page.getByRole('button',{name:'返回地图'}).click();
    await expect(page.getByRole('navigation',{name:'游戏菜单'})).toBeVisible();
    await expect(page.getByLabel('天下地图')).toBeVisible();
  });
}

test('fullscreen includes campaign save dialogs and keeps the battle paused after saving',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:/执掌何進/}).click();
  await page.getByRole('button',{name:'调兵出征'}).click();
  const target=page.getByLabel('行军目标');
  const option=target.getByRole('option').filter({hasText:'壺關'});
  await target.selectOption({label:(await option.textContent())!});
  await page.getByLabel(/出征兵力/).fill('60');
  await page.getByRole('button',{name:'下令出征'}).click();
  for(let i=0;i<3;i++)await page.getByRole('button',{name:'下一天',exact:true}).click();
  await page.getByRole('button',{name:'全屏战场'}).click();
  await expect.poll(()=>page.evaluate(()=>document.fullscreenElement?.className)).toBe('app');
  await page.getByRole('button',{name:'擂鼓开战'}).click();
  await page.getByRole('button',{name:'战中存档'}).click();
  const dialog=page.getByRole('dialog',{name:'军机存档'});
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(el=>document.fullscreenElement?.contains(el))).toBe(true);
  await dialog.getByRole('button',{name:'保存',exact:true}).first().click();
  await expect(dialog.getByRole('status')).toContainText('已保存');
  await dialog.getByRole('button',{name:'关闭对话框'}).click();
  await expect(page.getByRole('button',{name:'继续战斗',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'退出全屏'}).click();
  await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===null)).toBe(true);
  await expect(page.getByRole('heading',{name:'壺關之战'})).toBeVisible();
});

test('denied fullscreen remains a usable battle and does not show an asset loading failure',async({page})=>{
  await page.addInitScript(()=>{Element.prototype.requestFullscreen=()=>Promise.reject(new DOMException('Denied','NotAllowedError'));});
  const screen=new BattleScreen(page);await screen.open();
  await page.getByRole('button',{name:'全屏战场'}).click();
  await expect(page.getByRole('status')).toContainText('浏览器未允许全屏');
  await page.getByRole('button',{name:'关闭全屏提示'}).click();
  await page.getByRole('button',{name:'擂鼓开战'}).click();
  await expect(page.getByRole('button',{name:'暂停战斗',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'返回地图'}).click();
  await expect(page.getByLabel('天下地图')).toBeVisible();
});
