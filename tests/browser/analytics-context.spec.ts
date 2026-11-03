import { test, expect, chromium, type Browser } from "@playwright/test";
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

let browser: Browser;
test.beforeAll(async () => { browser = await chromium.launch({ executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), headless: true, args: ["--no-sandbox"] }); });
test.afterAll(async () => { await browser?.close(); });
async function fixture() {
  const page = await browser.newPage({ acceptDownloads: true }), requests: string[] = [];
  await page.route("**/*", route => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent('<section id="research"><label>Views mínimas<input id="fixture-min" type="number" value="0"></label></section><section id="analytics"></section><button id="replace-source">Alterar fonte sem evento</button><button id="clear-source">Limpar coleção e invalidar</button>');
  const bundle = await build({ stdin: { contents: `import {initAnalyticsTools} from './src/ui/analytics';
    let snapshot={url:'https://www.youtube.com/results?search_query=fixture',title:'Amostra',videos:[{id:'abcdefghijk',title:'Vídeo original',url:'https://www.youtube.com/watch?v=abcdefghijk',views:100,source:'youtube-dom'}],comments:[],transcript:[],warnings:[]};
    const tools=initAnalyticsTools({snapshot:()=>snapshot,filter:()=>({minViews:Number(document.querySelector('#fixture-min').value)})});
    document.querySelector('#replace-source').addEventListener('click',()=>{snapshot={...snapshot,videos:[{...snapshot.videos[0],title:'Vídeo novo',views:999}]};});
    document.querySelector('#clear-source').addEventListener('click',()=>{snapshot={...snapshot,videos:[]};tools.invalidate();});`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "iife" });
  await page.addScriptTag({ content: bundle.outputFiles[0].text }); return { page, requests };
}

test("stale collection cannot export and explicit invalidation clears only the prepared report", async () => {
  const { page, requests } = await fixture(); await page.locator("#analytics-refresh").click(); await expect(page.locator("#analytics-top")).toContainText("Vídeo original");
  await page.locator("#replace-source").click(); await page.locator("#analytics-export-json").click();
  await expect(page.locator("#analytics-result")).toBeHidden(); await expect(page.locator("#analytics-export-csv")).toBeDisabled(); await expect(page.locator("#analytics-status")).toContainText("coleção original foi preservada");
  await page.locator("#analytics-refresh").click(); await expect(page.locator("#analytics-top")).toContainText("Vídeo novo");
  const waiting = page.waitForEvent("download"); await page.locator("#analytics-export-json").click(); const report = JSON.parse(await readFile((await (await waiting).path())!, "utf8"));
  expect(report.videos).toMatchObject([{ title: "Vídeo novo", views: 999 }]);
  await page.locator("#clear-source").click(); await expect(page.locator("#analytics-result")).toBeHidden(); await expect(page.locator("#analytics-top")).toBeEmpty(); await expect(page.locator("#analytics-export-json")).toBeDisabled();
  await page.locator("#analytics-refresh").click(); await expect(page.locator("#analytics-scope")).toContainText("0 vídeos incluídos"); expect(requests).toEqual([]); await page.close();
});

test("research events invalidate active filters while inactive filters leave the whole-collection report valid", async () => {
  const { page, requests } = await fixture(); await page.locator("#analytics-refresh").click(); await page.locator("#fixture-min").fill("200");
  await expect(page.locator("#analytics-result")).toBeVisible(); await expect(page.locator("#analytics-export-json")).toBeEnabled();
  await page.locator("#analytics-source").selectOption("filtered"); await page.locator("#analytics-refresh").click(); await expect(page.locator("#analytics-scope")).toContainText("0 vídeos incluídos");
  await page.locator("#fixture-min").fill("0"); await expect(page.locator("#analytics-result")).toBeHidden(); await expect(page.locator("#analytics-export-json")).toBeDisabled();
  await page.locator("#analytics-refresh").click(); await expect(page.locator("#analytics-scope")).toContainText("1 vídeos incluídos");
  await page.evaluate(() => { (document.getElementById("fixture-min") as HTMLInputElement).value = "1000"; }); await page.locator("#analytics-export-markdown").click(); await expect(page.locator("#analytics-result")).toBeHidden();
  expect(requests).toEqual([]); await page.close();
});
