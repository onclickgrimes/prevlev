import { test, expect, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const appOrigin = "http://localhost:9401", sourceUrl = "https://www.youtube.com/watch?v=abcdefghijk", backendOrigin = "http://127.0.0.1:8787";
type Message = { type: string; [key: string]: unknown };
interface FixtureWindow extends Window { __commentsDispatch: (message: Message) => Promise<unknown>; __commentsSend: (message: Message) => Promise<unknown>; __commentsCopied?: string }
const fixture = `<!doctype html><meta charset="utf-8"><title>Comentários fixture - YouTube</title><ytd-comments>
<ytd-comment-thread-renderer data-comment-id="main"><ytd-comment-view-model><a id="author-text">João Azul</a><span id="content-text">Como criar café?</span><span id="vote-count-middle">10</span><span id="more-replies">2 respostas</span><ytd-creator-heart-renderer><button aria-pressed="true"></button></ytd-creator-heart-renderer></ytd-comment-view-model><ytd-comment-replies-renderer><ytd-comment-view-model data-comment-id="reply"><a id="author-text">Ana</a><span id="content-text">Resposta carregada</span><span data-likes="0"></span><span data-replies="0"></span><span data-hearted="false"></span></ytd-comment-view-model></ytd-comment-replies-renderer></ytd-comment-thread-renderer>
<ytd-comment-view-model data-comment-id="formula"><a id="author-text">=CMD()</a><span id="content-text">=SUM(1) &lt;img src=x onerror=alert(1)&gt;</span><span data-likes="20"></span><span data-replies="5"></span><span data-hearted="false"></span></ytd-comment-view-model>
<ytd-comment-view-model><a id="author-text">Ana</a><span id="content-text">Sem contadores</span></ytd-comment-view-model>
<ytd-comment-view-model data-comment-id="not-question"><a id="author-text">Carla</a><span id="content-text">Como fazer isto</span><span data-likes="5"></span><span data-replies="0"></span></ytd-comment-view-model>
</ytd-comments>`;
let browser: Browser, context: BrowserContext, source: Page, page: Page;
let backendRequests: { path: string; body?: Record<string, unknown> }[];

test.beforeAll(async () => { browser = await chromium.launch({ executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), headless: true, args: ["--no-sandbox"] }); });
test.afterAll(async () => { await browser?.close(); });
test.beforeEach(async () => {
  context = await browser.newContext({ viewport: { width: 1500, height: 1100 }, acceptDownloads: true }); backendRequests = [];
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === "https://www.youtube.com") return route.fulfill({ body: fixture, contentType: "text/html" });
    if (url.origin === backendOrigin) {
      const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": appOrigin, "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "authorization,content-type" };
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      backendRequests.push({ path: url.pathname, body: request.postData() ? JSON.parse(request.postData()!) : undefined });
      if (url.pathname === "/v1/ai/catalog") return route.fulfill({ headers, body: JSON.stringify({ status: "ok", source: "fixture", data: { origin: "http://127.0.0.1:7814", warnings: ["Synthetic catalog only"], models: [{ id: "fixture:text", provider: "fixture", label: "Fixture text", inputModalities: ["text"], outputModalities: ["text"], operations: ["responses"], streaming: true, textSupported: true, imageSupported: false }] } }) });
      if (url.pathname === "/v1/analyze") return route.fulfill({ headers, body: JSON.stringify({ status: "ok", source: "fixture", data: { text: "Análise sintética de fixture" } }) });
      return route.abort();
    }
    const file = url.pathname.slice(1);
    if (url.origin !== appOrigin || !["workspace.html", "workspace.js", "ui.css"].includes(file)) return route.abort();
    return route.fulfill({ body: await readFile(resolve("dist", file)), contentType: file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html" });
  });
  await context.exposeBinding("__commentsSend", async (_sender, message: Message) => source.evaluate(message => (window as unknown as FixtureWindow).__commentsDispatch(message), message));
  await context.addInitScript(({ appOrigin, sourceUrl }) => {
    const fixtureWindow = window as unknown as FixtureWindow;
    const store: Record<string, unknown> = {};
    let listener: ((message: Message, sender: { id: string }, reply: (response: unknown) => void) => unknown) | undefined;
    fixtureWindow.__commentsDispatch = message => new Promise(resolve => listener?.(message, { id: "comments-ui-fixture" }, resolve));
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => { fixtureWindow.__commentsCopied = text; } }, configurable: true });
    Object.defineProperty(globalThis, "chrome", { value: {
      runtime: { id: "comments-ui-fixture", getURL: (path: string) => `${appOrigin}/${path}`, onMessage: { addListener: (callback: typeof listener) => { listener = callback; } }, sendMessage: async () => ({ status: "unsupported" }) },
      tabs: { query: async () => [{ id: 1, title: "Comments fixture", url: sourceUrl }], sendMessage: async (_tab: number, message: Message) => fixtureWindow.__commentsSend(message) },
      storage: { local: { get: async (key: string) => ({ [key]: store[key] }), set: async (data: Record<string, unknown>) => Object.assign(store, data), remove: async (keys: string[]) => keys.forEach(key => delete store[key]) }, onChanged: { addListener: () => {} } },
      permissions: { request: async () => true, remove: async () => true },
    } });
  }, { appOrigin, sourceUrl });
  source = await context.newPage(); await source.goto(sourceUrl); await source.addScriptTag({ path: resolve("dist/content.js") });
  await expect(source.locator("#prevlev-controls")).toBeVisible();
  page = await context.newPage(); await page.goto(`${appOrigin}/workspace.html`); await expect(page.locator("#tab-select")).toHaveValue("1");
  await page.locator("#scan").click(); await expect(page.locator("#notice")).toContainText("5 comentários");
  await page.locator('[data-page="comments"]').click(); await expect(page.locator("#comment-list article")).toHaveCount(5);
});
test.afterEach(async () => { await context?.close(); });

test("real content comments flow supports author/text ranges, punctuation, heart/reply states and unknown sorting", async () => {
  expect(backendRequests).toEqual([]);
  await expect(page.locator("#comments-scope")).toContainText("identidades locais por fingerprint: 1");
  await page.locator("#comment-author").fill("joao azul"); await page.locator("#comment-filter").fill("cafe"); await page.locator("#comment-questions").check();
  await page.locator("#comment-likes").fill("0"); await page.locator("#comment-max-likes").fill("10"); await page.locator("#comment-replies-min").fill("2"); await page.locator("#comment-replies-max").fill("2"); await page.locator("#comment-hearted").selectOption("yes");
  await expect(page.locator("#comment-list article")).toHaveCount(1); await expect(page.locator("#comment-list")).toContainText("Como criar café?"); await expect(page.locator("#comments-count")).toContainText("1 de 5");
  await page.locator("#comments-reset").click(); await page.locator("#comment-sort").selectOption("likes");
  await expect(page.locator("#comment-list article strong")).toHaveText(["=CMD()", "João Azul", "Carla", "Ana", "Ana"]);
  await expect(page.locator("#comment-list article").last()).toContainText("desconhecidas");
  await expect(page.locator("#comment-list img")).toHaveCount(0);
  await page.locator("#comment-replies-state").selectOption("no"); await expect(page.locator("#comment-list article")).toHaveCount(2);
  await page.locator("#comment-hearted").selectOption("no"); await expect(page.locator("#comment-list article")).toHaveCount(1); await expect(page.locator("#comment-list")).toContainText("Resposta carregada");
  await page.locator("#comments-reset").click(); await page.locator("#comment-likes").fill("0"); await expect(page.locator("#comment-list article")).toHaveCount(4);
  await page.locator("#comment-likes").fill("10"); await page.locator("#comment-max-likes").fill("5");
  await expect(page.locator("#comments-error")).toContainText("mínimo não pode superar o máximo"); await expect(page.locator("#comments-copy")).toBeDisabled(); await expect(page.locator("#comments-export")).toBeDisabled(); await expect(page.locator("#comments-count")).toContainText("5 comentários continuam");
  expect(backendRequests).toEqual([]);
});

test("filtered clipboard/CSV/JSON use actual loaded comments and IA sends only after explicit selection and click", async () => {
  await page.locator("#comment-filter").fill("=SUM");
  await page.locator("#comments-copy").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as FixtureWindow).__commentsCopied)).toBe("=CMD(): =SUM(1) <img src=x onerror=alert(1)>");
  for (const [button, suffix] of [["comments-export", "csv"], ["comments-export-json", "json"]] as const) {
    const downloadPromise = page.waitForEvent("download"); await page.locator(`#${button}`).click(); const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`prevlev-comentarios.${suffix}`); const content = await readFile((await download.path())!, "utf8");
    if (suffix === "csv") { expect(content).toContain("'=CMD()"); expect(content).toContain("'=SUM(1)"); expect(content).not.toContain("Sem contadores"); }
    else { const data = JSON.parse(content); expect(data.comments).toHaveLength(1); expect(data.comments[0]).toMatchObject({ id: "formula", likes: 20, replies: 5, hearted: false }); expect(data.scope.loadedCount).toBe(5); }
  }
  expect(backendRequests).toEqual([]);
  await page.locator('[data-page="connection"]').click(); await page.locator("#backend-url").fill(backendOrigin); await page.locator("#save-settings").click(); await expect(page.locator("#notice")).toContainText("Configuração salva");
  await page.locator("#ai-discover").click(); await expect(page.locator("#ai-catalog-status")).toContainText("modelos anunciados");
  await page.locator("#ai-provider-select").selectOption("fixture"); await page.locator("#ai-model-select").selectOption("fixture:text"); await expect(page.locator("#ai-catalog-status")).toContainText("Seleção salva");
  expect(backendRequests.filter(request => request.path === "/v1/analyze")).toHaveLength(0);
  await page.locator('[data-page="comments"]').click(); await page.locator("#comments-ai").click(); await expect(page.locator("#remote-result")).toContainText("Análise sintética");
  const analyses = backendRequests.filter(request => request.path === "/v1/analyze"); expect(analyses).toHaveLength(1);
  expect(analyses[0].body).toMatchObject({ feature: "comment-analysis", payload: { comments: [{ id: "formula", text: "=SUM(1) <img src=x onerror=alert(1)>", likes: 20, replies: 5 }], model: "fixture:text" } });
});
