import { test, expect, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { build } from "esbuild";
import { existsSync } from "node:fs";

type FixtureState = Window & { removal: { invalidate(): void }; observeCalls: number; clicks: number; now: number; delayed: boolean; resolveObservation?: () => void };
let browser: Browser, context: BrowserContext, page: Page, bundle: string;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px system-ui}section{max-width:900px}label{display:block;margin:8px}input,select,textarea,button{font:inherit}ytcp-ad-breaks-editor{display:block}</style></head><body>
<ytcp-ad-breaks-editor data-video-id="video-1"><input aria-label="Ad slot start time" value="00:02:00"><input aria-label="Ad slot start time" value="00:04:00"><input aria-label="Ad slot start time" value="00:06:00"><button aria-label="Insert ad slot">Insert ad slot</button></ytcp-ad-breaks-editor><button id="save">Save</button><button id="continue">Continue</button><section id="studio"></section><script src="/fixture.js"></script></body></html>`;
test.beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `import {mountMidrollRemoval} from './src/ui/midroll-removal'; import {observeStudioMidrollSlots} from './src/content/studio'; window.observeCalls=0; window.clicks=0; window.now=Date.now(); window.delayed=false; window.removal=mountMidrollRemoval(document,{now:()=>window.now,observe:async()=>{window.observeCalls++;if(window.delayed)await new Promise(resolve=>window.resolveObservation=resolve);return observeStudioMidrollSlots();}});document.querySelectorAll('ytcp-ad-breaks-editor button,#save,#continue').forEach(button=>button.addEventListener('click',()=>window.clicks++));`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "iife" })).outputFiles[0].text;
  browser = await chromium.launch({ executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), headless: true, args: ["--no-sandbox"] });
});
test.afterAll(async () => { await browser?.close(); });
test.beforeEach(async () => {
  context = await browser.newContext();
  // Every request is fulfilled locally. No Studio code, account or service is accessed.
  await context.route("**/*", route => route.fulfill({ contentType: new URL(route.request().url()).pathname === "/fixture.js" ? "text/javascript" : "text/html", body: new URL(route.request().url()).pathname === "/fixture.js" ? bundle : html }));
  page = await context.newPage();
  await page.goto("https://studio.youtube.com/video/video-1/monetization");
});
test.afterEach(async () => { await context?.close(); });

test("observes only on action, previews an inclusive range, confirms locally and never alters controls", async () => {
  expect(await page.evaluate(() => (window as unknown as FixtureState).observeCalls)).toBe(0);
  await expect(page.locator('#removal-mode option[value="interruptive"]')).toHaveAttribute("disabled", "");
  await page.locator("#removal-mode").selectOption("range");
  await page.locator("#removal-start").fill("120");
  await page.locator("#removal-end").fill("240");
  await page.locator("#removal-preview").click();
  await expect(page.locator("#removal-title")).toHaveText("Remove 2 · prévia local");
  await expect(page.locator("#removal-targets li")).toHaveCount(2);
  await page.locator("#removal-confirmation").fill("REMOVER 3 DE vídeo video-1");
  await page.locator("#removal-confirm").click();
  await expect(page.locator("#removal-status")).toContainText("exatamente");
  await page.locator("#removal-confirmation").fill("REMOVER 2 DE vídeo video-1");
  await page.locator("#removal-confirm").click();
  await expect(page.locator("#removal-status")).toContainText("Plano local confirmado para 2 slots");
  expect(await page.evaluate(() => (window as unknown as FixtureState).clicks)).toBe(0);
  expect(await page.locator("ytcp-ad-breaks-editor input").evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value))).toEqual(["00:02:00", "00:04:00", "00:06:00"]);
});

test("reobserves before confirmation and rejects changed slot identity, cancellation and expiry", async () => {
  await page.locator("#removal-preview").click();
  await page.locator("#removal-confirmation").fill("REMOVER 3 DE vídeo video-1");
  await page.evaluate(() => { const field = document.querySelector("ytcp-ad-breaks-editor input")!; field.replaceWith(field.cloneNode(true)); });
  await page.locator("#removal-confirm").click();
  await expect(page.locator("#removal-status")).toContainText("Contexto ou slots alterados");
  await expect(page.locator("#removal-confirm")).toBeDisabled();
  await page.locator("#removal-preview").click();
  await page.locator("#removal-cancel").click();
  await expect(page.locator("#removal-status")).toContainText("Plano cancelado");
  await expect(page.locator("#removal-confirm")).toBeDisabled();
  await page.locator("#removal-preview").click();
  await page.locator("#removal-confirmation").fill("REMOVER 3 DE vídeo video-1");
  await page.evaluate(() => { (window as unknown as FixtureState).now += 120_000; });
  await page.locator("#removal-confirm").click();
  await expect(page.locator("#removal-status")).toContainText("Plano expirado");
  expect(await page.evaluate(() => (window as unknown as FixtureState).clicks)).toBe(0);
});

test("ignores a delayed observation after explicit context invalidation", async () => {
  await page.evaluate(() => { (window as unknown as FixtureState).delayed = true; });
  await page.locator("#removal-preview").click();
  await expect(page.locator("#removal-preview")).toBeDisabled();
  await page.evaluate(() => { const state = window as unknown as FixtureState; state.removal.invalidate(); state.resolveObservation?.(); });
  await expect(page.locator("#removal-status")).toContainText("Coleta ou aba alterada");
  await expect(page.locator("#removal-title")).toHaveText("Nenhum plano criado");
  await expect(page.locator("#removal-confirm")).toBeDisabled();
});

test("cancels a pending read and ignores its later observation", async () => {
  await page.evaluate(() => { (window as unknown as FixtureState).delayed = true; });
  await page.locator("#removal-preview").click();
  await page.locator("#removal-cancel").click();
  await page.evaluate(() => { (window as unknown as FixtureState).resolveObservation?.(); });
  await expect(page.locator("#removal-status")).toContainText("Plano cancelado");
  await expect(page.locator("#removal-title")).toHaveText("Nenhum plano criado");
  await expect(page.locator("#removal-confirm")).toBeDisabled();
});

test("manual observations remain declared and require explicit confirmation of observed positions", async () => {
  await page.locator("#removal-source").selectOption("manual");
  await page.locator("#removal-context").fill("meu vídeo observado");
  await page.locator("#removal-times").fill("120\n00:04:00");
  await page.locator("#removal-preview").click();
  await expect(page.locator("#removal-status")).toContainText("confirme manualmente");
  await page.locator("#removal-observed").check();
  await page.locator("#removal-preview").click();
  await expect(page.locator("#removal-details")).toContainText("observação manual não verificada");
  await expect(page.locator("#removal-limitations")).toContainText("Mudanças no Studio não podem ser detectadas");
  expect(await page.evaluate(() => (window as unknown as FixtureState).observeCalls)).toBe(0);
  await page.locator("#removal-times").fill("120\n00:05:00");
  await expect(page.locator("#removal-confirm")).toBeDisabled();
  await expect(page.locator("#removal-observed")).not.toBeChecked();
});
