import {test,expect,chromium,type Browser,type BrowserContext,type Page} from '@playwright/test';
import {build} from 'esbuild';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';

interface AssetFixture {items:Record<string,unknown>[];writes:number;bitmapCalls:number;hold:boolean;release?:()=>void;guard?:boolean;lockHeld?:boolean;releaseLock?:()=>void;saveOutcome?:string;}
interface FixtureWindow {assetFixture:AssetFixture;swipeTools:{render():Promise<void>;invalidatePreviews():void;saveAsset(blob:Blob,meta:unknown,guard?:()=>boolean):Promise<string>};}
let browser:Browser,context:BrowserContext,page:Page,bundle:string,unexpected:string[];
const origin='http://localhost:9416',url='https://www.youtube.com/watch?v=abcdefghijk';
test.beforeAll(async()=>{
 bundle=(await build({stdin:{contents:`import {initSwipeTools} from './src/ui/swipe';const tools=initSwipeTools();Object.assign(window,{swipeTools:tools});tools.render();`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife'})).outputFiles[0].text;
 browser=await chromium.launch({executablePath:process.env.PREVLEV_CHROMIUM_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
});
test.afterAll(async()=>{await browser?.close();});
test.beforeEach(async()=>{
 unexpected=[];context=await browser.newContext({acceptDownloads:true});
 await context.route('**/*',route=>{if(route.request().url()===`${origin}/`)return route.fulfill({contentType:'text/html',body:'<section id="swipe"></section><script src="/bundle.js"></script>'});if(route.request().url()===`${origin}/bundle.js`)return route.fulfill({contentType:'text/javascript',body:bundle});unexpected.push(route.request().url());return route.abort();});
 await context.addInitScript(({url})=>{
  const state:AssetFixture={items:[{id:'legacy',title:'Referência preservada',url,folder:'Ideias',createdAt:'2026-11-03T00:00:00.000Z',notes:'Nota original',thumbnail:'https://never-fetch.test/remote.png'}],writes:0,bitmapCalls:0,hold:false};Object.assign(window,{assetFixture:state});
  Object.assign(window,{chrome:{storage:{local:{get:async()=>({swipe:structuredClone(state.items)}),set:async(data:{swipe:Record<string,unknown>[]})=>{state.items=structuredClone(data.swipe);state.writes++;}}}}});
  const bitmap=window.createImageBitmap;window.createImageBitmap=(async(...args:Parameters<typeof createImageBitmap>)=>{state.bitmapCalls++;if(state.hold)await new Promise<void>(resolve=>{state.release=resolve;});return bitmap(...args);})as typeof createImageBitmap;
 },{url});
 page=await context.newPage();await page.goto(`${origin}/`);await expect(page.locator('#swipe-list article')).toHaveCount(1);
});
test.afterEach(async()=>{expect(unexpected).toEqual([]);await context.close();});
async function png(){return Buffer.from(await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=32;canvas.height=16;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#2255ff';ctx.fillRect(0,0,32,16);return canvas.toDataURL().split(',')[1];}),'base64');}
const snapshot=()=>page.evaluate(()=>structuredClone((window as unknown as FixtureWindow).assetFixture.items));
const reads=()=>page.evaluate(()=>{const s=(window as unknown as FixtureWindow).assetFixture;return{writes:s.writes,bitmapCalls:s.bitmapCalls};});
async function attach(bytes?:Buffer){await page.getByLabel('Imagem local para Referência preservada').setInputFiles({name:'own.png',mimeType:'image/png',buffer:bytes??await png()});await page.getByRole('button',{name:'Anexar imagem local',exact:true}).click();}

test('choosing is inert; explicit attach stores validated bytes/provenance, prefers local preview and round-trips JSON',async()=>{
 const bytes=await png();await page.getByLabel('Imagem local para Referência preservada').setInputFiles({name:'own.png',mimeType:'image/png',buffer:bytes});expect(await reads()).toEqual({writes:0,bitmapCalls:0});
 await page.getByRole('button',{name:'Anexar imagem local',exact:true}).click();await expect(page.locator('#swipe-status')).toContainText('Imagem local anexada');const item=(await snapshot())[0];expect(item.id).toBe('legacy');expect(item.notes).toBe('Nota original');expect(item.asset).toMatchObject({version:1,kind:'file',sourceUrl:url,fileName:'own.png',width:32,height:16,bytes:bytes.length});
 await page.getByRole('button',{name:'Ver prévia da imagem',exact:true}).click();await expect(page.locator('#swipe-list img')).toBeVisible();expect(await page.locator('#swipe-list img').getAttribute('src')).toMatch(/^blob:/);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Baixar imagem local',exact:true}).click();expect(await readFile((await (await download).path())!)).toEqual(bytes);
 const exported=page.waitForEvent('download');await page.locator('#swipe-export').click();const json=await readFile((await (await exported).path())!,'utf8');expect(JSON.parse(json).items[0].asset.id).toBe((item.asset as {id:string}).id);
 await page.evaluate(async()=>{const w=window as unknown as FixtureWindow;w.assetFixture.items=[];await w.swipeTools.render();});await page.locator('#swipe-import').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(json)});await expect(page.locator('#swipe-status')).toContainText('1 referências importadas');expect((await snapshot())[0].image).toBe(item.image);expect((await snapshot())[0].asset).toEqual(item.asset);
 const csv=page.waitForEvent('download');await page.locator('#swipe-export-csv').click();await csv;await expect(page.locator('#swipe-status')).toContainText('CSV não inclui imagens locais');
 await page.getByRole('button',{name:'Remover imagem local',exact:true}).click();await expect(page.locator('#swipe-status')).toContainText('Imagem local removida');const removed=(await snapshot())[0];expect(removed).not.toHaveProperty('image');expect(removed).not.toHaveProperty('asset');expect(removed.id).toBe('legacy');expect(removed.notes).toBe('Nota original');
});

test('oversized headers/MIME and cancelled late decoding never reach persistence or replace the old reference',async()=>{
 const bad=await png();bad.writeUInt32BE(8000,16);bad.writeUInt32BE(8000,20);await attach(bad);await expect(page.locator('#swipe-status')).toContainText('megapixels');expect(await reads()).toEqual({writes:0,bitmapCalls:0});
 await page.getByLabel('Imagem local para Referência preservada').setInputFiles({name:'fake.gif',mimeType:'image/gif',buffer:Buffer.from('GIF89a')});await page.getByRole('button',{name:'Anexar imagem local',exact:true}).click();await expect(page.locator('#swipe-status')).toContainText('não suportado');expect((await reads()).writes).toBe(0);
 await page.evaluate(()=>{(window as unknown as FixtureWindow).assetFixture.hold=true;});await attach();await expect.poll(async()=>(await reads()).bitmapCalls).toBe(1);await page.getByRole('button',{name:'Cancelar anexo',exact:true}).click();
 await page.evaluate(()=>{const s=(window as unknown as FixtureWindow).assetFixture;s.hold=false;s.release!();});await expect(page.getByRole('button',{name:'Anexar imagem local',exact:true})).toBeEnabled();expect((await reads()).writes).toBe(0);expect((await snapshot())[0]).not.toHaveProperty('image');
});

test('concurrent item edits reject a pending attachment and keep the newer notes',async()=>{
 await page.evaluate(()=>{(window as unknown as FixtureWindow).assetFixture.hold=true;});await attach();await expect.poll(async()=>(await reads()).bitmapCalls).toBe(1);
 await page.evaluate(()=>{const s=(window as unknown as FixtureWindow).assetFixture;s.items[0].notes='Edição concorrente';s.hold=false;s.release!();});await expect(page.locator('#swipe-status')).toContainText('referência mudou');expect((await reads()).writes).toBe(0);expect((await snapshot())[0].notes).toBe('Edição concorrente');
});

test('a valid image cannot exceed the aggregate four MiB budget or alter prior stored references',async()=>{
 await page.evaluate(async()=>{const w=window as unknown as FixtureWindow;for(let i=0;i<300;i++)w.assetFixture.items.push({id:`budget-${i}`,title:`Referência ${i}`,url:`https://example.test/${i}`,folder:'Arquivo',createdAt:'2026-11-03T00:00:00.000Z',notes:'x'.repeat(9500)});await w.swipeTools.render();});
 const data=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=768;canvas.height=512;const ctx=canvas.getContext('2d')!,pixels=ctx.createImageData(768,512);let seed=1234567;for(let i=0;i<pixels.data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)|0;pixels.data[i]=seed>>>24;}ctx.putImageData(pixels,0,0);return canvas.toDataURL().split(',')[1];});
 await page.getByLabel('Imagem local para Referência preservada').setInputFiles({name:'bounded.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});await page.getByRole('button',{name:'Anexar imagem local',exact:true}).first().click();await expect(page.locator('#swipe-status')).toContainText('4 MiB');expect((await reads()).writes).toBe(0);const items=await snapshot();expect(items).toHaveLength(301);expect(items[0]).not.toHaveProperty('image');expect(items[1].notes).toBe('x'.repeat(9500));
});

test('saveAsset hook attaches a verified capture without overwriting existing metadata and rejects implicit replacement',async()=>{
 const bytes=(await png()).toString('base64');const id=await page.evaluate(async({bytes,url})=>{const w=window as unknown as FixtureWindow,blob=new Blob([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],{type:'image/png'});return w.swipeTools.saveAsset(blob,{title:'Título da captura',url,folder:'Outra pasta',source:'youtube-dom',provenance:{kind:'capture',sourceUrl:'https://studio.youtube.com/video/abcdefghijk/analytics',videoId:'abcdefghijk',createdAt:'2026-11-03T01:00:00Z'}});},{bytes,url});
 expect(id).toBe('legacy');expect((await snapshot())[0]).toMatchObject({title:'Referência preservada',notes:'Nota original',folder:'Ideias',asset:{kind:'capture',videoId:'abcdefghijk'}});
 const before=(await reads()).writes;const error=await page.evaluate(async({bytes,url})=>{const w=window as unknown as FixtureWindow,blob=new Blob([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],{type:'image/png'});try{await w.swipeTools.saveAsset(blob,{title:'Outra',url,provenance:{kind:'composition',sourceUrl:url}});return'';}catch(error){return(error as Error).message;}},{bytes,url});expect(error).toContain('já tem uma imagem');expect((await reads()).writes).toBe(before);
});

test('saveAsset guard is rechecked inside the write lock so clearing data cannot resurrect a delayed capture',async()=>{
 const bytes=(await png()).toString('base64');
 await page.evaluate(()=>{const s=(window as unknown as FixtureWindow).assetFixture;s.guard=true;void navigator.locks.request('prevlev-swipe-library',async()=>{s.lockHeld=true;await new Promise<void>(resolve=>{s.releaseLock=resolve;});s.lockHeld=false;});});
 await expect.poll(()=>page.evaluate(()=>(window as unknown as FixtureWindow).assetFixture.lockHeld)).toBe(true);
 await page.evaluate(({bytes,url})=>{const w=window as unknown as FixtureWindow,s=w.assetFixture,blob=new Blob([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],{type:'image/png'});void w.swipeTools.saveAsset(blob,{title:'Captura pendente',url,provenance:{kind:'capture',sourceUrl:url}},()=>s.guard===true).then(()=>{s.saveOutcome='saved';},error=>{s.saveOutcome=(error as Error).name;});},{bytes,url});
 await expect.poll(()=>page.evaluate(async()=>{const state=await navigator.locks.query();return state.pending?.some(lock=>lock.name==='prevlev-swipe-library')??false;})).toBe(true);
 await page.evaluate(()=>{const s=(window as unknown as FixtureWindow).assetFixture;s.guard=false;s.items=[];s.releaseLock!();});
 await expect.poll(()=>page.evaluate(()=>(window as unknown as FixtureWindow).assetFixture.saveOutcome)).toBe('AbortError');expect((await reads()).writes).toBe(0);expect(await snapshot()).toEqual([]);
});

test('explicit folder rename/move preserves stable IDs and JSON carries them without any read migration',async()=>{
 expect((await snapshot())[0]).not.toHaveProperty('folderId');expect((await reads()).writes).toBe(0);await page.locator('#swipe-organize-folder').selectOption('Ideias');await page.locator('#swipe-folder-name').fill('Produção');await page.locator('#swipe-folder-rename').click();await expect(page.locator('#swipe-status')).toContainText('Pasta renomeada');const first=(await snapshot())[0];expect(first.folderId).toBeTruthy();expect(first.id).toBe('legacy');
 await page.locator('#swipe-organize-folder').selectOption('Produção');await page.locator('#swipe-folder-name').fill('Produção final');await page.locator('#swipe-folder-rename').click();await expect(page.locator('#swipe-status')).toContainText('Pasta renomeada');expect((await snapshot())[0].folderId).toBe(first.folderId);expect((await snapshot())[0].createdAt).toBe(first.createdAt);
});
