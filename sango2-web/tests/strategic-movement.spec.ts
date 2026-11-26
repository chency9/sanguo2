import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import type {Session} from '../packages/core/src/index';
import type {buildMovementReplays} from './movement-replay';

let replays:ReturnType<typeof buildMovementReplays>;
test.beforeAll(async({request,browser,baseURL})=>{
  const response=await request.get('/assets/content.json');expect(response.ok()).toBe(true);
  const page=await browser.newPage();
  try {
    await page.goto(new URL('/assets/content.json',baseURL!).href);
    const modulePath=`/@fs/${fileURLToPath(new URL('./movement-replay.ts',import.meta.url)).replace(/\\/g,'/')}`;
    replays=await page.evaluate(async({modulePath,content})=>{const {buildMovementReplays}=await import(modulePath);return buildMovementReplays(content);},{modulePath,content:await response.json()});
  } finally {await page.close();}
});

class MovementPage {
  constructor(readonly page:Page){}
  async importSession(kind:'initial'|'travelling'|'encounter'|'finished') {
    await this.page.goto('/');await this.page.getByRole('button',{name:'关闭对话框'}).click();
    await this.page.getByRole('button',{name:'存读档',exact:true}).click();
    await this.page.getByLabel('导入存档',{exact:true}).setInputFiles({name:'source-road.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'sango2-web-save',session:replays[kind]}))});
  }
  async exportSession(inBattle=false) {
    await this.page.getByRole('button',{name:inBattle?'战中存档':'存读档',exact:true}).click();
    const pending=this.page.waitForEvent('download');await this.page.getByRole('button',{name:'导出当前战役'}).click();
    return JSON.parse(await readFile((await (await pending).path())!,'utf8')).session as Session;
  }
  async restoreSlotOne() {
    // Each test owns an isolated browser context and therefore its first slot.
    await this.page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).first().click();
    await expect(this.page.getByRole('dialog').getByRole('status')).toContainText('已保存');
    await this.page.reload();await this.page.getByRole('button',{name:'关闭对话框'}).click();
    await this.page.getByRole('button',{name:'存读档',exact:true}).click();
    await this.page.getByRole('dialog').getByRole('button',{name:'读取',exact:true}).first().click();
  }
}

test('source march estimates use the real route and expose travel limitations to assistive technology',async({page})=>{
  const ui=new MovementPage(page);await ui.importSession('initial');
  const response=await page.request.get('/assets/content.json'),content=await response.json(),scene=content.scenarios[0];
  const from=scene.cities.find((c:{id:string})=>c.id===replays.from),to=scene.cities.find((c:{id:string})=>c.id===replays.to);
  await page.getByLabel('城池列表').getByRole('button',{name:new RegExp(from.name)}).click();
  await page.getByRole('button',{name:'调兵出征'}).click();
  const target=page.getByRole('combobox',{name:'行军目标'});await target.selectOption(replays.roadId);
  await expect(target).toHaveAttribute('aria-describedby','march-travel-help');
  await expect(target).toHaveAccessibleDescription(/途中遇敌.*停驻.*退军/);
  const option=target.getByRole('option').filter({hasText:to.name}),label=(await option.textContent())!;
  expect(label).toMatch(/预计约 \d+ 天/);expect(Number(label.match(/预计约 (\d+) 天/)![1])).toBeGreaterThan(3);
});

for(const width of [1440,390])test(`source road encounter and frozen partial day survive save/load at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const ui=new MovementPage(page);await ui.importSession('encounter');
  await expect(page.getByRole('heading',{name:'两军途中遭遇之战'})).toBeVisible();
  await expect(page.getByText('两军遭遇',{exact:true})).toBeVisible();
  const saved=await ui.exportSession(true);
  expect(saved.battle!.cityId).toBeNull();expect(saved.battle!.fortifications).toBeUndefined();
  expect(saved.battle!.roadEncounter).toEqual(replays.encounter.battle!.roadEncounter);
  expect(saved.nativeMovementClock).toEqual(replays.encounter.nativeMovementClock);
  expect(saved.nativeMovementClock!.callbackInDay).toBeGreaterThan(0);
  await ui.restoreSlotOne();
  await expect(page.getByRole('heading',{name:'两军途中遭遇之战'})).toBeVisible();
  const restored=await ui.exportSession(true);
  expect(restored.armies).toEqual(saved.armies);expect(restored.nativeMovementClock).toEqual(saved.nativeMovementClock);
  expect(restored.battle).toEqual(saved.battle);expect(errors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(width===1440){await page.getByRole('button',{name:'关闭对话框'}).click();await page.screenshot({path:'../docs/images/road-encounter.png'});}
});

test('victory pauses the source army while defeated troops keep retreating on the world map',async({page})=>{
  const ui=new MovementPage(page);await ui.importSession('finished');
  await page.getByRole('button',{name:'收兵 · 返回天下'}).click();
  const troops=page.getByRole('region',{name:'在途部队'});
  await expect(troops).toContainText('整军停驻');await expect(troops).toContainText('撤退中');
  await page.screenshot({path:'../docs/images/road-retreat.png',fullPage:true});
  const before=await ui.exportSession();expect(before.armies).toEqual(replays.aftermath.armies);
  expect(before.nativeMovementClock).toEqual(replays.aftermath.nativeMovementClock);
  await page.getByRole('button',{name:'关闭对话框'}).click();
  await page.getByRole('button',{name:'下一天',exact:true}).click();
  const after=await ui.exportSession();
  expect(after.day).toBe(before.day+1);expect(after.armies).toHaveLength(2);
  const victory=before.armies.find(a=>(a.nativeMovement!.flags&2)!==0)!,retreat=before.armies.find(a=>(a.nativeMovement!.flags&4)!==0)!;
  const nextVictory=after.armies.find(a=>a.id===victory.id)!,nextRetreat=after.armies.find(a=>a.id===retreat.id)!;
  expect([nextVictory.nativeMovement!.px,nextVictory.nativeMovement!.py]).toEqual([victory.nativeMovement!.px,victory.nativeMovement!.py]);
  expect([nextRetreat.nativeMovement!.px,nextRetreat.nativeMovement!.py]).not.toEqual([retreat.nativeMovement!.px,retreat.nativeMovement!.py]);
  expect(after.nativeMovementClock).toBeUndefined();
  expect(after.movementRules).toBe('native-strategic-v1');expect(after.captureRules).toBe('native-capture-v1');
});
