import { test, expect, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import type { StudioCaptureReceipt } from '../../src/core/studio-composition';
import type { StudioCompositionTools } from '../../src/ui/studio-composition';

type Fixture = Window & {
  tools: StudioCompositionTools; contextKey: string; bitmapCalls: number; holdBitmap: boolean; releaseBitmap?: () => void;
  validationCalls: number; validationAllowed: boolean; holdValidation: boolean; releaseValidation?: (allowed: boolean) => void;
};
let browser: Browser, context: BrowserContext, page: Page, bundle: string, unexpected: string[];
test.beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `import {mountStudioComposition} from './src/ui/studio-composition';
window.contextKey='context-A';window.bitmapCalls=0;window.holdBitmap=false;window.validationCalls=0;window.validationAllowed=true;window.holdValidation=false;
const real=window.createImageBitmap;window.createImageBitmap=(async(source,...rest)=>{window.bitmapCalls++;if(window.holdBitmap)await new Promise(resolve=>window.releaseBitmap=resolve);return real(source,...rest);});
window.tools=mountStudioComposition(document.querySelector('#host'),{contextKey:()=>window.contextKey,validateContext:async key=>{window.validationCalls++;if(window.holdValidation)return await new Promise(resolve=>window.releaseValidation=resolve);return window.validationAllowed;}});`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife' })).outputFiles[0].text;
  browser = await chromium.launch({ executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] });
});
test.afterAll(async () => { await browser?.close(); });
test.beforeEach(async () => {
  unexpected = []; context = await browser.newContext({ acceptDownloads: true });
  await context.route('**/*', route => { const url = route.request().url(); if (url === 'http://studio-compose.test/') return route.fulfill({ contentType: 'text/html', body: '<div id="host"></div><script src="/bundle.js"></script>' }); if (url === 'http://studio-compose.test/bundle.js') return route.fulfill({ contentType: 'text/javascript', body: bundle }); unexpected.push(url); return route.abort(); });
  page = await context.newPage(); await page.goto('http://studio-compose.test/');
});
test.afterEach(async () => { expect(unexpected).toEqual([]); await context.close(); });
async function png() {
  return page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 160; const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#14a078'; ctx.fillRect(0, 0, 240, 160); ctx.fillStyle = '#7030e0'; ctx.fillRect(240, 0, 80, 160); ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, 320, 16); return canvas.toDataURL().split(',')[1]; });
}
async function upload() { await page.locator('#studio-compose-file').setInputFiles({ name: 'pixels-mascarados.png', mimeType: 'image/png', buffer: Buffer.from(await png(), 'base64') }); await expect(page.locator('#studio-compose-status')).toContainText('Pixels aceitos'); }
async function pixels(points: number[][]) {
  return page.locator('#studio-compose-output img').evaluate(async (image: HTMLImageElement, coordinates) => { await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0); return { width: canvas.width, height: canvas.height, values: coordinates.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]) }; }, points);
}
async function setCapture(value: StudioCaptureReceipt) { const data = await png(); return page.evaluate(async ({ data, value }) => { const image = new Blob([Uint8Array.from(atob(data), character => character.charCodeAt(0))], { type: 'image/png' }); try { await (window as unknown as Fixture).tools.setCapture(image, value); return 'accepted'; } catch (error) { return (error as Error).message; } }, { data, value }); }
const receipt = (): StudioCaptureReceipt => ({ kind: 'analytics', contextKey: 'context-A', capturedAt: '2026-11-03T04:00:00Z', redactionValidated: true, redacted: true, categories: ['revenue', 'channel'] });

test('opening never captures or decodes; a validated receipt only prepares pixels until explicit composition', async () => {
  expect(await page.evaluate(() => (window as unknown as Fixture).tools.wantsComposition())).toBe(false);
  expect(await page.evaluate(() => (window as unknown as Fixture).bitmapCalls)).toBe(0);
  await page.locator('#studio-compose-enabled').check();
  expect(await setCapture(receipt())).toBe('accepted');
  await expect(page.locator('#studio-compose-source')).toContainText('Ocultações declaradas pela transação: receita, canal');
  expect(await page.evaluate(() => (window as unknown as Fixture).bitmapCalls)).toBe(0); await expect(page.locator('#studio-compose-output img')).toHaveCount(0);
  await page.locator('#studio-compose-render').click(); await expect(page.locator('#studio-compose-output img')).toBeVisible();
  expect(await setCapture({ ...receipt(), redactionValidated: false } as unknown as StudioCaptureReceipt)).toContain('recibo');
  await expect(page.locator('#studio-compose-output img')).toHaveCount(0); await expect(page.locator('#studio-compose-download')).toBeDisabled();
});

test('AnalyticsOnly preserves the full masked pixels and transparent outer background at scales one and two', async () => {
  await upload(); await page.locator('#studio-compose-title').fill('Texto declarado pelo usuário'); await page.locator('#studio-compose-background').selectOption('transparent');
  await page.locator('#studio-compose-render').click(); await expect(page.locator('#studio-compose-output img')).toBeVisible();
  expect(await pixels([[0, 0], [300, 175], [300, 400], [900, 400]])).toEqual({ width: 1120, height: 800, values: [[0, 0, 0, 0], [0, 0, 0, 255], [20, 160, 120, 255], [112, 48, 224, 255]] });
  await page.locator('#studio-compose-scale').selectOption('2'); await expect(page.locator('#studio-compose-output img')).toHaveCount(0);
  await page.locator('#studio-compose-render').click(); await expect(page.locator('#studio-compose-output img')).toBeVisible();
  expect(await pixels([[0, 0], [600, 350], [600, 800], [1800, 800]])).toEqual({ width: 2240, height: 1600, values: [[0, 0, 0, 0], [0, 0, 0, 255], [20, 160, 120, 255], [112, 48, 224, 255]] });
  const pending = page.waitForEvent('download'); await page.locator('#studio-compose-download').click(); expect((await pending).suggestedFilename()).toBe('prevlev-studio-composicao.png');
});

test('VideoInfo uses declared metadata, light/custom framing and retains the entire supplied source', async () => {
  await upload(); await page.locator('#studio-compose-layout').selectOption('video-info'); await page.locator('#studio-compose-theme').selectOption('light'); await page.locator('#studio-compose-background').selectOption('custom'); await page.locator('#studio-compose-color').fill('#123456');
  await page.locator('#studio-compose-title').fill('Vídeo declarado'); await page.locator('#studio-compose-period').fill('Período declarado, sem série privada'); await page.locator('#studio-compose-note').fill('Contexto informado por mim');
  await page.locator('#studio-compose-render').click(); await expect(page.locator('#studio-compose-output img')).toBeVisible();
  expect(await pixels([[0, 0], [500, 215], [500, 350], [1090, 350]])).toEqual({ width: 1200, height: 780, values: [[18, 52, 86, 255], [0, 0, 0, 255], [20, 160, 120, 255], [112, 48, 224, 255]] });
  await expect(page.locator('#studio-compose-source')).toContainText('Ocultações não verificadas');
  await page.locator('#studio-compose-note').fill('Nota alterada'); await expect(page.locator('#studio-compose-output img')).toHaveCount(0); await expect(page.locator('#studio-compose-download')).toBeDisabled();
  await page.locator('#studio-compose-cancel').click(); await expect(page.locator('#studio-compose-render')).toBeDisabled(); await expect(page.locator('#studio-compose-source')).toHaveText('Nenhuma imagem fornecida.');
});

test('context changes or edits during a held decode discard late results and never start a second physical decoder', async () => {
  await setCapture(receipt()); await page.evaluate(() => { (window as unknown as Fixture).holdBitmap = true; });
  await page.locator('#studio-compose-render').click(); await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).bitmapCalls)).toBe(1);
  await page.locator('#studio-compose-period').fill('Outro período declarado');
  await page.evaluate(() => { const fixture = window as unknown as Fixture; fixture.holdBitmap = false; fixture.releaseBitmap?.(); });
  await expect(page.locator('#studio-compose-output img')).toHaveCount(0); await expect(page.locator('#studio-compose-download')).toBeDisabled();
  await page.evaluate(() => { const fixture = window as unknown as Fixture; fixture.contextKey = 'context-B'; });
  await page.locator('#studio-compose-render').click(); await expect(page.locator('#studio-compose-source')).toHaveText('Nenhuma imagem fornecida.');
  expect(await page.evaluate(() => (window as unknown as Fixture).bitmapCalls)).toBe(1);
});

test('rejects oversized dimensions before decode and handles PNG encoding failure without retaining output', async () => {
  const bytes = Buffer.from(await png(), 'base64'); bytes.writeUInt32BE(8000, 16); bytes.writeUInt32BE(8000, 20);
  await page.locator('#studio-compose-file').setInputFiles({ name: 'dimensoes-invalidas.png', mimeType: 'image/png', buffer: bytes });
  await expect(page.locator('#studio-compose-status')).toContainText('pixels'); expect(await page.evaluate(() => (window as unknown as Fixture).bitmapCalls)).toBe(0);
  await upload();
  await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = () => { throw new DOMException('Canvas protegido', 'SecurityError'); }; });
  await page.locator('#studio-compose-render').click(); await expect(page.locator('#studio-compose-status')).toContainText('Canvas protegido'); await expect(page.locator('#studio-compose-output img')).toHaveCount(0); await expect(page.locator('#studio-compose-download')).toBeDisabled();
});

test('rechecks the captured context after decoding before publishing a result', async () => {
  await setCapture(receipt()); await page.evaluate(() => { (window as unknown as Fixture).holdBitmap = true; });
  await page.locator('#studio-compose-render').click(); await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).bitmapCalls)).toBe(1);
  await page.evaluate(() => { const fixture = window as unknown as Fixture; fixture.contextKey = 'context-B'; fixture.holdBitmap = false; fixture.releaseBitmap?.(); });
  await expect(page.locator('#studio-compose-source')).toHaveText('Nenhuma imagem fornecida.'); await expect(page.locator('#studio-compose-render')).toBeDisabled(); await expect(page.locator('#studio-compose-output img')).toHaveCount(0); await expect(page.locator('#studio-compose-download')).toBeDisabled();
});

test('cancelling during PNG encoding never retains the eventual encoded result', async () => {
  await upload();
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) { original.call(this, blob => { Object.assign(window, { finishCompositionEncoding: () => callback(blob) }); }, ...args); };
  });
  await page.locator('#studio-compose-render').click();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { finishCompositionEncoding?: () => void }).finishCompositionEncoding)).toBe('function');
  await page.locator('#studio-compose-cancel').click(); await expect(page.locator('#studio-compose-status')).toContainText('Composição cancelada');
  await page.evaluate(() => { (window as unknown as { finishCompositionEncoding(): void }).finishCompositionEncoding(); });
  await expect(page.locator('#studio-compose-render')).toBeDisabled(); await expect(page.locator('#studio-compose-output img')).toHaveCount(0); await expect(page.locator('#studio-compose-download')).toBeDisabled();
});

test('refuses actual-tab validation failures before accepting pixels or starting composition', async () => {
  await page.evaluate(() => { (window as unknown as Fixture).validationAllowed = false; });
  expect(await setCapture(receipt())).toContain('contexto real');
  await expect(page.locator('#studio-compose-source')).toHaveText('Nenhuma imagem fornecida.'); expect(await page.evaluate(() => (window as unknown as Fixture).bitmapCalls)).toBe(0);
  await page.evaluate(() => { (window as unknown as Fixture).validationAllowed = true; }); await setCapture(receipt());
  await page.evaluate(() => { (window as unknown as Fixture).validationAllowed = false; }); await page.locator('#studio-compose-render').click();
  await expect(page.locator('#studio-compose-status')).toContainText('contexto real'); await expect(page.locator('#studio-compose-render')).toBeDisabled(); expect(await page.evaluate(() => (window as unknown as Fixture).bitmapCalls)).toBe(0);
});

test('rejects a successful but stale validator reply after the synchronous context changes', async () => {
  await setCapture(receipt()); await page.evaluate(() => { (window as unknown as Fixture).holdValidation = true; });
  await page.locator('#studio-compose-render').click(); await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).validationCalls)).toBe(2);
  await page.evaluate(() => { const fixture = window as unknown as Fixture; fixture.contextKey = 'context-B'; fixture.releaseValidation?.(true); });
  await expect(page.locator('#studio-compose-source')).toHaveText('Nenhuma imagem fornecida.'); await expect(page.locator('#studio-compose-render')).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as Fixture).bitmapCalls)).toBe(0); await expect(page.locator('#studio-compose-output img')).toHaveCount(0);
});

test('revalidates the actual tab after a held composition decoder returns', async () => {
  await setCapture(receipt()); await page.evaluate(() => { (window as unknown as Fixture).holdBitmap = true; });
  await page.locator('#studio-compose-render').click(); await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).bitmapCalls)).toBe(1);
  await page.evaluate(() => { const fixture = window as unknown as Fixture; fixture.validationAllowed = false; fixture.holdBitmap = false; fixture.releaseBitmap?.(); });
  await expect(page.locator('#studio-compose-status')).toContainText('contexto real'); await expect(page.locator('#studio-compose-output img')).toHaveCount(0); await expect(page.locator('#studio-compose-download')).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as Fixture).validationCalls)).toBe(3);
});

test('revalidates the actual tab after a private preview decode before publishing', async () => {
  await setCapture(receipt());
  await page.evaluate(() => {
    const original = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () { await new Promise<void>(resolve => Object.assign(window, { releaseStudioPreview: resolve })); await original.call(this); };
  });
  await page.locator('#studio-compose-render').click();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { releaseStudioPreview?: () => void }).releaseStudioPreview)).toBe('function');
  await page.evaluate(() => { (window as unknown as Fixture).validationAllowed = false; (window as unknown as { releaseStudioPreview(): void }).releaseStudioPreview(); });
  await expect(page.locator('#studio-compose-status')).toContainText('contexto real'); await expect(page.locator('#studio-compose-source')).toHaveText('Nenhuma imagem fornecida.'); await expect(page.locator('#studio-compose-output img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as Fixture).validationCalls)).toBe(4);
});

test('an actual-tab validation failure before download clears pixels and produces no file', async () => {
  await setCapture(receipt()); await page.locator('#studio-compose-render').click(); await expect(page.locator('#studio-compose-output img')).toBeVisible();
  const files: string[] = []; page.on('download', download => files.push(download.suggestedFilename()));
  await page.evaluate(() => { (window as unknown as Fixture).validationAllowed = false; }); await page.locator('#studio-compose-download').click();
  await expect(page.locator('#studio-compose-status')).toContainText('contexto real'); await expect(page.locator('#studio-compose-source')).toHaveText('Nenhuma imagem fornecida.'); await expect(page.locator('#studio-compose-output img')).toHaveCount(0); await expect(page.locator('#studio-compose-download')).toBeDisabled(); expect(files).toEqual([]);
});

test('download validation ignores duplicate clicks and a late reply after cancellation', async () => {
  await setCapture(receipt()); await page.locator('#studio-compose-render').click(); await expect(page.locator('#studio-compose-output img')).toBeVisible();
  const files: string[] = []; page.on('download', download => files.push(download.suggestedFilename()));
  await page.evaluate(() => { const fixture = window as unknown as Fixture; fixture.holdValidation = true; const button = document.getElementById('studio-compose-download') as HTMLButtonElement; button.click(); button.click(); });
  await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).validationCalls)).toBe(5); await expect(page.locator('#studio-compose-download')).toBeDisabled();
  await page.locator('#studio-compose-cancel').click(); await page.evaluate(() => { (window as unknown as Fixture).releaseValidation?.(true); });
  await expect(page.locator('#studio-compose-status')).toContainText('Composição cancelada'); await expect(page.locator('#studio-compose-source')).toHaveText('Nenhuma imagem fornecida.'); expect(files).toEqual([]);
});

test('local PNG acceptance, composition and download never query the tab validator', async () => {
  await page.evaluate(() => { const fixture = window as unknown as Fixture; fixture.validationAllowed = false; fixture.contextKey = 'another-tab'; });
  await upload(); await page.locator('#studio-compose-render').click(); await expect(page.locator('#studio-compose-output img')).toBeVisible();
  const file = page.waitForEvent('download'); await page.locator('#studio-compose-download').click(); expect((await file).suggestedFilename()).toBe('prevlev-studio-composicao.png'); expect(await page.evaluate(() => (window as unknown as Fixture).validationCalls)).toBe(0);
});
