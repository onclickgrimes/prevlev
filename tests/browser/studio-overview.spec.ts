import { test, expect, chromium, type Browser } from "@playwright/test";
import { build } from "esbuild";
import { existsSync } from "node:fs";

let browser: Browser;
test.beforeAll(async () => {
  browser = await chromium.launch({ executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), headless: true, args: ["--no-sandbox"] });
});
test.afterAll(async () => { await browser?.close(); });

test("renders observed Studio context and presets only fill workspace fields", async () => {
  const page = await browser.newPage();
  const requests: string[] = [];
  await page.route("**/*", async route => { requests.push(route.request().url()); await route.abort(); });
  await page.setContent('<section id="studio"><input type="date" id="period-start"><input type="date" id="period-end"><input id="video-total" value="1"><button id="period">Preencher período aberto</button><div id="native-result"></div></section>');
  const bundle = await build({ stdin: { contents: `import { initStudioOverview } from './src/ui/studio-overview';
    document.querySelector('#period').addEventListener('click', () => document.querySelector('#native-result').textContent = 'clicked');
    initStudioOverview({ snapshot: () => ({ url: '', title: '', videos: [], comments: [], transcript: [], warnings: [], studio: { source: 'studio-dom', observedAt: '2024-03-08T00:00:00Z', revenue: 12.5, currency: 'R$', period: { label: 'Últimos 28 dias', selector: '#date-range-label' }, sources: {}, warnings: [] } }) });`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "iife" });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await expect(page.locator("#studio-overview")).toContainText("Últimos 28 dias");
  await expect(page.locator("#studio-overview")).toContainText("Data da observação");
  await expect(page.locator("#studio-overview")).toContainText("Quantidade observada de vídeosDesconhecida");
  await expect(page.locator('[data-days="7"]')).toBeDisabled();
  await page.locator("#studio-publication-date").fill("2020-02-28");
  await page.locator('[data-days="7"]').click();
  await expect(page.locator("#period-start")).toHaveValue("2020-02-28");
  await expect(page.locator("#period-end")).toHaveValue("2020-03-05");
  await expect(page.locator("#native-result")).toBeEmpty();
  await expect(page.locator("#video-total")).toHaveValue("1");
  expect(requests).toEqual([]);
  await page.close();
});

test('changing video clears the publication declaration and prepared dates before another preset can run',async()=>{
  const page=await browser.newPage();await page.setContent('<section id="studio"><input type="date" id="period-start"><input type="date" id="period-end"></section>');
  const built=await build({stdin:{contents:`import {initStudioOverview} from './src/ui/studio-overview';
let snapshot={url:'https://studio.youtube.com/video/aaaaaaaaaaa/analytics',videoId:'aaaaaaaaaaa',title:'A',videos:[],comments:[],transcript:[],warnings:[]};
const tools=initStudioOverview({snapshot:()=>snapshot});window.changeVideo=()=>{snapshot={...snapshot,url:'https://studio.youtube.com/video/bbbbbbbbbbb/analytics',videoId:'bbbbbbbbbbb'};tools.render();};`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife'});
  await page.addScriptTag({content:built.outputFiles[0].text});await page.locator('#studio-publication-date').fill('2020-01-01');await page.locator('[data-days="7"]').click();
  await expect(page.locator('#period-end')).toHaveValue('2020-01-07');
  await page.evaluate(()=>(window as unknown as {changeVideo:()=>void}).changeVideo());
  await expect(page.locator('#studio-publication-date')).toHaveValue('');await expect(page.locator('#period-start')).toHaveValue('');await expect(page.locator('#period-end')).toHaveValue('');await expect(page.locator('[data-days="7"]')).toBeDisabled();
  await page.close();
});
