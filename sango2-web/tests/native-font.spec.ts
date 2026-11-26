import {test,expect} from '@playwright/test';
import {finishInitialPolicy} from './campaign-fixture';

test('original bitmap atlas matches source pixels and WOFF2 preserves native advances',async({page},testInfo)=>{
  await page.goto('/assets/fonts/proof.json');
  const proof=await (await page.request.get('/assets/fonts/proof.json')).json();
  const results=await page.evaluate(async proof=>{
    const results=[];
    for(const font of proof.fonts){
      const face=new FontFace(font.family,`url(/assets/fonts/${font.path})`);await face.load();document.fonts.add(face);
      const atlas=new Image();atlas.src=`/assets/fonts/${font.atlas}`;await atlas.decode();
      for(const sample of font.samples){
        const canvas=document.createElement('canvas');canvas.width=sample.width;canvas.height=font.size;
        const context=canvas.getContext('2d')!;context.font=`${font.size}px "${font.family}"`;context.textBaseline='alphabetic';context.fillStyle='#fff';context.fillText(sample.character,0,font.size);
        const data=context.getImageData(0,0,canvas.width,canvas.height).data;let mismatches=0,binaryMismatches=0,fractional=0;
        for(let y=0;y<font.size;y++)for(let x=0;x<sample.width;x++){
          const alpha=data[(y*canvas.width+x)*4+3],expected=sample.pixels[y][x]==='1'?255:0;
          if(alpha!==expected)mismatches++;if((alpha>=128?255:0)!==expected)binaryMismatches++;if(alpha!==0&&alpha!==255)fractional++;
        }
        const width=context.measureText(sample.character).width;context.clearRect(0,0,canvas.width,canvas.height);context.imageSmoothingEnabled=false;
        context.drawImage(atlas,sample.atlas.x,sample.atlas.y,sample.width,font.size,0,0,sample.width,font.size);
        const original=context.getImageData(0,0,canvas.width,canvas.height).data;let atlasMismatches=0;
        for(let y=0;y<font.size;y++)for(let x=0;x<sample.width;x++)if(original[(y*sample.width+x)*4+3]!== (sample.pixels[y][x]==='1'?255:0))atlasMismatches++;
        results.push({size:font.size,character:sample.character,atlasMismatches,binaryMismatches,mismatches,fractional,width,expectedWidth:sample.width});
      }
    }
    return results;
  },proof);
  await testInfo.attach('native-font-pixel-comparison.json',{body:Buffer.from(JSON.stringify(results,null,2)),contentType:'application/json'});
  expect(results).toHaveLength(proof.fonts.reduce((sum:number,font:{samples:unknown[]})=>sum+font.samples.length,0));
  // Chromium applies platform smoothing to WOFF2. Its alpha differences stay
  // in the report. Only the original atlas receives zero-pixel-difference QA.
  expect(results.filter((r:{atlasMismatches:number;width:number;expectedWidth:number})=>r.atlasMismatches||r.width!==r.expectedWidth)).toEqual([]);
});

test('native bitmap canvas helper retains exact pixels, tint and missing-character fallback',async({page})=>{
  await page.goto('/assets/fonts/proof.json');
  const result=await page.evaluate(async()=>{
    const modulePath='/src/native-bitmap-font.ts',{loadNativeBitmapFont,drawNativeBitmapText}=await import(modulePath),font=await loadNativeBitmapFont(20);
    const canvas=document.createElement('canvas');canvas.width=20;canvas.height=20;const context=canvas.getContext('2d')!;
    const width=drawNativeBitmapText(context,font,'三',0,0,'#d0a050'),data=context.getImageData(0,0,20,20).data;
    const proof=await (await fetch('/assets/fonts/proof.json')).json(),expected=proof.fonts.find((f:{size:number})=>f.size===20).samples.find((s:{character:string})=>s.character==='三');
    let mismatches=0;for(let y=0;y<20;y++)for(let x=0;x<20;x++) {
      const offset=(y*20+x)*4,on=expected.pixels[y][x]==='1';
      if(data[offset+3]!== (on?255:0)||on&&(data[offset]!==208||data[offset+1]!==160||data[offset+2]!==80))mismatches++;
    }
    return {width,mismatches,fallback:drawNativeBitmapText(context,font,'🙂',0,0)};
  });
  expect(result).toEqual({width:20,mismatches:0,fallback:null});
});

test('real battle draws original commander labels and HUD names without blocking on font downloads',async({page})=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  await page.route('**/assets/fonts/sango2-15.json',async route=>{await gate;await route.continue();});
  await page.addInitScript(()=>{
    const state=window as unknown as {nativeLabelDraws:number};state.nativeLabelDraws=0;
    const original=CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage=function(this:CanvasRenderingContext2D,image:CanvasImageSource,...args:number[]){
      if(this.canvas.getAttribute('aria-label')==='实时战场画面'&&image instanceof HTMLCanvasElement&&image.width===16&&image.height===15)state.nativeLabelDraws++;
      return Reflect.apply(original,this,[image,...args]);
    } as typeof original;
  });
  await page.goto('/');await page.getByRole('button',{name:/执掌何進/}).click();await finishInitialPolicy(page);
  await page.getByRole('button',{name:'演武场',exact:true}).click();
  await expect(page.getByRole('main').getByRole('button',{name:'擂鼓开战'})).toBeEnabled();
  await expect(page.getByRole('heading',{name:'曹操',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as unknown as {nativeLabelDraws:number}).nativeLabelDraws)).toBe(0);
  release();
  const heading=page.getByRole('heading',{name:'曹操',exact:true}),canvas=heading.locator('canvas');
  await expect(heading.locator('[data-font-ready]')).toHaveAttribute('data-font-ready','true');
  await expect(canvas).toHaveAttribute('width','49');
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {nativeLabelDraws:number}).nativeLabelDraws)).toBeGreaterThan(0);
  const pixels=await canvas.evaluate(node=>{
    const context=(node as HTMLCanvasElement).getContext('2d')!,data=context.getImageData(0,0,49,16).data;
    return [...new Set(Array.from(data).filter((_,index)=>index%4===3))].sort((a,b)=>a-b);
  });
  expect(pixels).toEqual([0,255]);
  await page.screenshot({path:'docs/screenshots/native-font-after.png'});
});

test('battle names retain readable fallback when a source font lacks a character',async({page})=>{
  await page.route('**/assets/content.json',async route=>{
    const response=await route.fetch(),content=await response.json();for(const scene of content.scenarios)for(const g of scene.generals)g.name+='🙂';
    await route.fulfill({response,json:content});
  });
  await page.goto('/');await page.getByRole('button',{name:/执掌何進/}).click();await finishInitialPolicy(page);
  await page.getByRole('button',{name:'演武场',exact:true}).click();
  await expect(page.getByRole('main').getByRole('button',{name:'擂鼓开战'})).toBeEnabled();
  const heading=page.getByRole('heading',{name:'何進🙂',exact:true});await expect(heading).toBeVisible();
  await expect(heading.locator('[data-font-ready]')).toHaveAttribute('data-font-ready','false');
  await expect(heading.locator('canvas')).toBeHidden();
});
