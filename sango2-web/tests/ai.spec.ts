import {finishInitialPolicy} from './campaign-fixture';
import {test,expect,type Page} from '@playwright/test';

class DefensePage {
  constructor(readonly page:Page) {}
  async startExposedBorder() {
    // Real assets and scenario; constrain roads and officers to exercise a guaranteed invasion.
    await this.page.route('**/assets/content.json',async route=>{
      const response=await route.fetch(),content=await response.json(),s=content.scenarios[0];
      const home=s.cities.find((c:{name:string})=>c.name==='洛陽');
      const enemy=s.cities.find((c:{name:string})=>c.name==='壺關');
      const defenders=s.generals.filter((g:{cityId:string;ownerId:string;status:string})=>g.cityId===home.id&&g.ownerId===home.ownerId&&g.status==='登');
      defenders.slice(1).forEach((g:{status:string})=>g.status='野');
      const attackers=s.generals.filter((g:{ownerId:string;status:string})=>g.ownerId&&g.ownerId!==home.ownerId&&g.status==='登').slice(0,10);
      attackers.forEach((g:{cityId:string;ownerId:string})=>{g.cityId=enemy.id;g.ownerId=enemy.ownerId;});
      s.roads.forEach((r:{from:string;to:string;restricted:boolean;length:number})=>{
        r.restricted=!([r.from,r.to].includes(home.id)&&[r.from,r.to].includes(enemy.id));
        if(!r.restricted)r.length=120;
      });
      await route.fulfill({response,json:content});
    });
    await this.page.goto('/');await this.page.getByRole('button',{name:/执掌何進/}).click();await finishInitialPolicy(this.page);
  }
  async days(n:number) {for(let i=0;i<n;i++)await this.page.getByRole('button',{name:'下一天',exact:true}).click();}
}

test('enemy invasion warns the player, opens a defensive battle and preserves the controlled side through a save',async({page})=>{
  const game=new DefensePage(page);await game.startExposedBorder();
  const warning=page.getByRole('region',{name:'敌军来袭'});
  // Native candidate lottery includes idle weight 800; no fixed five-day guarantee.
  for(let day=0;day<120&&!await warning.isVisible();day++)await game.days(1);
  await expect(warning).toContainText('董卓 → 洛陽');
  await page.screenshot({path:'docs/screenshots/ai-incoming.png',fullPage:true});
  await game.days(2);
  await expect(page.getByRole('heading',{name:'洛陽之战'})).toBeVisible();
  await expect(page.getByText('敌军来袭 · 我军守城', {exact:true})).toBeVisible();
  await expect(page.getByTestId('battle-attacker-troops')).toHaveText('10');
  await page.getByRole('button',{name:'两军名册'}).click();
  await expect(page.getByRole('region',{name:'我军兵员'}).getByText('在场 10 · 现役 10 · 预备 0 · 超编留营 70',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'两军名册'}).click();
  await page.getByRole('button',{name:'擂鼓开战'}).click();
  await page.getByRole('button',{name:'战中存档'}).click();
  await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).first().click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('已保存');
  await page.reload();await page.getByRole('button',{name:'关闭对话框'}).click();
  await page.getByRole('button',{name:'存读档',exact:true}).click();
  await page.getByRole('button',{name:'读取',exact:true}).first().click();
  await expect(page.getByText('敌军来袭 · 我军守城',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'继续战斗',exact:true})).toBeEnabled();
  await expect(page.getByRole('img',{name:'实时战场画面'})).toHaveAttribute('data-sprite-scale-x',/.+/);
  await page.screenshot({path:'docs/screenshots/ai-defense.png'});
  await page.getByRole('button',{name:'撤离战场'}).click();
  await page.getByLabel('战场速度').selectOption('4');
  await page.getByRole('button',{name:'继续战斗',exact:true}).click();
  await page.getByRole('button',{name:'收兵 · 返回天下'}).click();
  await page.getByLabel('城池范围').selectOption('all');
  await page.getByLabel('城池列表').getByRole('button',{name:/洛陽/}).click();
  await expect(page.getByLabel('城池详情')).toContainText('董卓');
  await expect(page.getByLabel('天下地图').getByRole('button',{name:'洛陽 · 他方 · 董卓',exact:true})).toBeVisible();
});

test('unmodified campaign produces rival expeditions under native weighted decisions',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:/执掌何進/}).click();await finishInitialPolicy(page);
  const game=new DefensePage(page);
  for(let day=0;day<60&&!await page.getByRole('region',{name:'在途部队'}).getByRole('progressbar').count();day++)await game.days(1);
  await expect(page.getByRole('region',{name:'在途部队'})).toContainText(/他方|敌军来袭/);
  await expect(page.getByRole('region',{name:'在途部队'}).getByRole('progressbar')).not.toHaveCount(0);
});
