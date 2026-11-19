import {finishInitialPolicy} from './campaign-fixture';
import {test,expect,type Page} from '@playwright/test';

class StrategistScreen {
  constructor(readonly page:Page) {}
  async open() {
    await this.page.route('**/assets/content.json',async route=>{
      const response=await route.fetch(),content=await response.json();
      // Controlled spell lifecycle fixture; ordinary campaign AI tests stay unmodified.
      for(const g of content.scenarios[0].generals){g.strategyLearnset=[];g.rawStrategy='';}
      const cao=content.scenarios[0].generals.find((g:{name:string})=>g.name==='曹操');
      cao.level=Math.max(cao.level,3); // Include a learned, still-unimplemented control case.
      cao.strategyLearnset=[{level:1,sequence:61},{level:2,sequence:1},{level:3,sequence:28}];
      await route.fulfill({response,json:content});
    });
    await this.page.goto('/');await this.page.getByRole('button',{name:/执掌何進/}).click();await finishInitialPolicy(this.page);
    await this.page.getByRole('button',{name:'演武场',exact:true}).click();
    await expect(this.page.getByRole('button',{name:'擂鼓开战'})).toBeEnabled();
  }
  async select() {
    await this.page.getByRole('button',{name:'军师献策'}).click();
    const dialog=this.page.getByRole('dialog',{name:'军 师 献 策'});
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('军师计策').selectOption('61');
    return dialog;
  }
}
for(const viewport of [{width:1280,height:800},{width:390,height:844}]) {
  test(`strategy confirmation, keyboard cancel and actual temporary HP at ${viewport.width}`,async({page})=>{
    await page.setViewportSize(viewport);const screen=new StrategistScreen(page);await screen.open();
    const hp=page.getByRole('meter',{name:'曹操体力'});
    await expect(hp).toHaveAttribute('aria-valuemax','86');
    let dialog=await screen.select();
    await expect(dialog.getByRole('option',{name:/鼓舞士氣/})).toBeEnabled();
    await expect(dialog.getByRole('option',{name:/乱阵|亂陣/})).toBeDisabled();
    await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
    await expect(page.getByRole('button',{name:'军师献策'})).toBeFocused();
    await page.getByRole('button',{name:'军师献策'}).click();
    await expect(dialog.getByLabel('军师计策')).toHaveValue('0');
    await dialog.getByLabel('军师计策').selectOption('61');
    await dialog.getByRole('button',{name:'确认计策'}).click();
    await expect(dialog).toBeHidden();await expect(hp).toHaveAttribute('aria-valuemax','86');
    dialog=await screen.select();
    const bounds=await dialog.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({path:`docs/screenshots/strategist-${viewport.width}.png`});
    await dialog.getByRole('button',{name:'返回布阵'}).click();
    await page.getByRole('button',{name:'擂鼓开战'}).click();
    await expect(hp).toHaveAttribute('aria-valuemax','129');
    await page.getByRole('button',{name:'暂停战斗',exact:true}).click();
    await expect(page.getByRole('button',{name:'军师献策'})).toHaveCount(0);
    await expect(page.getByRole('img',{name:'实时战场画面'})).toBeVisible();
  });
}
