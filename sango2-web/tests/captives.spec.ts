import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import type {Session} from '../packages/core/src/index';
import type {GameContent} from '../packages/content/src/index';
import type {buildCaptiveReplays} from './captive-replay';
import {fileURLToPath} from 'node:url';

let replays:ReturnType<typeof buildCaptiveReplays>;
test.beforeAll(async({request,browser,baseURL})=>{
  const response=await request.get('/assets/content.json');expect(response.ok()).toBe(true);
  // Vite loads the same core modules as the game, including source JSON. Node
  // native ESM cannot import those JSON modules without per-file attributes.
  const page=await browser.newPage();
  try {
    await page.goto(new URL('/assets/content.json',baseURL!).href);
    const modulePath=`/@fs/${fileURLToPath(new URL('./captive-replay.ts',import.meta.url)).replace(/\\/g,'/')}`;
    replays=await page.evaluate(async({modulePath,content})=>{const {buildCaptiveReplays}=await import(modulePath);return buildCaptiveReplays(content);},{modulePath,content:await response.json() as GameContent});
  } finally {await page.close();}
});

class CaptivePage {
  constructor(readonly page:Page){}
  async importSession(kind:'pending'|'endgame') {
    const session=structuredClone(replays[kind]);
    await this.page.goto('/');await this.page.getByRole('button',{name:'关闭对话框'}).click();
    await this.page.getByRole('button',{name:'存读档',exact:true}).click();
    await this.page.getByLabel('导入存档',{exact:true}).setInputFiles({name:'capture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'sango2-web-save',session}))});
    return session as Session;
  }
  async exportSession() {
    await this.page.getByRole('navigation',{name:'战后菜单'}).getByRole('button',{name:'存读档',exact:true}).click();
    const pending=this.page.waitForEvent('download');await this.page.getByRole('button',{name:'导出当前战役'}).click();
    const download=await pending;return JSON.parse(await readFile((await download.path())!,'utf8')).session as Session;
  }
  async finishDialogue() {
    const dialogue=this.page.getByRole('region',{name:'俘将对白'});
    for(let i=0;i<5;i++) {
      if(await dialogue.count())await this.page.getByRole('button',{name:'继续对白'}).click();
      await expect.poll(async()=>await this.page.getByRole('main',{name:/武将招降/}).count()===0||await dialogue.count()>0||await this.page.getByRole('button',{name:'招 降',exact:true}).isEnabled()).toBe(true);
      if(await dialogue.count()===0)break;
    }
  }
}

for(const width of [1440,390])test(`prisoner rejection, save and ordered release/recruit at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const ui=new CaptivePage(page),s=await ui.importSession('pending');
  await expect(page.getByRole('main',{name:/武将招降/})).toBeVisible();
  await expect(page.getByRole('button',{name:'招 降',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'招 降',exact:true}).click();
  await expect(page.getByRole('region',{name:'俘将对白'})).toBeVisible();
  const during=await ui.exportSession();
  expect(during.pendingCaptive!.script?.phase).toBe('dialogue');
  const originalDecision=s.pendingCaptive!.current;
  expect(during.pendingCaptive!.current).toEqual(originalDecision);
  await page.getByRole('button',{name:'关闭对话框'}).click();
  await ui.finishDialogue();
  await expect(page.getByRole('status')).toContainText('不肯归降');
  await page.getByRole('button',{name:'招 降',exact:true}).click();
  await ui.finishDialogue();
  const exported=await ui.exportSession();
  expect(exported.pendingCaptive).toEqual(s.pendingCaptive);
  expect(exported.battle!.opponentAI!.rng).not.toEqual(s.battle!.opponentAI!.rng);
  await page.getByRole('button',{name:'保存',exact:true}).first().click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('已保存');await page.reload();
  await page.getByRole('button',{name:'关闭对话框'}).click();await page.getByRole('button',{name:'存读档',exact:true}).click();
  await page.getByRole('button',{name:'读取',exact:true}).first().click();
  await expect(page.getByRole('main',{name:/武将招降/})).toBeVisible();
  await page.getByRole('button',{name:'釋 放',exact:true}).focus();await page.keyboard.press('Enter');
  await ui.finishDialogue();
  await expect(page.getByRole('heading',{level:1})).toBeFocused();
  await expect(page.getByRole('status')).toContainText('1 将候审');
  if(width===1440)await page.screenshot({path:'../docs/images/captives.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'招 降',exact:true}).click();
  await ui.finishDialogue();
  await expect(page.getByRole('main',{name:/武将招降/})).toHaveCount(0);
  await expect(page.getByLabel('天下地图')).toBeVisible();expect(errors).toEqual([]);
});

test('a finished ruler-loss save opens the ending screen and can start another campaign',async({page})=>{
  await new CaptivePage(page).importSession('endgame');
  await expect(page.getByRole('heading',{name:'霸 業 未 成'})).toBeVisible();
  await page.getByRole('button',{name:'再起征程'}).click();
  await expect(page.getByRole('dialog',{name:'择时而起'})).toBeVisible();
});
