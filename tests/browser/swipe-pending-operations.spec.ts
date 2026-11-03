import {test,expect,chromium,type Browser,type BrowserContext,type Page} from '@playwright/test';
import {build} from 'esbuild';
import {existsSync} from 'node:fs';
import type {SwipeTools} from '../../src/ui/swipe';

interface State {items:Record<string,unknown>[];writes:number;clears:number;clearStarted:number;holdFileName?:string;fileReads:number;fileFinished:number;releaseFiles:Record<string,()=>void>;lockHeld?:boolean;releaseLock?:()=>void;saveOutcome?:string;bitmapCalls:number;}
interface FixtureWindow extends Window {pendingState:State;swipeTools:SwipeTools;}
const origin='http://localhost:9417',backend='http://127.0.0.1:8787',url='https://www.youtube.com/watch?v=abcdefghijk';
const remoteItem={id:'remote',title:'Referência remota fixture',url:'https://example.test/remote',folder:'Remota',createdAt:'2026-11-03T00:00:00Z'};
let browser:Browser,context:BrowserContext,page:Page,bundle:string,unexpected:string[];
let holdNextRead:boolean,holdNextCommit:boolean,readCalls:number,commitCalls:number,releases:(()=>void)[],remoteItems:Record<string,unknown>[];
test.beforeAll(async()=>{
 bundle=(await build({stdin:{contents:`import {initSwipeTools} from './src/ui/swipe';import {initSwipeSync} from './src/ui/swipe-sync';import {saveSwipe} from './src/shared/storage';
const tools=initSwipeTools(),sync=initSwipeSync(()=>tools.render());window.swipeTools=tools;tools.render();
document.querySelector('#discard').addEventListener('click',()=>{tools.invalidatePendingOperations();sync.invalidate();window.pendingState.clearStarted++;void saveSwipe([]).then(async()=>{window.pendingState.clears++;await tools.render();});});`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife'})).outputFiles[0].text;
 browser=await chromium.launch({executablePath:process.env.PREVLEV_CHROMIUM_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
});
test.afterAll(async()=>{await browser?.close();});
test.beforeEach(async()=>{
 unexpected=[];holdNextRead=false;holdNextCommit=false;readCalls=0;commitCalls=0;releases=[];remoteItems=[{...remoteItem}];
 context=await browser.newContext();
 await context.route('**/*',async route=>{
  const request=route.request(),requestUrl=new URL(request.url());
  if(request.url()===`${origin}/`)return route.fulfill({contentType:'text/html',body:'<button id="discard">Apagar dados da fixture</button><section id="swipe"></section><script src="/bundle.js"></script>'});
  if(request.url()===`${origin}/bundle.js`)return route.fulfill({contentType:'text/javascript',body:bundle});
  if(requestUrl.origin===backend&&requestUrl.pathname==='/v1/library'){
   const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'content-type,authorization'};
   if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
   const body=request.postDataJSON()as {action:string};
   if(body.action==='read'){readCalls++;if(holdNextRead){holdNextRead=false;await new Promise<void>(resolve=>{releases.push(resolve);});}}
   else if(body.action==='commit'){commitCalls++;if(holdNextCommit){holdNextCommit=false;await new Promise<void>(resolve=>{releases.push(resolve);});}}
   else{unexpected.push(request.url());return route.abort();}
   return route.fulfill({headers,body:JSON.stringify({status:'ok',source:'prevlev:library',data:{items:remoteItems,revision:'a'.repeat(64),assetSchemaVersion:1,folderIdentityVersion:1}})});
  }
  unexpected.push(request.url());return route.abort();
 });
 await context.addInitScript(({url,backend})=>{
  const state:State={items:[{id:'local',title:'Referência local',url,folder:'Ideias',createdAt:'2026-11-03T00:00:00Z',notes:'Preservada'}],writes:0,clears:0,clearStarted:0,fileReads:0,fileFinished:0,releaseFiles:{},bitmapCalls:0};Object.assign(window,{pendingState:state});
  Object.assign(window,{chrome:{storage:{local:{get:async(key:string)=>({[key]:key==='swipe'?structuredClone(state.items):{backendUrl:backend,backendToken:'fixture-token'}}),set:async(data:{swipe:Record<string,unknown>[]})=>{state.items=structuredClone(data.swipe);state.writes++;}}}}});
  const original=File.prototype.text;File.prototype.text=function(){if(this.name===state.holdFileName){state.fileReads++;return new Promise<string>((resolve,reject)=>{state.releaseFiles[this.name]=()=>{void original.call(this).then(value=>{state.fileFinished++;resolve(value);},reject);};});}return original.call(this);};
  const bitmap=window.createImageBitmap;window.createImageBitmap=(async(...args:Parameters<typeof createImageBitmap>)=>{state.bitmapCalls++;return bitmap(...args);})as typeof createImageBitmap;
 },{url,backend});
 page=await context.newPage();page.on('dialog',dialog=>dialog.accept());await page.goto(`${origin}/`);await expect(page.locator('#swipe-list article')).toHaveCount(1);
});
test.afterEach(async()=>{for(const release of releases.splice(0))release();expect(unexpected).toEqual([]);await context.close();});
const state=()=>page.evaluate(()=>{const current=(window as unknown as FixtureWindow).pendingState;return{items:current.items,writes:current.writes,clears:current.clears,bitmapCalls:current.bitmapCalls};});
async function clear(){await page.locator('#discard').click();await expect.poll(async()=>(await state()).clears).toBe(1);await expect(page.locator('#swipe-list article')).toHaveCount(0);}
async function empty(){await page.evaluate(async()=>{const current=window as unknown as FixtureWindow;current.pendingState.items=[];await current.swipeTools.render();});}
async function blockWrites(){await page.evaluate(()=>{const current=(window as unknown as FixtureWindow).pendingState;void navigator.locks.request('prevlev-swipe-library',async()=>{current.lockHeld=true;await new Promise<void>(resolve=>{current.releaseLock=resolve;});current.lockHeld=false;});});await expect.poll(()=>page.evaluate(()=>(window as unknown as FixtureWindow).pendingState.lockHeld)).toBe(true);}
async function pendingWrite(){await expect.poll(()=>page.evaluate(async()=>{const locks=await navigator.locks.query();return locks.pending?.some(lock=>lock.name==='prevlev-swipe-library')??false;})).toBe(true);}
async function releaseWrites(){await page.evaluate(()=>(window as unknown as FixtureWindow).pendingState.releaseLock!());}
async function selectHeld(name:string,content:string,mime='application/json'){await page.evaluate(name=>{(window as unknown as FixtureWindow).pendingState.holdFileName=name;},name);await page.locator('#swipe-import').setInputFiles({name,mimeType:mime,buffer:Buffer.from(content)});await expect.poll(()=>page.evaluate(name=>!!(window as unknown as FixtureWindow).pendingState.releaseFiles[name],name)).toBe(true);}
async function releaseFile(name:string){await page.evaluate(name=>{const current=(window as unknown as FixtureWindow).pendingState;current.holdFileName=undefined;current.releaseFiles[name]();},name);await expect.poll(()=>page.evaluate(()=>(window as unknown as FixtureWindow).pendingState.fileFinished)).toBe(1);}
async function writesSettled(){await expect.poll(()=>page.evaluate(async()=>{const locks=await navigator.locks.query();return [...locks.held??[],...locks.pending??[]].some(lock=>lock.name==='prevlev-swipe-library');})).toBe(false);}
async function readRemote(){await page.locator('#swipe-sync-read').click();await expect(page.locator('#swipe-sync-status')).toContainText('Revisão consultada');}

for(const format of ['json','csv'])test(`clear-data prevents a late ${format.toUpperCase()} file read from repopulating the library`,async()=>{
 const content=format==='json'?JSON.stringify([remoteItem]):'title,url\nImportação CSV,https://example.test/csv';
 await selectHeld(`late.${format}`,content,format==='csv'?'text/csv':'application/json');await clear();await releaseFile(`late.${format}`);
 await expect(page.locator('#swipe-import')).toHaveValue('');expect(await state()).toMatchObject({items:[],writes:1,bitmapCalls:0});
});

test('a newer file selection supersedes a held import and an old completion cannot clear its selection or overwrite the result',async()=>{
 await selectHeld('old.json',JSON.stringify([remoteItem]));
 await page.locator('#swipe-import').setInputFiles({name:'new.csv',mimeType:'text/csv',buffer:Buffer.from('title,url\nEscolha nova,https://example.test/new')});await expect(page.locator('#swipe-status')).toContainText('1 referências importadas');
 await releaseFile('old.json');const saved=await state();expect(saved.writes).toBe(1);expect(saved.items.map(item=>item.title)).toEqual(['Referência local','Escolha nova']);expect(saved.items.some(item=>item.id==='remote')).toBe(false);
});

test('the import revision is checked inside the write lock after the file has already been parsed',async()=>{
 await blockWrites();await page.locator('#swipe-import').setInputFiles({name:'queued.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([remoteItem]))});await pendingWrite();
 await page.locator('#swipe-import').setInputFiles([]);await releaseWrites();await writesSettled();expect((await state()).writes).toBe(0);expect((await state()).items).toHaveLength(1);
});

test('pagehide invalidates a held file read without changing existing references',async()=>{
 await selectHeld('suspended.json',JSON.stringify([remoteItem]));await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await releaseFile('suspended.json');expect((await state()).writes).toBe(0);expect((await state()).items).toHaveLength(1);
});

for(const action of ['add','edit','saveVideo'])test(`context discard rejects ${action} waiting for the library lock before it writes`,async()=>{
 if(action==='edit'){await page.getByRole('button',{name:'Editar',exact:true}).click();await page.locator('#swipe-notes').fill('Edição pendente');}
 await blockWrites();
 if(action==='add'){await page.locator('#swipe-title').fill('Adição pendente');await page.locator('#swipe-url').fill('https://example.test/add');await page.locator('#swipe-add').click();}
 else if(action==='edit')await page.locator('#swipe-add').click();
 else await page.evaluate(()=>{const current=window as unknown as FixtureWindow;void current.swipeTools.saveVideo({id:'bbbbbbbbbbb',title:'Vídeo pendente',url:'https://www.youtube.com/watch?v=bbbbbbbbbbb',source:'youtube-dom'}).then(()=>{current.pendingState.saveOutcome='saved';},error=>{current.pendingState.saveOutcome=(error as Error).name;});});
 await pendingWrite();await page.locator('#discard').click();await expect.poll(()=>page.evaluate(()=>(window as unknown as FixtureWindow).pendingState.clearStarted)).toBe(1);await releaseWrites();await expect.poll(async()=>(await state()).clears).toBe(1);expect(await state()).toMatchObject({items:[],writes:1});
 if(action==='saveVideo')await expect.poll(()=>page.evaluate(()=>(window as unknown as FixtureWindow).pendingState.saveOutcome)).toBe('AbortError');
});

test('ordinary rendering does not cancel an import already authorized and waiting for the write lock',async()=>{
 await blockWrites();await page.locator('#swipe-import').setInputFiles({name:'current.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([remoteItem]))});await pendingWrite();
 await page.evaluate(async()=>(window as unknown as FixtureWindow).swipeTools.render());await releaseWrites();await expect(page.locator('#swipe-status')).toContainText('1 referências importadas');expect((await state()).items).toHaveLength(2);expect((await state()).writes).toBe(1);
});

test('a late remote revision read cannot restore a cleared preview when the local library stays empty',async()=>{
 await empty();holdNextRead=true;await page.locator('#swipe-sync-read').click();await expect.poll(()=>releases.length).toBe(1);await clear();releases.shift()!();
 await expect(page.locator('#swipe-sync-read')).toBeEnabled();await expect(page.locator('#swipe-sync-preview')).toBeEmpty();await expect(page.locator('#swipe-sync-merge')).toBeDisabled();await expect(page.locator('#swipe-sync-upload')).toBeDisabled();expect((await state()).items).toEqual([]);expect(readCalls).toBe(1);
});

for(const action of ['merge','replace'])test(`clear-data prevents a late remote ${action} from repopulating an unchanged empty library`,async()=>{
 await empty();await readRemote();holdNextRead=true;await page.locator(`#swipe-sync-${action}`).click();await expect.poll(()=>releases.length).toBe(1);await clear();releases.shift()!();
 await expect(page.locator('#swipe-sync-read')).toBeEnabled();expect(await state()).toMatchObject({items:[],writes:1});await expect(page.locator('#swipe-sync-preview')).toBeEmpty();await expect(page.locator('#swipe-sync-merge')).toBeDisabled();expect(commitCalls).toBe(0);
});

test('remote merge checks the context again inside its local write lock even when the empty stamp is unchanged',async()=>{
 await empty();await readRemote();await blockWrites();await page.locator('#swipe-sync-merge').click();await pendingWrite();await page.locator('#discard').click();await expect.poll(()=>page.evaluate(()=>(window as unknown as FixtureWindow).pendingState.clearStarted)).toBe(1);await releaseWrites();
 await expect.poll(async()=>(await state()).clears).toBe(1);await expect(page.locator('#swipe-sync-read')).toBeEnabled();expect(await state()).toMatchObject({items:[],writes:1});
});

test('clearing during an already dispatched upload ignores its late response and never claims the RPC was cancelled',async()=>{
 await readRemote();holdNextCommit=true;await page.locator('#swipe-sync-upload').click();await expect.poll(()=>releases.length).toBe(1);expect(commitCalls).toBe(1);await clear();releases.shift()!();
 await expect(page.locator('#swipe-sync-read')).toBeEnabled();await expect(page.locator('#swipe-sync-status')).toContainText('solicitação já enviada ao backend pode ter sido concluída');await expect(page.locator('#swipe-sync-preview')).toBeEmpty();expect(commitCalls).toBe(1);expect((await state()).items).toEqual([]);
});

test('a backend legacy inline image is structurally validated before preview or local persistence',async()=>{
 remoteItems=[{...remoteItem,image:'data:image/png;base64,AAAA'}];await page.locator('#swipe-sync-read').click();await expect(page.locator('#swipe-sync-read')).toBeEnabled();await expect(page.locator('#swipe-sync-status')).not.toContainText('Revisão consultada');await expect(page.locator('#swipe-sync-merge')).toBeDisabled();await expect(page.locator('#swipe-sync-preview')).toBeEmpty();expect(await state()).toMatchObject({writes:0,bitmapCalls:0});
});
