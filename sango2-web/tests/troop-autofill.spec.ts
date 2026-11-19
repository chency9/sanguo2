import {test,expect,type Page} from '@playwright/test';
import type {GameContent} from '../packages/content/src/index';
import {CouncilPage} from './council-page';

async function setup(page:Page) {
  const council=new CouncilPage(page);await council.start();
  const save=await council.exportSession(),s=save.session;
  const content=await (await page.request.get('/assets/content.json')).json() as GameContent;
  const def=content.scenarios[0].generals.find(g=>g.name==='曹操')!,g=s.generals[def.id],cityId=g.cityId!;
  s.cities[cityId].troops+=130-g.troops;Object.assign(g,{level:40,troops:130,troopSlots:{active:60,reserve:70},forceMask:3,currentUnit:'刀'});
  s.nativeAI!.reserves[cityId]=60;
  await council.importSession(save);await council.command('部队征兵');await council.dialog.getByLabel('配兵武将').selectOption(def.id);
  // Freeze the browser clock only after the initial UI has settled. Tests advance
  // actual rAF callbacks rather than relying on wall-clock sleeps.
  const now=new Date();await page.clock.install({time:now});await page.clock.pauseAt(new Date(now.getTime()+10000));
  const allocation=council.dialog.getByRole('region',{name:'兵力调配'}),fill=allocation.getByRole('button',{name:'补满部队',exact:true});
  return {council,save,s,def,cityId,allocation,fill};
}

test('click starts gradual fill; pointer release and reactivation do not stop or duplicate it',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const {council,s,def,cityId,allocation,fill}=await setup(page);
  await fill.click();await expect(allocation.getByText('正在补兵 · 先现役，后预备',{exact:true})).toBeVisible();
  await expect(allocation.getByLabel('目标兵数')).toHaveValue('130');
  await page.clock.runFor(100);const first=Number(await allocation.getByLabel('目标兵数').inputValue());expect(first).toBeGreaterThan(130);expect(first).toBeLessThan(140);
  await fill.click();await page.clock.runFor(100);const second=Number(await allocation.getByLabel('目标兵数').inputValue());expect(second).toBeGreaterThan(first);expect(second-first).toBeLessThan(10);
  await expect(allocation.getByRole('button',{name:'立即完成补兵'})).toBeVisible();
  // The full region is taller than the ordinary dialog viewport. Enlarge only
  // for the documentation capture so the dialog's scrollport does not crop it.
  await page.setViewportSize({width:1440,height:2400});
  await council.dialog.getByRole('region',{name:'曹操部队兵种'}).screenshot({path:'docs/screenshots/troop-autofill-1440.png'});
  await page.clock.runFor(2500);await expect(allocation.getByLabel('目标兵数')).toHaveValue('190');
  await expect(allocation.getByRole('button',{name:'立即完成补兵'})).toHaveCount(0);
  const after=(await council.exportSession()).session;
  expect(after.generals[def.id]).toEqual({...s.generals[def.id],troops:190,troopSlots:{active:100,reserve:90}});
  expect(after.cities[cityId]).toEqual({...s.cities[cityId],troops:s.cities[cityId].troops+60});
  expect(after.nativeAI).toEqual({...s.nativeAI,reserves:{...s.nativeAI!.reserves,[cityId]:0}});
  expect(after.nextId).toBe(s.nextId+1);expect(after.chronicle).toHaveLength(s.chronicle.length+1);expect(after.policy).toEqual(s.policy);expect(after.rng).toBe(s.rng);expect(errors).toEqual([]);
});

test('switching officer finishes the old officer before changing selection',async({page})=>{
  const {council,s,def,cityId,allocation,fill}=await setup(page);
  const other=Object.entries(s.generals).find(([id,g])=>id!==def.id&&g.cityId===cityId&&g.ownerId===s.factionId&&g.status==='登')!;
  await fill.click();await page.clock.runFor(50);await council.dialog.getByLabel('配兵武将').selectOption(other[0]);
  await expect(allocation.getByRole('button',{name:'立即完成补兵'})).toHaveCount(0);
  await page.clock.runFor(1000);const after=(await council.exportSession()).session;
  expect(after.generals[def.id]).toMatchObject({troops:190,troopSlots:{active:100,reserve:90}});
  expect(after.generals[other[0]]).toEqual(other[1]);expect(after.nativeAI!.reserves[cityId]).toBe(0);
});

test('manual soldier edits during autofill change one soldier and preserve pending work',async({page})=>{
  const {council,def,cityId,allocation,fill}=await setup(page);
  await fill.click();await page.clock.runFor(100);
  const target=allocation.getByLabel('目标兵数'),count=Number(await target.inputValue());
  await allocation.getByRole('button',{name:'补充一兵',exact:true}).click();await expect(target).toHaveValue(String(count+1));
  await allocation.getByRole('button',{name:'退回一兵',exact:true}).click();await expect(target).toHaveValue(String(count));
  await target.fill('100');await allocation.getByRole('button',{name:'调整兵力',exact:true}).click();await expect(target).toHaveValue('100');
  await expect(allocation.getByRole('button',{name:'立即完成补兵'})).toBeVisible();
  await page.clock.runFor(100);expect(Number(await target.inputValue())).toBeGreaterThan(100);
  await allocation.getByRole('button',{name:'立即完成补兵'}).click();
  const after=(await council.exportSession()).session;
  expect(after.generals[def.id]).toMatchObject({troops:190,troopSlots:{active:100,reserve:90}});expect(after.nativeAI!.reserves[cityId]).toBe(0);
});

for(const boundary of ['city','section','unit','close','escape','finish','pagehide'] as const)test(`pending fill completes once at ${boundary} boundary`,async({page})=>{
  const {council,s,def,cityId,allocation,fill}=await setup(page);
  await fill.click();await page.clock.runFor(50);
  if(boundary==='city') {
    const other=Object.entries(s.cities).find(([id,c])=>id!==cityId&&c.ownerId===s.factionId)!;
    await council.dialog.getByLabel('治下城池').selectOption(other[0]);
  } else if(boundary==='section')await council.command('内政报告');
  else if(boundary==='unit')await council.dialog.getByRole('button',{name:/^長槍兵/}).click();
  else if(boundary==='close')await council.dialog.getByRole('button',{name:'关闭对话框'}).click();
  else if(boundary==='escape')await page.keyboard.press('Escape');
  else if(boundary==='finish')await council.finish();
  else await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  await page.clock.runFor(1000);
  if(boundary==='pagehide')await expect(allocation.getByRole('button',{name:'立即完成补兵'})).toHaveCount(0);
  const after=(await council.exportSession()).session;
  expect(after.generals[def.id]).toMatchObject({troops:190,troopSlots:{active:100,reserve:90},currentUnit:boundary==='unit'?'槍':'刀'});
  expect(after.nativeAI!.reserves[cityId]).toBe(0);
  expect(after.nextId).toBe(s.nextId+(boundary==='unit'||boundary==='finish'?2:1));
  expect(after.rng).toBe(s.rng);
});

test('reduced motion completes directly and the visible finish button completes on keyboard activation',async({page})=>{
  const {council,save,def,allocation,fill}=await setup(page);
  await page.emulateMedia({reducedMotion:'reduce'});await fill.click();
  await expect(allocation.getByLabel('目标兵数')).toHaveValue('190');await expect(allocation.getByRole('button',{name:'立即完成补兵'})).toHaveCount(0);
  await council.exportSession();await council.importSession(save);await council.command('部队征兵');await council.dialog.getByLabel('配兵武将').selectOption(def.id);
  await page.emulateMedia({reducedMotion:'no-preference'});await fill.focus();await page.keyboard.press('Enter');
  const finish=allocation.getByRole('button',{name:'立即完成补兵'});await expect(finish).toBeVisible();await finish.focus();await page.keyboard.press('Space');
  await expect(allocation.getByLabel('目标兵数')).toHaveValue('190');await expect(finish).toHaveCount(0);
});

test('mobile allocation shows active progress and finishes safely before export',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {council,def,allocation,fill}=await setup(page);await fill.click();await page.clock.runFor(100);
  const finish=allocation.getByRole('button',{name:'立即完成补兵'});await expect(finish).toBeVisible();
  const size=await finish.boundingBox();expect(size!.height).toBeGreaterThanOrEqual(48);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.setViewportSize({width:390,height:2400});
  await allocation.screenshot({path:'docs/screenshots/troop-autofill-390.png'});
  const after=(await council.exportSession()).session;expect(after.generals[def.id].troopSlots).toEqual({active:100,reserve:90});
});
