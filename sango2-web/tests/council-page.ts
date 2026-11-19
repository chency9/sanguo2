import {expect,type Page} from '@playwright/test';
import {delayRivalDecisions} from './campaign-fixture';
import {readFile} from 'node:fs/promises';
import type {Session} from '../packages/core/src/index';

export class CouncilPage {
  constructor(readonly page:Page){}
  get dialog(){return this.page.getByRole('dialog',{name:'内政经营'});}
  async start(recruitFixture=false){await delayRivalDecisions(this.page);if(recruitFixture)await this.page.route('**/assets/content.json',async route=>{const response=await route.fetch(),content=await response.json();for(const scene of content.scenarios){for(const f of scene.factions)f.flagNumber=999;scene.generals.find((g:{name:string})=>g.name==='曹操').level=20;}await route.fulfill({response,json:content});});await this.page.goto('/');await this.page.getByRole('button',{name:/执掌何進/}).click();await expect(this.dialog).toBeVisible();}
  async command(name:string){await this.dialog.getByRole('navigation',{name:'内政命令'}).getByRole('button',{name,exact:false}).click();}
  async finish(){await this.dialog.getByRole('button',{name:'内政終了 · 返回征战'}).click();await expect(this.dialog).toHaveCount(0);}
  async reopen(){await this.page.getByRole('navigation',{name:'游戏菜单'}).getByRole('button',{name:'内政经营',exact:true}).click();}
  async exportSession(){
    if(await this.dialog.count())await this.dialog.getByRole('button',{name:'关闭对话框'}).click();
    await this.page.getByRole('button',{name:'存读档',exact:true}).click();
    const pending=this.page.waitForEvent('download');await this.page.getByRole('button',{name:'导出当前战役'}).click();
    const download=await pending,path=await download.path();expect(path).toBeTruthy();
    return JSON.parse(await readFile(path!,'utf8')) as {format:string;session:Session};
  }
  async importSession(value:unknown){
    await this.page.getByLabel('导入存档',{exact:true}).setInputFiles({name:'policy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
    await expect(this.page.getByRole('button',{name:'导出当前战役',exact:true})).toHaveCount(0);
  }
}

