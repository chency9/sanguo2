import {test,expect} from '@playwright/test';
import {CouncilPage} from './council-page';
import type {GameContent} from '../packages/content/src/index';

for(const width of [1440,390])test(`bidirectional allocation conserves troops and obeys city capacity at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:width===1440?1200:844});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const council=new CouncilPage(page);await council.start();
  const save=await council.exportSession(),s=save.session,content=await (await page.request.get('/assets/content.json')).json() as GameContent;
  const officer=content.scenarios[0].generals.find(g=>g.name==='曹操')!,g=s.generals[officer.id],cityId=g.cityId!,city=s.cities[cityId];
  city.troops+=130-g.troops;city.population=100000;Object.assign(g,{level:40,troops:130,troopSlots:{active:60,reserve:70},forceMask:3,currentUnit:'刀'});
  s.nativeAI!.reserves[cityId]=10;s.policy!.acted.push(officer.id);const before=structuredClone(s);
  async function open(){await council.command('部队征兵');await council.dialog.getByLabel('配兵武将').selectOption(officer.id);}
  await council.importSession(save);await open();
  const allocation=council.dialog.getByRole('region',{name:'兵力调配'}),form=allocation.getByRole('form',{name:'调整部队兵力'}),target=form.getByLabel('目标兵数'),slider=form.getByRole('slider',{name:'兵力滑条'});
  expect(await page.locator('form form').count()).toBe(0);
  await target.fill('201');await form.getByRole('button',{name:'调整兵力',exact:true}).click();
  await expect(target).toBeFocused();await expect(council.dialog.getByLabel('配兵武将')).toContainText('曹操 · 现有130兵');
  // Native range movement edits a target; commit only with the submit button.
  await slider.focus();await page.keyboard.press('End');await expect(target).toHaveValue('200');
  await expect(form.getByText('调整后：现役 70 · 预备 70城内预备池 0 · 已到可分配边界',{exact:true})).toBeVisible();
  await expect(council.dialog.getByLabel('配兵武将')).toContainText('曹操 · 现有130兵');
  await form.getByRole('button',{name:'调整兵力',exact:true}).click();
  await expect(council.dialog.getByRole('status')).toContainText('现役70、预备70');
  await allocation.getByRole('button',{name:'退回一兵',exact:true}).click();await expect(council.dialog.getByRole('status')).toContainText('现役69、预备70');
  await allocation.getByRole('button',{name:'补充一兵',exact:true}).focus();await page.keyboard.press('Space');await expect(council.dialog.getByRole('status')).toContainText('现役70、预备70');
  await allocation.getByRole('button',{name:'尽量退回',exact:true}).click();await expect(council.dialog.getByRole('status')).toContainText('现役0、预备0，城内预备池140');
  await allocation.getByRole('button',{name:'补满部队',exact:true}).click();await allocation.getByRole('button',{name:'立即完成补兵'}).click();await expect(council.dialog.getByRole('status')).toContainText('现役100、预备40，城内预备池0');
  await council.dialog.getByRole('button',{name:/^長槍兵/}).click();
  const after=await council.exportSession(),a=after.session;
  expect(a.generals[officer.id]).toEqual({...before.generals[officer.id],troops:140,troopSlots:{active:100,reserve:40},currentUnit:'槍'});
  expect(a.policy).toEqual(before.policy);expect(a.cities[cityId]).toEqual({...before.cities[cityId],troops:before.cities[cityId].troops+10});
  expect(a.nativeAI).toEqual({...before.nativeAI,reserves:{...before.nativeAI!.reserves,[cityId]:0}});expect(a.rng).toBe(before.rng);
  // One free city slot allows exactly one soldier back, even with seven in hand.
  const second=structuredClone(after),b=second.session,bg=b.generals[officer.id];b.cities[cityId].troops+=7-bg.troops;Object.assign(bg,{troops:7,troopSlots:{active:2,reserve:5}});b.nativeAI!.reserves[cityId]=149;
  await council.importSession(second);await open();await allocation.getByRole('button',{name:'尽量退回',exact:true}).click();
  await expect(council.dialog.getByRole('status')).toContainText('现役1、预备5，城内预备池150');await expect(allocation.getByRole('button',{name:'退回一兵',exact:true})).toBeDisabled();
  await expect(target).toHaveValue('6');await expect(slider).toHaveValue('6');
  const box=await allocation.boundingBox(),dialog=await council.dialog.boundingBox();expect(box&&dialog).toBeTruthy();expect(box!.x).toBeGreaterThanOrEqual(dialog!.x);expect(box!.x+box!.width).toBeLessThanOrEqual(dialog!.x+dialog!.width);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const button of await allocation.getByRole('button').all()){const size=await button.boundingBox();expect(size!.height).toBeGreaterThanOrEqual(48);}
  if(width===1440)await council.dialog.getByRole('region',{name:'曹操部队兵种'}).screenshot({path:`docs/screenshots/troop-transfer-${width}.png`});
  else await allocation.screenshot({path:`docs/screenshots/troop-transfer-${width}.png`});
  const full=await council.exportSession();expect(full.session.generals[officer.id].troopSlots).toEqual({active:1,reserve:5});
  await council.importSession(full);await council.finish();await council.reopen();await open();
  await expect(target).toHaveValue('6');await allocation.getByRole('button',{name:'补满部队',exact:true}).click();await allocation.getByRole('button',{name:'立即完成补兵'}).click();
  await expect(council.dialog.getByRole('status')).toContainText('现役100、预备56，城内预备池0');
  expect(errors).toEqual([]);
});
