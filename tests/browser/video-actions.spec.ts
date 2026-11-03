import {test,expect,chromium,type Browser,type BrowserContext,type Page} from '@playwright/test';
import {build} from 'esbuild';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
interface State {requests:string[];copied:string[];images:{type:string;bytes:number}[];data:{mime:string;base64:string};hold:boolean;release?:()=>void;current:{id:string;url:string;title:string;source:string}[];decodes:number;}
interface FixtureWindow {actionsState:State;}
let browser:Browser,context:BrowserContext,page:Page,bundle:string,external:string[];
const origin='https://video-actions.test';
test.beforeAll(async()=>{
 bundle=(await build({stdin:{contents:`import {mountVideoActions} from './src/ui/video-actions';
 const state={requests:[],copied:[],images:[],data:{mime:'image/png',base64:''},hold:false,current:[{id:'abcdefghijk',url:'https://www.youtube.com/watch?v=abcdefghijk',title:'Título A',source:'youtube-dom'},{id:'bbbbbbbbbbb',url:'https://www.youtube.com/shorts/bbbbbbbbbbb',title:'Título Short B',source:'public-page'},{id:'ccccccccccc',url:'https://www.youtube.com/watch?v=ccccccccccc',title:'Título API',source:'youtube-data-api'}],decodes:0};
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>state.copied.push(text),write:async items=>{const blob=await items[0].getType('image/png');state.images.push({type:blob.type,bytes:blob.size});}}});
 const nativeBitmap=window.createImageBitmap;window.createImageBitmap=(...args)=>{state.decodes++;return nativeBitmap(...args);};
 for(const[index,video]of state.current.entries())mountVideoActions(document.querySelector('#row-'+index),{video:{...video},isCurrent:captured=>{const current=state.current[index];return current.id===captured.id&&current.url===captured.url&&current.title===captured.title&&current.source===captured.source;},thumbnail:async id=>{state.requests.push(id);const blob=new Blob([Uint8Array.from(atob(state.data.base64),char=>char.charCodeAt(0))],{type:state.data.mime});if(state.hold)await new Promise(resolve=>state.release=resolve);return blob;}});
 Object.assign(window,{actionsState:state});`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife'})).outputFiles[0].text;
 browser=await chromium.launch({executablePath:process.env.PREVLEV_CHROMIUM_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
});
test.afterAll(async()=>{await browser?.close();});
test.beforeEach(async()=>{
 external=[];context=await browser.newContext({acceptDownloads:true});await context.route('**/*',route=>{const url=route.request().url();if(url===origin+'/')return route.fulfill({contentType:'text/html',body:'<div id="row-0"></div><div id="row-1"></div><div id="row-2"></div><script src="/fixture.js"></script>'});if(url===origin+'/fixture.js')return route.fulfill({contentType:'text/javascript',body:bundle});external.push(url);return route.abort();});page=await context.newPage();await page.goto(origin+'/');
 await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=16;canvas.height=8;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#2255ff';ctx.fillRect(0,0,16,8);const data=canvas.toDataURL('image/jpeg');(window as unknown as FixtureWindow).actionsState.data={mime:'image/jpeg',base64:data.split(',')[1]};});
});
test.afterEach(async()=>{expect(external).toEqual([]);await context.close();});
const button=(row:number,action:string)=>page.locator(`#row-${row} [data-video-action="${action}"]`);
async function state(){return page.evaluate(()=>{const state=(window as unknown as FixtureWindow).actionsState;return{requests:state.requests,copied:state.copied,images:state.images,decodes:state.decodes};});}
test('per-item menu copies the Short metadata and converts only explicitly requested bytes to bounded PNG',async()=>{
 expect((await state()).requests).toEqual([]);await page.locator('#row-1 [data-video-actions-trigger]').hover();await page.locator('#row-1 [data-video-actions-trigger]').click();expect((await state()).requests).toEqual([]);
 for(const action of ['copy-title','copy-id','copy-thumbnail-url']){await button(1,action).click();await expect(button(1,action)).toBeEnabled();}expect((await state()).copied).toEqual(['Título Short B','bbbbbbbbbbb','https://i.ytimg.com/vi/bbbbbbbbbbb/hqdefault.jpg']);expect((await state()).requests).toEqual([]);
 const lens=page.locator('#row-1 [data-video-actions-lens]');expect(new URL((await lens.getAttribute('href'))!).searchParams.get('url')).toBe('https://i.ytimg.com/vi/bbbbbbbbbbb/hqdefault.jpg');expect(await lens.getAttribute('target')).toBe('_blank');
 const waiting=page.waitForEvent('download');await button(1,'download-png').click();const downloaded=await waiting;expect(downloaded.suggestedFilename()).toBe('prevlev-bbbbbbbbbbb.png');const png=await readFile((await downloaded.path())!);expect([...png.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);expect(png.readUInt32BE(16)).toBe(16);expect(png.readUInt32BE(20)).toBe(8);expect((await state()).decodes).toBe(1);
 await expect(button(1,'copy-png')).toBeEnabled();await button(1,'copy-png').click();await expect.poll(async()=> (await state()).images.length).toBe(1);expect((await state()).images[0].type).toBe('image/png');expect((await state()).requests).toEqual(['bbbbbbbbbbb','bbbbbbbbbbb']);
 await page.locator('#row-2 [data-video-actions-trigger]').click();for(const action of ['copy-thumbnail-url','download-png','copy-png'])await expect(button(2,action)).toBeDisabled();await expect(page.locator('#row-2 [data-video-actions-lens]')).toHaveCount(0);
});
test('oversized headers are refused before browser decoding or any output',async()=>{
 await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;const data=Uint8Array.from(atob(canvas.toDataURL().split(',')[1]),char=>char.charCodeAt(0));const view=new DataView(data.buffer);view.setUint32(16,8000);view.setUint32(20,8000);(window as unknown as FixtureWindow).actionsState.data={mime:'image/png',base64:btoa(String.fromCharCode(...data))};});
 await page.locator('#row-0 [data-video-actions-trigger]').click();await button(0,'download-png').click();await expect(page.locator('#row-0 [data-video-actions-status]')).toContainText('megapixels');expect((await state()).decodes).toBe(0);expect((await state()).images).toEqual([]);
});
test('a late thumbnail cannot download after the dataset item has been recycled',async()=>{
 let downloads=0;page.on('download',()=>downloads++);await page.evaluate(()=>{(window as unknown as FixtureWindow).actionsState.hold=true;});await page.locator('#row-0 [data-video-actions-trigger]').click();await button(0,'download-png').click();await expect.poll(async()=> (await state()).requests.length).toBe(1);
 await page.evaluate(()=>{const state=(window as unknown as FixtureWindow).actionsState;state.current[0]={...state.current[0],id:'ddddddddddd',url:'https://www.youtube.com/watch?v=ddddddddddd'};state.release!();});await expect(page.locator('#row-0 [data-video-actions-menu]')).toBeHidden();expect((await state()).decodes).toBe(0);expect((await state()).images).toEqual([]);expect(downloads).toBe(0);
});
