import {test,expect} from '@playwright/test';
import {CouncilPage} from './council-page';
import type {GameContent} from '../packages/content/src/index';

for(const width of [1440,390])test(`native troop choices commit without recruiting at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:width===1440?1200:844});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const council=new CouncilPage(page);await council.start();
  const save=await council.exportSession(),s=save.session,content=await (await page.request.get('/assets/content.json')).json() as GameContent;
  const officer=content.scenarios[0].generals.find(g=>g.name==='曹操')!,g=s.generals[officer.id];
  Object.assign(g,{forceMask:3,currentUnit:'刀'});
  // Zero pool/full soldiers must not prevent changing troop type. Conversely,
  // activating a type must not submit the surrounding recruitment form.
  s.nativeAI!.reserves[g.cityId!]=0;s.policy!.acted.push(officer.id);
  const before=structuredClone(s);await council.importSession(save);
  await council.command('部队征兵');await council.dialog.getByLabel('配兵武将').selectOption(officer.id);
  const choices=council.dialog.getByRole('group',{name:'选择出战兵种'}),region=council.dialog.getByRole('region',{name:'曹操部队兵种'});
  await expect(choices.getByRole('button')).toHaveCount(13);
  await expect(choices.getByRole('button',{name:/^大刀兵/})).toBeDisabled();
  await expect(choices.getByRole('button',{name:/^朴刀兵/})).toHaveAttribute('aria-pressed','true');
  const spear=choices.getByRole('button',{name:/^長槍兵/});
  await spear.focus();await page.keyboard.press('Enter');
  await expect(spear).toHaveAttribute('aria-pressed','true');await expect(spear).toBeFocused();
  await expect(region.getByText('出战兵种：長槍兵',{exact:true})).toBeVisible();
  await expect(council.dialog.getByRole('status')).toContainText('当前兵种已切换为槍');
  await page.keyboard.press('Space');await expect(spear).toHaveAttribute('aria-pressed','true');
  await expect(council.dialog.getByRole('button',{name:'补充部队',exact:true})).toBeDisabled();
  const groupBox=await choices.boundingBox(),dialogBox=await council.dialog.boundingBox(),buttonBox=await spear.boundingBox();
  expect(groupBox&&dialogBox&&buttonBox).toBeTruthy();expect(groupBox!.x).toBeGreaterThanOrEqual(dialogBox!.x);expect(groupBox!.x+groupBox!.width).toBeLessThanOrEqual(dialogBox!.x+dialogBox!.width);
  expect(buttonBox!.height).toBeGreaterThanOrEqual(48);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(width===1440)await region.screenshot({path:`docs/screenshots/troop-selection-${width}.png`});
  else {await choices.scrollIntoViewIfNeeded();await page.screenshot({path:`docs/screenshots/troop-selection-${width}.png`});}
  const after=await council.exportSession(),a=after.session;
  expect(a.generals).toEqual({...before.generals,[officer.id]:{...before.generals[officer.id],currentUnit:'槍'}});
  expect(a.policy).toEqual(before.policy);expect(a.cities).toEqual(before.cities);expect(a.nativeAI).toEqual(before.nativeAI);expect(a.rng).toBe(before.rng);
  await council.importSession(after);await council.command('部队征兵');await council.dialog.getByLabel('配兵武将').selectOption(officer.id);
  await expect(council.dialog.getByRole('button',{name:/^長槍兵/})).toHaveAttribute('aria-pressed','true');
  const other=Object.keys(before.generals).find(id=>id!==officer.id&&before.generals[id].cityId===g.cityId&&before.generals[id].ownerId===s.factionId&&before.generals[id].status==='登'&&!before.generals[id].armyId)!;
  expect(other).toBeTruthy();await council.dialog.getByLabel('配兵武将').selectOption(other);await expect(council.dialog.getByRole('region',{name:'曹操部队兵种'})).toHaveCount(0);await council.dialog.getByLabel('配兵武将').selectOption(officer.id);
  await council.finish();await council.reopen();await council.command('部队征兵');await council.dialog.getByLabel('配兵武将').selectOption(officer.id);
  await council.dialog.getByRole('button',{name:/^朴刀兵/}).click();await expect(council.dialog.getByRole('button',{name:/^朴刀兵/})).toHaveAttribute('aria-pressed','true');
  expect(errors).toEqual([]);
});
