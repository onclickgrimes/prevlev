import { test, expect, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { CardFilter } from "../../src/content/youtube";
import type { VideoRecord } from "../../src/shared/types";

interface FixtureWindow extends Window {
  overlay: { refresh: () => void };
  filter: CardFilter;
  videos: VideoRecord[];
  sourceUrl: string;
  startCalls: number;
  setFilter: (filter: unknown) => void;
  emit: () => void;
}
const origin = "http://research-overlay.test";
const fixedTime = "2026-11-03T12:34:56.789Z";
let browser: Browser, context: BrowserContext, page: Page, bundle: string, unexpected: string[];
test.beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
import { mountResearchOverlay } from './src/content/research-overlay';
import { normalizeCardFilter } from './src/content/youtube';
window.filter=normalizeCardFilter({sort:'default'});window.sourceUrl='https://www.youtube.com/results?search_query=fixture';window.startCalls=0;
window.videos=Array.from({length:500},(_,index)=>({id:String(index).padStart(11,'0'),title:'Item '+String(index).padStart(3,'0'),url:'https://www.youtube.com/watch?v='+String(index).padStart(11,'0'),views:Math.floor(index/3),subscribers:100,channel:'Fixture',channelId:'UCfixture',isShort:false,publishedAt:'2026-11-02T12:34:56.789Z',source:'youtube-dom'}));
window.videos.push({id:'api-only-id',title:'Official API only',url:'https://www.youtube.com/watch?v=abcdefghijk',views:999999999,source:'youtube-data-api'});
const state={phase:'idle',collectedCount:0,steps:0,maxItems:500,maxSteps:30,timeoutMs:60000,url:window.sourceUrl,reason:'Nenhuma coleta iniciada.',limitations:[]};let listener;
window.emit=()=>listener?.({...state});
window.overlay=mountResearchOverlay(document.querySelector('#host'),{getVideos:()=>window.videos,getFilter:()=>window.filter,setFilter:filter=>{window.filter=normalizeCardFilter(filter);},getUrl:()=>window.sourceUrl,collector:{status:()=>({...state}),subscribe:fn=>{listener=fn;fn({...state});return()=>{listener=undefined;};},start:()=>{window.startCalls++;return {...state};},cancel:()=>({...state}),snapshot:()=>undefined,dispose:()=>{}}});
window.setFilter=filter=>{window.filter=normalizeCardFilter(filter);window.overlay.refresh();};
`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "iife" })).outputFiles[0].text;
  browser = await chromium.launch({ executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), headless: true, args: ["--no-sandbox"] });
});
test.afterAll(async () => { await browser?.close(); });
test.beforeEach(async () => {
  context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1100 } }); unexpected = [];
  await context.route("**/*", route => {
    if (route.request().url() === `${origin}/`) return route.fulfill({ contentType: "text/html", body: '<div id="host"></div><script src="/bundle.js"></script>' });
    if (route.request().url() === `${origin}/bundle.js`) return route.fulfill({ contentType: "text/javascript", body: bundle });
    unexpected.push(route.request().url()); return route.abort();
  });
  page = await context.newPage(); await page.clock.setFixedTime(new Date(fixedTime)); await page.goto(`${origin}/`);
  await page.getByText("Pesquisa avançada e amostra", { exact: true }).click(); await page.locator("#prevlev-research-count").click();
});
test.afterEach(async () => { expect(unexpected).toEqual([]); expect(await page.evaluate(() => (window as unknown as FixtureWindow).startCalls)).toBe(0); await context.close(); });
async function filter(): Promise<CardFilter> { return page.evaluate(() => (window as unknown as FixtureWindow).filter); }
async function setFilter(value: unknown) { await page.evaluate(value => (window as unknown as FixtureWindow).setFilter(value), value); }
const titles = () => page.locator("#prevlev-research-results article > [data-prevlev-research-video-title]").allTextContents();

test("adding a second criterion from collection order creates two distinct, editable criteria and removal restores stable ties", async () => {
  await page.locator("#prevlev-research-add").click();
  expect((await filter()).criteria).toEqual([{ key: "views", direction: "desc" }, { key: "title", direction: "asc" }]);
  await expect(page.locator("#prevlev-research-second-row")).toBeVisible(); await expect(page.locator("#prevlev-research-status")).toBeEmpty();
  expect((await titles()).slice(0, 5)).toEqual(["Item 498", "Item 499", "Item 495", "Item 496", "Item 497"]);
  await page.locator("#prevlev-research-second-direction").selectOption("desc");
  expect((await titles()).slice(0, 5)).toEqual(["Item 499", "Item 498", "Item 497", "Item 496", "Item 495"]);
  await page.locator("#prevlev-research-remove").click();
  expect((await filter()).criteria).toEqual([{ key: "views", direction: "desc" }]);
  expect((await titles()).slice(0, 5)).toEqual(["Item 498", "Item 499", "Item 495", "Item 496", "Item 497"]);
  await page.locator("#prevlev-research-reset").click(); await page.locator("#prevlev-research-first").selectOption("title"); await page.locator("#prevlev-research-first-direction").selectOption("asc"); await page.locator("#prevlev-research-add").click();
  expect((await filter()).criteria?.map(criterion => criterion.key)).toEqual(["title", "views"]);
  expect((await filter()).criteria?.[0].direction).toBe("asc");
});

test("five local pages expose all 500 eligible observations in global sort order across list, grid and sidebar", async () => {
  await page.locator("#prevlev-research-add").click();
  const observed: string[] = [];
  for (let index = 0; index < 5; index++) {
    await expect(page.locator("#prevlev-research-page")).toHaveText(`Página ${index + 1} de 5`);
    await expect(page.locator("#prevlev-research-count")).toHaveText(`500 correspondem / 501 observados · mostrando ${index * 100 + 1}–${(index + 1) * 100}`);
    await expect(page.locator("#prevlev-research-results article")).toHaveCount(100);
    observed.push(...await titles());
    const current = await titles();
    for (const layout of ["grid", "sidebar", "list"]) {
      await page.locator("#prevlev-research-layout").selectOption(layout);
      await expect(page.locator("#prevlev-research-results")).toHaveAttribute("data-layout", layout);
      expect(await titles()).toEqual(current);
    }
    await page.evaluate(() => (window as unknown as FixtureWindow).emit());
    await expect(page.locator("#prevlev-research-page")).toHaveText(`Página ${index + 1} de 5`);
    if (index < 4) await page.locator("#prevlev-research-next").click();
  }
  const expected = Array.from({ length: 500 }, (_, index) => index).sort((left, right) => Math.floor(right / 3) - Math.floor(left / 3) || left - right).map(index => `Item ${String(index).padStart(3, "0")}`);
  expect(observed).toEqual(expected); expect(new Set(observed).size).toBe(500);
  await expect(page.locator("#prevlev-research-next")).toBeDisabled(); await page.locator("#prevlev-research-previous").click(); await expect(page.locator("#prevlev-research-page")).toHaveText("Página 4 de 5");
  await page.locator("#prevlev-research-first-direction").selectOption("asc"); await expect(page.locator("#prevlev-research-page")).toHaveText("Página 1 de 5");
  expect((await titles()).slice(0, 3)).toEqual(["Item 000", "Item 001", "Item 002"]);
});

test("an incomplete last page does not truncate JSON, CSV or Markdown exports, and changing context or sample keeps page bounds valid", async () => {
  await page.evaluate(() => { const fixture = window as unknown as FixtureWindow; fixture.videos = fixture.videos.slice(0, 235).concat(fixture.videos.at(-1)!); fixture.overlay.refresh(); });
  await page.locator("#prevlev-research-next").click(); await page.locator("#prevlev-research-next").click();
  await expect(page.locator("#prevlev-research-results article")).toHaveCount(35); await expect(page.locator("#prevlev-research-count")).toContainText("mostrando 201–235");
  for (const format of ["json", "csv", "md"]) {
    const pending = page.waitForEvent("download"); await page.locator(`#prevlev-research-${format}`).click(); const download = await pending;
    expect(download.suggestedFilename()).toBe(`prevlev-pesquisa-local.${format}`);
    const content = await readFile((await download.path())!, "utf8"); expect(content).toContain("Item 000"); expect(content).toContain("Item 234"); expect(content).not.toContain("Official API only");
    if (format === "json") { const data = JSON.parse(content); expect(data.count).toBe(235); expect(data.videos).toHaveLength(235); expect(data.comparisons).toHaveLength(235); expect(data.videos.map((video: VideoRecord) => video.title)).toEqual(Array.from({ length: 235 }, (_, index) => `Item ${String(index).padStart(3, "0")}`)); }
    if (format === "csv") expect(content.trim().split("\n")).toHaveLength(236);
    if (format === "md") expect(content).toContain("235 vídeos de observações locais");
  }
  await page.evaluate(() => { const fixture = window as unknown as FixtureWindow; fixture.sourceUrl = "https://www.youtube.com/results?search_query=another-context"; fixture.overlay.refresh(); });
  await expect(page.locator("#prevlev-research-page")).toHaveText("Página 1 de 3"); await page.locator("#prevlev-research-next").click(); await page.locator("#prevlev-research-next").click();
  await page.evaluate(() => { const fixture = window as unknown as FixtureWindow; fixture.videos = fixture.videos.slice(0, 12); fixture.overlay.refresh(); });
  await expect(page.locator("#prevlev-research-page")).toHaveText("Página 1 de 1"); await expect(page.locator("#prevlev-research-next")).toBeDisabled(); await expect(page.locator("#prevlev-research-previous")).toBeDisabled(); await expect(page.locator("#prevlev-research-results article")).toHaveCount(12);
  await setFilter({ query: "absent" }); await expect(page.locator("#prevlev-research-count")).toHaveText("0 correspondem / 12 observados · mostrando 0–0"); await expect(page.locator("#prevlev-research-json")).toBeDisabled();
});

test("Manual explicitly leaves a preset while preserving effective filters and outlier mode through refresh", async () => {
  await setFilter({ sort: "default", comparisonMode: "sample-channel-reference" });
  await page.locator("#prevlev-research-preset").selectOption("small-channel-50k");
  const applied = await filter(); expect(applied).toMatchObject({ minViews: 50000, subscribersBelow: 10000, comparisonMode: "sample-channel-reference" });
  await expect(page.locator("#prevlev-research-effective")).toContainText("views mínimas: 50000"); await expect(page.locator("#prevlev-research-effective")).toContainText("inscritos estritamente abaixo de 10000");
  await page.locator("#prevlev-research-preset").selectOption(""); expect(await filter()).toEqual(applied);
  await page.evaluate(() => { const fixture = window as unknown as FixtureWindow; fixture.overlay.refresh(); fixture.emit(); });
  await expect(page.locator("#prevlev-research-preset")).toHaveValue(""); await expect(page.locator("#prevlev-research-context")).toContainText("Filtros manuais na amostra"); await expect(page.locator("#prevlev-research-status")).toContainText("preservados para edição"); expect(await filter()).toEqual(applied);
});

test("preset cutoffs and exclusive semantics stay visible and fixed when the clock or collection progress changes", async () => {
  await page.locator("#prevlev-research-preset").selectOption("evergreen-vph");
  const applied = await filter(), cutoff = "2025-11-03T12:34:56.789Z"; expect(applied.publishedBeforeExclusive).toBe(cutoff);
  await expect(page.locator("#prevlev-research-before-label")).toHaveText("Antes de UTC (exclusivo)"); await expect(page.locator("#prevlev-research-before")).toHaveValue(cutoff.slice(0, -1)); await expect(page.locator("#prevlev-research-effective")).toContainText(`publicação estritamente antes de ${cutoff}`);
  const summary = await page.locator("#prevlev-research-effective").textContent();
  await page.clock.setFixedTime(new Date("2026-11-09T18:01:02.123Z")); await page.evaluate(() => { const fixture = window as unknown as FixtureWindow; fixture.overlay.refresh(); fixture.emit(); });
  expect(await filter()).toEqual(applied); await expect(page.locator("#prevlev-research-effective")).toHaveText(summary!); await expect(page.locator("#prevlev-research-before")).toHaveValue(cutoff.slice(0, -1));
  await page.locator("#prevlev-research-before").fill("2026-11-01T13:14:15.123"); await page.locator("#prevlev-research-before").dispatchEvent("change");
  expect((await filter()).publishedBeforeExclusive).toBeUndefined(); expect((await filter()).publishedBefore).toBe("2026-11-01T13:14:15.123Z"); await expect(page.locator("#prevlev-research-before-label")).toHaveText("Até UTC (inclusivo)");
  await page.locator('[data-prevlev-range="7"]').click(); const range = await filter(); expect(range.publishedAfter).toBe("2026-11-02T18:01:02.123Z"); expect(range.publishedBefore).toBeUndefined();
  await page.clock.setFixedTime(new Date("2026-11-12T21:00:00Z")); await page.evaluate(() => (window as unknown as FixtureWindow).overlay.refresh()); expect(await filter()).toEqual(range);
});

test("date-only and zoned stored boundaries show their exact effective UTC instants without mutating the filter", async () => {
  await setFilter({ sort: "default", publishedAfter: "2026-11-01", publishedBefore: "2026-11-03" });
  const applied = await filter(); await expect(page.locator("#prevlev-research-after")).toHaveValue("2026-11-01T00:00"); await expect(page.locator("#prevlev-research-before")).toHaveValue("2026-11-03T23:59:59.999");
  await expect(page.locator("#prevlev-research-effective")).toContainText("publicação a partir de 2026-11-01T00:00:00.000Z"); await expect(page.locator("#prevlev-research-effective")).toContainText("publicação até 2026-11-03T23:59:59.999Z"); expect(await filter()).toEqual(applied);
  await setFilter({ sort: "default", publishedAfter: "2026-11-01T15:30:00.125-03:00" });
  await expect(page.locator("#prevlev-research-after")).toHaveValue("2026-11-01T18:30:00.125"); await expect(page.locator("#prevlev-research-effective")).toContainText("2026-11-01T18:30:00.125Z");
});
