import {expect,type Page} from '@playwright/test';

/** Conquest/battle regressions start after the new game's initial council.
 * policy.spec.ts exercises the council itself without skipping any commands. */
export async function finishInitialPolicy(page:Page) {
  await page.getByRole('dialog',{name:'内政经营'}).getByRole('button',{name:'内政終了 · 返回征战',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
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
