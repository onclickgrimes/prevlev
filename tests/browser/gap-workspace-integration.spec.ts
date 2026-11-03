import {test,expect,chromium,type Browser,type BrowserContext,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
let browser:Browser,context:BrowserContext,page:Page;
type State={messages:Record<string,unknown>[];writes:number;tabUrl:string;holdCapture:boolean;finishCapture?:()=>void;holdMeasurement?:boolean;finishMeasurement?:()=>void;holdMetadata?:boolean;finishMetadata?:()=>void;copied?:string};
type Fixture=Window&{__gapState:State};
test.beforeAll(async()=>{browser=await chromium.launch({executablePath:existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined,headless:true,args:['--no-sandbox']});});
test.afterAll(async()=>{await browser?.close();});
test.beforeEach(async()=>{
  context=await browser.newContext({viewport:{width:1440,height:1100}});
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url()),file=url.pathname.slice(1);
    if(url.origin!=='http://localhost:9401'||!['workspace.html','workspace.js','ui.css'].includes(file))return route.abort();
    return route.fulfill({body:await readFile(resolve('dist',file)),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
  });
  await context.addInitScript(()=>{
    const state:State={messages:[],writes:0,tabUrl:'https://www.youtube.com/results?search_query=observado',holdCapture:false};
    (window as unknown as Fixture).__gapState=state;
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text:string)=>{state.copied=text;}}});
    const frozen={url:'https://www.youtube.com/watch?v=aaaaaaaaaaa',videoId:'aaaaaaaaaaa',title:'Coleção congelada A',videos:[{id:'aaaaaaaaaaa',title:'Vídeo congelado A',url:'https://www.youtube.com/watch?v=aaaaaaaaaaa',source:'youtube-dom'}],comments:[],transcript:[],warnings:[]};
    const store:Record<string,unknown>={snapshot:frozen};
    Object.defineProperty(globalThis,'chrome',{value:{runtime:{id:'gap-fixture',getURL:(path:string)=>'http://localhost:9401/'+path,sendMessage:async(message:Record<string,unknown>)=>{
      state.messages.push(message);
      if(message.type==='CAPTURE_SCREENSHOT') {
        const sourceUrl=state.tabUrl;
        if(state.holdCapture)await new Promise<void>(resolve=>{state.finishCapture=resolve;});
        const canvas=document.createElement('canvas');canvas.width=500;canvas.height=200;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#ff0000';ctx.fillRect(0,0,500,200);
        return {status:'ok',dataUrl:canvas.toDataURL(),tabContext:{tabId:1,url:sourceUrl},capture:{captureStamp:'validated-fixture',rect:{x:0,y:0,width:500,height:200},redactions:[{x:0,y:0,width:60,height:200}],viewportWidth:500}};
      }return {status:'not_configured',source:'fixture'};
    }},tabs:{query:async()=>[{id:1,url:state.tabUrl,title:'Aba observada B'}],get:async()=>({id:1,url:state.tabUrl,title:'Aba observada B'}),sendMessage:async(_tab:number,message:Record<string,unknown>)=>{
      state.messages.push(message);
      if(message.type==='GET_CURRENT_METADATA'){const url=state.tabUrl;if(state.holdMetadata)await new Promise<void>(resolve=>{state.finishMetadata=resolve;});return {status:'ok',metadata:{title:'Título observado',id:new URL(url).searchParams.get('v')??undefined,url}};}
      if(message.type==='GET_IMAGE_CONTEXT')return {status:'ok',snapshot:{...frozen,url:state.tabUrl,title:'Aba observada B',videos:[{id:'bbbbbbbbbbb',title:'Vídeo observado B',url:'https://www.youtube.com/watch?v=bbbbbbbbbbb',source:'youtube-dom'}]}};
      if(message.type==='STUDIO_PREVIEW')return {status:'ready',id:'plan-fixture'};
      if(message.type==='CAPTURE_CARD'){if(state.holdMeasurement)await new Promise<void>(resolve=>{state.finishMeasurement=resolve;});return {status:'ok',captureStamp:'validated-fixture'};}
      return {status:'ok',snapshot:frozen};
    }},storage:{local:{get:async(key:string)=>({[key]:store[key]}),set:async(value:Record<string,unknown>)=>{state.writes++;Object.assign(store,value);},remove:async(keys:string[])=>keys.forEach(key=>delete store[key])}},permissions:{request:async()=>true,remove:async()=>true}}});
  });
  page=await context.newPage();await page.goto('http://localhost:9401/workspace.html');await expect(page.locator('#video-rows')).toContainText('Vídeo congelado A');
});
test.afterEach(async()=>{await context.close();});
test('metadata from an old selected tab or URL never reaches the clipboard',async()=>{
  await page.evaluate(()=>{const select=document.querySelector<HTMLSelectElement>('#tab-select')!;select.append(new Option('Outra aba','2'));(window as unknown as Fixture).__gapState.holdMetadata=true;});
  await page.locator('#copy-title').click();await expect.poll(()=>page.evaluate(()=>!!(window as unknown as Fixture).__gapState.finishMetadata)).toBe(true);
  await page.locator('#tab-select').selectOption('2');await page.locator('#tab-select').selectOption('1');
  await page.evaluate(()=>(window as unknown as Fixture).__gapState.finishMetadata!());
  await expect(page.locator('#notice')).toContainText('Nada foi copiado');expect(await page.evaluate(()=>(window as unknown as Fixture).__gapState.copied)).toBeUndefined();
  await page.evaluate(()=>{const state=(window as unknown as Fixture).__gapState;state.finishMetadata=undefined;});
  await page.locator('#copy-title').click();await expect.poll(()=>page.evaluate(()=>!!(window as unknown as Fixture).__gapState.finishMetadata)).toBe(true);
  await page.evaluate(()=>{const state=(window as unknown as Fixture).__gapState;state.tabUrl='https://www.youtube.com/watch?v=ccccccccccc';state.finishMetadata!();});
  await expect(page.locator('#notice')).toContainText('Nada foi copiado');expect(await page.evaluate(()=>(window as unknown as Fixture).__gapState.copied)).toBeUndefined();
  await page.evaluate(()=>{(window as unknown as Fixture).__gapState.holdMetadata=false;});await page.locator('#copy-title').click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as Fixture).__gapState.copied)).toBe('Título observado\nccccccccccc');
});
test('explicit selected-tab preview context uses read-only snapshot without replacing the collection',async()=>{
  await page.locator('[data-page="images"]').click();expect(await page.evaluate(()=>(window as unknown as Fixture).__gapState.messages.length)).toBe(0);
  await page.locator('#preview-source').selectOption('selected-tab');await page.locator('#preview-load-context').click();
  await expect(page.locator('#preview-source-info')).toContainText('search_query=observado');await expect(page.locator('#preview-source-info')).toContainText('Aba observada B');
  const observed=await page.evaluate(()=>({messages:(window as unknown as Fixture).__gapState.messages,writes:(window as unknown as Fixture).__gapState.writes}));
  expect(observed.messages).toEqual([{type:'GET_IMAGE_CONTEXT'}]);expect(observed.writes).toBe(0);
  await page.locator('[data-page="research"]').click();await expect(page.locator('#video-rows')).toContainText('Vídeo congelado A');await expect(page.locator('#video-rows')).not.toContainText('Vídeo observado B');
});
test('Studio capture is masked and accepted only for explicit local composition, then invalidated by mask edits',async()=>{
  await page.evaluate(()=>{(window as unknown as Fixture).__gapState.tabUrl='https://studio.youtube.com/video/aaaaaaaaaaa/analytics';});
  await page.locator('[data-page="studio"]').click();await page.locator('#studio-compose-enabled').check();await page.locator('#analytics-shot').click();
  await expect(page.locator('#studio-compose-status')).toContainText('Pixels aceitos');await expect(page.locator('#studio-compose-output img')).toHaveCount(0);
  await page.locator('#studio-compose-layout').selectOption('video-info');await page.locator('#studio-compose-render').click();await expect(page.locator('#studio-compose-output img')).toBeVisible();
  await page.locator('#capture-redaction-categories input[value="channel"]').uncheck();await expect(page.locator('#studio-compose-output img')).toHaveCount(0);await expect(page.locator('#studio-compose-render')).toBeDisabled();
  const messages=await page.evaluate(()=>(window as unknown as Fixture).__gapState.messages);expect(messages.filter(m=>m.type==='CAPTURE_SCREENSHOT')).toHaveLength(1);expect(messages[0]).toMatchObject({redact:true,redactionCategories:['channel','revenue','subscribers','views','video-info']});
});
test('late capture after a mask change cannot replace the current Studio composition input',async()=>{
  await page.evaluate(()=>{(window as unknown as Fixture).__gapState.tabUrl='https://studio.youtube.com/video/aaaaaaaaaaa/analytics';});
  await page.locator('[data-page="studio"]').click();await page.locator('#studio-compose-enabled').check();await page.evaluate(()=>{(window as unknown as Fixture).__gapState.holdCapture=true;});await page.locator('#analytics-shot').click();
  await expect.poll(()=>page.evaluate(()=>!!(window as unknown as Fixture).__gapState.finishCapture)).toBe(true);
  await page.locator('#redact').uncheck();await page.evaluate(()=>(window as unknown as Fixture).__gapState.finishCapture!());
  await expect(page.locator('#studio-compose-render')).toBeDisabled();await expect(page.locator('#studio-compose-source')).toHaveText('Nenhuma imagem fornecida.');
});
test('same-tab Studio navigation invalidates a stored capture before generating or downloading',async()=>{
  await page.evaluate(()=>{(window as unknown as Fixture).__gapState.tabUrl='https://studio.youtube.com/video/aaaaaaaaaaa/analytics';});
  await page.locator('[data-page="studio"]').click();await page.locator('#studio-compose-enabled').check();await page.locator('#analytics-shot').click();await expect(page.locator('#studio-compose-status')).toContainText('Pixels aceitos');
  await page.evaluate(()=>{(window as unknown as Fixture).__gapState.tabUrl='https://studio.youtube.com/video/bbbbbbbbbbb/analytics';});
  await page.locator('#studio-compose-render').click();await expect(page.locator('#studio-compose-render')).toBeDisabled();await expect(page.locator('#studio-compose-output img')).toHaveCount(0);await expect(page.locator('#studio-compose-source')).toHaveText('Nenhuma imagem fornecida.');
});
test('navigation while a validated screenshot is returning refuses the old source before image acceptance',async()=>{
  await page.evaluate(()=>{const state=(window as unknown as Fixture).__gapState;state.tabUrl='https://studio.youtube.com/video/aaaaaaaaaaa/analytics';state.holdCapture=true;});
  await page.locator('[data-page="studio"]').click();await page.locator('#studio-compose-enabled').check();await page.locator('#analytics-shot').click();
  await expect.poll(()=>page.evaluate(()=>!!(window as unknown as Fixture).__gapState.finishCapture)).toBe(true);
  await page.evaluate(()=>{const state=(window as unknown as Fixture).__gapState;state.tabUrl='https://studio.youtube.com/video/bbbbbbbbbbb/analytics';state.finishCapture!();});
  await expect(page.locator('#notice')).toContainText('URL da aba mudou');await expect(page.locator('#studio-compose-render')).toBeDisabled();await expect(page.locator('#studio-compose-output img')).toHaveCount(0);
});
test('cancel while the final capture measurement waits cannot be undone by its late completion',async()=>{
  await page.evaluate(()=>{const state=(window as unknown as Fixture).__gapState;state.tabUrl='https://studio.youtube.com/video/aaaaaaaaaaa/analytics';state.holdMeasurement=true;});
  await page.locator('[data-page="studio"]').click();await page.locator('#studio-compose-enabled').check();await page.locator('#analytics-shot').click();
  await expect.poll(()=>page.evaluate(()=>!!(window as unknown as Fixture).__gapState.finishMeasurement)).toBe(true);
  await page.locator('#studio-compose-cancel').click();
  await page.evaluate(async()=>{(window as unknown as Fixture).__gapState.finishMeasurement!();await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
  await expect(page.locator('#studio-compose-render')).toBeDisabled();await expect(page.locator('#studio-compose-source')).toHaveText('Nenhuma imagem fornecida.');await expect(page.locator('#studio-compose-status')).toContainText('Composição cancelada');
});
test('a local PNG survives the late rejection of a previous capture after navigation',async()=>{
  await page.evaluate(()=>{const state=(window as unknown as Fixture).__gapState;state.tabUrl='https://studio.youtube.com/video/aaaaaaaaaaa/analytics';state.holdMeasurement=true;});
  await page.locator('[data-page="studio"]').click();await page.locator('#studio-compose-enabled').check();await page.locator('#analytics-shot').click();
  await expect.poll(()=>page.evaluate(()=>!!(window as unknown as Fixture).__gapState.finishMeasurement)).toBe(true);
  const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=8;canvas.height=4;canvas.getContext('2d')!.fillRect(0,0,8,4);return canvas.toDataURL().split(',')[1];});
  await page.locator('#studio-compose-file').setInputFiles({name:'nova-origem-local.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await expect(page.locator('#studio-compose-source')).toContainText('nova-origem-local.png');
  await page.evaluate(async()=>{const state=(window as unknown as Fixture).__gapState;state.tabUrl='https://studio.youtube.com/video/bbbbbbbbbbb/analytics';state.finishMeasurement!();await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
  await expect(page.locator('#studio-compose-source')).toContainText('nova-origem-local.png');await expect(page.locator('#studio-compose-render')).toBeEnabled();
});
test('workspace passes fractional frame positions and refuses conflicting editor FPS before sending',async()=>{
  await page.locator('[data-page="studio"]').click();await page.locator('#studio-action').selectOption('midrolls');await page.locator('#duration').fill('600');await page.locator('#midroll-mode').selectOption('quantity');await page.locator('#midroll-position-precision').selectOption('frames');await page.locator('#midroll-position-fps').fill('30');await page.locator('#midroll-playhead').fill('250.5');await page.locator('#midroll-include-playhead').check();await page.locator('#studio-preview').click();
  await expect(page.locator('#studio-confirm')).toBeEnabled();const plans=await page.evaluate(()=>(window as unknown as Fixture).__gapState.messages.filter(m=>m.type==='STUDIO_PREVIEW'));
  expect(plans).toHaveLength(1);expect(plans[0].input).toMatchObject({fps:30,positions:expect.arrayContaining([250.5])});
  await page.locator('#studio-fps').selectOption('24');await page.locator('#studio-preview').click();await expect(page.locator('#studio-plan')).toContainText('FPS do plano difere');await expect(page.locator('#studio-confirm')).toBeDisabled();expect(await page.evaluate(()=>(window as unknown as Fixture).__gapState.messages.filter(m=>m.type==='STUDIO_PREVIEW').length)).toBe(1);
});
