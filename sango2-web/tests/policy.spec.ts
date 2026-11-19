import {test,expect,type Page} from '@playwright/test';
import {delayRivalDecisions} from './campaign-fixture';

class CouncilPage {
  constructor(readonly page:Page){}
  get dialog(){return this.page.getByRole('dialog',{name:'内政经营'});}
  async start(recruitFixture=false){await delayRivalDecisions(this.page);if(recruitFixture)await this.page.route('**/assets/content.json',async route=>{const response=await route.fetch(),content=await response.json();for(const scene of content.scenarios){for(const f of scene.factions)f.flagNumber=999;scene.generals.find((g:{name:string})=>g.name==='曹操').level=20;}await route.fulfill({response,json:content});});await this.page.goto('/');await this.page.getByRole('button',{name:/执掌何進/}).click();await expect(this.dialog).toBeVisible();}
  async command(name:string){await this.dialog.getByRole('navigation',{name:'内政命令'}).getByRole('button',{name,exact:false}).click();}
  async finish(){await this.dialog.getByRole('button',{name:'内政終了 · 返回征战'}).click();await expect(this.dialog).toHaveCount(0);}
  async reopen(){await this.page.getByRole('navigation',{name:'游戏菜单'}).getByRole('button',{name:'内政经营',exact:true}).click();}
}

for(const width of [1440,390])test(`domestic council supports development, appointment, reports and save at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:width===1440?1200:844});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const council=new CouncilPage(page);await council.start();
  const select=council.dialog.getByLabel('治下城池');await expect(select).toBeFocused();
  await select.selectOption({label:'洛陽 · 8将'});
  const actor=council.dialog.getByRole('checkbox',{name:/曹操/});await actor.check();
  await council.dialog.getByRole('button',{name:'执行开发 · 1将',exact:true}).click();
  await expect(actor).toBeDisabled();await expect(council.dialog.getByRole('status')).toContainText('1将完成开发');
  await expect(council.dialog.getByText('5,336',{exact:true})).toBeVisible();
  await council.command('任命太守');
  await council.dialog.getByLabel('太守人选').selectOption({label:'曹操 · 智力92 · 武力87'});
  await council.dialog.getByRole('button',{name:'任命为太守',exact:true}).click();
  await expect(council.dialog.getByRole('status')).toContainText('任命曹操为太守');
  await council.command('内政报告');await expect(council.dialog.getByRole('rowheader',{name:'洛陽 · 曹操'})).toBeVisible();
  await council.command('开发');await expect(council.dialog.getByRole('checkbox',{name:/曹操/})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`docs/screenshots/policy-${width}.png`});
  await council.dialog.getByRole('button',{name:'关闭对话框'}).click();
  await expect(page.getByRole('button',{name:'下一天',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'存读档',exact:true}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出当前战役'}).click();const file=await download;
  const path=await file.path();expect(path).toBeTruthy();
  await page.getByLabel('导入存档',{exact:true}).setInputFiles(path!);
  await expect(council.dialog).toBeVisible();
  await expect(council.dialog.getByRole('checkbox',{name:/曹操/})).toBeDisabled();
  await council.finish();await expect(page.getByRole('button',{name:'下一天',exact:true})).toBeEnabled();
  await council.reopen();await expect(council.dialog.getByRole('checkbox',{name:/曹操/})).toBeDisabled();
  await expect(council.dialog.getByRole('button',{name:'执行开发',exact:true})).toBeDisabled();
  await expect(council.dialog.getByRole('button',{name:'内政終了 · 返回征战'})).toHaveCount(0);
  await council.dialog.getByRole('button',{name:'关闭对话框'}).focus();await page.keyboard.press('Escape');
  await expect(council.dialog).toHaveCount(0);await expect(page.getByRole('navigation',{name:'游戏菜单'}).getByRole('button',{name:'内政经营',exact:true})).toBeFocused();
  expect(errors).toEqual([]);
});

test('native reserve transfer consumes existing soldiers and preserves gold',async({page})=>{
  const council=new CouncilPage(page);await council.start(true);await council.finish();
  await page.getByRole('button',{name:'下一天',exact:true}).click();await council.reopen();await council.command('部队征兵');
  // The first native reserve recruit costs100; assignment itself is free.
  await expect(council.dialog.getByText('5,236',{exact:true})).toBeVisible();
  await council.dialog.getByLabel('配兵武将').selectOption({label:'曹操 · 现有80兵'});
  await council.dialog.getByLabel('补充兵数').fill('1');await council.dialog.getByRole('button',{name:'补充部队',exact:true}).click();
  await expect(council.dialog.getByRole('status')).toContainText('补充1兵');
  await expect(council.dialog.getByText('5,236',{exact:true})).toBeVisible();
  await expect(council.dialog.getByRole('button',{name:'补充部队',exact:true})).toBeDisabled();
});
