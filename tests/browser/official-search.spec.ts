import {test,expect,chromium,type Browser,type BrowserContext,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

const appOrigin='http://localhost:9397', backend='http://127.0.0.1:8787';
interface OfficialFixtureWindow extends Window {__officialStore:Record<string,unknown>;__officialWrites:Record<string,unknown>[];__officialInjected?:boolean;}
interface Request {body:Record<string,unknown>;headers:Record<string,string>;url:string;}
let browser:Browser, context:BrowserContext, page:Page, requests:Request[], external:string[], errors:string[];
let mode:'ok'|'error'|'bad-url'|'bad-source'|'bulk', pending:boolean, releasePending:(()=>void)|undefined;
const id=(index:number)=>`video${String(index).padStart(6,'0')}`;
const channelId=(index:number)=>`UC${String(index).padStart(22,'0')}`;

test.beforeAll(async()=>{browser=await chromium.launch({executablePath:process.env.PREVLEV_CHROMIUM_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});});
test.afterAll(async()=>{await browser?.close();});
test.beforeEach(async()=>{
 requests=[];external=[];errors=[];mode='ok';pending=false;releasePending=undefined;
 context=await browser.newContext({viewport:{width:1500,height:1100}});
 // All URLs are intercepted; no Google API, real backend, key or quota is used.
 await context.route('**/*',async route=>{
   const request=route.request(), url=new URL(request.url());
   if(url.origin===backend){
     const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':appOrigin,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'authorization,content-type'};
     if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
     if(url.pathname!=='/v1/youtube/search')return route.fulfill({status:404,headers,body:JSON.stringify({status:'error',source:'fixture',error:'Rota fora do escopo da fixture.'})});
     const body=request.postDataJSON() as Record<string,unknown>;requests.push({body,headers:request.headers(),url:url.href});
     if(pending)await new Promise<void>(resolve=>{releasePending=resolve;});
     if(mode==='error')return route.fulfill({headers,body:JSON.stringify({status:'not_configured',source:'youtube-data-api',error:'Fonte desativada no servidor; configure uma chave existente.',data:{requestCount:0}})}).catch(()=>undefined);
     const number=body.pageToken==='page-3'?3:body.pageToken==='page-2'?2:1, fetchedAt=new Date().toISOString();
     const indices=mode==='bulk'?Array.from({length:25},(_,index)=>(number-1)*25+index+1):number===1?[1]:[1,number];
     const videos=body.type==='video'?indices.map(index=>({id:id(index),title:`Vídeo oficial fixture ${index} <img src=x onerror="window.__officialInjected=true">`,url:mode==='bad-url'?'javascript:alert(1)':`https://www.youtube.com/watch?v=${id(index)}`,channelId:channelId(index),channelTitle:`Canal oficial ${index}`,publishedAt:'2026-10-01T00:00:00Z',duration:'PT60S',viewCount:'9007199254740993',likeCount:'0',commentCount:null,thumbnail:`https://i.ytimg.com/vi/${id(index)}/default.jpg`,source:'youtube-data-api',fetchedAt})):[];
     const channels=body.type==='channel'?indices.map(index=>({id:channelId(index),title:`Canal oficial fixture ${index}`,url:`https://www.youtube.com/channel/${channelId(index)}`,subscriberCount:index===1?null:'12300',hiddenSubscriberCount:index===1,viewCount:'18446744073709551615',videoCount:null,publishedAt:null,thumbnail:null,source:'youtube-data-api',fetchedAt})):[];
     const query={q:body.q,type:body.type,order:body.order,maxResults:body.maxResults,...(body.pageToken?{pageToken:body.pageToken}:{})};
     return route.fulfill({headers,body:JSON.stringify({status:'ok',source:mode==='bad-source'?'untrusted-source':'youtube-data-api',data:{source:'youtube-data-api',videos,channels,nextPageToken:number<3?`page-${number+1}`:'page-4',query,fetchedAt,requestCount:body.type==='video'?3:2,warnings:['Fixture oficial sintética; não representa todo o catálogo.']}})}).catch(()=>undefined);
   }
   const filename=url.pathname.slice(1);
   if(url.origin!==appOrigin||!['workspace.html','workspace.js','ui.css'].includes(filename)){external.push(url.href);return route.abort();}
   return route.fulfill({body:await readFile(resolve('dist',filename)),contentType:filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html'});
 });
 await context.addInitScript(({appOrigin,backend})=>{
   const state=window as unknown as OfficialFixtureWindow;
   const snapshot={url:'https://www.youtube.com/watch?v=abcdefghijk',title:'Coleta local fixture',videos:[{id:'abcdefghijk',title:'Vídeo local separado',url:'https://www.youtube.com/watch?v=abcdefghijk',views:42}],comments:[],transcript:[],warnings:[]};
   state.__officialStore={snapshot,settings:{hideShorts:false,showMetrics:false,backendUrl:backend,backendToken:'prevlev-fixture-token',aiModel:'',aiStreaming:false,aiOrigin:'http://127.0.0.1:7814'}};state.__officialWrites=[];
   Object.defineProperty(globalThis,'chrome',{value:{runtime:{id:'official-ui-fixture',getURL:(path:string)=>`${appOrigin}/${path}`,sendMessage:async()=>({status:'unsupported'})},tabs:{query:async()=>[{id:1,url:snapshot.url,title:snapshot.title}],sendMessage:async()=>({status:'ok',snapshot})},storage:{local:{get:async(key:string)=>({[key]:state.__officialStore[key]}),set:async(data:Record<string,unknown>)=>{state.__officialWrites.push(data);Object.assign(state.__officialStore,data);},remove:async(keys:string[])=>keys.forEach(key=>delete state.__officialStore[key])},onChanged:{addListener:()=>{}}},permissions:{request:async()=>true,remove:async()=>true}}});
 },{appOrigin,backend});
 page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.clock.install();await page.goto(`${appOrigin}/workspace.html`);await page.locator('[data-page="official-search"]').click();await expect(page.locator('#yt-form')).toBeVisible();
});
test.afterEach(async()=>{releasePending?.();expect(external).toEqual([]);expect(errors).toEqual([]);await context?.close();});
async function consent(type='video') {await page.locator('#yt-source').selectOption('youtube-data-api');await page.locator('#yt-q').fill('astronomia fixture');await page.locator('#yt-type').selectOption(type);await page.locator('#yt-consent').check();}
async function search(){await page.locator('#yt-search').click();await expect(page.locator('#yt-status')).toContainText('Página 1 concluída');}

test('source and consent are explicit; no request on load, navigation or invalid controls',async()=>{
 expect(requests).toEqual([]);await expect(page.locator('#yt-source')).toHaveValue('');await expect(page.locator('#yt-consent')).not.toBeChecked();
 await page.locator('#yt-q').fill('fixture');await page.locator('#yt-search').click();expect(requests).toEqual([]);
 await page.locator('#yt-source').selectOption('youtube-data-api');await page.locator('#yt-search').click();expect(requests).toEqual([]);
 await page.locator('#yt-consent').check();await page.locator('#yt-max-results').fill('26');await page.locator('#yt-search').click();expect(requests).toEqual([]);
 for(const href of ['https://www.youtube.com/t/terms','https://policies.google.com/privacy','https://github.com/onclickgrimes/prevlev/blob/main/docs/PRIVACY.md'])await expect(page.locator(`#yt-form a[href="${href}"]`)).toHaveAttribute('rel','noopener noreferrer');
});
test('renders raw exact counts safely and keeps official records out of local collection and storage',async()=>{
 await consent();await search();await expect(page.locator('#yt-video-rows tr')).toHaveCount(1);
 await expect(page.locator('#yt-video-rows')).toContainText('9.007.199.254.740.993');await expect(page.locator('#yt-video-rows')).toContainText('PT60S');await expect(page.locator('#yt-video-rows')).toContainText('<img src=x onerror=');
 await expect(page.locator('#yt-video-rows img')).toHaveCount(0);expect(await page.evaluate(()=>(window as unknown as OfficialFixtureWindow).__officialInjected)).toBeUndefined();
 await expect(page.locator('#yt-video-rows a').first()).toHaveAttribute('href',`https://www.youtube.com/watch?v=${id(1)}`);
 expect(requests).toHaveLength(1);expect(requests[0].body).toEqual({q:'astronomia fixture',type:'video',order:'relevance',maxResults:10,apiConsent:true});expect(requests[0].headers.authorization).toBe('Bearer prevlev-fixture-token');
 await page.locator('[data-page="research"]').click();await expect(page.locator('#video-rows tr')).toHaveCount(1);await expect(page.locator('#video-rows')).toContainText('Vídeo local separado');
 const saved=await page.evaluate(()=>(window as unknown as OfficialFixtureWindow).__officialStore);expect(JSON.stringify(saved)).not.toContain('Vídeo oficial fixture');expect(JSON.stringify(saved)).not.toContain('9007199254740993');
});
test('next pages are manual, deduplicated and limited to three pages and75 raw results',async()=>{
 mode='bulk';await consent();await page.locator('#yt-max-results').fill('25');await search();await expect(page.locator('#yt-video-rows tr')).toHaveCount(25);expect(requests).toHaveLength(1);
 await page.locator('#yt-next').click();await expect(page.locator('#yt-video-rows tr')).toHaveCount(50);expect(requests).toHaveLength(2);expect(requests[1].body.pageToken).toBe('page-2');
 await page.locator('#yt-next').click();await expect(page.locator('#yt-video-rows tr')).toHaveCount(75);await expect(page.locator('#yt-next')).toBeDisabled();expect(requests).toHaveLength(3);expect(requests[2].body.pageToken).toBe('page-3');
 await expect(page.locator('#yt-summary')).toContainText('3/3');await expect(page.locator('#yt-status')).toContainText('Limite de três');
});
test('duplicate IDs do not grow raw state and query changes invalidate next page',async()=>{
 await consent();await search();await page.locator('#yt-next').click();await expect(page.locator('#yt-video-rows tr')).toHaveCount(2);
 await page.locator('#yt-q').fill('consulta diferente');await expect(page.locator('#yt-next')).toBeDisabled();await expect(page.locator('#yt-results')).toBeHidden();expect(requests).toHaveLength(2);
 await search();expect(requests).toHaveLength(3);expect(requests[2].body.q).toBe('consulta diferente');expect(requests[2].body).not.toHaveProperty('pageToken');
});
test('channel view preserves hidden/unknown and rounded raw subscriber counts',async()=>{
 await consent('channel');await search();await expect(page.locator('#yt-video-rows tr')).toHaveCount(0);await expect(page.locator('#yt-channel-rows')).toContainText('Oculto');await expect(page.locator('#yt-channel-rows')).toContainText('18.446.744.073.709.551.615');
 await page.locator('#yt-next').click();await expect(page.locator('#yt-channel-rows tr')).toHaveCount(2);await expect(page.locator('#yt-channel-rows')).toContainText('12.300');await expect(page.locator('#yt-channel-rows')).toContainText('—');
});
test('cancel discards pending results and ignores a later transport completion',async()=>{
 pending=true;await consent();await page.locator('#yt-search').click();await expect.poll(()=>requests.length).toBe(1);await expect(page.locator('#yt-cancel')).toBeEnabled();
 await page.locator('#yt-cancel').click();await expect(page.locator('#yt-status')).toContainText('Espera cancelada');await expect(page.locator('#yt-results')).toBeHidden();
 pending=false;releasePending?.();await expect(page.locator('#yt-video-rows tr')).toHaveCount(0);await expect(page.locator('#yt-next')).toBeDisabled();expect(requests).toHaveLength(1);
});
test('rejects unexpected source/URL and shows unavailable configuration without fake results',async()=>{
 await consent();mode='bad-url';await page.locator('#yt-search').click();await expect(page.locator('#yt-status')).toContainText('incompatíveis');await expect(page.locator('#yt-results')).toBeHidden();
 mode='bad-source';await page.locator('#yt-search').click();await expect(page.locator('#yt-status')).toContainText('incompatíveis');await expect(page.locator('#yt-video-rows tr')).toHaveCount(0);
 mode='error';await page.locator('#yt-search').click();await expect(page.locator('#yt-status')).toContainText('Fonte desativada');await expect(page.locator('#yt-next')).toBeDisabled();
});
test('expires raw data after24h and never refreshes the API automatically',async()=>{
 await consent();await search();await expect(page.locator('#yt-results')).toBeVisible();await page.clock.fastForward(24*60*60*1000+5000);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.locator('#yt-status')).toContainText('expiraram');await expect(page.locator('#yt-video-rows tr')).toHaveCount(0);await expect(page.locator('#yt-results')).toBeHidden();expect(requests).toHaveLength(1);
});
