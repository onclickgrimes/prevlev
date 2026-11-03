import { test, expect, chromium, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';

interface SafetyState {
  sources: string[]; bitmaps: number; readsStarted: number; readsActive: number; maxReads: number;
  decodeActive: number; maxDecode: number; holdReads: boolean; holdDecode: boolean;
  lastImage?: HTMLImageElement;
  releaseReads: (() => void)[]; releaseDecodes: (() => void)[];
}
interface FixtureWindow { safety: SafetyState; imageTools: { invalidateContext(): void }; fixtureSwipe: { render(): Promise<void>; invalidatePreviews(): void } }
const origin = 'http://image-consumers.test', remote = 'https://preview.test/local-fixture.png';
const tiny = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZkAAAAASUVORK5CYII=', 'base64');
function oversized() { const bytes = Buffer.from(tiny); bytes.writeUInt32BE(8000, 16); bytes.writeUInt32BE(8000, 20); return bytes; }
let browser: Browser, context: BrowserContext, page: Page, bundle: string, valid: Buffer, responseBytes: Buffer, requested: { url: string; type: string }[], unexpected: string[], heldRoutes: Route[], holdRemote: boolean;
test.beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `import {initImageTools} from './src/ui/images';import {initSwipeTools} from './src/ui/swipe';import {initCardCompositionTools} from './src/ui/card-composition';import {initVisualSimilarityTools} from './src/ui/visual-similarity';
const fixtureSwipe=initSwipeTools();fixtureSwipe.render();Object.assign(window,{fixtureSwipe,imageTools:initImageTools({contextVideos:()=>[{id:'abcdefghijk',title:'Contexto da coleta',url:'https://www.youtube.com/watch?v=abcdefghijk',source:'youtube-dom'}]}),composer:initCardCompositionTools({snapshot:()=>({videos:[]})})});initVisualSimilarityTools();`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife' })).outputFiles[0].text;
  browser = await chromium.launch({ executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] });
});
test.afterAll(async () => { await browser?.close(); });
test.beforeEach(async () => {
  responseBytes = tiny; requested = []; unexpected = []; heldRoutes = []; holdRemote = false; context = await browser.newContext();
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (url === `${origin}/`) return route.fulfill({ contentType: 'text/html', body: '<section id="images"></section><section id="swipe"></section><section id="card-composition"></section><section id="visual-similarity"></section><script src="/bundle.js"></script>' });
    if (url === `${origin}/bundle.js`) return route.fulfill({ contentType: 'text/javascript', body: bundle });
    if (url === remote) {
      requested.push({ url, type: route.request().resourceType() });
      if (holdRemote) { heldRoutes.push(route); return; }
      return route.fulfill({ contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: responseBytes });
    }
    unexpected.push(url); return route.abort();
  });
  await context.addInitScript(({ remote }) => {
    const state: SafetyState = { sources: [], bitmaps: 0, readsStarted: 0, readsActive: 0, maxReads: 0, decodeActive: 0, maxDecode: 0, holdReads: false, holdDecode: false, releaseReads: [], releaseDecodes: [] };
    Object.assign(window, { safety: state });
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
    Object.defineProperty(HTMLImageElement.prototype, 'src', { ...descriptor, set(value: string) { state.sources.push(String(value)); descriptor.set!.call(this, value); } });
    const bitmap = window.createImageBitmap;
    window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => { state.bitmaps++; return bitmap(...args); }) as typeof createImageBitmap;
    const arrayBuffer = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = async function () { state.readsStarted++; state.readsActive++; state.maxReads = Math.max(state.maxReads, state.readsActive); try { if (state.holdReads) await new Promise<void>(resolve => state.releaseReads.push(resolve)); return await arrayBuffer.call(this); } finally { state.readsActive--; } };
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () { state.lastImage = this; state.decodeActive++; state.maxDecode = Math.max(state.maxDecode, state.decodeActive); try { if (state.holdDecode) await new Promise<void>(resolve => state.releaseDecodes.push(resolve)); return await decode.call(this); } finally { state.decodeActive--; } };
    Object.assign(window, { chrome: { storage: { local: { get: async () => ({ swipe: [{ id: 'fixture-remote', title: 'Referência local', url: 'https://example.test/video', thumbnail: remote, folder: 'Referências', createdAt: '2026-11-03T00:00:00Z' }] }), set: async () => {} } } } });
  }, { remote });
  page = await context.newPage(); await page.goto(`${origin}/`);
  valid = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 16; c.height = 8; const ctx = c.getContext('2d')!; ctx.fillStyle = '#2255ff'; ctx.fillRect(0, 0, 16, 8); return c.toDataURL().split(',')[1]; }), 'base64'); responseBytes = valid;
});
test.afterEach(async () => { expect(unexpected).toEqual([]); await context.close(); });
const upload = (selector: string, buffer = valid, name = 'local.png', mimeType = 'image/png') => page.locator(selector).setInputFiles({ name, mimeType, buffer });
const state = () => page.evaluate(() => { const s = (window as unknown as FixtureWindow).safety; return { sources: s.sources, bitmaps: s.bitmaps, readsStarted: s.readsStarted, readsActive: s.readsActive, maxReads: s.maxReads, decodeActive: s.decodeActive, maxDecode: s.maxDecode }; });
async function rendered() { await upload('#image-file'); await page.locator('#image-preview').click(); await expect(page.locator('#image-output')).toBeVisible(); }

test('gallery rejects dimensions, MIME and excessive candidate counts before exposing img.src or bitmap', async () => {
  await upload('#image-file', oversized()); await expect(page.locator('#image-info')).toContainText('pixels');
  expect((await state()).sources).toEqual([]); expect((await state()).bitmaps).toBe(0); await expect(page.locator('#image-variants img')).toHaveCount(0);
  await upload('#image-file', Buffer.from('GIF89a'), 'unsupported.gif', 'image/gif'); await expect(page.locator('#image-info')).toContainText('não suportado'); expect((await state()).sources).toEqual([]);
  await upload('#image-file', valid, 'mime-mismatch.jpg', 'image/jpeg'); await expect(page.locator('#image-info')).toContainText('Cabeçalho'); expect((await state()).sources).toEqual([]);
  const beforeLargeRead = (await state()).readsStarted;
  await upload('#image-file', Buffer.alloc(10 * 1024 * 1024 + 1), 'oversized-file.png'); await expect(page.locator('#image-info')).toContainText('bytes');
  expect((await state()).readsStarted).toBe(beforeLargeRead); expect((await state()).sources).toEqual([]);
  await rendered(); const before = (await state()).sources.length;
  await page.locator('#candidate-file').setInputFiles(Array.from({ length: 7 }, (_, i) => ({ name: `candidate-${i}.png`, mimeType: 'image/png', buffer: valid })));
  await expect(page.locator('#image-output')).toBeHidden(); await expect(page.locator('#image-output')).not.toHaveAttribute('src'); await expect(page.locator('#image-variants img')).toHaveCount(0); await expect(page.locator('#preview-download')).toBeDisabled();
  await expect(page.locator('#image-info')).toContainText('máximo 6'); expect((await state()).sources.length).toBe(before);
});

test('replacement clears old results immediately and retains one physical read despite rapid cancellation', async () => {
  await rendered(); await page.evaluate(() => { (window as unknown as FixtureWindow).safety.holdReads = true; });
  const before = (await state()).readsStarted;
  await upload('#candidate-file', valid, 'first.png'); await expect.poll(async () => (await state()).readsActive).toBe(1);
  await expect(page.locator('#image-output')).toBeHidden(); await expect(page.locator('#image-variants img')).toHaveCount(0);
  await upload('#candidate-file', valid, 'second.png'); await upload('#candidate-file', valid, 'latest.png');
  expect((await state()).readsStarted).toBe(before + 1); expect((await state()).maxReads).toBe(1);
  await page.evaluate(() => { const s = (window as unknown as FixtureWindow).safety; s.holdReads = false; for (const release of s.releaseReads.splice(0)) release(); });
  await expect(page.locator('#image-preview')).toBeEnabled(); await expect(page.locator('#image-variants img')).toHaveCount(1);
  expect((await state()).maxReads).toBe(1); await page.locator('#image-preview').click(); await expect(page.locator('#image-output')).toBeVisible();
});

test('context invalidation drops output/gallery and refuses a late decode without opening another slot', async () => {
  await rendered(); await page.evaluate(() => { (window as unknown as FixtureWindow).safety.holdDecode = true; });
  await page.locator('#image-preview').click(); await expect.poll(async () => (await state()).decodeActive).toBe(1);
  await page.evaluate(() => (window as unknown as FixtureWindow).imageTools.invalidateContext());
  await expect(page.locator('#image-output')).toBeHidden(); await expect(page.locator('#image-variants img')).toHaveCount(0); await expect(page.locator('#preview-download')).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).safety.lastImage?.getAttribute('src'))).toMatch(/^blob:/);
  await page.evaluate(() => { const s = (window as unknown as FixtureWindow).safety; s.holdDecode = false; for (const release of s.releaseDecodes.splice(0)) release(); });
  await expect.poll(async () => (await state()).decodeActive).toBe(0);
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).safety.lastImage?.getAttribute('src'))).toBeNull();
  await expect(page.locator('#image-output')).not.toHaveAttribute('src'); await expect(page.locator('#image-variants img')).toHaveCount(0); expect((await state()).maxDecode).toBe(1);
});

test('library previews explicitly fetch bounded bytes and reject oversized headers before assigning a source', async () => {
  await expect(page.locator('#swipe-list img')).toHaveCount(0); expect(requested).toEqual([]);
  responseBytes = oversized(); await page.getByRole('button', { name: 'Ver prévia da imagem', exact: true }).click(); await expect(page.locator('#swipe-status')).toContainText('pixels');
  expect(requested).toEqual([{ url: remote, type: 'fetch' }]); expect((await state()).sources).toEqual([]); await expect(page.locator('#swipe-list img')).toHaveCount(0);
  responseBytes = valid; await page.getByRole('button', { name: 'Ver prévia da imagem', exact: true }).click(); await expect(page.locator('#swipe-list img')).toBeVisible();
  expect((await state()).sources.every(url => url.startsWith('blob:'))).toBe(true); await page.getByRole('button', { name: 'Ocultar prévia', exact: true }).click(); await expect(page.locator('#swipe-list img')).toHaveCount(0);
});

test('library cancellation and rerender discard a delayed fetch without decoding it', async () => {
  holdRemote = true; await page.getByRole('button', { name: 'Ver prévia da imagem', exact: true }).click(); await expect.poll(() => heldRoutes.length).toBe(1);
  await page.evaluate(() => (window as unknown as FixtureWindow).fixtureSwipe.render());
  for (const route of heldRoutes.splice(0)) await route.fulfill({ contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: tiny }).catch(() => {});
  await expect(page.locator('#swipe-list img')).toHaveCount(0); expect((await state()).sources).toEqual([]); expect((await state()).bitmaps).toBe(0);
});

test('card and visual consumers never decode or display an oversized local header', async () => {
  await upload('#card-compose-file', oversized()); await page.locator('#card-compose-title').fill('Título informado'); await page.locator('#card-compose-render').click(); await expect(page.locator('#card-compose-status')).toContainText('pixels');
  await upload('#visual-reference', oversized()); await upload('#visual-candidates'); await page.locator('#visual-compare').click(); await expect(page.locator('#visual-status')).toContainText('pixels');
  expect((await state()).bitmaps).toBe(0); expect((await state()).sources).toEqual([]); await expect(page.locator('#card-compose-output')).toBeHidden(); await expect(page.locator('#visual-results img')).toHaveCount(0);
});
