import { test, expect, chromium, type Browser } from "@playwright/test";
import { build } from "esbuild";
import { existsSync } from "node:fs";
import type { SaveSwipeAssetMetadata } from "../../src/ui/swipe-assets";

interface CaptureFixture extends Window {
  captureFixture: {
    offer(id: string): void; invalidate(): void; dispose(): void;
    resolve(index: number): void; reject(index: number): void; changeSource(): void;
    calls: { metadata: SaveSwipeAssetMetadata; guard: () => boolean; size: number; type: string }[];
  };
}
let browser: Browser;
test.beforeAll(async () => { browser = await chromium.launch({ executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined), headless: true, args: ["--no-sandbox"] }); });
test.afterAll(async () => { await browser?.close(); });
async function fixture() {
  const page = await browser.newPage(), requests: string[] = [];
  await page.route("**/*", route => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent('<section id="capture-host"><p>Host preservado</p></section>');
  const bundle = await build({ stdin: { contents: `import {mountCapturedAsset} from './src/ui/captured-asset';
    const calls=[],pending=[];let context='';
    const panel=mountCapturedAsset(document.querySelector('#capture-host'),{saveAsset:(blob,metadata,guard)=>{calls.push({metadata,guard,size:blob.size,type:blob.type});return new Promise((resolve,reject)=>pending.push({resolve,reject}));}});
    window.captureFixture={calls,offer:(id)=>{context=id;panel.offer({blob:new Blob(['fixture validated by host'],{type:'image/png'}),metadata:{title:'Captura '+id,url:'https://www.youtube.com/watch?v='+id,source:'youtube-dom',provenance:{kind:'capture',sourceUrl:'https://studio.youtube.com/video/'+id+'/analytics?period=28',videoId:id}},isCurrent:()=>context===id});},invalidate:()=>panel.invalidate(),dispose:()=>panel.dispose(),resolve:(index)=>pending[index].resolve('asset-'+index),reject:(index)=>pending[index].reject(new Error('Falha antiga')),changeSource:()=>{context='changed';}};`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "iife" });
  await page.addScriptTag({ content: bundle.outputFiles[0].text }); return { page, requests };
}

test("only an explicit save forwards the offered bytes, edited title and declared capture URL", async () => {
  const { page, requests } = await fixture(); await expect(page.locator(".captured-asset")).toBeHidden();
  await page.evaluate(() => (window as unknown as CaptureFixture).captureFixture.offer("abcdefghijk"));
  await expect(page.locator(".captured-asset-provenance")).toContainText("https://studio.youtube.com/video/abcdefghijk/analytics?period=28"); await expect(page.locator("#capture-host img,#capture-host a,#capture-host canvas")).toHaveCount(0);
  await page.locator(".captured-asset-title").fill("Título revisto"); expect(await page.evaluate(() => (window as unknown as CaptureFixture).captureFixture.calls.length)).toBe(0);
  await page.getByRole("button", { name: "Salvar última captura na biblioteca" }).click(); await expect(page.locator(".captured-asset-save")).toBeDisabled();
  expect(await page.evaluate(() => { const call = (window as unknown as CaptureFixture).captureFixture.calls[0]; return { metadata: call.metadata, guard: call.guard(), type: call.type }; })).toMatchObject({ metadata: { title: "Título revisto", url: "https://www.youtube.com/watch?v=abcdefghijk", provenance: { kind: "capture", sourceUrl: "https://studio.youtube.com/video/abcdefghijk/analytics?period=28" } }, guard: true, type: "image/png" });
  await page.evaluate(() => (window as unknown as CaptureFixture).captureFixture.resolve(0)); await expect(page.locator(".captured-asset-status")).toContainText("Captura salva"); expect(requests).toEqual([]); await page.close();
});

test("editing and replacing an offer invalidate old guards without stale failures changing the next save", async () => {
  const { page } = await fixture(); await page.evaluate(() => (window as unknown as CaptureFixture).captureFixture.offer("abcdefghijk")); await page.locator(".captured-asset-save").click();
  await page.locator(".captured-asset-title").fill("Título novo"); expect(await page.evaluate(() => (window as unknown as CaptureFixture).captureFixture.calls[0].guard())).toBe(false);
  await page.evaluate(() => (window as unknown as CaptureFixture).captureFixture.offer("bcdefghijkl")); await page.locator(".captured-asset-save").click(); await page.evaluate(() => (window as unknown as CaptureFixture).captureFixture.reject(0));
  await expect(page.locator(".captured-asset-status")).toContainText("Validando e salvando"); await expect(page.locator(".captured-asset-title")).toHaveValue("Captura bcdefghijkl"); await expect(page.locator(".captured-asset-save")).toBeDisabled();
  await page.evaluate(() => (window as unknown as CaptureFixture).captureFixture.resolve(1)); await expect(page.locator(".captured-asset-status")).toContainText("Captura salva"); await page.close();
});

test("discard, context changes and host disposal suppress late success without touching host content", async () => {
  const { page } = await fixture(); await page.evaluate(() => (window as unknown as CaptureFixture).captureFixture.offer("abcdefghijk")); await page.locator(".captured-asset-save").click(); await page.getByRole("button", { name: "Descartar", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as CaptureFixture).captureFixture.calls[0].guard())).toBe(false); await page.evaluate(() => (window as unknown as CaptureFixture).captureFixture.resolve(0)); await expect(page.locator(".captured-asset")).toBeHidden();
  await page.evaluate(() => (window as unknown as CaptureFixture).captureFixture.offer("bcdefghijkl")); await page.locator(".captured-asset-save").click(); await page.evaluate(() => { const fixture = (window as unknown as CaptureFixture).captureFixture; fixture.changeSource(); fixture.resolve(1); });
  await expect(page.locator(".captured-asset-status")).toContainText("origem da captura mudou"); await expect(page.locator(".captured-asset-status")).not.toContainText("Captura salva");
  await page.evaluate(() => (window as unknown as CaptureFixture).captureFixture.offer("cdefghijklm")); await page.locator(".captured-asset-save").click(); await page.evaluate(() => { const fixture = (window as unknown as CaptureFixture).captureFixture; fixture.dispose(); fixture.resolve(2); });
  await expect(page.locator(".captured-asset")).toHaveCount(0); await expect(page.locator("#capture-host")).toHaveText("Host preservado"); await page.close();
});
