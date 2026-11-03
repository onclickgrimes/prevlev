import {test,expect,chromium,type Browser,type BrowserContext,type Page} from '@playwright/test';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

const url='https://www.youtube.com/watch?v=abcdefghijk';
type Message={type:string;[key:string]:unknown};
interface State {jobId:string;phase:string;collectedCount:number;steps:number;reason:string;}
interface Reply {status:string;collection:State;snapshot?:{url:string;videos:{id:string;views?:number;source?:string;observedAt?:string}[];comments:{id:string;text:string;likes?:number}[]};error?:string;}
type FixtureWindow=Window&{__collectionSend:(message:Message,senderId?:string)=>Promise<Reply>;__collectionStore:Record<string,unknown>;__collectionMessages:Message[];__collectionListeners:number;__collectionAccountClicks:number;__collectionLoadKind:'videos'|'comments';};
const fixture=`<!doctype html><html><head><meta charset="utf-8"><title>Coleta fixture - YouTube</title><style>body{margin:0}.spacer{height:900px}ytd-rich-grid-renderer,ytd-video-renderer,ytd-comments,ytd-comment-thread-renderer{display:block}ytd-video-renderer{height:400px;background:#eee}ytd-comment-thread-renderer{height:250px}</style></head><body><button id="account">Conta: não tocar</button><ytd-watch-flexy video-id="abcdefghijk"></ytd-watch-flexy><ytd-watch-metadata><h1>Título atual da fixture</h1></ytd-watch-metadata><div class="spacer"></div><ytd-rich-grid-renderer id="videos"><ytd-video-renderer><a id="video-title" href="/watch?v=abcdefghijk">Primeiro vídeo, views ausentes</a></ytd-video-renderer></ytd-rich-grid-renderer><ytd-comments><div id="contents"><ytd-comment-thread-renderer><ytd-comment-view-model data-comment-id="comment-first"><span id="author-text">Pessoa fixture</span><span id="content-text">Primeiro comentário</span></ytd-comment-view-model></ytd-comment-thread-renderer></div></ytd-comments><div style="height:100px"></div></body></html>`;
let browser:Browser,context:BrowserContext,page:Page,unexpected:string[];

test.beforeAll(async()=>{browser=await chromium.launch({executablePath:process.env.PREVLEV_CHROMIUM_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});});
test.afterAll(async()=>{await browser?.close();});
test.beforeEach(async()=>{
  unexpected=[];context=await browser.newContext({viewport:{width:1300,height:900}});await context.route('**/*',route=>{if(route.request().url()===url)return route.fulfill({contentType:'text/html',body:fixture});unexpected.push(route.request().url());return route.abort();});
  await context.addInitScript(()=>{
    const win=window as unknown as FixtureWindow;win.__collectionStore={settings:{hideShorts:false,showMetrics:false,backendUrl:'',backendToken:''}};win.__collectionMessages=[];win.__collectionListeners=0;win.__collectionAccountClicks=0;win.__collectionLoadKind='videos';
    let listener:((message:Message,sender:{id:string},reply:(value:unknown)=>void)=>unknown)|undefined;
    win.__collectionSend=(message,senderId='collection-fixture')=>new Promise(resolve=>{const accepted=listener?.(message,{id:senderId},result=>resolve(result as Reply));if(accepted===false)resolve({status:'blocked'} as Reply);});
    Object.defineProperty(globalThis,'chrome',{value:{runtime:{id:'collection-fixture',getURL:(path:string)=>`chrome-extension://fixture/${path}`,onMessage:{addListener:(fn:typeof listener)=>{listener=fn;win.__collectionListeners++;}},sendMessage:async(message:Message)=>{win.__collectionMessages.push(message);return{status:'ok'};}},storage:{local:{get:async(key:string)=>({[key]:win.__collectionStore[key]}),set:async(values:Record<string,unknown>)=>Object.assign(win.__collectionStore,values)},onChanged:{addListener:()=>{}}}}});
    document.addEventListener('DOMContentLoaded',()=>{
      document.querySelector('#account')!.addEventListener('click',()=>win.__collectionAccountClicks++);
      let videoBatch=0,commentBatch=0,pending=false;
      window.addEventListener('scroll',()=>{
        if(window.scrollY<=0||pending)return;pending=true;setTimeout(()=>{pending=false;
          if(win.__collectionLoadKind==='videos'&&videoBatch<4){videoBatch++;const row=document.createElement('ytd-video-renderer'),id=['lmnopqrstuv','zzzzzzzzzzz','bbbbbbbbbbb','ccccccccccc'][videoBatch-1];row.innerHTML=`<a id="video-title" href="/watch?v=${id}">Vídeo carregado ${videoBatch}</a><div id="metadata-line"><span>${videoBatch*100} views</span></div>`;document.querySelector('#videos')!.append(row);}
          else if(win.__collectionLoadKind==='comments'&&commentBatch<4){commentBatch++;const row=document.createElement('ytd-comment-thread-renderer');row.innerHTML=`<ytd-comment-view-model data-comment-id="comment-${commentBatch}"><span id="author-text">Resposta fixture</span><span id="content-text">Comentário carregado ${commentBatch}</span></ytd-comment-view-model>`;document.querySelector('ytd-comments #contents')!.append(row);}
        },50);
      });
    });
  });
  page=await context.newPage();await page.goto(url);await page.addScriptTag({path:resolve('dist/content.js')});await page.addScriptTag({path:resolve('dist/content.js')});await expect(page.locator('#prevlev-controls')).toBeVisible();
});
test.afterEach(async()=>{await context?.close();});
const send=(message:Message)=>page.evaluate(message=>(window as unknown as FixtureWindow).__collectionSend(message),message);

test('controles da página coletam por rolagem real e só abrem resultado após ação explícita',async()=>{
  expect(await page.evaluate(()=>(window as unknown as FixtureWindow).__collectionListeners)).toBe(1);expect(await page.evaluate(()=>window.scrollY)).toBe(0);
  await page.locator('#prevlev-controls summary').first().click();await page.locator('#prevlev-collection-limit').fill('4');await page.locator('#prevlev-collection-start').click();
  await expect(page.locator('#prevlev-collection-status')).toContainText('4 itens',{timeout:8000});await expect(page.locator('#prevlev-collection-use')).toBeEnabled();
  const status=await send({type:'COLLECTION_STATUS'});expect(status.collection).toMatchObject({phase:'completed',collectedCount:4,steps:3});expect(status.snapshot).toBeUndefined();expect(await page.evaluate(()=>window.scrollY)).toBe(0);
  const result=await send({type:'COLLECTION_STATUS',jobId:status.collection.jobId,includeResults:true});expect(result.snapshot?.videos).toHaveLength(4);expect(result.snapshot?.videos[0].views).toBeUndefined();expect(result.snapshot?.videos[0].source).toBe('youtube-dom');expect(result.snapshot?.videos.every(video=>typeof video.observedAt==='string')).toBe(true);
  expect(await page.evaluate(()=>(window as unknown as FixtureWindow).__collectionStore.snapshot)).toBeUndefined();await page.locator('#prevlev-collection-use').click();await expect.poll(()=>page.evaluate(()=>(window as unknown as FixtureWindow).__collectionMessages.length)).toBe(1);expect(await page.evaluate(()=>(window as unknown as FixtureWindow).__collectionMessages[0].type)).toBe('OPEN_WORKSPACE');expect(await page.evaluate(()=>(window as unknown as FixtureWindow).__collectionAccountClicks)).toBe(0);expect(unexpected).toEqual([]);
});

test('mensagens confiáveis limitam comentários, cancelam SPA e preservam o contexto da amostra',async()=>{
  expect(await page.evaluate(()=>(window as unknown as FixtureWindow).__collectionSend({type:'START_COLLECTION',kind:'comments'},'foreign'))).toMatchObject({status:'blocked'});
  await page.evaluate(()=>(window as unknown as FixtureWindow).__collectionLoadKind='comments');const started=await send({type:'START_COLLECTION',kind:'comments',maxItems:3,maxSteps:10,timeoutMs:10000});expect(started.status).toBe('ok');expect(await send({type:'START_COLLECTION',kind:'comments'})).toMatchObject({status:'error'});
  await expect.poll(async()=>(await send({type:'COLLECTION_STATUS',jobId:started.collection.jobId})).collection.phase).toBe('completed');const comments=await send({type:'COLLECTION_STATUS',jobId:started.collection.jobId,includeResults:true});expect(comments.snapshot?.comments).toHaveLength(3);expect(comments.snapshot?.comments[0].likes).toBeUndefined();expect(comments.snapshot?.videos).toEqual([]);
  const active=await send({type:'START_COLLECTION',kind:'comments',maxItems:500,maxSteps:30,timeoutMs:60000});await page.evaluate(()=>{document.dispatchEvent(new Event('yt-navigate-start'));history.pushState({},'','/watch?v=zzzzzzzzzzz');document.querySelector('ytd-watch-flexy')!.setAttribute('video-id','zzzzzzzzzzz');document.querySelector('ytd-watch-metadata h1')!.textContent='Título novo da navegação';});
  const cancelled=await send({type:'COLLECTION_STATUS',jobId:active.collection.jobId,includeResults:true});expect(cancelled.collection.phase).toBe('cancelled');expect(cancelled.snapshot?.url).toBe(url);const steps=cancelled.collection.steps;await page.waitForTimeout(700);expect((await send({type:'COLLECTION_STATUS',jobId:active.collection.jobId})).collection.steps).toBe(steps);
  expect(await send({type:'GET_CURRENT_METADATA'})).toMatchObject({status:'ok',metadata:{title:'Título novo da navegação',id:'zzzzzzzzzzz',url:'https://www.youtube.com/watch?v=zzzzzzzzzzz'}});expect(await page.evaluate(()=>(window as unknown as FixtureWindow).__collectionStore.snapshot)).toBeUndefined();expect(await page.evaluate(()=>(window as unknown as FixtureWindow).__collectionAccountClicks)).toBe(0);expect(unexpected).toEqual([]);
});
