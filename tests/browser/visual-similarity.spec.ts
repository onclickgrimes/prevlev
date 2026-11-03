import {test,expect,chromium,type Browser,type BrowserContext,type Page} from '@playwright/test';
import {build} from 'esbuild';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import type {compareLocalImages} from '../../src/core/visual-similarity';
interface FixtureWindow {visual:{compareLocalImages:typeof compareLocalImages};}
let browser:Browser,context:BrowserContext,page:Page,script:string,unexpected:string[];
test.beforeAll(async()=>{
  script=(await build({stdin:{contents:"import {initVisualSimilarityTools} from './src/ui/visual-similarity';import {compareLocalImages} from './src/core/visual-similarity';Object.assign(window,{visual:{compareLocalImages}});initVisualSimilarityTools();",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser',target:'chrome120'})).outputFiles[0].text;
  browser=await chromium.launch({executablePath:process.env.PREVLEV_CHROMIUM_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
});
test.afterAll(async()=>{await browser?.close();});
test.beforeEach(async()=>{
  context=await browser.newContext({acceptDownloads:true});unexpected=[];
  await context.route('**/*',route=>{const url=route.request().url();if(url==='http://localhost:9398/')return route.fulfill({contentType:'text/html',body:'<!doctype html><section id="visual-similarity"></section><script src="fixture.js"></script>'});if(url==='http://localhost:9398/fixture.js')return route.fulfill({contentType:'text/javascript',body:script});unexpected.push(url);return route.abort();});
  page=await context.newPage();await page.goto('http://localhost:9398/');
});
test.afterEach(async()=>{expect(unexpected).toEqual([]);await context.close();});
async function png(pattern:'descending'|'ascending'|'transparent'|'white',width=90,height=80):Promise<Buffer>{
  const data=await page.evaluate(({pattern,width,height})=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d')!;if(pattern!=='transparent'){for(let x=0;x<width;x++){const v=pattern==='white'?255:Math.round(255*(pattern==='descending'?1-x/(width-1):x/(width-1)));ctx.fillStyle=`rgb(${v},${v},${v})`;ctx.fillRect(x,0,1,height);}}return canvas.toDataURL().split(',')[1];},{pattern,width,height});return Buffer.from(data,'base64');
}
test('ranks decoded pixels, reports identical bytes and invalid files, previews and exports',async()=>{
  const original=await png('descending'),inverse=await png('ascending'),small=await png('descending',180,160);
  await page.locator('#visual-reference').setInputFiles({name:'reference.png',mimeType:'image/png',buffer:original});
  await page.locator('#visual-candidates').setInputFiles([{name:'inverse.png',mimeType:'image/png',buffer:inverse},{name:'duplicate.png',mimeType:'image/png',buffer:original},{name:'resized.png',mimeType:'image/png',buffer:small},{name:'bad.png',mimeType:'image/png',buffer:Buffer.from('not an image')}]);
  await page.locator('#visual-compare').click();await expect(page.locator('#visual-status')).toContainText('3 imagem(ns) comparada(s); 1 inválida(s)');
  const rows=page.locator('#visual-results ol li');await expect(rows).toHaveCount(3);await expect(rows.nth(0)).toContainText('duplicate.png: 100.00%');await expect(rows.nth(0)).toContainText('bytes duplicados');await expect(rows.nth(1)).toContainText('resized.png: 100.00%');await expect(rows.nth(2)).toContainText('inverse.png: 0.00%');await expect(page.locator('#visual-results')).toContainText('bad.png');await expect(page.locator('#visual-results img')).toHaveCount(4);
  const dl=page.waitForEvent('download');await page.locator('#visual-json').click();const result=await dl;expect(result.suggestedFilename()).toBe('prevlev-similaridade-visual.json');const json=JSON.parse(await readFile((await result.path())!,'utf8'));expect(json.matches.map((m:{name:string})=>m.name)).toEqual(['duplicate.png','resized.png','inverse.png']);expect(json.invalid[0].name).toBe('bad.png');
  const csvDownload=page.waitForEvent('download');await page.locator('#visual-csv').click();expect(await readFile((await (await csvDownload).path())!,'utf8')).toContain('bad.png');
  await page.locator('#visual-candidates').setInputFiles([]);await expect(page.locator('#visual-json')).toBeDisabled();await expect(page.locator('#visual-results img')).toHaveCount(0);
});
test('transparent pixels compare as white and bounded work cancels and times out',async()=>{
  const white=await png('white'),transparent=await png('transparent');
  const result=await page.evaluate(async({white,transparent})=>{
    const file=(data:string,name:string)=>new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],name,{type:'image/png'});
    const core=(window as unknown as FixtureWindow).visual,base=file(white,'white.png'),candidate=file(transparent,'transparent.png');
    const report=await core.compareLocalImages(base,[candidate]);
    const original=window.createImageBitmap;window.createImageBitmap=(()=>new Promise<ImageBitmap>(()=>{})) as typeof createImageBitmap;
    const controller=new AbortController();const cancelling=core.compareLocalImages(base,[candidate],{signal:controller.signal}).catch(error=>(error as Error).name);setTimeout(()=>controller.abort(),10);
    const timeout=core.compareLocalImages(base,[candidate],{durationMs:20}).catch(error=>(error as Error).message);
    const cancellation=await cancelling,limit=await timeout;window.createImageBitmap=original;
    return {match:report.matches[0],cancellation,limit};
  },{white:white.toString('base64'),transparent:transparent.toString('base64')});
  expect(result.match.similarity).toBe(100);expect(result.cancellation).toBe('AbortError');expect(result.limit).toContain('Tempo limite');
});
test('rejects a decoded image above the pixel limit',async()=>{
  const large=await png('white',4500,4500),small=await png('white');
  await page.locator('#visual-reference').setInputFiles({name:'small.png',mimeType:'image/png',buffer:small});await page.locator('#visual-candidates').setInputFiles({name:'large.png',mimeType:'image/png',buffer:large});await page.locator('#visual-compare').click();await expect(page.locator('#visual-results')).toContainText('excede 20 megapixels');await expect(page.locator('#visual-status')).toContainText('0 imagem(ns) comparada(s); 1 inválida(s)');
});
test('cancel button interrupts an in-flight comparison without exposing a stale export',async()=>{
  const data=await png('descending');await page.locator('#visual-reference').setInputFiles({name:'reference.png',mimeType:'image/png',buffer:data});await page.locator('#visual-candidates').setInputFiles({name:'candidate.png',mimeType:'image/png',buffer:data});
  await page.evaluate(()=>{window.createImageBitmap=(()=>new Promise<ImageBitmap>(()=>{})) as typeof createImageBitmap;});
  await page.locator('#visual-compare').click();await expect(page.locator('#visual-cancel')).toBeEnabled();await page.locator('#visual-cancel').click();await expect(page.locator('#visual-status')).toContainText('cancelada');await expect(page.locator('#visual-json')).toBeDisabled();await expect(page.locator('#visual-compare')).toBeEnabled();
});
test('accepts genuine static JPEG and WebP produced by the browser',async()=>{
  const result=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=90;canvas.height=80;const ctx=canvas.getContext('2d')!;
    for(let x=0;x<90;x++){const value=255-Math.round(x*255/89);ctx.fillStyle=`rgb(${value},${value},${value})`;ctx.fillRect(x,0,1,80);}
    const encode=async(type:string)=>{const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),type));return new File([blob],type==='image/jpeg'?'source.jpg':'candidate.webp',{type});};
    const jpeg=await encode('image/jpeg'),webp=await encode('image/webp');return (window as unknown as FixtureWindow).visual.compareLocalImages(jpeg,[webp]);
  });
  expect(result.invalid).toEqual([]);expect(result.matches).toHaveLength(1);expect(result.matches[0].similarity).toBeGreaterThan(90);
});
