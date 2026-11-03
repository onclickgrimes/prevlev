import {test,expect,chromium,type Browser,type BrowserContext,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
const app='http://localhost:9403',backend='http://127.0.0.1:8787',sourceUrl='https://www.youtube.com/watch?v=abcdefghijk';
interface Message {type:string;[key:string]:unknown;}
interface FixtureWindow extends Window {__transcriptDispatch:(message:Message)=>Promise<unknown>;__transcriptSend:(message:Message)=>Promise<unknown>;__transcriptClipboard:string[];}
let browser:Browser,context:BrowserContext,source:Page,page:Page,requests:Record<string,unknown>[],external:string[],errors:string[],pending:boolean,release:(()=>void)|undefined;
const modern=(time:string,text:string)=>`<transcript-segment-view-model><div class="ytwTranscriptSegmentViewModelTimestamp">${time}</div><div class="ytwTranscriptSegmentViewModelText">${text}</div></transcript-segment-view-model>`;
test.beforeAll(async()=>{browser=await chromium.launch({executablePath:process.env.PREVLEV_CHROMIUM_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});});
test.afterAll(async()=>{await browser?.close();});
test.beforeEach(async()=>{
 requests=[];external=[];errors=[];pending=false;release=undefined;context=await browser.newContext({viewport:{width:1500,height:1100},acceptDownloads:true});
 // Every request is intercepted. All AI text below is explicitly a transport fixture.
 await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin==='https://www.youtube.com')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><meta charset="UTF-8"><title>Transcrição moderna fixture - YouTube</title><h1>Transcrição moderna fixture</h1><video class="html5-main-video"></video><main id="loaded-transcript">${modern('0:01','Alpha 🪐 café')}${modern('0:05','Beta assunto')}</main>`});
   if(url.origin===backend){const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':app,'Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'authorization,content-type'};if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});if(url.pathname!=='/v1/analyze'){external.push(url.href);return route.abort();}const body=request.postDataJSON()as Record<string,unknown>;requests.push(body);if(pending)await new Promise<void>(resolve=>{release=resolve;});const feature=body.feature,text=feature==='transcript-summary'?'Resumo fixture':feature==='transcript-topics'?'Tópicos fixture':'Roteiro fixture';return route.fulfill({headers,body:JSON.stringify({status:'ok',source:'test:injected-ai',data:{text,model:'fixture:text',generated:true}})}).catch(()=>undefined);}
   const file=url.pathname.slice(1);if(url.origin!==app||!['workspace.html','workspace.js','ui.css'].includes(file)){external.push(url.href);return route.abort();}return route.fulfill({body:await readFile(resolve('dist',file)),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
 });
 await context.exposeBinding('__transcriptSend',async(_sender,message:Message)=>source.evaluate(message=>(window as unknown as FixtureWindow).__transcriptDispatch(message),message));
 await context.addInitScript(({app,backend,sourceUrl})=>{
   const fixture=window as unknown as FixtureWindow;fixture.__transcriptClipboard=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{fixture.__transcriptClipboard.push(value);}}});
   const store:Record<string,unknown>={settings:{hideShorts:false,showMetrics:false,backendUrl:backend,backendToken:'prevlev-fixture-token',aiModel:'fixture:text',aiStreaming:false,aiOrigin:'http://127.0.0.1:7814'}};let listener:((message:Message,sender:{id:string},reply:(value:unknown)=>void)=>unknown)|undefined;fixture.__transcriptDispatch=message=>new Promise(resolve=>listener?.(message,{id:'transcript-fixture'},resolve));
   Object.defineProperty(globalThis,'chrome',{value:{runtime:{id:'transcript-fixture',getURL:(path:string)=>`${app}/${path}`,onMessage:{addListener:(callback:typeof listener)=>{listener=callback;}},sendMessage:async()=>({status:'unsupported'})},tabs:{query:async()=>[{id:1,title:'Transcrição fixture',url:sourceUrl}],sendMessage:async(_id:number,message:Message)=>fixture.__transcriptSend(message)},storage:{local:{get:async(key:string)=>({[key]:store[key]}),set:async(data:Record<string,unknown>)=>Object.assign(store,data),remove:async(keys:string[])=>keys.forEach(key=>delete store[key])},onChanged:{addListener:()=>{}}},permissions:{request:async()=>true,remove:async()=>true}}});
 },{app,backend,sourceUrl});
 source=await context.newPage();await source.goto(sourceUrl);await source.evaluate(()=>{const video=document.querySelector('video')!;let paused=true;Object.defineProperties(video,{duration:{value:100,configurable:true},currentTime:{value:0,writable:true,configurable:true},paused:{get:()=>paused,configurable:true},play:{value:async()=>{paused=false;video.dispatchEvent(new Event('play'));}},pause:{value:()=>{paused=true;video.dispatchEvent(new Event('pause'));}}});});await source.addScriptTag({path:resolve('dist/content.js')});await expect(source.locator('#prevlev-timeline')).toBeVisible();
 page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(`${app}/workspace.html`);await page.locator('#scan').click();await page.locator('[data-page="transcript"]').click();await expect(page.locator('#transcript-text')).toHaveValue('Alpha 🪐 café\nBeta assunto');
});
test.afterEach(async()=>{release?.();expect(external).toEqual([]);expect(errors).toEqual([]);await context?.close();});
async function fileText(button:string){const waiting=page.waitForEvent('download');await page.locator(button).click();const download=await waiting;return {name:download.suggestedFilename(),content:await readFile((await download.path())!,'utf8')};}

test('actual content bundle accumulates modern virtualized A/B→B/C and preserves selected Beta/search',async()=>{
 await source.locator('#prevlev-timeline summary').click();await source.locator('#prevlev-timeline #search').fill('Beta');await source.locator('#prevlev-timeline .segment input').check();
 await source.evaluate(html=>{document.getElementById('loaded-transcript')!.innerHTML=html;},modern('0:05','Beta atualizada')+modern('0:10','Gamma novo'));
 await expect(source.locator('#prevlev-timeline #count')).toContainText('3 trechos');await expect(source.locator('#prevlev-timeline #search')).toHaveValue('Beta');await expect(source.locator('#prevlev-timeline .segment input')).toBeChecked();
 await page.locator('#timeline-refresh').click();await expect(page.locator('#timeline-segments button')).toHaveCount(3);await expect(page.locator('#timeline-segments')).toContainText('Alpha 🪐 café');await expect(page.locator('#timeline-segments')).toContainText('Beta atualizada');
 await source.evaluate(()=>{history.pushState(null,'','/watch?v=bbbbbbbbbbb');document.dispatchEvent(new Event('yt-navigate-finish'));});await expect(source.locator('#prevlev-timeline #count')).toContainText('Nenhum trecho');await expect(source.locator('#prevlev-timeline #search')).toHaveValue('');
 await source.evaluate(html=>{document.getElementById('loaded-transcript')!.innerHTML=html;},modern('0:02','Delta outro vídeo'));await page.locator('#timeline-refresh').click();await expect(page.locator('#timeline-segments button')).toHaveCount(1);await expect(page.locator('#timeline-segments')).toContainText('Delta outro vídeo');
});

test('imports actual VTT/SRT files and exports metadata JSON CSV Markdown without losing times',async()=>{
 const vtt='WEBVTT\n\n00:00:01.250 --> 00:00:02.750\nOlá café 🪐\n\n00:00:04.000 --> 00:00:06.500\nÚltima fala';
 await page.locator('#transcript-file').setInputFiles({name:'fixture.vtt',mimeType:'text/vtt',buffer:Buffer.from(vtt)});await expect(page.locator('#transcript-text')).toHaveValue('Olá café 🪐\nÚltima fala');await expect(page.locator('#notice')).toContainText('2 segmentos');
 const unassociated=JSON.parse((await fileText('#transcript-export-json')).content);expect(unassociated).toMatchObject({videoUrl:null,videoId:null,inputSource:{kind:'imported-file',fileName:'fixture.vtt',videoAssociation:'none'}});expect(unassociated.title).not.toBe('Vídeo fixture');
 await page.locator('#transcript-associate-video').click();await expect(page.locator('#transcript-input-source')).toContainText('Associação ao vídeo declarada pelo usuário');
 const json=await fileText('#transcript-export-json'),report=JSON.parse(json.content);expect(json.name).toBe('prevlev-transcricao.json');expect(report).toMatchObject({videoUrl:sourceUrl,videoId:'abcdefghijk',timestampsAvailable:true,segments:[{start:1.25,duration:1.5,end:2.75,text:'Olá café 🪐'},{start:4,duration:2.5,end:6.5,text:'Última fala'}]});expect(Number.isFinite(Date.parse(report.exportedAt))).toBe(true);
 const csv=await fileText('#transcript-export-csv');expect(csv.content).toContain('00:00:01.250');expect(csv.content).toContain(sourceUrl);const markdown=await fileText('#transcript-metadata-md');expect(markdown.content).toContain('Exportado em:');expect(markdown.content).toContain('Olá café 🪐');expect(markdown.content).toContain(sourceUrl);
 const srt='1\n00:00:00,500 --> 00:00:02,000\nSRT primeiro\n\n2\n00:00:03,000 --> 00:00:04,000\nSRT segundo';await page.locator('#transcript-file').setInputFiles({name:'fixture.srt',mimeType:'application/x-subrip',buffer:Buffer.from(srt)});await expect(page.locator('#transcript-text')).toHaveValue('SRT primeiro\nSRT segundo');const exported=await fileText('#transcript-vtt');expect(exported.content).toContain('00:00:00.500 --> 00:00:02.000');expect(exported.content).toContain('00:00:03.000 --> 00:00:04.000');
});

test('VTT omits unknown last end with NOTE while JSON preserves last text and null end',async()=>{
 const vtt=await fileText('#transcript-vtt');expect(vtt.content).toContain('NOTE Prevlev');expect(vtt.content).toContain('00:00:01.000 --> 00:00:05.000');expect(vtt.content).not.toContain('00:00:05.000 -->');expect(vtt.content).not.toContain('00:00:07.000');const json=JSON.parse((await fileText('#transcript-export-json')).content);expect(json.segments.at(-1)).toMatchObject({text:'Beta assunto',end:null,endBasis:'unknown'});
 await page.locator('#transcript-copy-timestamps').click();expect(await page.evaluate(()=>(window as unknown as FixtureWindow).__transcriptClipboard.at(-1))).toBe('[00:00:01] Alpha 🪐 café\n[00:00:05] Beta assunto');
});

test('separate AI cache/copy actions never confuse transcript timestamps with generated summary/topics/script',async()=>{
 await page.locator('[data-ai="transcript-summary"]').click();await expect(page.locator('#transcript-ai-state')).toContainText('concluído');expect(requests).toHaveLength(1);await page.locator('[data-ai="transcript-summary"]').click();await expect(page.locator('#transcript-ai-state')).toContainText('cache');expect(requests).toHaveLength(1);
 for(const feature of ['transcript-topics','transcript-script']){await page.locator(`[data-ai="${feature}"]`).click();await expect(page.locator('#transcript-ai-state')).toContainText('concluído');}expect(requests).toHaveLength(3);
 for(const part of ['summary','topics','script'])await page.locator(`#transcript-copy-${part}`).click();expect(await page.evaluate(()=>(window as unknown as FixtureWindow).__transcriptClipboard.slice(-3))).toEqual(['Resumo fixture','Tópicos fixture','Roteiro fixture']);
 await page.locator('#transcript-ai-back').click();await expect(page.locator('#transcript-result')).toHaveText('');await expect(page.locator('#transcript-text')).toHaveValue('Alpha 🪐 café\nBeta assunto');await page.locator('#transcript-text').fill('Texto novo sem timestamps');for(const part of ['summary','topics','script'])await expect(page.locator(`#transcript-copy-${part}`)).toBeDisabled();
 const json=JSON.parse((await fileText('#transcript-export-json')).content);expect(json.timestampsAvailable).toBe(false);expect(json.segments).toEqual([]);expect(json.text).toBe('Texto novo sem timestamps');
});

test('loading result is discarded after input invalidation even when the mocked backend finishes later',async()=>{
 pending=true;await page.locator('[data-ai="transcript-summary"]').click();await expect.poll(()=>requests.length).toBe(1);await expect(page.locator('#transcript-ai-state')).toContainText('processamento');await page.locator('#transcript-text').fill('Entrada nova durante a análise');pending=false;release?.();await expect(page.locator('[data-ai="transcript-summary"]')).toBeEnabled();await expect(page.locator('#transcript-result')).toHaveText('');await expect(page.locator('#transcript-copy-summary')).toBeDisabled();expect(requests).toHaveLength(1);
});
