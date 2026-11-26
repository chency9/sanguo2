import {expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';

/** Conquest/battle regressions start after the new game's initial council.
 * policy.spec.ts exercises the council itself without skipping any commands. */
export async function finishInitialPolicy(page:Page,legacyTravel=false) {
  await page.getByRole('dialog',{name:'内政经营'}).getByRole('button',{name:'内政終了 · 返回征战',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  if(legacyTravel) {
    // Old three-day encounter regressions explicitly exercise retained legacy
    // travel. Keep native initialization, equipment and soldier slots intact.
    await page.getByRole('button',{name:'存读档',exact:true}).click();
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:'导出当前战役'}).click();
    const save=JSON.parse(await readFile((await (await pending).path())!,'utf8'));
    delete save.session.movementRules;delete save.session.captureRules;
    await page.getByLabel('导入存档',{exact:true}).setInputFiles({name:'legacy-travel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(save))});
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
}

/** Isolate player economy/capture/save regressions from simultaneous AI encounters.
 * AI behavior is exercised separately with unmodified countdowns in ai.spec.ts.
 */
export async function delayRivalDecisions(page:Page) {
  await page.route('**/assets/content.json',async route=>{
    const response=await route.fetch(),content=await response.json();
    for(const scene of content.scenarios)for(const faction of scene.factions)faction.flagNumber=999;
    await route.fulfill({response,json:content});
  });
}
