import {test,expect,chromium,type Browser,type BrowserContext,type Page} from '@playwright/test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import type {Server} from 'node:http';
import {createPrevlevServer} from '../../server/index.mjs';

const appOrigin='https://localhost:9410';
const token='swipe-sync-fixture-token';
const created='2026-11-03T00:00:00.000Z';
const localItem={id:'local-a',title:'Referência local preservada',url:'https://www.youtube.com/watch?v=abcdefghijk',folder:'Local',type:'video',tags:['local'],notes:'Nota local',createdAt:created,source:'user-provided'};
const remoteItem={id:'remote-b',title:'Referência remota fixture',url:'https://www.youtube.com/watch?v=bcdefghijkl',folder:'Servidor',type:'video',tags:['remota'],notes:'Nota remota',createdAt:created,source:'user-provided'};
interface FixtureState {items:Record<string,unknown>[];settings:Record<string,unknown>;writes:number;prompt?:string;nativeConfirm?:(message?:string)=>boolean;releaseLock?:()=>void;lockHeld?:boolean;}
interface FixtureWindow extends Window {__syncFixture:FixtureState;}
interface LibraryData {items:Record<string,unknown>[];revision:string;}
let browser:Browser,context:BrowserContext,page:Page,server:Server,dataDir:string,backend:string;
let requests:Record<string,unknown>[],unexpected:string[],errors:string[];
let holdRead:boolean,readReached:()=>void,releaseRead:()=>void,heldRead:Promise<void>,readArrived:Promise<void>;

test.beforeAll(async()=>{
 browser=await chromium.launch({executablePath:process.env.PREVLEV_CHROMIUM_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
});
test.afterAll(async()=>{await browser?.close();});
test.beforeEach(async()=>{
 requests=[];unexpected=[];errors=[];holdRead=false;dataDir=await mkdtemp(join(tmpdir(),'prevlev-library-ui-'));
 server=createPrevlevServer({dataDir,allowedOrigins:[appOrigin],token},{fetcher:async()=>{throw new Error('No external source may be contacted by this test.');}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('Fixture did not bind loopback.');backend=`http://127.0.0.1:${address.port}`;
 context=await browser.newContext({viewport:{width:1440,height:1100}});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===backend&&url.pathname==='/v1/library'){
   const body=request.method()==='POST'?JSON.parse(request.postData()??'{}') as Record<string,unknown>:undefined;
   if(body)requests.push(body);
   // Controlled relay to the actual personal HTTP backend and temporary files.
   // Browser loopback policy is preserved; no user backend/cloud/provider is used.
   try{const upstream=await route.fetch({maxRedirects:0});if(holdRead&&body?.action==='read'){holdRead=false;readReached();await heldRead;}return await route.fulfill({response:upstream});}catch{return route.abort().catch(()=>{});}
  }
  const file=url.pathname.slice(1);if(url.origin===appOrigin&&['workspace.html','workspace.js','ui.css'].includes(file))return route.fulfill({body:await readFile(resolve('dist',file)),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
  unexpected.push(url.href);return route.abort();
 });
 await context.addInitScript(({appOrigin,backend,token,localItem})=>{
  const state:FixtureState={items:[structuredClone(localItem)],settings:{hideShorts:false,showMetrics:true,backendUrl:backend,backendToken:token,aiModel:'',aiStreaming:false,aiOrigin:'http://127.0.0.1:7814'},writes:0};
  (window as unknown as FixtureWindow).__syncFixture=state;
  Object.defineProperty(globalThis,'chrome',{value:{runtime:{id:'swipe-sync-fixture',getURL:(path:string)=>`${appOrigin}/${path}`,sendMessage:async()=>{throw new Error('Swipe fixture does not use a worker or external service.');}},tabs:{query:async()=>[],sendMessage:async()=>({status:'unsupported'})},storage:{local:{get:async(key:string)=>({[key]:structuredClone(key==='swipe'?state.items:key==='settings'?state.settings:undefined)}),set:async(data:Record<string,unknown>)=>{if('swipe' in data){state.items=structuredClone(data.swipe) as Record<string,unknown>[];state.writes++;}if('settings' in data)state.settings=structuredClone(data.settings) as Record<string,unknown>;},remove:async()=>{throw new Error('Swipe sync must not remove unrelated local data.');}},onChanged:{addListener:()=>{}}},permissions:{request:async()=>true,remove:async()=>true}}});
 },{appOrigin,backend,token,localItem});
 page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(`${appOrigin}/workspace.html`);await page.locator('[data-page="swipe"]').click();await expect(page.locator('#swipe-list')).toContainText(localItem.title);await expect(page.locator('#swipe-sync-read')).toBeEnabled();
});
test.afterEach(async()=>{
 releaseRead?.();await context?.close();
 if(server)await new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});
 await rm(dataDir,{recursive:true,force:true});expect(unexpected).toEqual([]);expect(errors).toEqual([]);
});

async function operation(body:Record<string,unknown>):Promise<{status:string;data:LibraryData;error?:string}>{
 const response=await fetch(`${backend}/v1/library`,{method:'POST',headers:{Origin:appOrigin,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});return response.json() as Promise<{status:string;data:LibraryData;error?:string}>;
}
async function seed(items:Record<string,unknown>[]){const current=await operation({action:'read'});expect(current.status).toBe('ok');const saved=await operation({action:'commit',baseRevision:current.data.revision,items});expect(saved.status).toBe('ok');return saved.data;}
async function localState(){return page.evaluate(()=>{const state=(window as unknown as FixtureWindow).__syncFixture;return structuredClone({items:state.items,settings:state.settings,writes:state.writes,prompt:state.prompt});});}
async function readPreview(){await page.locator('#swipe-sync-read').click();await expect(page.locator('#swipe-sync-status')).toContainText('Revisão consultada');}
function pauseNextRead(){holdRead=true;heldRead=new Promise<void>(resolve=>{releaseRead=resolve;});readArrived=new Promise<void>(resolve=>{readReached=resolve;});}

test('manual read and merge preserve local metadata and do not perform transfers on initialization',async()=>{
 expect(requests).toEqual([]);expect((await localState()).writes).toBe(0);
 await expect(page.locator('#swipe-sync-upload')).toBeDisabled();
 await seed([{...localItem,title:'Versão remota deve perder para a local'},remoteItem]);
 await readPreview();expect(requests).toEqual([{action:'read'}]);expect((await localState()).writes).toBe(0);
 await expect(page.locator('#swipe-sync-preview')).toContainText(backend);
 await expect(page.locator('#swipe-sync-preview')).toContainText('"mergeAdds": 1');
 await expect(page.locator('#swipe-sync-preview')).toContainText('"mergeDuplicates": 1');
 const beforeDismiss=requests.length;page.once('dialog',async dialog=>{expect(dialog.message()).toContain('Mesclar 1');await dialog.dismiss();});
 await page.locator('#swipe-sync-merge').click();await expect(page.locator('#swipe-sync-merge')).toBeEnabled();expect(requests).toHaveLength(beforeDismiss);expect((await localState()).items).toHaveLength(1);
 page.once('dialog',async dialog=>{expect(dialog.message()).toContain('Mesclar 1');await dialog.accept();});await page.locator('#swipe-sync-merge').click();
 await expect(page.locator('#swipe-sync-status')).toContainText('Transferência local concluída');
 const state=await localState();expect(state.items).toHaveLength(2);expect(state.items.find(item=>item.id==='local-a')).toMatchObject(localItem);expect(state.items.find(item=>item.id==='remote-b')).toMatchObject(remoteItem);expect(state.writes).toBe(1);
 expect((await operation({action:'read'})).data.items[0].title).toBe('Versão remota deve perder para a local');
 expect(requests.every(body=>body.action==='read')).toBe(true);
 await expect(page.locator('#swipe-sync-upload')).toBeDisabled();
});

test('upload checks native confirmation, local freshness and remote CAS before any overwrite',async()=>{
 await seed([remoteItem]);await readPreview();
 // Another local view writes while the confirmation is open; only this fixture simulates that view.
 await page.evaluate(()=>{const state=(window as unknown as FixtureWindow).__syncFixture;state.nativeConfirm=window.confirm;window.confirm=message=>{state.prompt=message;state.items.push({id:'concurrent-local',title:'Escrita concorrente local',url:'https://www.youtube.com/watch?v=cdefghijklm',folder:'Outra',createdAt:'2026-11-03T00:00:00.000Z'});return true;};});
 const before=requests.length;await page.locator('#swipe-sync-upload').click();await expect(page.locator('#swipe-sync-status')).toContainText('biblioteca local mudou');expect(requests).toHaveLength(before);expect((await localState()).prompt).toContain(backend);expect((await operation({action:'read'})).data.items).toHaveLength(1);
 await page.evaluate(()=>{const state=(window as unknown as FixtureWindow).__syncFixture;window.confirm=state.nativeConfirm!;delete state.nativeConfirm;});
 await readPreview();await seed([{...remoteItem,title:'Revisão remota mudou após a prévia'}]);
 page.once('dialog',async dialog=>{expect(dialog.message()).toContain(backend);await dialog.accept();});await page.locator('#swipe-sync-upload').click();
 await expect(page.locator('#swipe-sync-status')).toContainText('backend mudou');
 expect((await operation({action:'read'})).data.items[0].title).toBe('Revisão remota mudou após a prévia');expect((await localState()).items).toHaveLength(2);
 await expect(page.locator('#swipe-sync-upload')).toBeDisabled();
 await readPreview();page.once('dialog',async dialog=>{expect(dialog.message()).toContain(backend);await dialog.accept();});await page.locator('#swipe-sync-upload').click();
 await expect(page.locator('#swipe-sync-status')).toContainText('referências enviadas');
 expect((await operation({action:'read'})).data.items.map(item=>item.id)).toEqual(['local-a','concurrent-local']);
 const commits=requests.filter(body=>body.action==='commit');expect(commits).toHaveLength(2);expect(commits.every(body=>Object.keys(body).sort().join(',')==='action,baseRevision,items')).toBe(true);expect(JSON.stringify(commits)).not.toContain(token);
});

test('local replacement refuses a connection change after remote read and while awaiting the local write lock',async()=>{
 await seed([remoteItem]);await readPreview();pauseNextRead();
 page.once('dialog',async dialog=>{expect(dialog.message()).toContain(backend);await dialog.accept();});await page.locator('#swipe-sync-replace').click();await readArrived;
 await page.evaluate(()=>{(window as unknown as FixtureWindow).__syncFixture.settings.backendUrl='http://127.0.0.1:1';});releaseRead();
 await expect(page.locator('#swipe-sync-status')).toContainText('conexão mudou');expect((await localState()).items).toHaveLength(1);expect((await localState()).writes).toBe(0);
 await page.evaluate(backend=>{(window as unknown as FixtureWindow).__syncFixture.settings.backendUrl=backend;},backend);await readPreview();
 await page.evaluate(()=>{const state=(window as unknown as FixtureWindow).__syncFixture;const held=new Promise<void>(resolve=>{state.releaseLock=resolve;});void navigator.locks.request('prevlev-swipe-library',async()=>{state.lockHeld=true;await held;state.lockHeld=false;});});
 await expect.poll(()=>page.evaluate(()=>(window as unknown as FixtureWindow).__syncFixture.lockHeld)).toBe(true);
 page.once('dialog',async dialog=>{expect(dialog.message()).toContain(backend);await dialog.accept();});await page.locator('#swipe-sync-replace').click();
 await expect.poll(()=>page.evaluate(async()=>{const state=await navigator.locks.query();return state.pending?.some(lock=>lock.name==='prevlev-swipe-library')??false;})).toBe(true);
 await page.evaluate(()=>{const state=(window as unknown as FixtureWindow).__syncFixture;state.settings.backendToken='changed-fixture-token';state.releaseLock?.();});
 await expect(page.locator('#swipe-sync-status')).toContainText('conexão mudou');expect((await localState()).writes).toBe(0);expect((await localState()).items[0]).toMatchObject(localItem);
 expect((await operation({action:'read'})).data.items[0]).toMatchObject(remoteItem);expect(requests.every(body=>body.action==='read')).toBe(true);
 await page.evaluate(token=>{(window as unknown as FixtureWindow).__syncFixture.settings.backendToken=token;},token);await readPreview();
 page.once('dialog',async dialog=>{expect(dialog.message()).toContain(backend);await dialog.accept();});await page.locator('#swipe-sync-replace').click();await expect(page.locator('#swipe-sync-status')).toContainText('Transferência local concluída');
 const replaced=await localState();expect(replaced.items).toHaveLength(1);expect(replaced.items[0]).toMatchObject(remoteItem);expect(replaced.writes).toBe(1);expect(requests.every(body=>body.action==='read')).toBe(true);await expect(page.locator('#swipe-list')).toContainText(remoteItem.title);
});


test('malformed remote library never becomes an empty replaceable snapshot',async()=>{
 await seed([remoteItem]);
 await page.route(`${backend}/v1/library`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'ok',source:'prevlev:library',data:{revision:'a'.repeat(64)}})}));
 await page.locator('#swipe-sync-read').click();
 await expect(page.locator('#swipe-sync-status')).toContainText('lista explícita');
 for(const action of ['upload','merge','replace'])await expect(page.locator(`#swipe-sync-${action}`)).toBeDisabled();
 expect((await localState()).writes).toBe(0);
 expect((await operation({action:'read'})).data.items[0]).toMatchObject(remoteItem);
});

async function localAsset(){return page.evaluate(()=>{const state=(window as unknown as FixtureWindow).__syncFixture,canvas=document.createElement('canvas');canvas.width=4;canvas.height=2;canvas.getContext('2d')!.fillRect(0,0,4,2);const image=canvas.toDataURL(),bytes=atob(image.split(',')[1]).length;state.items[0]={...state.items[0],folderId:'folder_fixture',image,asset:{version:1,id:'asset_fixture',kind:'file',mime:'image/png',bytes,width:4,height:2,sourceUrl:'https://www.youtube.com/watch?v=abcdefghijk',fileName:'own.png',createdAt:'2026-11-03T00:00:00.000Z'}};return structuredClone(state.items[0]);});}

test('personal sync preserves local image bytes, asset provenance and folder identity when schema support is advertised',async()=>{
 await seed([remoteItem]);const expected=await localAsset();await readPreview();page.once('dialog',dialog=>dialog.accept());await page.locator('#swipe-sync-upload').click();await expect(page.locator('#swipe-sync-status')).toContainText('referências enviadas');const actual=(await operation({action:'read'})).data.items[0];expect(actual.image).toBe(expected.image);expect(actual.asset).toEqual(expected.asset);expect(actual.folderId).toBe('folder_fixture');
});

test('older backends are blocked before asset/folder writes while legacy metadata-only synchronization still works',async()=>{
 await seed([remoteItem]);await localAsset();const legacy=(await operation({action:'read'})).data;
 await page.route(`${backend}/v1/library`,route=>{const body=route.request().postDataJSON()as{action:string};if(body.action!=='read')return route.fallback();return route.fulfill({contentType:'application/json',body:JSON.stringify({status:'ok',source:'prevlev:library',data:{items:legacy.items,revision:legacy.revision}})});});
 await readPreview();await page.locator('#swipe-sync-upload').click();await expect(page.locator('#swipe-sync-status')).toContainText('não anuncia suporte a ativos');expect(requests.filter(body=>body.action==='commit')).toHaveLength(0);
 await page.evaluate(()=>{const item=(window as unknown as FixtureWindow).__syncFixture.items[0];delete item.image;delete item.asset;});await readPreview();await page.locator('#swipe-sync-upload').click();await expect(page.locator('#swipe-sync-status')).toContainText('identidades de pasta');expect(requests.filter(body=>body.action==='commit')).toHaveLength(0);
 await page.evaluate(()=>{delete(window as unknown as FixtureWindow).__syncFixture.items[0].folderId;});await readPreview();page.once('dialog',dialog=>dialog.accept());await page.locator('#swipe-sync-upload').click();await expect(page.locator('#swipe-sync-status')).toContainText('referências enviadas');expect(requests.filter(body=>body.action==='commit')).toHaveLength(1);
});
