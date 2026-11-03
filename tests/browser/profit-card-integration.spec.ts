import { test, expect, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const appOrigin = "http://localhost:9414";
const studioUrl = "https://studio.youtube.com/video/abcdefghijk/analytics";
type Message = { type: string; session?: string; sequence?: number; observationId?: string; [key: string]: unknown };
type Response = { status: string; error?: string; observation?: { id: string; revenue: number }; redactions?: { x: number; y: number; width: number; height: number }[]; [key: string]: unknown };
interface FixtureWindow extends Window {
  __profitDispatch: (message: Message) => Promise<Response>;
  __profitSend: (input: { tabId: number; message: Message }) => Promise<Response>;
  __profitGetTab: (tabId: number) => Promise<{ id: number; url: string }>;
  __profitEmitUpdated: (url: string) => void;
  __profitNativeClicks: number;
}
const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>Studio lucro fixture</title><style>
body{font:16px system-ui;margin:24px}#top-section{box-sizing:border-box;width:850px;min-height:220px;padding:24px;border:1px solid #888}#TOTAL_ESTIMATED_EARNINGS-tab{padding:12px}button{font:inherit;padding:6px}
</style></head><body><main data-video-id="abcdefghijk"><section id="top-section"><span id="date-range-label">Últimos 28 dias</span><div id="key-metric-header"><div id="TOTAL_ESTIMATED_EARNINGS-tab" data-currency="BRL"><b id="metric-total" style="font-size:28px">R$ 1.000,00</b></div><yta-key-metric-card data-metric="Quantidade de vídeos"><b id="metric-value">999</b></yta-key-metric-card></div></section><button id="save">Save</button></main></body></html>`;
let browser: Browser, context: BrowserContext, source: Page, page: Page;
let commands: { tabId: number; message: Message }[], responses: { message: Message; response: Response }[];
let unexpected: string[], errors: string[], releases: (() => void)[];
let holdReplyType: string | undefined, holdNextShowDelivery: boolean, heldReplies: number, heldShows: number;
test.beforeAll(async () => {
  browser = await chromium.launch({ executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), headless: true, args: ["--no-sandbox"] });
});
test.afterAll(async () => { await browser?.close(); });
test.beforeEach(async () => {
  commands = []; responses = []; unexpected = []; errors = []; releases = []; holdReplyType = undefined; holdNextShowDelivery = false; heldReplies = 0; heldShows = 0;
  context = await browser.newContext({ viewport: { width: 1500, height: 1100 }, acceptDownloads: true });
  // Only local fixture HTML and the real extension bundles are allowed. No Studio,
  // backend, AI/provider, account or channel service is contacted by these tests.
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === "https://studio.youtube.com" && route.request().resourceType() === "document") return route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture });
    const file = url.pathname.slice(1);
    if (url.origin === appOrigin && ["workspace.html", "workspace.js", "ui.css"].includes(file)) return route.fulfill({ body: await readFile(resolve("dist", file)), contentType: file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html" });
    unexpected.push(url.href); return route.abort();
  });
  await context.exposeBinding("__profitGetTab", async (_sender, tabId: number) => ({ id: tabId, url: tabId === 1 ? source.url() : "https://studio.youtube.com/video/bbbbbbbbbbb/analytics" }));
  await context.exposeBinding("__profitSend", async (_sender, input: { tabId: number; message: Message }) => {
    commands.push(input);
    if (input.tabId !== 1) return { status: "error", error: "A segunda aba é somente um contexto de seleção da fixture." };
    if (input.message.type === "STUDIO_PROFIT_SHOW" && holdNextShowDelivery) {
      holdNextShowDelivery = false; heldShows++;
      await new Promise<void>(resolve => { releases.push(resolve); });
    }
    const response = await source.evaluate(message => (window as unknown as FixtureWindow).__profitDispatch(message), input.message);
    responses.push({ message: input.message, response });
    if (input.message.type === holdReplyType) {
      holdReplyType = undefined; heldReplies++;
      await new Promise<void>(resolve => { releases.push(resolve); });
    }
    return response;
  });
  await context.addInitScript(({ appOrigin, studioUrl }) => {
    const current = window as unknown as FixtureWindow;
    current.__profitNativeClicks = 0;
    const store: Record<string, unknown> = { settings: { hideShorts: false, showMetrics: false, backendUrl: "", backendToken: "" } };
    let listener: ((message: Message, sender: { id: string }, reply: (response: Response) => void) => unknown) | undefined;
    const updates: ((tabId: number, change: { url?: string; status?: string }, tab: object) => void)[] = [];
    current.__profitDispatch = message => new Promise(resolve => { if (!listener) throw new Error("Listener de conteúdo ausente na fixture."); listener(message, { id: "profit-integration-fixture" }, resolve); });
    current.__profitEmitUpdated = url => updates.forEach(callback => callback(1, { url, status: "loading" }, {}));
    Object.defineProperty(globalThis, "chrome", { value: {
      runtime: { id: "profit-integration-fixture", getURL: (path: string) => `${appOrigin}/${path}`, onMessage: { addListener: (callback: typeof listener) => { listener = callback; } }, sendMessage: async () => ({ status: "unsupported" }) },
      tabs: { query: async () => [{ id: 1, title: "Studio observado", url: studioUrl }, { id: 2, title: "Outro contexto", url: "https://studio.youtube.com/video/bbbbbbbbbbb/analytics" }], get: async (tabId: number) => current.__profitGetTab(tabId), sendMessage: async (tabId: number, message: Message) => current.__profitSend({ tabId, message }), onUpdated: { addListener: (callback: typeof updates[number]) => updates.push(callback) }, onRemoved: { addListener: () => {} } },
      storage: { local: { get: async (key: string) => ({ [key]: store[key] }), set: async (data: Record<string, unknown>) => Object.assign(store, data), remove: async (keys: string[]) => keys.forEach(key => delete store[key]) }, onChanged: { addListener: () => {} } },
      permissions: { request: async () => true, remove: async () => true },
    } });
  }, { appOrigin, studioUrl });
  source = await context.newPage(); source.on("pageerror", error => errors.push(error.message)); await source.goto(studioUrl);
  await source.evaluate(() => { for (const id of ["save", "TOTAL_ESTIMATED_EARNINGS-tab"]) document.getElementById(id)!.addEventListener("click", () => { (window as unknown as FixtureWindow).__profitNativeClicks++; }); });
  await source.addScriptTag({ path: resolve("dist/content.js") });
  await expect.poll(() => source.evaluate(() => typeof (window as unknown as FixtureWindow).__profitDispatch)).toBe("function");
  page = await context.newPage(); page.on("pageerror", error => errors.push(error.message)); await page.goto(`${appOrigin}/workspace.html`); await expect(page.locator("#tab-select")).toHaveValue("1");
  await page.locator("#scan").click(); await expect(page.locator("#notice")).toContainText("Coletados"); await page.locator('[data-page="studio"]').click(); await expect(page.locator("#revenue")).toHaveValue("1000");
});
test.afterEach(async () => { for (const release of releases.splice(0)) release(); expect(unexpected).toEqual([]); expect(errors).toEqual([]); expect(await source.evaluate(() => (window as unknown as FixtureWindow).__profitNativeClicks)).toBe(0); await context?.close(); });
const projection = () => source.locator("[data-prevlev-profit-card]");
async function readCard() { await page.locator("#profit-card-observe").click(); await expect(page.locator("#profit-observation")).toContainText("Card observado:"); await expect(page.locator("#profit-card-observe")).toBeEnabled(); }
async function confirmAndCalculate() { await page.locator("#profit-revenue-confirm").check(); await page.locator("#profit-count-confirm").check(); await page.locator("#profit").click(); await expect(page.locator("#profit-output")).toHaveText("Lucro estimado local: 700 BRL"); }
async function ready() { await page.locator("#cost").fill("100"); await page.locator("#video-total").fill("3"); await readCard(); await confirmAndCalculate(); }
async function show() { await ready(); await page.locator("#profit-card-show").click(); await expect(projection().locator("output")).toHaveText("700 BRL"); await expect(page.locator("#profit-status")).toContainText("mostrada junto"); }

test("actual workspace reads a fresh card receipt and requires new manual confirmations before showing an independent shadow estimate", async () => {
  await expect(projection()).toHaveCount(0); await expect(page.locator("#video-total")).toHaveValue("");
  await page.locator("#cost").fill("100"); await page.locator("#video-total").fill("3"); await page.locator("#profit-revenue-confirm").check(); await page.locator("#profit-count-confirm").check();
  await readCard(); await expect(page.locator("#profit-revenue-confirm")).not.toBeChecked(); await expect(page.locator("#profit-count-confirm")).not.toBeChecked(); await expect(page.locator("#video-total")).toHaveValue("3");
  await page.locator("#profit").click(); await expect(page.locator("#profit-output")).toBeEmpty(); await expect(projection()).toHaveCount(0);
  await confirmAndCalculate(); await page.locator("#profit-card-show").click(); await expect(projection().locator("output")).toHaveText("700 BRL");
  expect(await projection().evaluate(host => !!host.shadowRoot)).toBe(true); await expect(source.locator("#metric-total")).toHaveText("R$ 1.000,00"); await expect(source.locator("#metric-total")).toHaveAttribute("style", "font-size:28px");
  const snapshot = await source.evaluate(() => (window as unknown as FixtureWindow).__profitDispatch({ type: "GET_SNAPSHOT" }));
  expect(snapshot.snapshot).toMatchObject({ studio: { revenue: 1000, currencyCode: "BRL", videoCount: 999 } });
  await page.locator("#profit-count-confirm").uncheck(); await expect(projection()).toHaveCount(0); await expect(page.locator("#profit-output")).toBeEmpty(); await expect(page.locator("#profit-card-show")).toBeHidden();
});

test("revoking confirmation while a successful SHOW reply waits removes the estimate and discards the late success", async () => {
  await ready(); holdReplyType = "STUDIO_PROFIT_SHOW"; await page.locator("#profit-card-show").click(); await expect.poll(() => heldReplies).toBe(1); await expect(projection()).toHaveCount(1);
  await page.locator("#profit-revenue-confirm").uncheck(); await expect(projection()).toHaveCount(0); await expect(page.locator("#profit-status")).toContainText("Confirmações alteradas");
  releases.shift()!(); await expect(page.locator("#profit-card-show")).toBeHidden(); await expect(page.locator("#profit-output")).toBeEmpty(); await expect(page.locator("#profit-status")).toContainText("Confirmações alteradas");
});

test("tab selection and actual same-tab navigation invalidate receipt fields and the projection without changing native revenue", async () => {
  await show(); await page.locator("#tab-select").selectOption("2"); await expect(projection()).toHaveCount(0); await expect(page.locator("#revenue")).toHaveValue(""); await expect(page.locator("#profit-currency")).toHaveValue(""); await expect(page.locator("#profit-period-mode")).toHaveValue("dates"); await expect(page.locator("#profit-revenue-confirm")).not.toBeChecked(); await expect(page.locator("#profit-output")).toBeEmpty();
  await page.locator("#tab-select").selectOption("1"); await show();
  const nextUrl = "https://studio.youtube.com/video/ccccccccccc/analytics"; await source.evaluate(url => history.pushState(null, "", url), nextUrl); await page.evaluate(url => (window as unknown as FixtureWindow).__profitEmitUpdated(url), nextUrl);
  await expect(projection()).toHaveCount(0); await expect(page.locator("#revenue")).toHaveValue(""); await expect(page.locator("#profit-observation")).toContainText("descartada"); await expect(page.locator("#profit-card-show")).toBeHidden(); await expect(source.locator("#metric-total")).toHaveText("R$ 1.000,00");
});

test("a delayed OBSERVE response cannot repopulate fields after a tab switch and return", async () => {
  await source.evaluate(() => { document.getElementById("metric-total")!.textContent = "R$ 2.000,00"; document.getElementById("date-range-label")!.textContent = "Últimos 7 dias"; });
  holdReplyType = "STUDIO_PROFIT_OBSERVE"; await page.locator("#profit-card-observe").click(); await expect.poll(() => heldReplies).toBe(1);
  const observation = responses.find(entry => entry.message.type === "STUDIO_PROFIT_OBSERVE")!.response.observation!; expect(observation.revenue).toBe(2000);
  await page.locator("#tab-select").selectOption("2"); await page.locator("#tab-select").selectOption("1"); releases.shift()!();
  await expect.poll(() => responses.some(entry => entry.message.type === "STUDIO_PROFIT_CANCEL" && entry.message.observationId === observation.id)).toBe(true);
  await expect(page.locator("#revenue")).not.toHaveValue("2000"); await expect(page.locator("#profit-observation")).not.toContainText("Card observado:"); await expect(page.locator("#profit-revenue-confirm")).not.toBeChecked(); await expect(page.locator("#profit-count-confirm")).not.toBeChecked(); await expect(page.locator("#profit-card-show")).toBeHidden(); await expect(projection()).toHaveCount(0);
});

test("RESTORE delivered before an earlier SHOW prevents resurrection and still permits a newer explicit SHOW", async () => {
  await ready(); holdNextShowDelivery = true; await page.locator("#profit-card-show").click(); await expect.poll(() => heldShows).toBe(1);
  const oldShow = commands.find(entry => entry.message.type === "STUDIO_PROFIT_SHOW")!.message;
  await page.locator("#profit-card-restore").click(); await expect(page.locator("#profit-status")).toContainText("Apresentação local retirada"); await expect(projection()).toHaveCount(0);
  const newerRestore = commands.filter(entry => entry.message.type === "STUDIO_PROFIT_RESTORE").at(-1)!.message; expect(newerRestore.session).toBe(oldShow.session); expect(newerRestore.sequence!).toBeGreaterThan(oldShow.sequence!);
  releases.shift()!(); await expect.poll(() => responses.some(entry => entry.message.sequence === oldShow.sequence && entry.message.type === "STUDIO_PROFIT_SHOW" && entry.response.status === "error")).toBe(true); await expect(projection()).toHaveCount(0); await expect(page.locator("#profit-status")).toContainText("Apresentação local retirada");
  await page.locator("#profit-card-show").click(); await expect(projection().locator("output")).toHaveText("700 BRL"); await expect(page.locator("#profit-status")).toContainText("mostrada junto");
});

test("actual CAPTURE_CARD preparation removes the owned estimate before returning native revenue masks", async () => {
  await show();
  const measured = await source.evaluate(() => (window as unknown as FixtureWindow).__profitDispatch({ type: "CAPTURE_CARD", kind: "analytics", redact: true, redactionCategories: ["revenue"] }));
  expect(measured.status).toBe("ok"); expect(measured.redactions?.length).toBeGreaterThan(0); await expect(projection()).toHaveCount(0); await expect(source.locator("#metric-total")).toHaveText("R$ 1.000,00");
  const nativeBox = await source.locator("#metric-total").boundingBox(); expect(nativeBox).not.toBeNull(); expect(measured.redactions).toContainEqual(nativeBox);
});

test("capture refuses an externally changed projection that ownership checks cannot safely remove", async () => {
  await show(); await projection().locator("output").evaluate(node => { node.textContent = "Conteúdo editado externamente"; });
  const measured = await source.evaluate(() => (window as unknown as FixtureWindow).__profitDispatch({ type: "CAPTURE_CARD", kind: "analytics", redact: true, redactionCategories: ["revenue"] }));
  expect(measured.status).toBe("error"); expect(measured.error).toMatch(/alterada|permanece|captura/i); expect(measured.redactions).toBeUndefined(); await expect(projection().locator("output")).toHaveText("Conteúdo editado externamente"); await expect(source.locator("#metric-total")).toHaveText("R$ 1.000,00");
});

test("a persisted pagehide discards the estimate and pageshow permits a fresh receipt and native capture", async () => {
  await show(); await source.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }))); await expect(projection()).toHaveCount(0);
  await source.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await readCard(); await expect(page.locator("#profit-revenue-confirm")).not.toBeChecked(); await expect(page.locator("#profit-count-confirm")).not.toBeChecked();
  const measured = await source.evaluate(() => (window as unknown as FixtureWindow).__profitDispatch({ type: "CAPTURE_CARD", kind: "analytics", redact: true, redactionCategories: ["revenue"] })); expect(measured.status).toBe("ok");
});
