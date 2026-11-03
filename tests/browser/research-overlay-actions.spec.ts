import {test,expect,chromium,type Browser,type BrowserContext,type Page,type Route} from '@playwright/test';
import {build} from 'esbuild';
import {existsSync} from 'node:fs';
interface Video {id:string;url:string;title:string;source:string;}
interface FixtureWindow {videos:Video[];sourceUrl:string;copied:string[];overlay:{refresh():void;dispose():void;};startCalls:number;decodes:number;}
let browser:Browser,context:BrowserContext,page:Page,bundle:string,requested:string[],unexpected:string[],held:Route[],hold:boolean;
const origin='https://research-actions.test';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZkAAAAASUVORK5CYII=','base64');
test.beforeAll(async()=>{
 bundle=(await build({stdin:{contents:`import {mountResearchOverlay} from './src/content/research-overlay';
 window.sourceUrl='https://www.youtube.com/results?search_query=observed';window.copied=[];window.startCalls=0;window.decodes=0;
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.copied.push(text)}});const bitmap=window.createImageBitmap;window.createImageBitmap=(...args)=>{window.decodes++;return bitmap(...args);};
 window.videos=Array.from({length:205},(_,index)=>({id:String(index).padStart(11,'0'),title:'Item '+String(index).padStart(3,'0'),url:'https://www.youtube.com/'+(index===100?'shorts/':'watch?v=')+String(index).padStart(11,'0'),views:index,source:'youtube-dom'}));window.videos.push({id:'zzzzzzzzzzz',title:'API_ONLY',url:'https://www.youtube.com/watch?v=zzzzzzzzzzz',source:'youtube-data-api'});
 let filter={sort:'default'};const state={phase:'idle',collectedCount:0,steps:0,maxItems:500,maxSteps:30,timeoutMs:60000,url:window.sourceUrl,reason:'Fixture',limitations:[]};window.overlay=mountResearchOverlay(document.querySelector('#host'),{getVideos:()=>window.videos,getFilter:()=>filter,setFilter:next=>{filter=next;},getUrl:()=>window.sourceUrl,collector:{status:()=>state,start:()=>{window.startCalls++;return state;},cancel:()=>state,snapshot:()=>undefined,subscribe:()=>()=>{},dispose:()=>{}}});`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife'})).outputFiles[0].text;
 browser=await chromium.launch({executablePath:process.env.PREVLEV_CHROMIUM_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
});
test.afterAll(async()=>{await browser?.close();});
test.beforeEach(async()=>{
 requested=[];unexpected=[];held=[];hold=false;context=await browser.newContext({acceptDownloads:true});await context.route('**/*',async route=>{
  const url=route.request().url();if(url===origin+'/')return route.fulfill({contentType:'text/html',body:'<div id="host"></div><script src="/fixture.js"></script>'});if(url===origin+'/fixture.js')return route.fulfill({contentType:'text/javascript',body:bundle});
  if(url.startsWith('https://i.ytimg.com/vi/')){requested.push(url);if(hold){held.push(route);return;}return route.fulfill({contentType:'image/png',headers:{'Access-Control-Allow-Origin':'*'},body:png});}
  unexpected.push(url);return route.abort();
 });page=await context.newPage();await page.goto(origin+'/');await page.getByText('Pesquisa avançada e amostra',{exact:true}).click();await page.locator('#prevlev-research-count').click();
});
test.afterEach(async()=>{for(const route of held.splice(0))await route.abort().catch(()=>{});expect(unexpected).toEqual([]);expect(await page.evaluate(()=>(window as unknown as FixtureWindow).startCalls)).toBe(0);await context.close();});
const item=()=>page.locator('#prevlev-research-results article').first();
async function release(){hold=false;for(const route of held.splice(0))await route.fulfill({contentType:'image/png',headers:{'Access-Control-Allow-Origin':'*'},body:png}).catch(()=>{});}
test('each paginated item copies its own Short fields without requesting images during render or paging',async()=>{
 expect(requested).toEqual([]);await page.locator('#prevlev-research-next').click();await expect(page.locator('#prevlev-research-page')).toHaveText('Página 2 de 3');await expect(item().locator('> [data-prevlev-research-video-title]')).toHaveText('Item 100');expect(requested).toEqual([]);
 await item().locator('[data-video-actions-trigger]').hover();await item().locator('[data-video-actions-trigger]').click();for(const action of ['copy-title','copy-id','copy-thumbnail-url']){await item().locator(`[data-video-action="${action}"]`).click();await expect(item().locator(`[data-video-action="${action}"]`)).toBeEnabled();}
 expect(await page.evaluate(()=>(window as unknown as FixtureWindow).copied)).toEqual(['Item 100','00000000100','https://i.ytimg.com/vi/00000000100/hqdefault.jpg']);expect(requested).toEqual([]);expect(await page.locator('#prevlev-research-results').textContent()).not.toContain('API_ONLY');
});
for(const change of ['page','refresh','context','identity','dispose']as const)test(`late thumbnail is discarded after ${change} changes`,async()=>{
 let downloads=0;page.on('download',()=>downloads++);hold=true;await item().locator('[data-video-actions-trigger]').click();await item().locator('[data-video-action="download-png"]').click();await expect.poll(()=>requested.length).toBe(1);
 if(change==='page')await page.locator('#prevlev-research-next').click();
 if(change==='refresh')await page.evaluate(()=>(window as unknown as FixtureWindow).overlay.refresh());
 if(change==='context')await page.evaluate(()=>{(window as unknown as FixtureWindow).sourceUrl='https://www.youtube.com/results?search_query=changed';});
 if(change==='identity')await page.evaluate(()=>{(window as unknown as FixtureWindow).videos[0].title='Reciclado';});
 if(change==='dispose')await page.evaluate(()=>(window as unknown as FixtureWindow).overlay.dispose());
 await release();
 if(change==='context'||change==='identity')await expect(item().locator('[data-video-actions-menu]')).toBeHidden();else if(change==='dispose')await expect(page.locator('[data-prevlev-research-overlay]')).toHaveCount(0);else await expect(item().locator('[data-video-actions-trigger]')).toBeVisible();
 expect(downloads).toBe(0);expect(await page.evaluate(()=>(window as unknown as FixtureWindow).decodes)).toBe(0);expect(requested).toHaveLength(1);
});
