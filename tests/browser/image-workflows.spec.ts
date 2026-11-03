import {test,expect,chromium,type Browser,type BrowserContext,type Page} from '@playwright/test';
import {build} from 'esbuild';
import {existsSync} from 'node:fs';
import {stat} from 'node:fs/promises';
import type {compressToTarget,renderHomePreview} from '../../src/core/image-workflows';

interface FixtureWindow {__imageCore:{compressToTarget:typeof compressToTarget;renderHomePreview:typeof renderHomePreview};__drawnText:string[];}
let browser:Browser,script:string,context:BrowserContext,page:Page;
test.beforeAll(async()=>{
  script=(await build({stdin:{contents:`import {initImageTools} from './src/ui/images';import {compressToTarget,renderHomePreview} from './src/core/image-workflows';Object.assign(window,{__imageCore:{compressToTarget,renderHomePreview}});initImageTools({contextVideos:()=>[{id:'abcdefghijk',title:'Título observado real da amostra',url:'https://www.youtube.com/watch?v=abcdefghijk',channel:'Canal observado',views:123,publishedAt:'2026-10-01T00:00:00Z',durationSeconds:65,thumbnail:'https://i.ytimg.com/vi/abcdefghijk/default.jpg',source:'youtube-dom'}]});`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser',target:'chrome120'})).outputFiles[0].text;
  browser=await chromium.launch({executablePath:process.env.PREVLEV_CHROMIUM_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
});
test.afterAll(async()=>{await browser?.close();});
test.beforeEach(async()=>{
  context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  await context.route('**/*',route=>{
    if(route.request().url()==='http://localhost:9398/fixture.js')return route.fulfill({body:script,contentType:'text/javascript'});
    if(route.request().url()==='http://localhost:9398/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><style>body{font:14px sans-serif}label{display:block;margin:8px}input,select,textarea,button{padding:6px}#images>.card{padding:12px}.grid.two{display:grid;grid-template-columns:1fr 1fr;gap:20px}img{max-width:100%}</style><section id="images"></section><script src="fixture.js"></script>'});
    return route.abort();
  });
  await context.addInitScript(()=>{
    (window as unknown as FixtureWindow).__drawnText=[];
    const original=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(text:string,x:number,y:number,maxWidth?:number){(window as unknown as FixtureWindow).__drawnText.push(text);if(maxWidth===undefined)original.call(this,text,x,y);else original.call(this,text,x,y,maxWidth);};
  });
  page=await context.newPage();await page.goto('http://localhost:9398/');
});
test.afterEach(async()=>{await context?.close();});
async function png(width=800,height=450,color='#24a67d',alpha=false):Promise<Buffer>{
  const encoded=await page.evaluate(({width,height,color,alpha})=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d')!;ctx.fillStyle=color;ctx.fillRect(alpha?10:0,alpha?5:0,alpha?width-20:width,alpha?height-10:height);return canvas.toDataURL().split(',')[1];},{width,height,color,alpha});return Buffer.from(encoded,'base64');
}
async function uploadOriginal(buffer?:Buffer){await page.locator('#image-file').setInputFiles({name:'original.png',mimeType:'image/png',buffer:buffer??await png()});}

test('real canvas renders cyclic variants, observed provenance, layouts, themes and reversible comparison',async()=>{
  const external:string[]=[];page.on('request',request=>{if(!request.url().startsWith('http://localhost:9398/')&&!request.url().startsWith('blob:'))external.push(request.url());});
  await uploadOriginal();const red=await png(800,450,'#e33333'),blue=await png(800,450,'#3355cc');
  await page.locator('#candidate-file').setInputFiles([{name:'red.png',mimeType:'image/png',buffer:red},{name:'blue.png',mimeType:'image/png',buffer:blue}]);
  await page.locator('#preview-title').fill('Título um');await page.locator('#preview-titles').fill('Título dois\nTítulo três');
  await page.locator('#preview-views').fill('999 views de exemplo');await page.locator('#preview-date').fill('Data escolhida');await page.locator('#preview-duration').fill('07:35');
  await page.locator('#preview-avatar').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:await png(32,32,'#f8c344')});
  await page.locator('#preview-source').selectOption('loaded');await page.locator('#preview-load-context').click();await expect(page.locator('#preview-source-info')).toContainText('Coleção local congelada');
  await page.locator('#image-preview').click();await expect(page.locator('#image-output')).toBeVisible();await expect(page.locator('#image-variants button')).toHaveCount(3);
  await expect.poll(()=>page.locator('#image-output').evaluate((image:HTMLImageElement)=>image.naturalWidth)).toBe(1280);
  const text=await page.evaluate(()=>(window as unknown as FixtureWindow).__drawnText);
  expect(text.join('\n')).toContain('Título observado real');expect(text).toContain('123 visualizações · amostra');expect(text).toContain('1:05');expect(text).not.toContain('NEVER_API_CONTEXT');expect(text).toContain('999 views de exemplo');expect(text).toContain('Data escolhida');expect(text).toContain('07:35');
  for(const layout of ['mobile','list','desktop']){await page.locator('#preview-context').selectOption(layout);await expect(page.locator('#preview-status')).toContainText(layout);}
  await page.locator('#preview-theme').selectOption('light');await expect(page.locator('#preview-status')).toContainText('light');
  await page.locator('#preview-mode').selectOption('side-by-side');await expect.poll(()=>page.evaluate(()=>(window as unknown as FixtureWindow).__drawnText.includes('Original'))).toBe(true);
  await page.locator('#preview-restore').click();await expect(page.locator('#preview-mode')).toHaveValue('original');
  await page.locator('#preview-mode').selectOption('candidate');await expect.poll(()=>page.locator('#image-file').evaluate((input:HTMLInputElement)=>input.files?.[0]?.name)).toBe('original.png');
  expect(external).toEqual([]);
});

test('metadata Reset/Done, feed contexts and explicit source fallback are real local controls',async()=>{
  await uploadOriginal();await page.locator('#image-preview').click();await expect(page.locator('#image-output')).toBeVisible();
  for(const feed of ['trending','subscriptions','channel','search','home']){await page.locator('#preview-feed').selectOption(feed);await expect.poll(()=>page.locator('#preview-feed').inputValue()).toBe(feed);}
  await page.locator('#preview-views').fill('Personalizado');await page.locator('#metadata-reset').click();await expect(page.locator('#preview-views')).toHaveValue('12 mil visualizações · exemplo');
  await page.locator('#metadata-done').click();await expect(page.locator('#preview-metadata')).not.toHaveAttribute('open','');
  await page.locator('#preview-source').selectOption('illustrative');await expect(page.locator('#preview-status')).toContainText('ilustrativo');
  await page.locator('#preview-shuffle').click();await expect(page.locator('#preview-position')).toHaveValue('random');
  const download=page.waitForEvent('download');await page.locator('#preview-download').click();expect((await download).suggestedFilename()).toBe('prevlev-previa-local.png');
});

test('real encoder meets a feasible target and reports measured download bytes',async()=>{
  await expect(page.locator('#compression-target-kb')).toHaveValue('2048');
  await uploadOriginal();const downloading=page.waitForEvent('download');await page.locator('#compress').click();const downloaded=await downloading;
  expect(downloaded.suggestedFilename()).toBe('prevlev-thumbnail.jpg');const path=await downloaded.path();expect(path).not.toBeNull();const bytes=(await stat(path!)).size;
  await expect(page.locator('#compression-result')).toContainText(`${bytes} bytes`);await expect(page.locator('#compression-result')).toContainText('Meta atingida');await expect(page.locator('#image-info')).toContainText('Saída:');
});

test('preserves an eligible original byte for byte and transforms when required',async()=>{
  const input=await png(80,40,'#ff0000',true);
  const results=await page.evaluate(async base64=>{
    const bytes=Uint8Array.from(atob(base64),character=>character.charCodeAt(0)),source=new Blob([bytes],{type:'image/png'}),tools=(window as unknown as FixtureWindow).__imageCore;
    const preserved=await tools.compressToTarget(source,{targetBytes:50000,type:'image/png'});
    const resized=await tools.compressToTarget(source,{targetBytes:50000,type:'image/png',maxWidth:40,maxHeight:40});
    const converted=await tools.compressToTarget(source,{targetBytes:50000,type:'image/webp'});
    return {same:source===preserved.blob,reason:preserved.reason,iterations:preserved.iterations,alpha:preserved.alphaPreserved,resized:{width:resized.width,height:resized.height,reason:resized.reason},converted:{type:converted.type,reason:converted.reason}};
  },input.toString('base64'));
  expect(results).toEqual({same:true,reason:'original-preserved',iterations:0,alpha:true,resized:{width:40,height:20,reason:'target-met'},converted:{type:'image/webp',reason:'target-met'}});
});

test('impossible byte target and explicit cancellation never claim success or silently download',async()=>{
  await uploadOriginal();await page.locator('#compression-target-kb').fill('0.001');await page.locator('#compression-format').selectOption('image/png');
  let downloads=0;page.on('download',()=>downloads++);await page.locator('#compress').click();await expect(page.locator('#compression-result')).toContainText('Meta não atingida');expect(downloads).toBe(0);await expect(page.locator('#compression-download')).toBeEnabled();
  await page.evaluate(async()=>{document.getElementById('compress')!.click();await Promise.resolve();document.getElementById('compression-cancel')!.click();});
  await expect(page.locator('#compression-result')).toContainText('cancelado');expect(downloads).toBe(0);await expect(page.locator('#compression-download')).toBeDisabled();
});

test('actual PNG/WebP preserve alpha and JPEG requires explicit flattening',async()=>{
  const input=await png(40,20,'#ff0000',true);
  const results=await page.evaluate(async(base64)=>{
    const bytes=Uint8Array.from(atob(base64),character=>character.charCodeAt(0)),source=new Blob([bytes],{type:'image/png'}),tools=(window as unknown as FixtureWindow).__imageCore;
    const read=async(blob:Blob)=>{const image=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);image.close();return [...ctx.getImageData(0,0,1,1).data];};
    const preserved=[];for(const type of ['image/png','image/webp'] as const){const result=await tools.compressToTarget(source,{targetBytes:50000,type});preserved.push({type:result.type,hadAlpha:result.hadAlpha,alphaPreserved:result.alphaPreserved,pixel:await read(result.blob)});}
    const rejected=await tools.compressToTarget(source,{targetBytes:50000,type:'image/jpeg'}).then(()=>'',error=>(error as Error).message);
    const flattened=await tools.compressToTarget(source,{targetBytes:50000,type:'image/jpeg',flattenBackground:'#ffffff'});
    return {preserved,rejected,flattened:{flattened:flattened.flattened,alphaPreserved:flattened.alphaPreserved,pixel:await read(flattened.blob)}};
  },input.toString('base64'));
  for(const result of results.preserved){expect(result.alphaPreserved).toBe(true);expect(result.hadAlpha).toBe(true);expect(result.pixel[3]).toBe(0);}
  expect(results.rejected).toContain('autorize explicitamente');expect(results.flattened).toMatchObject({flattened:true,alphaPreserved:false});expect(results.flattened.pixel[3]).toBe(255);expect(results.flattened.pixel[0]).toBeGreaterThan(240);
});

test('JPEG EXIF orientation and aspect are respected exactly once by actual decoding',async()=>{
  const result=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=100;canvas.height=50;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#ee2222';ctx.fillRect(0,0,50,50);ctx.fillStyle='#2222ee';ctx.fillRect(50,0,50,50);
    const jpeg=await new Promise<Blob>(resolve=>canvas.toBlob(blob=>resolve(blob!),'image/jpeg',0.95)),bytes=new Uint8Array(await jpeg.arrayBuffer());
    const exif=new Uint8Array([69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
    const segment=new Uint8Array([255,225,0,exif.length+2,...exif]),oriented=new Blob([bytes.slice(0,2),segment,bytes.slice(2)],{type:'image/jpeg'});
    const result=await (window as unknown as FixtureWindow).__imageCore.compressToTarget(oriented,{targetBytes:50000,maxWidth:100,maxHeight:100,type:'image/png'});
    return {sourceWidth:result.sourceWidth,sourceHeight:result.sourceHeight,width:result.width,height:result.height};
  });
  expect(result).toEqual({sourceWidth:50,sourceHeight:100,width:50,height:100});
});
