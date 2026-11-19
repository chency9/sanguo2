import type {Page} from '@playwright/test';

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
