import {test,expect,chromium,type Browser,type BrowserContext,type Page} from '@playwright/test';
import {build} from 'esbuild';
import {existsSync} from 'node:fs';
import type {StudioCompositionAssetReceipt,StudioCompositionTools} from '../../src/ui/studio-composition';

interface SaveFixture {items:Record<string,unknown>[];writes:number;calls:Record<string,unknown>[];contextKey:string;validationAllowed:boolean;validationCalls:number;hold:boolean;release?:()=>void;dropped:number;validationAfterSave:boolean;}
interface FixtureWindow {saveFixture:SaveFixture;studio:StudioCompositionTools;}
const sourceUrl='https://studio.youtube.com/video/abcdefghijk/analytics';
let browser:Browser,context:BrowserContext,page:Page,bundle:string,unexpected:string[];
test.beforeAll(async()=>{
 bundle=(await build({stdin:{contents:`import {mountStudioComposition} from './src/ui/studio-composition';import {initSwipeTools} from './src/ui/swipe';
const s={items:[],writes:0,calls:[],contextKey:'context-A',validationAllowed:true,validationCalls:0,hold:false,dropped:0,validationAfterSave:true};Object.assign(window,{saveFixture:s});
Object.assign(window,{chrome:{storage:{local:{get:async()=>({swipe:structuredClone(s.items)}),set:async data=>{s.items=structuredClone(data.swipe);s.writes++;}}}}});const library=initSwipeTools();
Object.assign(window,{studio:mountStudioComposition(document.querySelector('#host'),{contextKey:()=>s.contextKey,validateContext:async()=>{s.validationCalls++;return s.validationAllowed;},saveAsset:async(blob,metadata,guard)=>{s.calls.push(metadata);if(s.hold)await new Promise(resolve=>s.release=resolve);if(!guard()){s.dropped++;throw new DOMException('Resultado invalidado antes da biblioteca','AbortError');}const id=await library.saveAsset(blob,metadata,guard);s.validationAllowed=s.validationAfterSave;return id;}})});`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife'})).outputFiles[0].text;
 browser=await chromium.launch({executablePath:process.env.PREVLEV_CHROMIUM_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
});
test.afterAll(async()=>{await browser?.close();});
test.beforeEach(async()=>{unexpected=[];context=await browser.newContext();await context.route('**/*',route=>{if(route.request().url()==='http://localhost:9417/')return route.fulfill({contentType:'text/html',body:'<div id="host"></div><section id="swipe" hidden></section><script src="/bundle.js"></script>'});if(route.request().url()==='http://localhost:9417/bundle.js')return route.fulfill({contentType:'text/javascript',body:bundle});unexpected.push(route.request().url());return route.abort();});page=await context.newPage();await page.goto('http://localhost:9417/');});
test.afterEach(async()=>{expect(unexpected).toEqual([]);await context.close();});
async function png(){return page.evaluate(()=>{const c=document.createElement('canvas');c.width=160;c.height=80;const ctx=c.getContext('2d')!;ctx.fillStyle='#225577';ctx.fillRect(0,0,160,80);return c.toDataURL().split(',')[1];});}
async function capture(receipt:StudioCompositionAssetReceipt={kind:'analytics',contextKey:'context-A',capturedAt:'2026-11-03T04:00:00Z',redactionValidated:true,redacted:true,categories:['revenue'],sourceUrl,videoId:'abcdefghijk'}){const data=await png();await page.evaluate(async({data,receipt})=>{await(window as unknown as FixtureWindow).studio.setCapture(new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'image/png'}),receipt);},{data,receipt});}
async function compose(){await page.locator('#studio-compose-title').fill('Composição declarada');await page.locator('#studio-compose-render').click();await expect(page.locator('#studio-compose-output img')).toBeVisible();await expect(page.locator('#studio-compose-save')).toBeEnabled();}
async function summary(){return page.evaluate(()=>{const s=(window as unknown as FixtureWindow).saveFixture;return{items:structuredClone(s.items),writes:s.writes,calls:structuredClone(s.calls),validationCalls:s.validationCalls,dropped:s.dropped};});}

test('only the explicit current-result save stores a composition with the real receipt URL and declared metadata',async()=>{
 expect((await summary()).calls).toEqual([]);await expect(page.locator('#studio-compose-save')).toBeDisabled();await capture();await compose();expect((await summary()).writes).toBe(0);const before=(await summary()).validationCalls;
 await page.locator('#studio-compose-save').click();await expect(page.locator('#studio-compose-status')).toContainText('salva explicitamente');const state=await summary();expect(state.writes).toBe(1);expect(state.validationCalls).toBe(before+2);expect(state.calls[0]).toMatchObject({title:'Composição declarada',url:sourceUrl,source:'user-provided',provenance:{kind:'composition',sourceUrl,videoId:'abcdefghijk'}});expect(state.items[0]).toMatchObject({url:sourceUrl,source:'user-provided',asset:{kind:'composition',sourceUrl,videoId:'abcdefghijk'}});await expect(page.locator('#studio-compose-save')).toBeDisabled();
});

test('a local PNG needs a declared HTTPS source URL and never inherits Studio identity or queries its validator',async()=>{
 await page.locator('#studio-compose-file').setInputFiles({name:'own.png',mimeType:'image/png',buffer:Buffer.from(await png(),'base64')});await expect(page.locator('#studio-compose-status')).toContainText('Pixels aceitos');await compose();await page.locator('#studio-compose-save').click();await expect(page.locator('#studio-compose-status')).toContainText('Declare uma URL HTTPS');expect((await summary()).calls).toEqual([]);
 await page.locator('#studio-compose-asset-url').fill('http://example.test/insecure');await page.locator('#studio-compose-render').click();await expect(page.locator('#studio-compose-save')).toBeEnabled();await page.locator('#studio-compose-save').click();await expect(page.locator('#studio-compose-status')).toContainText('exige URL HTTPS');expect((await summary()).calls).toEqual([]);
 await page.locator('#studio-compose-asset-url').fill('https://example.test/my-own-source');await expect(page.locator('#studio-compose-save')).toBeDisabled();await page.locator('#studio-compose-render').click();await expect(page.locator('#studio-compose-save')).toBeEnabled();await page.locator('#studio-compose-save').click();await expect(page.locator('#studio-compose-status')).toContainText('salva explicitamente');const state=await summary();expect(state.validationCalls).toBe(0);expect(state.calls[0]).toMatchObject({url:'https://example.test/my-own-source',source:'user-provided',provenance:{kind:'composition',sourceUrl:'https://example.test/my-own-source'}});expect((state.calls[0].provenance as Record<string,unknown>).videoId).toBeUndefined();
});

test('capture receipts without a source URL cannot borrow a declared local URL for persistence',async()=>{
 await capture({kind:'analytics',contextKey:'context-A',capturedAt:'2026-11-03T04:00:00Z',redactionValidated:true,redacted:false,categories:[]});await compose();await page.locator('#studio-compose-save').click();await expect(page.locator('#studio-compose-status')).toContainText('recibo não preservou a URL');expect((await summary()).calls).toEqual([]);expect((await summary()).writes).toBe(0);
});

test('actual context validation failure before save discards the output without calling the library',async()=>{
 await capture();await compose();await page.evaluate(()=>{(window as unknown as FixtureWindow).saveFixture.validationAllowed=false;});await page.locator('#studio-compose-save').click();await expect(page.locator('#studio-compose-status')).toContainText('contexto real');await expect(page.locator('#studio-compose-save')).toBeDisabled();await expect(page.locator('#studio-compose-output img')).toHaveCount(0);expect((await summary()).calls).toEqual([]);
});

test('a changed input value without a DOM event is still rejected by the result fingerprint',async()=>{
 await capture();await compose();await page.evaluate(()=>{(document.getElementById('studio-compose-title')as HTMLInputElement).value='Título trocado sem evento';});await page.locator('#studio-compose-save').click();await expect(page.locator('#studio-compose-status')).toContainText('entradas mudaram');expect((await summary()).calls).toEqual([]);expect((await summary()).writes).toBe(0);await expect(page.locator('#studio-compose-output img')).toHaveCount(0);await expect(page.locator('#studio-compose-save')).toBeDisabled();
});

for(const reason of ['cancel','options','mask','navigation']as const)test(`a held save cannot commit after ${reason} invalidates its result guard`,async()=>{
 await capture();await compose();await page.evaluate(()=>{(window as unknown as FixtureWindow).saveFixture.hold=true;});await page.locator('#studio-compose-save').click();await expect.poll(async()=>(await summary()).calls.length).toBe(1);
 if(reason==='cancel')await page.locator('#studio-compose-cancel').click();else if(reason==='options')await page.locator('#studio-compose-period').fill('Outro período');else await page.evaluate(reason=>{const w=window as unknown as FixtureWindow;if(reason==='mask')w.studio.invalidate('Ocultações alteradas; faça outra captura.');else w.saveFixture.contextKey='navigated-B';},reason);
 await page.evaluate(()=>{const s=(window as unknown as FixtureWindow).saveFixture;s.hold=false;s.release!();});await expect.poll(async()=>(await summary()).dropped).toBe(1);expect((await summary()).writes).toBe(0);expect((await summary()).items).toEqual([]);await expect(page.locator('#studio-compose-save')).toBeDisabled();
});

test('the actual context is checked again after a confirmed write without falsely claiming rollback',async()=>{
 await capture();await compose();await page.evaluate(()=>{(window as unknown as FixtureWindow).saveFixture.validationAfterSave=false;});await page.locator('#studio-compose-save').click();await expect(page.locator('#studio-compose-status')).toContainText('biblioteca informou gravação');await expect(page.locator('#studio-compose-status')).toContainText('Confira a biblioteca');expect((await summary()).writes).toBe(1);await expect(page.locator('#studio-compose-save')).toBeDisabled();
});
