import {finishInitialPolicy} from './campaign-fixture';
import { expect, test, type Page } from '@playwright/test';
import {delayRivalDecisions} from './campaign-fixture';

class GamePage {
  constructor(readonly page: Page) {}
  async start(legacyTravel=false) {
    await this.page.goto('/');
    await this.page.getByRole('button', { name: '执掌何進 · 开始征程' }).click();await finishInitialPolicy(this.page,legacyTravel);
    await expect(this.page.getByRole('dialog')).toHaveCount(0);
    await expect(this.page.locator('canvas')).toBeVisible();
    await expect(this.page.getByText('正在展开山河图…')).toHaveCount(0);
  }
  async selectCity(name: string) { await this.page.getByLabel('城池列表').getByRole('button', { name: new RegExp(name) }).click(); }
  async next() { await this.page.getByRole('button',{name:'下一天',exact:true}).click(); }
}

test('map identifies own, other and unclaimed cities without relying on flag color',async({page})=>{
  const game=new GamePage(page);await game.start();
  const map=page.getByRole('region',{name:'天下地图'});
  const own=map.getByRole('button',{name:'洛陽 · 我方 · 何進',exact:true});
  const neutral=map.getByRole('button',{name:'安定 · 空城 · 无主',exact:true});
  const other=map.getByRole('button',{name:'壺關 · 他方 · 董卓',exact:true});
  await expect(own).toBeVisible();await expect(own).toContainText('我·何進');
  await expect(neutral).toBeVisible();await expect(neutral).toContainText('空城');
  await expect(other).toBeVisible();await expect(other).toContainText('董卓');
  await other.click();
  await expect(page.getByLabel('城池详情').getByRole('heading',{name:'壺關',exact:true})).toBeVisible();
  await expect(other).toHaveAttribute('aria-pressed','true');
  await neutral.focus();await page.keyboard.press('Enter');
  await expect(page.getByLabel('城池详情').getByRole('heading',{name:'安定',exact:true})).toBeVisible();
  await page.screenshot({path:'docs/screenshots/map-ownership-desktop.png',fullPage:true});
});

test('wheel zoom keeps the city under the cursor and does not scroll the page', async ({ page }) => {
  const game = new GamePage(page); await game.start();
  const box = (await page.locator('canvas').boundingBox())!;
  const scale = Math.min(box.width / 1280, box.height / 960);
  const x = box.x + (box.width - 1280 * scale) / 2 + 382 * scale;
  const y = box.y + (box.height - 960 * scale) / 2 + 448 * scale;
  const before = await page.locator('canvas').screenshot();
  const scroll = await page.evaluate(() => scrollY);
  await page.mouse.move(x,y); await page.mouse.wheel(0,-500);
  await expect.poll(async () => (await page.locator('canvas').screenshot()).equals(before)).toBe(false);
  await page.mouse.click(x,y);
  await expect(page.getByLabel('城池详情').getByRole('heading',{name:'長安',exact:true})).toBeVisible();
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  await expect(page.getByLabel('地图缩放比例')).not.toHaveText('100%');
  await page.getByRole('button',{name:'全图',exact:true}).click();
  await expect(page.getByLabel('地图缩放比例')).toHaveText('100%');
});

test('real content, economy, native dialog focus and map render', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror',e=>errors.push(e.message));
  const game = new GamePage(page); await game.start();
  const map = (await page.locator('canvas').boundingBox())!;
  const scale = Math.min(map.width / 1280, map.height / 960);
  // 長安's original content coordinate verifies that rendered markers and input agree.
  await page.mouse.click(map.x + (map.width - 1280 * scale) / 2 + 382 * scale, map.y + (map.height - 960 * scale) / 2 + 448 * scale);
  await expect(page.getByLabel('城池详情').getByRole('heading',{name:'長安',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'放大地图'}).click();
  await page.getByRole('button',{name:'全图',exact:true}).click();
  await game.selectCity('洛陽');
  await expect(page.getByTestId('city-money')).toHaveText('5,336金');
  await game.next();
  await expect(page.getByTestId('city-money')).toHaveText('5,236金'); // one native passive recruit
  await page.getByRole('button',{name:'武将名册'}).click();
  await expect(page.getByRole('dialog',{name:'群英名册'})).toBeVisible();
  await page.getByRole('searchbox',{name:'检索武将'}).fill('曹操');
  await expect(page.getByRole('rowheader',{name:'曹操'})).toBeVisible();
  // Escape in a nonempty native search input clears its text before dismissing a dialog.
  await page.getByRole('button',{name:'关闭对话框'}).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'武将名册'})).toBeFocused();
  await expect(page.getByText(/地图加载失败/)).toHaveCount(0);
  await page.screenshot({path:'test-results/realm-desktop.png',fullPage:true});
  expect(errors).toEqual([]);
});

for(const width of [1280,390])test(`officer conditions survive export/import and remain keyboard-scrollable at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:844});const game=new GamePage(page);await game.start();
  await page.getByRole('button',{name:'武将名册'}).click();
  const region=page.getByRole('region',{name:'武将名册 · 当前人物状态'});
  await page.getByRole('searchbox',{name:'检索武将'}).fill('曹操');
  await expect(region.getByRole('columnheader',{name:'士气 / 疲劳 / 忠诚'})).toBeAttached();
  await expect(region.getByRole('cell',{name:'士气 80 疲劳 0 · 忠诚 90'})).toBeAttached();
  await region.focus();await expect(region).toBeFocused();
  if(width===390){await page.keyboard.press('ArrowRight');await expect.poll(()=>region.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);}
  await region.getByRole('cell',{name:'士气 80 疲劳 0 · 忠诚 90'}).scrollIntoViewIfNeeded();
  await expect(region.getByRole('cell',{name:'士气 80 疲劳 0 · 忠诚 90'})).toBeInViewport();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`docs/screenshots/officer-condition-${width}.png`});
  await page.getByRole('button',{name:'关闭对话框'}).click();
  await page.getByRole('button',{name:'存读档',exact:true}).click();
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'导出当前战役'}).click();
  const file=await pending,path=await file.path();expect(path).toBeTruthy();
  await page.getByLabel('导入存档',{exact:true}).setInputFiles(path!);
  await page.getByRole('button',{name:'武将名册'}).click();
  await page.getByRole('searchbox',{name:'检索武将'}).fill('曹操');
  await expect(region.getByRole('cell',{name:'士气 80 疲劳 0 · 忠诚 90'})).toBeAttached();
});

test('another page cannot silently overwrite a newer save', async ({ page, context }) => {
  const first = new GamePage(page); await first.start();
  await page.getByRole('button',{name:'存读档',exact:true}).click();
  await expect(page.getByRole('button',{name:'保存',exact:true}).first()).toBeEnabled();
  const secondPage = await context.newPage(); const second = new GamePage(secondPage); await second.start();
  await secondPage.getByRole('button',{name:'存读档',exact:true}).click();
  await expect(secondPage.getByRole('button',{name:'保存',exact:true}).first()).toBeEnabled();
  await page.getByRole('button',{name:'保存',exact:true}).first().click();
  await expect(page.locator('.statusbar').getByRole('status')).toContainText('已保存');
  await secondPage.getByRole('button',{name:'保存',exact:true}).first().click();
  await expect(secondPage.getByRole('alert')).toContainText('另一个页面更新');
  await secondPage.close();
});

test('neutral capture, persistent save, export and invalid import', async ({ page }) => {
  await delayRivalDecisions(page);
  const game = new GamePage(page); await game.start(true); await game.selectCity('長安');
  await page.getByRole('button',{name:'调兵出征'}).click();
  await page.getByLabel('行军目标').selectOption({label:'安定 · 无主 · 预计约 4 天'});
  await page.getByLabel(/出征兵力/).fill('30');
  await page.getByRole('button',{name:'下令出征'}).click();
  await expect(page.getByRole('heading',{name:'在途部队'})).toBeVisible();
  await game.next(); await game.next(); await game.next(); await game.next();
  await game.selectCity('安定'); await expect(page.getByTestId('city-troops')).toHaveText('30人');
  await expect(page.getByLabel('天下地图').getByRole('button',{name:'安定 · 我方 · 何進',exact:true})).toBeVisible();
  await expect(page.getByLabel('天下地图').getByRole('button',{name:'安定 · 空城 · 无主',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'存读档',exact:true}).click();
  await page.getByRole('button',{name:'保存',exact:true}).first().click();
  await expect(page.locator('.statusbar').getByRole('status')).toHaveText('战役已保存到此浏览器。');
  const download = page.waitForEvent('download');
  await page.getByRole('button',{name:'导出当前战役'}).click();
  const artifact = await download; const path = await artifact.path(); expect(path).toBeTruthy();
  await page.getByLabel('导入存档',{exact:true}).setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"format":"wrong"}')});
  await expect(page.getByRole('alert')).toContainText('不是');
  await page.getByLabel('导入存档',{exact:true}).setInputFiles(path!);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload(); await page.getByRole('button',{name:'关闭对话框'}).click();
  await page.getByRole('button',{name:'存读档',exact:true}).click();
  await page.getByRole('button',{name:'读取',exact:true}).first().click();
  await game.selectCity('安定'); await expect(page.getByTestId('city-troops')).toHaveText('30人');
  await expect(page.getByLabel('天下地图').getByRole('button',{name:'安定 · 我方 · 何進',exact:true})).toBeVisible();
});

test('all five eras initialize and phone layout remains operable', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  const game = new GamePage(page); await game.start();
  for (const [year,title] of [[189,'討伐董卓'],[200,'群雄割據'],[208,'赤壁之戰'],[219,'三國鼎立']] as const) {
    await page.getByRole('button',{name:'新征程'}).click();
    await page.getByRole('button',{name:`${year} ${title}`}).click();
    await page.getByRole('button',{name:/执掌.*开始征程/}).click();await finishInitialPolicy(page);
    await expect(page.locator('.campaign-bar')).toContainText(String(year));
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const map=page.getByLabel('天下地图');
  const cityLabels=map.getByRole('button').filter({has:page.locator('strong')});
  const labelCount=await cityLabels.count();
  // Overview labels must not overlap; zoom reveals additional city identities.
  const boxes=await cityLabels.evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}));
  for(let i=0;i<boxes.length;i++)for(let j=0;j<i;j++) {
    const a=boxes[i],b=boxes[j];
    expect(a.x>=b.x+b.w||b.x>=a.x+a.w||a.y>=b.y+b.h||b.y>=a.y+a.h).toBe(true);
  }
  await page.getByRole('button',{name:'放大地图'}).click();
  await expect.poll(()=>cityLabels.count()).toBeGreaterThan(labelCount);
  await page.getByRole('button',{name:'全图',exact:true}).click();
  await page.getByRole('navigation',{name:'游戏菜单'}).getByRole('button',{name:'内政经营',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'内政经营'}).getByRole('button',{name:'执行开发',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'关闭对话框'}).click();
  await page.screenshot({path:'test-results/realm-mobile.png',fullPage:true});
});
