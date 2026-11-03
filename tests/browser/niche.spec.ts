import { test, expect, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

let browser: Browser, context: BrowserContext, page: Page, bundle: string;
const origin = "http://niche.test";
const requests: string[] = [];
test.beforeAll(async () => {
  const result = await build({ stdin: { contents: `import { initNicheTools } from './src/ui/niche';
const base = { channel: 'Fixture', channelId: 'a', isShort: false, source: 'user-provided', publishedAt: new Date(Date.now() - 86400000).toISOString(), durationSeconds: 60, subscribers: 100 };
const videos = [
  { ...base, id: 'target', title: '=SUM(1)|<img src=x>', url: 'https://example.com/t', views: 500000 },
  ...[100000,100000,100000].map((views,i) => ({...base, id:'p'+i, title:'Peer '+i, url:'https://example.com/p', views})),
  {id:'missing', title:'Unknown', url:'https://example.com/u'},
  {...base, id:'api', title:'API secret', views:99999999, source:'youtube-data-api'},
  {...base, id:'target', title:'Duplicate', views:1}
];
let snapshot = {url:'', title:'', videos, comments:[], transcript:[], warnings:[]};
const tools = initNicheTools({snapshot:()=>snapshot});
globalThis.fixtureReplaceNiche = () => { snapshot = {...snapshot, videos:[{...base, id:'replacement', title:'Replacement', url:'https://example.com/new', views:17}]}; tools.invalidate(); };
globalThis.fixtureClearNiche = () => { snapshot = {...snapshot, videos:[]}; tools.invalidate(); };
globalThis.fixtureNicheModeSample = () => { snapshot = {...snapshot, videos:[
  {...base,id:'mode-target',title:'Mode target',url:'https://example.com/mode',views:1000},
  ...[100,100,1000].map((views,index)=>({...base,id:'mode-peer-'+index,title:'Mode peer '+index,url:'https://example.com/peer',views,source:['youtube-dom','public-page',undefined][index],durationSeconds:1000,publishedAt:'2020-01-01T00:00:00Z'})),
  {...base,id:'api-mode',title:'Official excluded',url:'https://example.com/api',views:1,source:'youtube-data-api'}
]};tools.invalidate();};`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "iife" });
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch({ executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), headless: true, args: ["--no-sandbox"] });
});
test.afterAll(async () => { await browser?.close(); });
test.beforeEach(async () => {
  context = await browser.newContext({ acceptDownloads: true }); requests.length = 0;
  await context.route("**/*", async route => { const url = route.request().url(); if (url === `${origin}/`) return route.fulfill({ contentType: "text/html", body: `<section id="niche"></section><script src="/bundle.js"></script>` }); if (url === `${origin}/bundle.js`) return route.fulfill({ contentType: "text/javascript", body: bundle }); requests.push(url); return route.abort(); });
  page = await context.newPage(); await page.goto(`${origin}/`);
});
test.afterEach(async () => { await context?.close(); });

test("renders local sample, filters, resets and downloads real reports", async () => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.locator("#niche-refresh").click();
  await expect(page.locator("#niche-scope")).toContainText("7 registros · 1 da API excluídos · 1 duplicatas excluídas · 5 elegíveis · 5 incluídos");
  await expect(page.locator("#niche-distribution")).toContainText("≥5×: 1");
  await expect(page.locator("#niche-videos img")).toHaveCount(0);
  await expect(page.locator("#niche-videos")).not.toContainText("API secret");
  await expect(page.locator("#niche-coverage")).toContainText("Views/inscrito");
  await expect(page.locator("#niche-timeline")).toContainText("Fixture");
  await page.locator("#niche-preset").selectOption("500k");
  await expect(page.locator("#niche-export-json")).toBeDisabled();
  await page.locator("#niche-refresh").click();
  await expect(page.locator("#niche-videos tr")).toHaveCount(1);
  for (const [format, suffix] of [["json", "json"], ["csv", "csv"], ["markdown", "md"]] as const) {
    const promise = page.waitForEvent("download"); await page.locator(`#niche-export-${format}`).click(); const download = await promise;
    expect(download.suggestedFilename()).toBe(`prevlev-nicho.${suffix}`);
    const content = await readFile((await download.path())!, "utf8");
    if (format === "json") { const data = JSON.parse(content); expect(data.scope.included).toBe(1); expect(data.scope.excludedApi).toBe(1); expect(data.videos[0].outlier).toBe(5); }
    if (format === "csv") expect(content).toContain("'=SUM(1)");
    if (format === "markdown") expect(content).toContain("\\|\\<img");
  }
  await page.locator("#niche-preset").selectOption("all");
  await page.locator("#niche-channels input").check();
  await page.locator("#niche-duration").selectOption("1to4");
  await page.locator("#niche-refresh").click();
  await expect(page.locator("#niche-videos tr")).toHaveCount(4);
  await page.locator("#niche-reset").click();
  await expect(page.locator("#niche-preset")).toHaveValue("all");
  await expect(page.locator("#niche-channels input")).not.toBeChecked();
  await expect(page.locator("#niche-export-json")).toBeDisabled();
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});


test("snapshot replacement and clearing erase the prior report and disable exports", async () => {
  await page.locator("#niche-refresh").click();
  await expect(page.locator("#niche-videos")).toContainText("Peer 0");
  await expect(page.locator("#niche-channels")).toContainText("Fixture");
  await page.evaluate(() => (globalThis as typeof globalThis & { fixtureReplaceNiche: () => void }).fixtureReplaceNiche());
  await expect(page.locator("#niche-result")).toBeHidden();
  await expect(page.locator("#niche-videos tr")).toHaveCount(0);
  await expect(page.locator("#niche-coverage tr")).toHaveCount(0);
  await expect(page.locator("#niche-timeline tr")).toHaveCount(0);
  await expect(page.locator("#niche-channels")).not.toContainText("Fixture");
  await expect(page.locator("#niche-status")).toContainText("Coleção alterada");
  for (const format of ["json", "csv", "markdown"]) await expect(page.locator(`#niche-export-${format}`)).toBeDisabled();
  await page.locator("#niche-refresh").click();
  await expect(page.locator("#niche-videos")).toContainText("Replacement");
  await expect(page.locator("#niche-videos")).not.toContainText("Peer 0");
  await page.evaluate(() => (globalThis as typeof globalThis & { fixtureClearNiche: () => void }).fixtureClearNiche());
  await expect(page.locator("#niche-result")).toBeHidden();
  await expect(page.locator("#niche-videos")).toBeEmpty();
  await expect(page.locator("#niche-channels")).not.toContainText("Fixture");
  await expect(page.locator("#niche-export-json")).toBeDisabled();
  await page.locator("#niche-refresh").click();
  await expect(page.locator("#niche-scope")).toContainText("0 incluídos");
  await expect(page.locator("#niche-videos tr")).toHaveCount(0);
  expect(requests).toEqual([]);
});

test("switches the explicit niche outlier mode, invalidates old results and applies it before filters", async () => {
  await page.evaluate(() => (globalThis as typeof globalThis & { fixtureNicheModeSample(): void }).fixtureNicheModeSample());
  await expect(page.locator("#niche-comparison-mode")).toHaveValue("sample-median");
  await page.locator("#niche-period").selectOption("week");
  await page.locator("#niche-duration").selectOption("1to4");
  await page.locator("#niche-preset").selectOption("high-outlier");
  await page.locator("#niche-refresh").click();
  await expect(page.locator("#niche-videos tr")).toHaveCount(1);
  await expect(page.locator("#niche-videos")).toContainText("10×");
  await expect(page.locator("#niche-comparison-summary")).toContainText("sample-median");
  await page.locator("#niche-comparison-mode").selectOption("sample-channel-reference");
  await expect(page.locator("#niche-result")).toBeHidden();
  await expect(page.locator("#niche-export-json")).toBeDisabled();
  await expect(page.locator("#niche-comparison-info")).toContainText("nome isolado não basta");
  await page.locator("#niche-refresh").click();
  await expect(page.locator("#niche-videos tr")).toHaveCount(0);
  await expect(page.locator("#niche-comparison-summary")).toContainText("sample-channel-reference");
  await page.locator("#niche-preset").selectOption("all");
  await page.locator("#niche-refresh").click();
  await expect(page.locator("#niche-videos tr")).toHaveCount(1);
  await expect(page.locator("#niche-videos")).toContainText("2,5×");
  await expect(page.locator("#niche-videos")).toContainText("referência 400");
  await expect(page.locator("#niche-videos")).toContainText("3 candidatas (3 positivas)");
  for (const format of ["json", "csv", "markdown"] as const) {
    const promise = page.waitForEvent("download"); await page.locator(`#niche-export-${format}`).click();
    const content = await readFile((await (await promise).path())!, "utf8");
    if (format === "json") { const data = JSON.parse(content); expect(data.options.comparisonMode).toBe("sample-channel-reference"); expect(data.videos[0]).toMatchObject({ outlier: 2.5, outlierReference: 400, outlierReferences: 3, outlierProvenance: "loaded-observations" }); expect(data.scope.excludedApi).toBe(1); }
    else { expect(content).toContain("sample-channel-reference"); expect(content).toContain("sample-channel-mean"); expect(content).toContain("400"); expect(content).toContain("loaded-observations"); }
  }
  await page.evaluate(() => (globalThis as typeof globalThis & { fixtureReplaceNiche(): void }).fixtureReplaceNiche());
  await expect(page.locator("#niche-comparison-mode")).toHaveValue("sample-channel-reference");
  await expect(page.locator("#niche-export-json")).toBeDisabled();
  await page.locator("#niche-reset").click();
  await expect(page.locator("#niche-comparison-mode")).toHaveValue("sample-median");
  await expect(page.locator("#niche-comparison-info")).toContainText("Modo sample-median");
  expect(requests).toEqual([]);
});

test("renders and exports a channel reference as unknown when the sample lacks sufficient peers", async () => {
  await page.evaluate(() => (globalThis as typeof globalThis & { fixtureReplaceNiche(): void }).fixtureReplaceNiche());
  await page.locator("#niche-comparison-mode").selectOption("sample-channel-reference");
  await page.locator("#niche-refresh").click();
  await expect(page.locator("#niche-videos")).toContainText("desconhecido; método previsto sample-channel-mean; referência desconhecido (unknown)");
  const promise = page.waitForEvent("download"); await page.locator("#niche-export-json").click();
  const data = JSON.parse(await readFile((await (await promise).path())!, "utf8"));
  expect(data.options.comparisonMode).toBe("sample-channel-reference");
  expect(data.videos[0]).toMatchObject({ outlierReference: null, outlierReferenceStatus: "unknown", outlierScoreStatus: "unknown", outlierReferences: 0 });
  expect(requests).toEqual([]);
});
