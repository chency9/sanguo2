import {finishInitialPolicy} from './campaign-fixture';
import {test,expect,type Page} from '@playwright/test';

class TerrainScreen {
  constructor(readonly page:Page){}
  async open(){
    await this.page.goto('/');await this.page.getByRole('button',{name:/执掌何進/}).click();await finishInitialPolicy(this.page);
    await this.page.getByRole('button',{name:'演武场',exact:true}).click();
    await expect(this.page.getByRole('button',{name:'擂鼓开战'})).toBeEnabled();
  }
  async choose(id:number,variant:'a'|'b'){
    await this.page.getByLabel('演武地形',{exact:true}).selectOption(String(id));
    await this.page.getByLabel('景色',{exact:true}).selectOption(variant);
    await expect(this.page.getByRole('img',{name:'实时战场画面'})).toHaveAttribute('data-scenery',`${id}:${variant}`);
    await expect(this.page.getByRole('button',{name:'擂鼓开战'})).toBeEnabled();
  }
}
test('all 24 terrain variants render without missing assets and select source music',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
  const screen=new TerrainScreen(page);await screen.open();
  const tracks=[6,5,4,4,6,5,4,6,6,5,5,4];
  for(let id=0;id<12;id++)for(const variant of ['a','b'] as const){
    await screen.choose(id,variant);
    await expect(page.locator('audio')).toHaveAttribute('src',`/assets/battle/music-0${tracks[id]}.mp3`);
    await expect(page.getByTestId('battle-attacker-troops')).toHaveText('10');
  }
  await screen.choose(8,'b');await page.screenshot({path:'docs/screenshots/terrain-snow.png'});
  await screen.choose(0,'a');await page.screenshot({path:'docs/screenshots/terrain-city.png'});
  await screen.choose(3,'a');await page.screenshot({path:'docs/screenshots/terrain-ship.png'});
  await page.getByRole('button',{name:'擂鼓开战'}).click();
  await expect(page.getByLabel('演武地形',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'暂停战斗',exact:true})).toBeEnabled();
  expect(errors).toEqual([]);
});

test('failed scenery loads pause the battle and can retry the same selection',async({page})=>{
  const screen=new TerrainScreen(page);await screen.open();
  await page.route('**/terrain-08/**',route=>route.abort());
  await page.getByLabel('演武地形',{exact:true}).selectOption('8');
  await expect(page.getByRole('button',{name:'重新载入战场'})).toBeVisible();
  await expect(page.getByRole('button',{name:'擂鼓开战'})).toBeDisabled();
  await page.unroute('**/terrain-08/**');
  await page.getByRole('button',{name:'重新载入战场'}).click();
  await expect(page.getByRole('button',{name:'擂鼓开战'})).toBeEnabled();
  await expect(page.getByRole('img',{name:'实时战场画面'})).toHaveAttribute('data-scenery','8:a');
  await expect(page.getByTestId('battle-attacker-troops')).toHaveText('10');
});
