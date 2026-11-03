import { test, expect, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const origin = "http://localhost:9402", sourceUrl = "https://www.youtube.com/results?search_query=fixture";
type Message = { type: string; [key: string]: unknown };
interface FixtureWindow extends Window { __advancedDispatch: (message: Message) => Promise<unknown>; __advancedSend: (message: Message) => Promise<unknown>; __advancedRequests: Message[] }
const cards = [
  { id: "abcdefghijk", title: "Zulu lead", views: 1000, subscribers: 100, date: "há 1 hora", duration: "2:00" },
  { id: "bcdefghijkl", title: "Alpha tie", views: 1000, subscribers: 10, date: "há 2 horas", duration: "3:00" },
  { id: "cdefghijklm", title: "Beta old", views: 100, subscribers: 1, date: "há 2 anos", duration: "30:00" },
  { id: "defghijklmn", title: "Short fixture", views: 500, subscribers: 20, date: "há 1 hora", duration: "0:30", short: true },
  { id: "efghijklmno", title: "Unknown metadata" },
];
const fixture = `<!doctype html><meta charset="utf-8"><title>Pesquisa avançada fixture</title><ytd-search><ytd-section-list-renderer><ytd-item-section-renderer><div id="contents">${cards.map((card, index) => `<ytd-video-renderer data-fixture-id="${card.id}"><a id="video-title" href="/${card.short ? "shorts/" + card.id : "watch?v=" + card.id}">${card.title}</a><ytd-channel-name><a href="/channel/UCfixture${index}">Canal ${index}</a></ytd-channel-name>${card.views === undefined ? "" : `<div id="metadata-line"><span>${card.views} views</span><span>${card.date}</span></div><span id="subscriber-count">${card.subscribers} subscribers</span><ytd-thumbnail-overlay-time-status-renderer>${card.duration}</ytd-thumbnail-overlay-time-status-renderer>`}</ytd-video-renderer>`).join("")}</div></ytd-item-section-renderer></ytd-section-list-renderer></ytd-search>`;
let browser: Browser, context: BrowserContext, source: Page, workspace: Page;
let unexpected: string[];
test.beforeAll(async () => { browser = await chromium.launch({ executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), headless: true, args: ["--no-sandbox"] }); });
test.afterAll(async () => { await browser?.close(); });
test.beforeEach(async () => {
  context = await browser.newContext({ viewport: { width: 1500, height: 1100 }, acceptDownloads: true }); unexpected = [];
  await context.route("**/*", async route => { const url = new URL(route.request().url()); if (url.origin === "https://www.youtube.com") return route.fulfill({ body: fixture, contentType: "text/html" }); const file = url.pathname.slice(1); if (url.origin !== origin || !["workspace.html", "workspace.js", "ui.css"].includes(file)) { unexpected.push(url.href); return route.abort(); } return route.fulfill({ body: await readFile(resolve("dist", file)), contentType: file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html" }); });
  await context.exposeBinding("__advancedSend", async (_sender, message: Message) => source.evaluate(message => (window as unknown as FixtureWindow).__advancedDispatch(message), message));
  await context.addInitScript(({ origin, sourceUrl }) => { const current = window as unknown as FixtureWindow; current.__advancedRequests = []; const store: Record<string, unknown> = { settings: { hideShorts: false, showMetrics: false, backendUrl: "", backendToken: "" } }; let listener: ((message: Message, sender: { id: string }, reply: (response: unknown) => void) => unknown) | undefined; current.__advancedDispatch = message => new Promise(resolve => listener?.(message, { id: "advanced-fixture" }, resolve)); Object.defineProperty(globalThis, "chrome", { value: { runtime: { id: "advanced-fixture", getURL: (path: string) => `${origin}/${path}`, onMessage: { addListener: (callback: typeof listener) => { listener = callback; } }, sendMessage: async () => ({ status: "unsupported" }) }, tabs: { query: async () => [{ id: 1, title: "Advanced fixture", url: sourceUrl }], sendMessage: async (_tab: number, message: Message) => { current.__advancedRequests.push(message); return current.__advancedSend(message); } }, storage: { local: { get: async (key: string) => ({ [key]: store[key] }), set: async (data: Record<string, unknown>) => Object.assign(store, data), remove: async (keys: string[]) => keys.forEach(key => delete store[key]) }, onChanged: { addListener: () => {} } }, permissions: { request: async () => true, remove: async () => true } } }); }, { origin, sourceUrl });
  source = await context.newPage(); await source.goto(sourceUrl); await source.addScriptTag({ path: resolve("dist/content.js") }); await expect(source.locator("#prevlev-controls")).toBeVisible();
  workspace = await context.newPage(); await workspace.goto(`${origin}/workspace.html`); await expect(workspace.locator("#tab-select")).toHaveValue("1"); await workspace.locator("#scan").click(); await expect(workspace.locator("#video-rows tr")).toHaveCount(5);
});
test.afterEach(async () => { await context?.close(); });

test("workspace two-criterion directions and ratio priority produce exactly the native card order", async () => {
  await workspace.locator("#research-enhancements summary").click();
  await workspace.locator("#research-add-sort").click(); await workspace.locator("#research-sort-secondary").selectOption("subscribers"); await workspace.locator("#research-direction-secondary").selectOption("asc");
  await expect(workspace.locator("#video-rows tr > td:first-child > a")).toHaveText(["Alpha tie", "Zulu lead", "Short fixture", "Beta old", "Unknown metadata"]);
  await workspace.locator("#research-direction-primary").selectOption("asc");
  await expect(workspace.locator("#video-rows tr > td:first-child > a")).toHaveText(["Beta old", "Short fixture", "Alpha tie", "Zulu lead", "Unknown metadata"]);
  await workspace.locator("#research-priority").check(); await workspace.locator("#research-hide-feed").check();
  await expect(workspace.locator("#video-rows tr > td:first-child > a")).toHaveText(["Beta old", "Alpha tie", "Short fixture", "Zulu lead", "Unknown metadata"]);
  await workspace.locator("#apply-page-filter").click();
  await expect(workspace.locator("#notice")).toContainText("5 de 5");
  await expect(source.locator("ytd-video-renderer #video-title")).toHaveText(["Beta old", "Alpha tie", "Short fixture", "Zulu lead", "Unknown metadata"]);
  await workspace.locator("#research-hide-search").check(); await expect(workspace.locator("#video-rows tr > td:first-child > a")).toHaveCount(4); await workspace.locator("#apply-page-filter").click();
  await expect(source.locator('ytd-video-renderer:not([data-prevlev-hidden="true"])')).toHaveCount(4);
  const applied = await workspace.evaluate(() => (window as unknown as FixtureWindow).__advancedRequests.filter(message => message.type === "APPLY_FILTER").at(-1));
  expect(applied).toMatchObject({ filter: { criteria: [{ key: "views", direction: "asc" }, { key: "subscribers", direction: "asc" }], priority: "views-per-subscriber", hideShortsOnFeed: true, hideShortsOnSearch: true, surface: "search" } });
  expect(unexpected).toEqual([]);
});

test("contextual presets keep precise dates, search-only Shorts and an explicit alternative comparison mode", async () => {
  await workspace.locator("#research-enhancements summary").click(); await expect(workspace.locator("#research-preset option")).toHaveCount(12);
  await workspace.locator("#research-preset").selectOption("day-views"); await expect(workspace.locator("#video-rows tr > td:first-child > a")).toHaveText(["Zulu lead", "Alpha tie", "Short fixture"]);
  await expect(workspace.locator("#research-status")).toContainText("Limites precisos UTC");
  await workspace.locator("#research-preset").selectOption("search-shorts"); await expect(workspace.locator("#video-rows tr > td:first-child > a")).toHaveText(["Short fixture"]); await workspace.locator("#apply-page-filter").click();
  await expect(source.locator('ytd-video-renderer:not([data-prevlev-hidden="true"])')).toHaveAttribute("data-fixture-id", "defghijklmn");
  await workspace.locator("#research-comparison").selectOption("sample-channel-reference"); await expect(workspace.locator("#research-comparison-note")).toContainText("Não equivale ao índice proprietário");
  const downloadPromise = workspace.waitForEvent("download"); await workspace.locator("#research-export-markdown").click(); const download = await downloadPromise; expect(download.suggestedFilename()).toBe("prevlev-pesquisa.md"); const content = await readFile((await download.path())!, "utf8"); expect(content).toContain("Short fixture"); expect(content).not.toContain("Beta old"); expect(content).toContain("A amostra pode ser parcial");
  await workspace.locator("#reset-filters").click(); await expect(workspace.locator("#video-rows tr > td:first-child > a")).toHaveCount(5); await expect(workspace.locator("#research-preset")).toHaveValue(""); await expect(workspace.locator("#research-comparison")).toHaveValue("sample-median");
  expect(unexpected).toEqual([]);
});

test("in-page overlay renders actual list/grid/sidebar samples, exports them and reports genuine manual collection progress", async () => {
  await source.locator("#prevlev-controls summary").first().click();
  await source.getByText("Pesquisa avançada e amostra", { exact: true }).click();
  await expect(source.locator("#prevlev-research-count")).toContainText("5 correspondem / 5 observados");
  await expect(source.locator("#prevlev-research-progress")).toHaveAttribute("value", "0");
  await source.locator("#prevlev-research-count").click(); await expect(source.locator("#prevlev-research-results article")).toHaveCount(5);
  await source.locator("#prevlev-research-layout").selectOption("grid"); await expect(source.locator("#prevlev-research-results")).toHaveAttribute("data-layout", "grid");
  await source.locator("#prevlev-research-layout").selectOption("sidebar"); await expect(source.locator("#prevlev-research-results")).toHaveCSS("position", "fixed");
  await source.locator("#prevlev-research-layout").selectOption("list"); await source.locator("#prevlev-research-preset").selectOption("search-shorts"); await expect(source.locator("#prevlev-research-results article")).toHaveCount(1);
  for (const format of ["json", "csv", "md"] as const) { const downloadPromise = source.waitForEvent("download"); await source.locator(`#prevlev-research-${format}`).click(); const download = await downloadPromise; expect(download.suggestedFilename()).toBe(`prevlev-pesquisa-local.${format}`); const content = await readFile((await download.path())!, "utf8"); expect(content).toContain("Short fixture"); expect(content).not.toContain("Zulu lead"); if (format === "json") expect(JSON.parse(content).videos).toHaveLength(1); }
  await source.locator("#prevlev-research-reset").click(); await source.locator('[data-prevlev-range="7"]').click(); await expect(source.locator("#prevlev-research-results article")).toHaveCount(3); await expect(source.locator("#prevlev-research-after")).not.toHaveValue("");
  await source.locator("#prevlev-research-limit").fill("5"); await source.locator("#prevlev-research-load").click(); await expect(source.locator("#prevlev-research-collection")).toContainText("5 IDs observados"); await expect(source.locator("#prevlev-research-progress")).toHaveAttribute("value", "5"); await expect(source.locator("#prevlev-research-collection")).toContainText("Limite de itens atingido");
  expect(unexpected).toEqual([]);
});
