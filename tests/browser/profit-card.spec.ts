import { test, expect, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { build } from "esbuild";
import { existsSync } from "node:fs";
import type { ProfitCardAdapter, ProfitCardObservation } from "../../src/content/profit-card";

type Fixture = Window & { card: ProfitCardAdapter; receipt?: ProfitCardObservation; nativeReads(): number | undefined; clock: number; nativeClicks: number };
let browser: Browser, context: BrowserContext, page: Page, bundle: string;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px system-ui;max-width:950px;margin:24px}label{display:block;margin:8px}input,button{font:inherit;margin:4px}#TOTAL_ESTIMATED_EARNINGS-tab{padding:18px;border:1px solid #888}</style></head><body>
  <div id="TOTAL_ESTIMATED_EARNINGS-tab" data-currency="BRL"><span id="metric-total" style="font-size:28px">R$ 1.000,00</span></div><span id="date-range-label">Últimos 28 dias</span>
  <label>Custo por vídeo<input id="cost" type="number" value="100"></label><label>Quantidade manual<input id="count" type="number" value="3"></label>
  <label><input id="revenue-confirm" type="checkbox"> Receita pertence ao período observado</label><label><input id="count-confirm" type="checkbox"> Confirmei quantidade e moeda do período</label>
  <button id="observe">Ler card</button><button id="show">Mostrar estimativa local</button><button id="restore">Restaurar apresentação</button><button id="cancel">Cancelar</button><button id="save">Save</button><p id="status"></p><p id="error"></p><script src="/fixture.js"></script></body></html>`;
test.beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `import {createProfitCardAdapter} from './src/content/profit-card';import {readStudioMetrics} from './src/content/studio';
    window.clock=Date.now();window.nativeClicks=0;window.nativeReads=()=>readStudioMetrics(document).revenue;
    window.card=createProfitCardAdapter({doc:document,readMetrics:()=>readStudioMetrics(document),now:()=>window.clock,onState:state=>document.querySelector('#status').textContent=JSON.stringify(state)});
    const run=(id,fn)=>document.querySelector('#'+id).addEventListener('click',()=>{document.querySelector('#error').textContent='';try{fn();}catch(error){document.querySelector('#error').textContent=error.message;}});
    run('observe',()=>{window.receipt=window.card.observe();document.querySelector('#revenue-confirm').checked=false;document.querySelector('#count-confirm').checked=false;});
    run('show',()=>{const r=window.receipt;if(!r)throw new Error('Leia o card primeiro.');window.card.show({revenue:r.revenue,currency:r.currencyCode,costCurrency:r.currencyCode,costPerVideo:Number(document.querySelector('#cost').value),videoCount:Number(document.querySelector('#count').value),period:{kind:'observed',label:r.period.label,observation:r.id},countPeriod:{kind:'observed',label:r.period.label,observation:r.id},source:{kind:'studio-dom',description:r.source.description,observation:r.id},collection:r.id,revenuePeriodConfirmed:document.querySelector('#revenue-confirm').checked,countConfirmed:document.querySelector('#count-confirm').checked},r.id);});
    run('restore',()=>window.card.restore());run('cancel',()=>window.card.cancel());
    for(const id of ['cost','count'])document.querySelector('#'+id).addEventListener('input',()=>{window.card.restore();document.querySelector('#revenue-confirm').checked=false;document.querySelector('#count-confirm').checked=false;});
    document.querySelector('#save').addEventListener('click',()=>window.nativeClicks++);document.querySelector('#TOTAL_ESTIMATED_EARNINGS-tab').addEventListener('click',()=>window.nativeClicks++);`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "iife" })).outputFiles[0].text;
  browser = await chromium.launch({ executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), headless: true, args: ["--no-sandbox"] });
});
test.afterAll(async () => { await browser?.close(); });
test.beforeEach(async () => {
  context = await browser.newContext();
  // Every URL is fulfilled locally; no Studio code, account, channel or service is used.
  await context.route("**/*", route => route.fulfill({ contentType: new URL(route.request().url()).pathname === "/fixture.js" ? "text/javascript" : "text/html", body: new URL(route.request().url()).pathname === "/fixture.js" ? bundle : html }));
  page = await context.newPage(); await page.goto("https://studio.youtube.com/video/abcdefghijk/analytics");
});
test.afterEach(async () => { await context?.close(); });
const projection = () => page.locator("[data-prevlev-profit-card]");
async function confirmedShow() { await page.locator("#observe").click(); await page.locator("#revenue-confirm").check(); await page.locator("#count-confirm").check(); await page.locator("#show").click(); }

test("requires a fresh read and manual confirmations, preserves native revenue while shown, and restores without native clicks", async () => {
  await expect(projection()).toHaveCount(0);
  await page.locator("#observe").click(); await expect(projection()).toHaveCount(0);
  await page.locator("#show").click(); await expect(page.locator("#error")).toContainText("Confirme"); await expect(projection()).toHaveCount(0);
  await confirmedShow(); await expect(projection().locator("output")).toHaveText("700 BRL");
  await expect(page.locator("#metric-total")).toHaveText("R$ 1.000,00"); await expect(page.locator("#metric-total")).toHaveAttribute("style", "font-size:28px");
  expect(await page.evaluate(() => (window as unknown as Fixture).nativeReads())).toBe(1000);
  await projection().getByRole("button", { name: "Voltar à receita nativa" }).click(); await expect(projection()).toHaveCount(0);
  expect(await page.evaluate(() => { const f = window as unknown as Fixture; return f.card.isCurrent(f.receipt!.id); })).toBe(true);
  await page.locator("#cost").fill("200"); await page.locator("#revenue-confirm").check(); await page.locator("#count-confirm").check(); await page.locator("#show").click(); await expect(projection().locator("output")).toHaveText("400 BRL");
  expect(await page.evaluate(() => (window as unknown as Fixture).nativeClicks)).toBe(0);
});

test("native amount/period and silent URL changes invalidate the estimate without restoring obsolete native text", async () => {
  await confirmedShow();
  await page.evaluate(() => { document.querySelector("#metric-total")!.textContent = "R$ 1.500,00"; });
  await expect(projection()).toHaveCount(0); await expect(page.locator("#status")).toContainText("invalidated"); await expect(page.locator("#metric-total")).toHaveText("R$ 1.500,00");
  await confirmedShow(); await expect(projection().locator("output")).toHaveText("1.200 BRL");
  await page.evaluate(() => { document.querySelector("#date-range-label")!.textContent = "Últimos 7 dias"; });
  await expect(projection()).toHaveCount(0); await expect(page.locator("#metric-total")).toHaveText("R$ 1.500,00");
  await confirmedShow();
  await page.evaluate(() => history.pushState(null, "", "/video/another/analytics"));
  await expect(projection()).toHaveCount(0); await expect(page.locator("#status")).toContainText("invalidated");
});

test("identical native node recycling invalidates the receipt and never copies a shadow estimate into a new card", async () => {
  await confirmedShow();
  await page.evaluate(() => { const native = document.querySelector("#metric-total")!; native.replaceWith(native.cloneNode(true)); });
  await expect(projection()).toHaveCount(0); await expect(page.locator("#status")).toContainText("invalidated");
  await confirmedShow();
  await page.evaluate(() => { const card = document.querySelector("#TOTAL_ESTIMATED_EARNINGS-tab")!; card.replaceWith(card.cloneNode(true)); });
  await expect(page.locator("#status")).toContainText("invalidated"); await expect(projection().locator("output")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as Fixture).nativeReads())).toBe(1000);
});

test("expiry, cancellation, pagehide and cleanup remove owned UI and refuse stale receipts", async () => {
  await confirmedShow();
  await page.evaluate(() => { const f = window as unknown as Fixture; f.clock += 120_000; f.card.isCurrent(f.receipt!.id); });
  await expect(projection()).toHaveCount(0); await expect(page.locator("#status")).toContainText("expired");
  await confirmedShow(); await page.locator("#cancel").click(); await expect(projection()).toHaveCount(0); await expect(page.locator("#status")).toContainText("cancelled");
  await confirmedShow(); await page.evaluate(() => window.dispatchEvent(new Event("pagehide"))); await expect(projection()).toHaveCount(0);
  await confirmedShow(); await page.evaluate(() => (window as unknown as Fixture).card.cleanup()); await expect(projection()).toHaveCount(0); await expect(page.locator("#status")).toContainText("disposed");
  await page.locator("#observe").click(); await expect(page.locator("#error")).toContainText("encerrado");
});

test("ownership compare-and-swap preserves externally changed subtree and native updates", async () => {
  await confirmedShow();
  await page.evaluate(() => { const host = document.querySelector("[data-prevlev-profit-card]")!; host.shadowRoot!.querySelector("output")!.textContent = "Conteúdo de outro renderizador"; document.querySelector("#metric-total")!.textContent = "R$ 2.000,00"; });
  await expect(page.locator("#status")).toContainText('"removedOwnPresentation":false');
  await expect(projection().locator("output")).toHaveText("Conteúdo de outro renderizador");
  await expect(page.locator("#metric-total")).toHaveText("R$ 2.000,00");
});
