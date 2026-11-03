import {test,expect,chromium,type Browser,type BrowserContext,type Page} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

const origin='http://localhost:9404';
let browser:Browser,context:BrowserContext,page:Page,bundle:string;
const external:string[]=[];
const created='2026-11-03T00:00:00.000Z';
const thumbnail='https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg';
test.beforeAll(async()=>{
 const compiled=await build({stdin:{contents:"import {initSwipeTools} from './src/ui/swipe'; const tools=initSwipeTools(); globalThis.fixtureSaveVideo=tools.saveVideo; globalThis.fixtureRender=tools.render; tools.render();",resolveDir:process.cwd(),sourcefile:'swipe-fixture.ts'},bundle:true,write:false,format:'iife',target:'chrome120'});bundle=compiled.outputFiles[0].text;
 browser=await chromium.launch({executablePath:process.env.PREVLEV_CHROMIUM_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
});
test.afterAll(async()=>{await browser?.close();});
test.beforeEach(async()=>{
 context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});external.length=0;
 await context.route('**/*',async route=>{
  const url=route.request().url();
  if(url===`${origin}/`)return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><link rel="stylesheet" href="/ui.css"></head><body><p id="notice"></p><section id="swipe"></section><script src="/harness.js"></script></body></html>'});
  if(url===`${origin}/harness.js`)return route.fulfill({contentType:'text/javascript',body:bundle});
  if(url===`${origin}/ui.css`)return route.fulfill({contentType:'text/css',body:await readFile(resolve('ui.css'))});
  external.push(url);
  if(url===thumbnail)return route.fulfill({contentType:'image/png',headers:{'Access-Control-Allow-Origin':'*'},body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZkAAAAASUVORK5CYII=','base64')});
  return route.abort();
 });
 await context.addInitScript(({created,thumbnail})=>{
  const state:{items:unknown[];writes:number;quota:boolean}={items:[{id:'legacy-id',folder:'Roteiros',title:'=SUM(1) referência antiga',url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ',thumbnail,createdAt:created}],writes:0,quota:false};
  Object.assign(globalThis,{fixtureState:state});
  Object.defineProperty(globalThis,'chrome',{value:{storage:{local:{get:async()=>({swipe:structuredClone(state.items)}),set:async(data:{swipe:unknown[]})=>{if(state.quota)throw new Error('QUOTA_BYTES private error');state.items=structuredClone(data.swipe);state.writes++;}}}}});
 },{created,thumbnail});
 page=await context.newPage();await page.goto(origin);await expect(page.locator('#swipe-list')).toContainText('referência antiga');
});
test.afterEach(async()=>{await context?.close();});
const state=()=>page.evaluate(()=>structuredClone((globalThis as unknown as {fixtureState:{items:Record<string,unknown>[];writes:number;quota:boolean}}).fixtureState));

test('reads legacy references without migration or remote image requests, then previews only after a click',async()=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 expect((await state()).writes).toBe(0);expect(external).toEqual([]);await expect(page.locator('#swipe-list img')).toHaveCount(0);
 await page.getByRole('button',{name:'Ver prévia da imagem'}).click();await expect(page.locator('#swipe-list img')).toBeVisible();await expect.poll(()=>page.locator('#swipe-list img').evaluate((image:HTMLImageElement)=>image.naturalWidth)).toBe(1);expect(external).toEqual([thumbnail]);
 await page.getByRole('button',{name:'Ocultar prévia'}).click();await expect(page.locator('#swipe-list img')).toHaveCount(0);expect((await state()).writes).toBe(0);expect(errors).toEqual([]);
});

test('adds, edits, searches, moves and deletes with tags and notes while preserving identity',async()=>{
 await page.locator('#swipe-title').fill('<img src=x onerror=alert(1)> Canal de edição');await page.locator('#swipe-url').fill('https://www.youtube.com/@Example');await page.locator('#swipe-folder').fill('Produção');await page.locator('#swipe-tags').fill('Edição, Roteiro');await page.locator('#swipe-notes').fill('Ideia de introdução detalhada');await page.locator('#swipe-add').click();await expect(page.locator('#swipe-status')).toContainText('Referência salva');
 expect((await state()).items).toHaveLength(2);const saved=(await state()).items.find(item=>item.url==='https://www.youtube.com/@Example')!;expect(saved.type).toBe('channel');
 await expect(page.locator('#swipe-list img')).toHaveCount(0);await expect(page.locator('#swipe-list script')).toHaveCount(0);expect(external).toEqual([]);
 await page.locator('#swipe-search').fill('introducao');await expect(page.locator('#swipe-list article')).toHaveCount(1);await page.locator('#swipe-filter-tag').selectOption('Edição');await page.locator('#swipe-filter-type').selectOption('channel');await expect(page.locator('#swipe-list')).toContainText('Canal de edição');
 await page.getByRole('button',{name:'Editar',exact:true}).click();await page.locator('#swipe-title').fill('Título editado');await page.locator('#swipe-notes').fill('Ideia de introdução revisada');await page.locator('#swipe-add').click();await expect(page.locator('#swipe-status')).toContainText('ID e criação preservados');const edited=(await state()).items.find(item=>item.id===saved.id)!;expect(edited.createdAt).toBe(saved.createdAt);expect(edited.notes).toBe('Ideia de introdução revisada');
 await page.locator('#swipe-list summary').click();await page.getByRole('combobox',{name:'Nova pasta'}).fill('Pesquisa');await page.getByRole('button',{name:'Aplicar pasta'}).click();await expect(page.locator('#swipe-status')).toContainText('movida');expect((await state()).items.find(item=>item.id===saved.id)?.folder).toBe('Pesquisa');
 await page.getByRole('button',{name:'Excluir',exact:true}).click();await expect(page.locator('#swipe-status')).toContainText('excluída');expect((await state()).items).toHaveLength(1);
});

test('imports with visible deduplication/conflict counts and exports versioned JSON and safe CSV',async()=>{
 const incoming={format:'prevlev-swipe',version:2,items:[{id:'duplicate-url',title:'Dup',url:'https://youtu.be/dQw4w9WgXcQ',createdAt:created},{id:'legacy-id',title:'Conflict',url:'https://example.com/conflict',createdAt:created},{id:'import-id',title:'Nova referência',url:'https://example.com/new',tags:['Estudo'],notes:'Nota importada',createdAt:created}]};
 await page.locator('#swipe-import').setInputFiles({name:'biblioteca.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});await expect(page.locator('#swipe-status')).toContainText('1 referências importadas; 1 duplicatas e 1 conflitos');expect((await state()).items).toHaveLength(2);expect((await state()).items.map(item=>item.id)).toEqual(['legacy-id','import-id']);
 for(const format of ['json','csv']){const waiting=page.waitForEvent('download');await page.locator(format==='json'?'#swipe-export':'#swipe-export-csv').click();const download=await waiting;expect(download.suggestedFilename()).toBe(`prevlev-swipe.${format}`);const content=await readFile((await download.path())!,'utf8');if(format==='json'){const data=JSON.parse(content);expect(data.version).toBe(2);expect(data.items[1]).toMatchObject({id:'import-id',tags:['Estudo'],notes:'Nota importada'});}else{expect(content).toContain("'=SUM(1)");expect(content).toContain('notes');}}
 expect(external).toEqual([]);
});

test('invalid URLs, API provenance and quota failure preserve prior data and show errors',async()=>{
 const initial=await state();await page.locator('#swipe-title').fill('Unsafe');await page.locator('#swipe-url').fill('javascript:alert(1)');await page.locator('#swipe-add').click();await expect(page.locator('#swipe-status')).toContainText('HTTPS');expect((await state()).items).toEqual(initial.items);
 const api=[{id:'api',title:'API record',url:'https://example.com/api',source:'youtube-data-api',createdAt:created}];await page.locator('#swipe-import').setInputFiles({name:'api.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(api))});await expect(page.locator('#swipe-status')).toContainText('youtube-data-api');expect((await state()).writes).toBe(0);
 const rejected=await page.evaluate(async()=>{try{await (globalThis as unknown as {fixtureSaveVideo:(video:unknown)=>Promise<void>}).fixtureSaveVideo({id:'abcdefghijk',title:'API save',url:'https://www.youtube.com/watch?v=abcdefghijk',source:'youtube-data-api'});return false;}catch{return true;}});expect(rejected).toBe(true);expect((await state()).writes).toBe(0);
 await page.evaluate(()=>{(globalThis as unknown as {fixtureState:{quota:boolean}}).fixtureState.quota=true;});await page.locator('#swipe-title').fill('Quota');await page.locator('#swipe-url').fill('https://example.com/new');await page.locator('#swipe-add').click();await expect(page.locator('#swipe-status')).toContainText('cota');expect((await state()).items).toEqual(initial.items);expect(external).toEqual([]);
});

test('CSV import uses the same local validation and metadata rules',async()=>{
 const csv='id,title,url,folder,tags,notes\r\ncsv-id,"CSV, referência",https://example.com/csv,Leitura,"Edição, Estudo","Nota com\nsegunda linha"\r\n';
 await page.locator('#swipe-import').setInputFiles({name:'referencias.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await expect(page.locator('#swipe-status')).toContainText('1 referências importadas');expect((await state()).items.find(item=>item.id==='csv-id')).toMatchObject({folder:'Leitura',tags:['Edição','Estudo'],notes:'Nota com\nsegunda linha'});expect(external).toEqual([]);
});

test('actual Web Locks prevent lost updates across separate same-origin workspace pages',async()=>{
 let shared:Record<string,unknown>[]=[];
 await context.exposeBinding('sharedSwipeGet',async()=>{await new Promise(resolve=>setTimeout(resolve,20));return structuredClone(shared);});
 await context.exposeBinding('sharedSwipeSet',async(_source,data:{swipe:Record<string,unknown>[]})=>{await new Promise(resolve=>setTimeout(resolve,20));shared=structuredClone(data.swipe);});
 const second=await context.newPage();await second.goto(origin);await expect(second.locator('#swipe-list')).toContainText('referência antiga');
 for(const current of [page,second])await current.evaluate(()=>{
  const globals=globalThis as unknown as {chrome:{storage:{local:{get:(key:string)=>Promise<unknown>;set:(data:unknown)=>Promise<void>}}};sharedSwipeGet:()=>Promise<unknown[]>;sharedSwipeSet:(data:unknown)=>Promise<void>};
  globals.chrome.storage.local.get=async(key:string)=>({[key]:await globals.sharedSwipeGet()});globals.chrome.storage.local.set=data=>globals.sharedSwipeSet(data);
 });
 expect(await page.evaluate(()=>typeof navigator.locks?.request)).toBe('function');
 await Promise.all([page.evaluate(async()=>{await (globalThis as unknown as {fixtureSaveVideo:(video:unknown)=>Promise<void>}).fixtureSaveVideo({id:'abcdefghijk',title:'Página A',url:'https://www.youtube.com/watch?v=abcdefghijk'});}),second.evaluate(async()=>{await (globalThis as unknown as {fixtureSaveVideo:(video:unknown)=>Promise<void>}).fixtureSaveVideo({id:'bcdefghijkl',title:'Página B',url:'https://www.youtube.com/watch?v=bcdefghijkl'});})]);
 expect(shared).toHaveLength(2);expect(shared.map(item=>item.title).sort()).toEqual(['Página A','Página B']);expect(external).toEqual([]);await second.close();
});
