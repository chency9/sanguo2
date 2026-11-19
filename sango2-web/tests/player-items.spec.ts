import {test,expect} from '@playwright/test';
import {CouncilPage} from './council-page';
import type {GameContent} from '../packages/content/src/index';

for(const width of [1440,390])test(`player item allocation, learning, rejection and save at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:width===1440?1200:844});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const council=new CouncilPage(page);await council.start();
  const save=await council.exportSession(),s=save.session,content=await (await page.request.get('/assets/content.json')).json() as GameContent;
  const scene=content.scenarios[0],cao=scene.generals.find(g=>g.name==='曹操')!,g=s.generals[cao.id],before=structuredClone(g);
  g.loyalty=90;g.hp=1;g.mp=1;g.forceMask=1;
  s.policy!.search!.inventory[s.factionId]={'2':2,'14':1,'15':1,'47':1,'48':1,'49':1,'53':1,'54':1,'73':2};
  await council.importSession(save);await council.dialog.getByLabel('治下城池').selectOption(g.cityId!);await council.command('物品库');
  const form=council.dialog.getByRole('form',{name:'势力物品库'}),target=form.getByLabel('分配武将');
  await target.selectOption(cao.id);
  await form.getByRole('radio',{name:'青龍偃月刀',exact:true}).check();await form.getByRole('button',{name:'装备物品',exact:true}).click();
  await expect(council.dialog.getByRole('status')).toContainText('需要等级45');await expect(form.getByText(/^不可使用：/)).toBeFocused();
  // Native selection does not commit; confirm once with keyboard.
  const spear=form.getByRole('radio',{name:'短錐槍',exact:true});await spear.focus();await page.keyboard.press('Space');
  await expect(form.getByRole('region',{name:'曹操当前装备'})).toContainText('直劍');
  await form.getByRole('button',{name:'装备物品',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(council.dialog.getByRole('status')).toContainText('曹操装备短錐槍');await expect(form.getByRole('region',{name:'曹操当前装备'})).toContainText('武力 89');
  const talisman=form.getByRole('radio',{name:'長槍兵兵符',exact:true});await talisman.check();await form.getByRole('button',{name:'使用物品',exact:true}).click();await expect(council.dialog.getByRole('status')).toContainText('曹操使用長槍兵兵符');
  const unit=form.getByLabel('当前兵种');await expect(unit).toHaveValue('刀');await unit.selectOption('槍');await expect(form.getByText('出战兵种：刀',{exact:true})).toBeVisible();await form.getByRole('button',{name:'切换兵种',exact:true}).click();await expect(council.dialog.getByRole('status')).toContainText('当前兵种已切换为槍');await expect(unit).toHaveValue('槍');
  for(const name of ['春秋左傳','史記','青囊書']){
    await form.getByRole('radio',{name,exact:true}).check();await form.getByRole('button',{name:'装备物品',exact:true}).click();await expect(council.dialog.getByRole('status')).toContainText(`曹操装备${name}`);
  }
  await form.getByRole('radio',{name:'卸下随身物品',exact:true}).check();await form.getByRole('button',{name:'卸下随身物品',exact:true}).click();
  await expect(council.dialog.getByRole('status')).toContainText('卸下青囊書');await expect(form.getByRole('radio',{name:'卸下随身物品',exact:true})).toHaveCount(0);
  await form.getByRole('radio',{name:'長槍兵兵符',exact:true}).check();await form.getByRole('button',{name:'使用物品',exact:true}).click();await expect(council.dialog.getByRole('status')).toContainText('已会');
  await form.getByRole('radio',{name:'布匹',exact:true}).check();await form.getByRole('button',{name:'使用物品',exact:true}).click();await expect(form.getByRole('region',{name:'曹操当前装备'})).toContainText('忠诚 94');
  const leader=scene.factions.find(f=>f.id===s.factionId)!.leaderId!;await target.selectOption(leader);
  await form.getByRole('radio',{name:'布匹',exact:true}).check();await form.getByRole('button',{name:'使用物品',exact:true}).click();await expect(council.dialog.getByRole('status')).toContainText('君主');
  await target.selectOption(cao.id);await form.getByRole('radio',{name:'史記',exact:true}).check();await form.getByRole('button',{name:'装备物品',exact:true}).click();
  await expect(form.getByRole('region',{name:'曹操当前装备'})).toContainText('智力 102');
  // Keep the original weapon selected to make the replacement preview visible.
  await form.getByRole('radio',{name:'直劍',exact:true}).check();
  await expect(form.getByRole('button',{name:'装备物品',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const unitBox=await unit.boundingBox(),switchBox=await form.getByRole('button',{name:'切换兵种',exact:true}).boundingBox(),dialogBox=await council.dialog.boundingBox();
  expect(unitBox&&switchBox&&dialogBox).toBeTruthy();expect(unitBox!.x+unitBox!.width).toBeLessThanOrEqual(dialogBox!.x+dialogBox!.width);expect(switchBox!.x+switchBox!.width).toBeLessThanOrEqual(dialogBox!.x+dialogBox!.width);
  if(width===1440)await form.screenshot({path:`docs/screenshots/player-items-${width}.png`});
  else {await form.getByRole('region',{name:'曹操当前装备'}).scrollIntoViewIfNeeded();await page.screenshot({path:`docs/screenshots/player-items-${width}.png`});}
  const after=await council.exportSession(),a=after.session,stock=a.policy!.search!.inventory[a.factionId],ag=a.generals[cao.id];
  expect(ag).toMatchObject({weaponId:15,thingId:49,strength:89,intelligence:102,hp:1,mp:1,loyalty:94,forceMask:3,currentUnit:'槍',maxHp:before.maxHp});
  expect(stock).toEqual({'2':1,'14':2,'47':1,'48':1,'53':1,'54':1,'73':1});
  expect(a.policy!.acted).toEqual(s.policy!.acted);expect(a.nativeAI!.rng).toEqual(s.nativeAI!.rng);
  await council.importSession(after);const restored=await council.exportSession();expect(restored.session).toEqual(a);
  await council.importSession(restored);await council.finish();await council.reopen();await council.command('物品库');await council.dialog.getByLabel('分配武将').selectOption(cao.id);
  await expect(council.dialog.getByLabel('当前兵种')).toHaveValue('槍');
  await council.dialog.getByRole('radio',{name:'春秋左傳',exact:true}).check();await council.dialog.getByRole('button',{name:'装备物品',exact:true}).click();
  await expect(council.dialog.getByRole('status')).toContainText('曹操装备春秋左傳');expect(errors).toEqual([]);
});
