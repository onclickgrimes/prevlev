import {test,expect,chromium,type Browser,type BrowserContext,type Page} from '@playwright/test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Server} from 'node:http';
import {createPrevlevServer} from '../../server/index.mjs';
import type {PageSnapshot} from '../../src/shared/types';

const appOrigin='https://localhost:9398';
type HistoryFixtureWindow=Window&{__historyStore:Record<string,unknown>};
let browser:Browser,context:BrowserContext,page:Page,server:Server,dataDir:string,backend:string;
let requests:Record<string,unknown>[],unexpected:string[];
let networkMode:'normal'|'offline'|'delayed';

test.beforeAll(async()=>{browser=await chromium.launch({executablePath:process.env.PREVLEV_CHROMIUM_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});});
test.afterAll(async()=>{await browser?.close();});
test.beforeEach(async()=>{
  requests=[];unexpected=[];networkMode='normal';dataDir=await mkdtemp(join(tmpdir(),'prevlev-history-ui-'));
  // This is the actual own HTTP backend, with isolated storage and no external provider transport.
  server=createPrevlevServer({dataDir,allowedOrigins:[appOrigin],token:'history-fixture-token'}, {fetcher:async()=>{throw new Error('No provider/YouTube request is permitted in this fixture.');}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('Fixture did not bind loopback.');backend=`http://127.0.0.1:${address.port}`;
  context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===backend&&url.pathname==='/v1/history'){
      if(request.method()==='POST')requests.push(JSON.parse(request.postData()??'{}') as Record<string,unknown>);
      if(networkMode==='offline')return route.abort('connectionrefused');
      if(networkMode==='delayed'){await new Promise(resolve=>setTimeout(resolve,500));if(route.request().isNavigationRequest())return route.abort();}
      // Controlled fixture relay uses the REAL own HTTP server/temporary files.
      // Native browser loopback access is denied by this environment's policy.
      try{const upstream=await route.fetch({maxRedirects:0});return await route.fulfill({response:upstream});}catch{return route.abort().catch(()=>{});}
    }
    const filename=url.pathname.slice(1);if(url.origin===appOrigin&&['workspace.html','workspace.js','ui.css'].includes(filename))return route.fulfill({body:await readFile(resolve('dist',filename)),contentType:filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html'});
    unexpected.push(url.href);return route.abort();
  });
  await context.addInitScript(({appOrigin,backend})=>{
    const snapshot={url:'https://www.youtube.com/',title:'Fixture histórico',videos:[{id:'abcdefghijk',title:'<img src=x onerror="window.__injected=true"> título observado',url:'https://www.youtube.com/watch?v=abcdefghijk',views:100,subscribers:10,isShort:false,source:'youtube-dom',observedAt:'2000-01-01T00:00:00Z'},{id:'officialapi1',title:'Dados oficiais não persistíveis',url:'https://www.youtube.com/watch?v=officialapi1',views:999,source:'youtube-data-api',observedAt:'2000-01-01T00:00:00Z'},{id:'unknown0001',title:'Contagens ausentes',url:'https://www.youtube.com/watch?v=unknown0001',source:'user-provided'}],comments:[{id:'secret',text:'PRIVATE_COMMENT_SHOULD_NOT_SEND',author:'fixture',likes:0,replies:0}],transcript:[{start:0,duration:1,text:'PRIVATE_TRANSCRIPT_SHOULD_NOT_SEND'}],warnings:['Fixture própria, sem conta real.']};
    const fixture=window as unknown as HistoryFixtureWindow;fixture.__historyStore={snapshot,settings:{hideShorts:false,showMetrics:true,backendUrl:backend,backendToken:'history-fixture-token',aiModel:'',aiStreaming:false,aiOrigin:'http://127.0.0.1:7814'}};
    Object.defineProperty(globalThis,'chrome',{value:{runtime:{id:'history-fixture',getURL:(path:string)=>`${appOrigin}/${path}`,sendMessage:async()=>{throw new Error('History fixture does not use a worker or external service.');}},tabs:{query:async()=>[{id:1,title:'YouTube fixture',url:snapshot.url}],sendMessage:async(_id:number,message:{type:string})=>message.type==='GET_SNAPSHOT'?{status:'ok',snapshot:fixture.__historyStore.snapshot}:{status:'unsupported'}},storage:{local:{get:async(key:string)=>({[key]:fixture.__historyStore[key]}),set:async(value:Record<string,unknown>)=>Object.assign(fixture.__historyStore,value),remove:async(keys:string[])=>keys.forEach(key=>delete fixture.__historyStore[key])},onChanged:{addListener:()=>{}}},permissions:{request:async()=>true,remove:async()=>true}}});
  },{appOrigin,backend});
  page=await context.newPage();await page.goto(`${appOrigin}/workspace.html`);await page.locator('[data-page="history"]').click();await expect(page.locator('#history-record')).toBeVisible();
});
test.afterEach(async()=>{await context?.close();if(server){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}await rm(dataDir,{recursive:true,force:true});});

test('UI usa backend HTTP próprio para registrar, consultar, exportar e excluir sem inventar instantes',async()=>{
  expect(requests).toEqual([]);await expect(page.locator('#history-status')).toContainText('Nenhuma solicitação');
  await page.locator('#history-record').click();await expect(page.locator('#history-status')).toContainText('Gravados 1');
  expect(requests).toHaveLength(1);expect((requests[0].videos as unknown[])).toHaveLength(2);expect(JSON.stringify(requests)).not.toContain('PRIVATE_COMMENT');expect(JSON.stringify(requests)).not.toContain('PRIVATE_TRANSCRIPT');expect(JSON.stringify(requests)).not.toContain('youtube-data-api');
  const persisted=JSON.parse(await readFile(join(dataDir,'observations-v1.json'),'utf8')) as {records:{observedAt:string;recordedAt:string;views:number}[]};expect(persisted.records[0]).toMatchObject({observedAt:'2000-01-01T00:00:00Z',views:100});expect(persisted.records[0].recordedAt).not.toBe(persisted.records[0].observedAt);
  await page.locator('#history-record').click();await expect(page.locator('#history-status')).toContainText('Gravados 0; duplicados 1');
  await page.evaluate(()=>{const snapshot=(window as unknown as HistoryFixtureWindow).__historyStore.snapshot as PageSnapshot;snapshot.videos[0].views=80;snapshot.videos[0].subscribers=13;snapshot.videos[0].observedAt='2000-01-01T01:00:00Z';});
  const beforeScan=requests.length;await page.locator('#scan').click();await expect(page.locator('#notice')).toContainText('Coletados');expect(requests).toHaveLength(beforeScan);
  await page.locator('#history-record').click();await expect(page.locator('#history-status')).toContainText('Gravados 1');await page.locator('#history-video-id').fill('abcdefghijk');await page.locator('#history-list').click();await expect(page.locator('#history-status')).toContainText('Consulta concluída');await expect(page.locator('#history-rows tr')).toHaveCount(2);await expect(page.locator('#history-trend-rows')).toContainText('-20');await expect(page.locator('#history-trend-rows')).toContainText('3');expect(await page.locator('#history img').count()).toBe(0);await expect(page.locator('#history-rows')).toContainText('<img src=x');
  const jsonEvent=page.waitForEvent('download');await page.locator('#history-export-json').click();const jsonDownload=await jsonEvent;const json=JSON.parse(await readFile((await jsonDownload.path())!,'utf8')) as {records:{observedAt:string;recordedAt:string;views:number}[]};expect(json.records.map(record=>record.observedAt)).toEqual(['2000-01-01T01:00:00Z','2000-01-01T00:00:00Z']);expect(json.records.map(record=>record.views)).toEqual([80,100]);expect(json.records.every(record=>!!record.recordedAt)).toBe(true);
  const csvEvent=page.waitForEvent('download');await page.locator('#history-export-csv').click();const csvDownload=await csvEvent;const csv=await readFile((await csvDownload.path())!,'utf8');expect(csv).toContain('2000-01-01T00:00:00Z');expect(csv).toContain('recordedAt');
  const beforeDismiss=requests.length;page.once('dialog',async dialog=>{expect(dialog.message()).toContain(backend);await dialog.dismiss();});await page.locator('#history-delete-video').click();await expect(page.locator('#history-status')).toContainText('Exclusão cancelada');expect(requests).toHaveLength(beforeDismiss);
  page.once('dialog',async dialog=>{expect(dialog.message()).toContain(backend);await dialog.accept();});await page.locator('#history-delete-video').click();await expect(page.locator('#history-status')).toContainText('Excluídos 2');await expect(page.locator('#history-scope')).toContainText('Prévia descartada');expect(JSON.parse(await readFile(join(dataDir,'observations-v1.json'),'utf8')).records).toEqual([]);expect(unexpected).toEqual([]);
});

test('UI vincula confirmação destrutiva à origem e recusa conexão trocada durante o diálogo',async()=>{
  await page.locator('#history-record').click();await expect(page.locator('#history-status')).toContainText('Gravados 1');await page.locator('#history-video-id').fill('abcdefghijk');
  const before=requests.length;
  // Only this fixture replaces confirmation to simulate a synchronous settings change.
  await page.evaluate(()=>{const fixture=window as unknown as HistoryFixtureWindow&{__historyPrompt?:string};window.confirm=message=>{fixture.__historyPrompt=message;(fixture.__historyStore.settings as Record<string,unknown>).backendUrl='http://127.0.0.1:1';return true;};});
  await page.locator('#history-delete-video').click();await expect(page.locator('#history-status')).toContainText('mudou antes do envio');
  expect(await page.evaluate(()=>(window as unknown as {__historyPrompt:string}).__historyPrompt)).toContain(backend);expect(requests).toHaveLength(before);expect(JSON.parse(await readFile(join(dataDir,'observations-v1.json'),'utf8')).records).toHaveLength(1);
  await expect(page.locator('#history-scope')).toContainText(`Origem da resposta: ${backend}`);await expect(page.locator('#history-destination')).toContainText('http://127.0.0.1:1');expect(unexpected).toEqual([]);
});

test('UI recusa somente API, evita clique duplicado e mostra erro/cancelamento sem repetir mutações',async()=>{
  await page.evaluate(()=>{const snapshot=(window as unknown as HistoryFixtureWindow).__historyStore.snapshot as PageSnapshot;snapshot.videos=snapshot.videos.filter(video=>video.source==='youtube-data-api');});await page.locator('#scan').click();await expect(page.locator('#notice')).toContainText('Coletados');await page.locator('#history-record').click();await expect(page.locator('#history-status')).toContainText('API oficial');expect(requests).toEqual([]);
  networkMode='offline';await page.locator('#history-list').click();await expect(page.locator('#history-status')).toContainText('Não foi possível');expect(requests).toHaveLength(1);
  networkMode='delayed';await page.evaluate(()=>{const button=document.querySelector<HTMLButtonElement>('#history-list')!;button.click();button.click();});await expect(page.locator('#history-cancel')).toBeEnabled();await expect.poll(()=>requests.length).toBe(2);await page.locator('#history-cancel').click();await expect(page.locator('#history-status')).toContainText('Espera cancelada');await expect(page.locator('#history-list')).toBeEnabled();expect(requests).toHaveLength(2);expect(unexpected).toEqual([]);
});
