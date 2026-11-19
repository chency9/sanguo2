import {test,expect,type Page} from '@playwright/test';
import {delayRivalDecisions} from './campaign-fixture';
import {readFile} from 'node:fs/promises';
import type {Session} from '../packages/core/src/index';
import type {GameContent} from '../packages/content/src/index';

class CouncilPage {
  constructor(readonly page:Page){}
  get dialog(){return this.page.getByRole('dialog',{name:'内政经营'});}
  async start(recruitFixture=false){await delayRivalDecisions(this.page);if(recruitFixture)await this.page.route('**/assets/content.json',async route=>{const response=await route.fetch(),content=await response.json();for(const scene of content.scenarios){for(const f of scene.factions)f.flagNumber=999;scene.generals.find((g:{name:string})=>g.name==='曹操').level=20;}await route.fulfill({response,json:content});});await this.page.goto('/');await this.page.getByRole('button',{name:/执掌何進/}).click();await expect(this.dialog).toBeVisible();}
  async command(name:string){await this.dialog.getByRole('navigation',{name:'内政命令'}).getByRole('button',{name,exact:false}).click();}
  async finish(){await this.dialog.getByRole('button',{name:'内政終了 · 返回征战'}).click();await expect(this.dialog).toHaveCount(0);}
  async reopen(){await this.page.getByRole('navigation',{name:'游戏菜单'}).getByRole('button',{name:'内政经营',exact:true}).click();}
  async exportSession(){
    if(await this.dialog.count())await this.dialog.getByRole('button',{name:'关闭对话框'}).click();
    await this.page.getByRole('button',{name:'存读档',exact:true}).click();
    const pending=this.page.waitForEvent('download');await this.page.getByRole('button',{name:'导出当前战役'}).click();
    const download=await pending,path=await download.path();expect(path).toBeTruthy();
    return JSON.parse(await readFile(path!,'utf8')) as {format:string;session:Session};
  }
  async importSession(value:unknown){await this.page.getByLabel('导入存档',{exact:true}).setInputFiles({name:'policy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});}
}

test('annual rival governance, wounds and equipment persist through the real save and roster UI',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const council=new CouncilPage(page);await council.start();
  const save=await council.exportSession(),s=save.session,content=await (await page.request.get('/assets/content.json')).json() as GameContent;
  const scene=content.scenarios[0],rival=scene.factions.find(f=>f.id!==s.factionId&&f.leaderId&&s.generals[f.leaderId].ownerId===f.id)!,id=rival.leaderId!;
  const g=s.generals[id],def=scene.generals.find(d=>d.id===id)!;s.cities[g.cityId!].troops+=1-g.troops;
  Object.assign(g,{level:1,experience:0,hp:1,mp:1,troops:1,troopSlots:{active:1,reserve:0}});
  s.day=359;s.policy!.annual!.battleExperience[s.factionId]=200000;
  // Isolate annual progression from the ten ordinary recovery/recruit callbacks
  // that the calendar runs before the annual transition.
  for(const timer of Object.values(s.nativeAI!.recovery)){timer.hp=9999;timer.mp=9999;}
  for(const city of scene.cities)s.nativeAI!.recruitTimers[city.id]=9999;
  await council.importSession(save);await council.finish();await page.getByRole('button',{name:'下一天',exact:true}).click();await expect(council.dialog).toBeVisible();
  const after=await council.exportSession(),a=after.session;
  expect(a.policy!.year).toBe(scene.year+1);expect(a.policy!.annual!.reports.length).toBeGreaterThan(0);expect(a.generals[id].level).toBeGreaterThan(1);
  expect(a.generals[id].hp).toBe(1);expect(a.generals[id].mp).toBe(1);expect(a.generals[id].troops).toBe(1);
  expect(a.policy!.search!.reports).toEqual([]);expect(a.policy!.results).toEqual([]);
  await council.importSession(after);const restored=await council.exportSession();expect(restored.session).toEqual(a);
  await council.importSession(restored);await council.dialog.getByRole('button',{name:'关闭对话框'}).click();
  await page.getByRole('button',{name:/^武将名册/}).click();
  await page.getByLabel('名册范围').selectOption('all');await page.getByLabel('检索武将').fill(def.name);
  const row=page.getByRole('row').filter({has:page.getByRole('rowheader',{name:def.name,exact:true})});
  await expect(row).toContainText(`等级 ${a.generals[id].level}`);await expect(row).toContainText(`经验 ${a.generals[id].experience}`);await expect(row).toContainText('体 1 /');
  await page.screenshot({path:'docs/screenshots/policy-annual-roster.png'});expect(errors).toEqual([]);
});

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
  const cao=await council.dialog.getByRole('option',{name:/^曹操 · 智力/}).getAttribute('value');
  await council.dialog.getByLabel('太守人选').selectOption(cao!);
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
  const council=new CouncilPage(page);await council.start(true);
  // A new native officer begins full; import one casualty through the real save UI.
  const save=await council.exportSession(),s=save.session;
  const response=await page.request.get('/assets/content.json'),content=await response.json();
  const cao=content.scenarios[0].generals.find((g:{name:string})=>g.name==='曹操');
  s.generals[cao.id].troops=99;s.generals[cao.id].troopSlots={active:99,reserve:0};s.cities[cao.cityId].troops--;
  await council.importSession(save);await council.finish();
  await page.getByRole('button',{name:'下一天',exact:true}).click();await council.reopen();await council.command('部队征兵');
  // The first native reserve recruit costs100; assignment itself is free.
  await expect(council.dialog.getByText('5,236',{exact:true})).toBeVisible();
  await council.dialog.getByLabel('配兵武将').selectOption({label:'曹操 · 现有99兵'});
  await council.dialog.getByLabel('补充兵数').fill('1');await council.dialog.getByRole('button',{name:'补充部队',exact:true}).click();
  await expect(council.dialog.getByRole('status')).toContainText('补充1兵');
  await expect(council.dialog.getByText('5,236',{exact:true})).toBeVisible();
  await expect(council.dialog.getByRole('button',{name:'补充部队',exact:true})).toBeDisabled();
});

for(const width of [1440,390])test(`search, explicit autonomy, inventory and reports survive save at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:width===1440?1200:844});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/assets/content.json',async route=>{
    const response=await route.fetch(),content=await response.json();
    // Keep native route RNG and item selection; isolate inventory from recruitment.
    for(const scene of content.scenarios){for(const f of scene.factions)f.flagNumber=999;for(const g of scene.generals)if(g.status==='野'){g.status='未';g.cityId=null;}}
    for(const item of content.items)item.RATE=item.SEQUENCE==='1'?'100':'0';
    await route.fulfill({response,json:content});
  });
  const council=new CouncilPage(page);await page.goto('/');await page.getByRole('button',{name:/执掌何進/}).click();
  await council.dialog.getByLabel('治下城池').selectOption({label:'洛陽 · 8将'});
  await council.command('搜索人才');await council.dialog.getByRole('button',{name:'全选未行动武将'}).click();
  await council.dialog.getByRole('button',{name:'执行搜索 · 8将',exact:true}).click();
  await expect(council.dialog.getByRole('status')).toContainText('8将完成搜索');
  await expect(council.dialog.getByRole('checkbox',{name:/曹操/})).toBeDisabled();
  await council.command('物品库');await expect(council.dialog.getByRole('rowheader',{name:'朴刀兵兵符',exact:true})).toBeVisible();
  await page.screenshot({path:`docs/screenshots/policy-inventory-${width}.png`});
  await council.command('城池自治');
  const form=council.dialog.getByRole('form',{name:'设置城池自治'});
  await form.getByRole('radio',{name:/搜索为主/}).check();
  await expect(form.getByText(/已保存：不自治/)).toBeVisible();
  await form.getByRole('button',{name:'保存自治方针',exact:true}).click();
  await expect(form.getByText(/已保存：搜索为主/)).toBeVisible();
  await council.dialog.getByRole('button',{name:'自治施行',exact:true}).click();
  await expect(council.dialog.getByRole('status')).toContainText('共0将');
  await page.screenshot({path:`docs/screenshots/policy-autonomy-${width}.png`});
  await council.command('内政报告');await expect(council.dialog.getByRole('table',{name:'搜索报告 · 最近100次'}).getByRole('row')).toHaveCount(9);
  await page.screenshot({path:`docs/screenshots/policy-search-${width}.png`});
  const save=await council.exportSession();expect(save.session.policy!.search!.reports).toHaveLength(8);
  expect(save.session.policy!.search!.inventory[save.session.factionId]['1']).toBeGreaterThan(0);
  await council.importSession(save);await council.command('物品库');
  await expect(council.dialog.getByRole('rowheader',{name:'朴刀兵兵符',exact:true})).toBeVisible();
  await council.command('城池自治');await expect(council.dialog.getByRole('radio',{name:/搜索为主/})).toBeChecked();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
