import { test, expect, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const origin = "http://localhost:9398";
let browser: Browser;
let context: BrowserContext;
let page: Page;
const requests: string[] = [];

test.beforeAll(async () => {
  browser = await chromium.launch({ executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), headless: true, args: ["--no-sandbox"] });
});
test.afterAll(async () => { await browser?.close(); });
test.beforeEach(async () => {
  context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  requests.length = 0;
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice(1);
    if (url.origin !== origin || !["workspace.html", "workspace.js", "ui.css"].includes(path)) { requests.push(url.href); return route.abort(); }
    return route.fulfill({ body: await readFile(resolve("dist", path)), contentType: path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html" });
  });
  await context.addInitScript(({ origin }) => {
    const channel = { channel: "Canal Fixture", channelId: "same", channelUrl: "https://www.youtube.com/@fixture", isShort: false };
    const fixtureVideos = [
      { ...channel, id: "abcdefghijk", title: "=SUM(1)|<img src=x onerror=alert(1)>", url: "https://www.youtube.com/watch?v=abcdefghijk", views: 1000, publishedAt: "2026-02-01T00:00:00Z", durationSeconds: 120, source: "user-provided" },
      { ...channel, id: "bcdefghijkl", title: "Peer one", url: "https://www.youtube.com/watch?v=bcdefghijkl", views: 100, publishedAt: "2026-01-01T00:00:00Z", durationSeconds: 30, source: "youtube-dom" },
      { ...channel, id: "cdefghijklm", title: "Peer two", url: "https://www.youtube.com/watch?v=cdefghijklm", views: 200, publishedAt: "2026-01-02T00:00:00Z", durationSeconds: 40, source: "youtube-dom" },
      { ...channel, id: "defghijklmn", title: "Peer three", url: "https://www.youtube.com/watch?v=defghijklmn", views: 300, publishedAt: "2026-01-03T00:00:00Z", source: "public-page" },
      { id: "unknown", title: "Unknown unsafe link", url: "javascript:alert(1)" },
      { id: "official", title: "Official excluded", url: "https://www.youtube.com/watch?v=abcdefghijk", views: 999999, source: "youtube-data-api", isShort: true },
      { ...channel, id: "bcdefghijkl", title: "Duplicate peer", url: "https://www.youtube.com/watch?v=bcdefghijkl", views: 100, publishedAt: "2026-01-01T00:00:00Z", durationSeconds: 30, source: "youtube-dom" },
    ];
    const snapshot = { url: "https://www.youtube.com/watch?v=abcdefghijk", title: "Analytics fixture", videos: fixtureVideos, comments: [], transcript: [], warnings: ["<script>Fixture warning</script>"] };
    const store: Record<string, unknown> = { snapshot };
    Object.defineProperty(globalThis, "chrome", { value: {
      runtime: { id: "analytics-fixture", getURL: (path: string) => `${origin}/${path}`, sendMessage: async () => ({ status: "not_configured", error: "No backend in this fixture" }) },
      tabs: { query: async () => [{ id: 1, title: "Fixture", url: snapshot.url }], sendMessage: async (_tab: number, message: { type: string }) => message.type === "GET_SNAPSHOT" ? { status: "ok", snapshot } : { status: "unsupported" } },
      storage: { local: { get: async (key: string) => ({ [key]: store[key] }), set: async (data: Record<string, unknown>) => Object.assign(store, data), remove: async (keys: string[]) => keys.forEach(key => delete store[key]) }, onChanged: { addListener: () => {} } },
      permissions: { request: async () => true, remove: async () => true },
    } });
  }, { origin });
  page = await context.newPage();
  await page.goto(`${origin}/workspace.html`);
  await expect(page.locator("#tab-select")).toHaveValue("1");
  // A saved legacy/user collection can genuinely lack provenance; a fresh scan now labels DOM data.
  await expect(page.locator("#video-rows")).toContainText("Unknown unsafe link");
});
test.afterEach(async () => { await context?.close(); });

test("local analytics refreshes explicitly, reports missing provenance and excludes API/duplicates without any requests", async () => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.locator('[data-page="analytics"]').click();
  await expect(page.locator("#analytics-result")).toBeHidden();
  await expect(page.locator("#analytics-export-json")).toBeDisabled();
  await page.locator("#analytics-refresh").click();
  await expect(page.locator("#analytics-scope")).toContainText("7 registros recebidos · 5 vídeos incluídos · 1 da API oficial excluídos · 1 duplicatas excluídas");
  await expect(page.locator("#analytics-totals")).toContainText("1.600");
  await expect(page.locator("#analytics-coverage tr").first()).toHaveText("Visualizações41");
  await expect(page.locator("#analytics-formats")).toContainText("Desconhecidos: 1");
  await expect(page.locator("#analytics-provenance")).toContainText("origem não declarada: 1");
  await expect(page.locator("#analytics-channels tr")).toHaveCount(1);
  await expect(page.locator("#analytics-months tr")).toHaveCount(2);
  await expect(page.locator("#analytics-top tr")).toHaveCount(5);
  await expect(page.locator("#analytics-top tr").first()).toContainText("5×");
  await expect(page.locator("#analytics-top tr").last().locator("a")).toHaveCount(0);
  await expect(page.locator("#analytics-top img")).toHaveCount(0);
  await expect(page.locator("#analytics-limitations script")).toHaveCount(0);
  await expect(page.locator("#analytics-limitations")).toContainText("<script>Fixture warning</script>");
  await expect(page.locator("#analytics-limitations")).toContainText("Receita, RPM");
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test("filtered analytics preserves full outlier reference, validates ranges and exports actual JSON CSV Markdown", async () => {
  await page.locator("#video-filter").fill("=SUM");
  await page.locator('[data-page="analytics"]').click();
  await page.locator("#analytics-source").selectOption("filtered");
  await page.locator("#analytics-refresh").click();
  await expect(page.locator("#analytics-top tr")).toHaveCount(1);
  await expect(page.locator("#analytics-top tr")).toContainText("5×");
  await expect(page.locator("#analytics-filter-summary")).toContainText("texto “=SUM”");
  for (const [format, suffix] of [["json", "json"], ["csv", "csv"], ["markdown", "md"]] as const) {
    const downloadPromise = page.waitForEvent("download");
    await page.locator(`#analytics-export-${format}`).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`prevlev-analytics.${suffix}`);
    const content = await readFile((await download.path())!, "utf8");
    if (format === "json") { const report = JSON.parse(content); expect(report.scope.includedCount).toBe(1); expect(report.scope.excludedApiCount).toBe(1); expect(report.scope.excludedDuplicateCount).toBe(1); expect(report.videos[0].outlierScore).toBe(5); }
    if (format === "csv") { expect(content).toContain("'=SUM(1)"); expect(content).toContain("observed_views"); }
    if (format === "markdown") { expect(content).toContain("# Relatório local Prevlev"); expect(content).toContain("\\|\\<img"); }
  }
  await page.locator("#analytics-source").selectOption("all");
  await expect(page.locator("#analytics-export-json")).toBeDisabled();
  await page.locator('[data-page="research"]').click();
  await page.locator(".advanced-filters summary").click();
  await page.locator("#min-views").fill("2000");
  await page.locator("#max-views").fill("1000");
  await page.locator('[data-page="analytics"]').click();
  await page.locator("#analytics-source").selectOption("filtered");
  await page.locator("#analytics-refresh").click();
  await expect(page.locator("#analytics-status")).toContainText("mínimo não pode superar o máximo");
  await expect(page.locator("#analytics-result")).toBeHidden();
  await expect(page.locator("#analytics-export-json")).toBeDisabled();
  expect(requests).toEqual([]);
});


test("workspace CSV includes fields from later rows and identifies empty exports", async () => {
  await page.locator("#research-enhancements summary").click();
  await page.locator("#research-sort-primary").selectOption("title");
  await page.locator("#research-direction-primary").selectOption("desc");
  await expect(page.locator("#video-rows tr").first()).toContainText("Unknown unsafe link");
  let waiting = page.waitForEvent("download");
  await page.locator("#export-csv").click();
  let download = await waiting;
  const csv = await readFile((await download.path())!, "utf8");
  const [header, first] = csv.split(/\r?\n/);
  expect(first).toContain('"unknown"');
  for (const key of ["views", "source", "isShort", "durationSeconds"]) expect(header).toContain(`"${key}"`);
  expect(csv).toContain('"1000"');
  await page.locator("#video-filter").fill("no such video fixture");
  await expect(page.locator("#outlier-details")).toContainText("Exportações sem linhas não incluem esses totais");
  await expect(page.locator("#outlier-details")).toContainText("1 da API oficial");
  waiting = page.waitForEvent("download");
  await page.locator("#export-json").click();
  download = await waiting;
  expect(JSON.parse(await readFile((await download.path())!, "utf8"))).toEqual([]);
  waiting = page.waitForEvent("download");
  await page.locator("#export-csv").click();
  download = await waiting;
  const emptyCsv = await readFile((await download.path())!, "utf8");
  expect(emptyCsv).toContain('"excluded_api_count"');
  expect(emptyCsv.trim().split(/\r?\n/)).toHaveLength(1);
});
