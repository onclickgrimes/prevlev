import {test,expect,chromium,type Browser,type BrowserContext,type Page} from '@playwright/test';
import {build} from 'esbuild';
import {existsSync} from 'node:fs';

interface RaceFixture {calls:number;finished:number;hold:boolean;release?:()=>void;}
let browser:Browser,context:BrowserContext,page:Page,bundle:string;
test.beforeAll(async()=>{
 bundle=(await build({stdin:{contents:`import {initImageTools} from './src/ui/images';const state={calls:0,finished:0,hold:false};Object.assign(window,{imageRace:state});const bitmap=window.createImageBitmap;window.createImageBitmap=async(...args)=>{state.calls++;if(state.hold)await new Promise(resolve=>state.release=resolve);try{return await bitmap(...args);}finally{state.finished++;}};initImageTools();`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife'})).outputFiles[0].text;
 browser=await chromium.launch({executablePath:process.env.PREVLEV_CHROMIUM_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
});
test.afterAll(async()=>{await browser?.close();});
test.beforeEach(async()=>{context=await browser.newContext();await context.route('**/*',route=>{if(route.request().url()==='http://localhost:9418/')return route.fulfill({contentType:'text/html',body:'<section id="images"></section><script src="/bundle.js"></script>'});if(route.request().url()==='http://localhost:9418/bundle.js')return route.fulfill({contentType:'text/javascript',body:bundle});return route.abort();});page=await context.newPage();await page.goto('http://localhost:9418/');});
test.afterEach(async()=>{await context.close();});
test('selecting the illustrative source during a pending render reports cancellation instead of leaving a permanent composing status',async()=>{
 const buffer=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=80;c.height=40;c.getContext('2d')!.fillRect(0,0,80,40);return c.toDataURL().split(',')[1];}),'base64');
 await page.locator('#image-file').setInputFiles({name:'own.png',mimeType:'image/png',buffer});await page.locator('#image-preview').click();await expect(page.locator('#image-output')).toBeVisible();
 await page.evaluate(()=>{(window as unknown as {imageRace:RaceFixture}).imageRace.hold=true;});await page.locator('#preview-feed').selectOption('trending');await expect.poll(()=>page.evaluate(()=>(window as unknown as {imageRace:RaceFixture}).imageRace.calls)).toBe(2);await expect(page.locator('#preview-status')).toContainText('Compondo');
 await page.locator('#preview-source').selectOption('illustrative');await page.evaluate(()=>{const state=(window as unknown as {imageRace:RaceFixture}).imageRace;state.hold=false;state.release!();});await expect.poll(()=>page.evaluate(()=>(window as unknown as {imageRace:RaceFixture}).imageRace.finished)).toBe(2);
 await expect(page.locator('#image-output')).toBeHidden();await expect(page.locator('#image-variants img')).toHaveCount(0);const cancelledStatus=await page.locator('#preview-status').textContent();
 // A fresh render succeeds, proving that the physical resource gate was released.
 await page.locator('#image-preview').click();await expect(page.locator('#image-output')).toBeVisible();expect(cancelledStatus).toContain('ilustrativo');expect(cancelledStatus).not.toContain('Compondo');
});
