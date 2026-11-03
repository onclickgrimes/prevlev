import {test,expect,chromium,type Browser,type BrowserContext,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import type {SponsorshipReport} from '../../src/core/sponsorships';

const origin='http://localhost:9402';
interface SponsorFixtureWindow extends Window {__sponsorStore:Record<string,unknown>;__sponsorInjected?:boolean;}
let browser:Browser,context:BrowserContext,page:Page,requests:string[],errors:string[];
test.beforeAll(async()=>{browser=await chromium.launch({executablePath:process.env.PREVLEV_CHROMIUM_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});});
test.afterAll(async()=>{await browser?.close();});
test.beforeEach(async()=>{
 requests=[];errors=[];context=await browser.newContext({viewport:{width:1500,height:1100},acceptDownloads:true});
 // No backend, brand website, API key, real account or live service is used.
 await context.route('**/*',async route=>{const url=new URL(route.request().url()),file=url.pathname.slice(1);if(url.origin!==origin||!['workspace.html','workspace.js','ui.css'].includes(file)){requests.push(url.href);return route.abort();}return route.fulfill({body:await readFile(resolve('dist',file)),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});});
 await context.addInitScript(({origin})=>{
   const state=window as unknown as SponsorFixtureWindow;const snapshot={url:'',title:'Fixture local',videos:[],comments:[],transcript:[],warnings:[]};state.__sponsorStore={snapshot};
   Object.defineProperty(globalThis,'chrome',{value:{runtime:{id:'sponsor-fixture',getURL:(path:string)=>`${origin}/${path}`,sendMessage:async()=>{throw new Error('A análise de patrocínio deve ser local.');}},tabs:{query:async()=>[],sendMessage:async()=>({status:'unsupported'})},storage:{local:{get:async(key:string)=>({[key]:state.__sponsorStore[key]}),set:async(data:Record<string,unknown>)=>Object.assign(state.__sponsorStore,data),remove:async(keys:string[])=>keys.forEach(key=>delete state.__sponsorStore[key])},onChanged:{addListener:()=>{}}},permissions:{request:async()=>true,remove:async()=>true}}});
 },{origin});
 page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(`${origin}/workspace.html`);await page.locator('[data-page="sponsorships"]').click();await expect(page.locator('#sponsor-analyze')).toBeVisible();
});
test.afterEach(async()=>{expect(requests).toEqual([]);expect(errors).toEqual([]);await context?.close();});

test('extracts literal brands, coupons, disclosure and unknowns only after an explicit local action',async()=>{
 const text='🪐 Abertura.\nPatrocinado pela Acme Studio. Use cupom ACME20 em https://acme.example/?ref=creator\nSponsored by Acme Studio. Affiliate link https://shop.example/?ref=creator\nPatrocinado por https://unknown.example\nNão é patrocinado por Falsa Marca.';
 await expect(page.locator('#sponsor-result')).toBeHidden();await page.locator('#sponsor-text').fill(text);await expect(page.locator('#sponsor-result')).toBeHidden();await expect(page.locator('#sponsor-export-json')).toBeDisabled();
 await page.locator('#sponsor-analyze').click();await expect(page.locator('#sponsor-status')).toContainText('Leitura local concluída');await expect(page.locator('#sponsor-brands li')).toHaveCount(1);await expect(page.locator('#sponsor-brands')).toContainText('Acme Studio');await expect(page.locator('#sponsor-coupons')).toContainText('ACME20');await expect(page.locator('#sponsor-unknown')).toContainText('Marca desconhecida');await expect(page.locator('#sponsor-unknown')).toContainText('Negação literal');
 await expect(page.locator('#sponsor-links a')).toHaveCount(3);await expect(page.locator('#sponsor-links a').first()).toHaveAttribute('rel','noopener noreferrer');await expect(page.locator('#sponsor-links')).toContainText('contexto na mesma linha');await expect(page.locator('#sponsor-links')).toContainText('sem marca atribuída');await expect(page.locator('#sponsor-status')).toContainText('desconhecidos');
 const store=await page.evaluate(()=>(window as unknown as SponsorFixtureWindow).__sponsorStore);expect(JSON.stringify(store)).not.toContain('Acme Studio');expect(JSON.stringify(store)).not.toContain('ACME20');
});

test('exports actual JSON CSV and Markdown with original evidence and safe formula handling',async()=>{
 const text='🪐 Início.\nSponsored by "=SUM(A1:A2)". Use code SAVE20.\nOferecimento: Acme Studio. https://safe.example/path';
 await page.locator('#sponsor-text').fill(text);await page.locator('#sponsor-analyze').click();await expect(page.locator('#sponsor-export-json')).toBeEnabled();
 for(const [format,suffix]of [['json','json'],['csv','csv'],['markdown','md']]as const){
   const waiting=page.waitForEvent('download');await page.locator(`#sponsor-export-${format}`).click();const download=await waiting;expect(download.suggestedFilename()).toBe(`prevlev-sponsorship-evidence.${suffix}`);const content=await readFile((await download.path())!,'utf8');
   if(format==='json'){const report=JSON.parse(content)as SponsorshipReport;expect(report.estimatedRevenue).toBeNull();expect(report.brands.map(item=>item.value)).toEqual(['=SUM(A1:A2)','Acme Studio']);for(const proof of report.evidence)expect(text.slice(proof.start,proof.end)).toBe(proof.quote);expect(report.evidence.find(item=>item.quote==='=SUM(A1:A2)')?.line).toBe(2);expect(content).not.toContain('"confidence"');}
   if(format==='csv'){expect(content).toContain("'=SUM(A1:A2)");expect(content).toContain('"start"');expect(content).toContain('SAVE20');}
   if(format==='markdown'){expect(content).toContain('# Evidências textuais');expect(content).toContain('```text\n=SUM(A1:A2)\n```');expect(content).toContain('intervalo [');}
 }
 await page.locator('#sponsor-text').fill('Texto alterado.');await expect(page.locator('#sponsor-result')).toBeHidden();for(const format of ['json','csv','markdown'])await expect(page.locator(`#sponsor-export-${format}`)).toBeDisabled();
});

test('rejects official API provenance and unsafe links without any network or active markup',async()=>{
 await page.locator('#sponsor-source').selectOption('youtube-data-api');await page.locator('#sponsor-text').fill('Patrocinado por Acme.');await page.locator('#sponsor-analyze').click();await expect(page.locator('#sponsor-status')).toContainText('youtube-data-api');await expect(page.locator('#sponsor-result')).toBeHidden();await expect(page.locator('#sponsor-export-json')).toBeDisabled();
 await page.locator('#sponsor-source').selectOption('user-provided');await page.locator('#sponsor-text').fill('#ad <img src=x onerror="window.__sponsorInjected=true">\nPatrocinado por Acme. https://u:PRIVATE_SECRET@example.test/\nAffiliate link https://example.test/?access_token=PRIVATE_SECRET\njavascript:https://evil.test');await page.locator('#sponsor-analyze').click();
 await expect(page.locator('#sponsor-result')).toBeVisible();await expect(page.locator('#sponsor-links a')).toHaveCount(0);await expect(page.locator('#sponsor-limits')).toContainText('omitidos');await expect(page.locator('#sponsor-result img')).toHaveCount(0);expect(await page.evaluate(()=>(window as unknown as SponsorFixtureWindow).__sponsorInjected)).toBeUndefined();await expect(page.locator('#sponsor-result')).not.toContainText('PRIVATE_SECRET');
});

test('bounds the evidence list and clears source text/results/export state explicitly',async()=>{
 await page.locator('#sponsor-text').fill('Sponsored by Acme. Use code SAVE20.\n'.repeat(150));await page.locator('#sponsor-analyze').click();await expect(page.locator('#sponsor-evidence tr')).toHaveCount(200);await expect(page.locator('#sponsor-limits')).toContainText('Limite de 200');
 await page.locator('#sponsor-clear').click();await expect(page.locator('#sponsor-text')).toHaveValue('');await expect(page.locator('#sponsor-result')).toBeHidden();await expect(page.locator('#sponsor-evidence tr')).toHaveCount(0);await expect(page.locator('#sponsor-export-json')).toBeDisabled();
});
