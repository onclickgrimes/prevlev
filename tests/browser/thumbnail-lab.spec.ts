import { test, expect, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { build } from "esbuild";
import { existsSync } from "node:fs";

let browser: Browser, context: BrowserContext, page: Page, bundle: string, unexpected: string[];
test.beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `import { mountThumbnailLab } from './src/ui/thumbnail-lab';
const selection={origin:'http://127.0.0.1:7814',backendOrigin:'http://127.0.0.1:8787',model:{id:'fixture:exact-image',provider:'fixture',label:'Fixture',operations:['images.generate'],inputModalities:['text','image'],outputModalities:['image'],imageSupported:true,textSupported:false,streaming:false}};
const state={calls:[],selection,shown:0,resolve:undefined,reject:undefined};
Object.assign(window,{labState:state,lab:mountThumbnailLab(document.querySelector('#thumbnail-lab'),{selection:()=>selection,generate:payload=>{state.calls.push(payload);return new Promise((resolve,reject)=>{state.resolve=resolve;state.reject=reject;});},showResult:()=>{state.shown++;}})});`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "iife" })).outputFiles[0].text;
  browser = await chromium.launch({ executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), headless: true, args: ["--no-sandbox"] });
});
test.afterAll(async () => { await browser?.close(); });
test.beforeEach(async () => {
  unexpected = []; context = await browser.newContext();
  await context.route("**/*", route => {
    if (route.request().url() === "http://lab.test/") return route.fulfill({ contentType: "text/html", body: '<section id="thumbnail-lab"></section><script src="/bundle.js"></script>' });
    if (route.request().url() === "http://lab.test/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    unexpected.push(route.request().url()); return route.abort();
  });
  page = await context.newPage(); await page.goto("http://lab.test/");
});
test.afterEach(async () => { expect(unexpected).toEqual([]); await context.close(); });
async function calls() { return page.evaluate(() => (window as unknown as { labState: { calls: unknown[] } }).labState.calls); }
async function success() { await page.evaluate(() => (window as unknown as { labState: { resolve: (r: unknown) => void } }).labState.resolve({ status: "ok", source: "prevlev:fixture", data: { generated: true, model: "fixture:exact-image", images: [{ base64: "fixture", mime: "image/png" }] } })); }

test("opening and organizing local URL/file references never sends or loads them", async () => {
  expect(await calls()).toEqual([]);
  await page.locator('#thumbnail-lab-form [name="title"]').fill("Título original");
  await page.locator('#thumbnail-lab-form [name="newTitle"]').fill("Novo título");
  await page.locator('#thumbnail-lab-form [name="instructions"]').fill("Composição declarada");
  await page.locator("#thumbnail-lab-ref-group").selectOption("style");
  await page.locator("#thumbnail-lab-ref-note").fill("REFERÊNCIA PRIVADA");
  await page.locator("#thumbnail-lab-ref-url").fill("https://never-fetch.test/ref.png");
  await page.locator("#thumbnail-lab-add-url").click();
  await page.locator("#thumbnail-lab-ref-file").setInputFiles({ name: "referencia-nao-enviada.png", mimeType: "image/png", buffer: Buffer.from("fixture-not-image-bytes") });
  await expect(page.locator("#thumbnail-lab-references li")).toHaveCount(2);
  await expect(page.locator("#thumbnail-lab-references")).toContainText("bytes não lidos");
  expect(await calls()).toEqual([]);
  await page.locator("#thumbnail-lab-generate").click();
  const sent = await calls(); expect(sent).toHaveLength(1); expect(sent[0]).toMatchObject({ model: "fixture:exact-image", expectedOrigin: "http://127.0.0.1:7814", stream: false });
  expect(JSON.stringify(sent)).not.toMatch(/PRIVADA|never-fetch|referencia-nao|references|resolution|aspect/);
  expect(JSON.stringify(sent)).toContain("Novo título");
  await expect(page.locator("#thumbnail-lab-generate")).toBeDisabled();
  await success(); await expect(page.locator("#thumbnail-lab-history")).toContainText("Resposta de imagem recebida");
  await expect(page.locator("#thumbnail-lab-history")).toContainText("2 referência(s) locais não enviadas");
  expect(await page.evaluate(() => (window as unknown as { labState: { shown: number } }).labState.shown)).toBe(0);
  await page.getByRole("button", { name: "Abrir resposta retida" }).click();
  expect(await page.evaluate(() => (window as unknown as { labState: { shown: number } }).labState.shown)).toBe(1);
  expect(await calls()).toHaveLength(1);
});

test("stopping follow-up reports uncertainty and a late response resolves the same job", async () => {
  await page.locator('#thumbnail-lab-form [name="instructions"]').fill("Briefing um"); await page.locator("#thumbnail-lab-generate").click();
  await page.locator("#thumbnail-lab-stop").click(); await expect(page.locator("#thumbnail-lab-history")).toContainText("Resultado incerto");
  await expect(page.locator("#thumbnail-lab-status")).toContainText("cancelamento remoto não é suportado");
  await expect(page.locator("#thumbnail-lab-generate")).toBeDisabled(); await expect(page.locator("#thumbnail-lab-clear")).toBeDisabled();
  await page.locator('#thumbnail-lab-form [name="instructions"]').fill("Briefing posterior");
  await success(); await expect(page.locator("#thumbnail-lab-status")).toContainText("após interromper");
  await expect(page.locator("#thumbnail-lab-history")).toContainText("Briefing um"); await expect(page.locator("#thumbnail-lab-history")).not.toContainText("Briefing posterior");
  expect(await calls()).toHaveLength(1); await expect(page.locator("#thumbnail-lab-generate")).toBeEnabled();
});

test("unknown outcomes are retained without retries and local clearing removes the session", async () => {
  await page.locator('#thumbnail-lab-form [name="instructions"]').fill("Pedido perdido"); await page.locator("#thumbnail-lab-generate").click();
  await page.evaluate(() => (window as unknown as { labState: { reject: (e: Error) => void } }).labState.reject(new Error("JSON incompleto")));
  await expect(page.locator("#thumbnail-lab-history")).toContainText("Resultado incerto"); await expect(page.locator("#thumbnail-lab-status")).toContainText("Nenhuma repetição automática");
  expect(await calls()).toHaveLength(1);
  await page.locator("#thumbnail-lab-clear").click(); await expect(page.locator("#thumbnail-lab-history li")).toHaveCount(0); await expect(page.locator('#thumbnail-lab-form [name="instructions"]')).toHaveValue(""); expect(await calls()).toHaveLength(1);
});

test("capabilities gate generation and client preflight rejection never reports a generated image", async () => {
  await page.evaluate(() => { const win = window as unknown as { labState: { selection: { model: { operations: string[] } } }; lab: { refreshSelection: () => void } }; win.labState.selection.model.operations = []; win.lab.refreshSelection(); });
  await expect(page.locator("#thumbnail-lab-generate")).toBeDisabled(); expect(await calls()).toHaveLength(0);
  await page.evaluate(() => { const win = window as unknown as { labState: { selection: { model: { operations: string[] } } }; lab: { refreshSelection: () => void } }; win.labState.selection.model.operations = ["images.generate"]; win.lab.refreshSelection(); });
  await page.locator('#thumbnail-lab-form [name="instructions"]').fill("Um pedido"); await page.locator("#thumbnail-lab-generate").click();
  await page.evaluate(() => (window as unknown as { labState: { resolve: (r: unknown) => void } }).labState.resolve({ status: "error", source: "prevlev:client", error: "Solicitação não enviada: modelo mudou." }));
  await expect(page.locator("#thumbnail-lab-status")).toContainText("Solicitação não enviada"); await expect(page.locator("#thumbnail-lab-history")).not.toContainText("Resposta de imagem recebida");
});
