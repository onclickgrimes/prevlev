import { test, expect, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

interface FixtureState {
  calls: { source: string; expectedIdentity: string }[];
  identities: Record<string, string>;
  hold: boolean;
  resolve?: (capture: unknown) => void;
  samples: Record<string, { source: string; identity: string; url: string; title: string; videos: { id: string; title: string; url: string; source: string; views: number }[] }>;
  text: string[];
  bitmapCalls: number;
  holdBitmap: boolean;
  releaseBitmap?: () => void;
}
interface FixtureWindow { fixture: FixtureState }
let browser: Browser, context: BrowserContext, page: Page, bundle: string, unexpected: string[];
const origin = 'http://preview-context.test';
test.beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `import {initImageTools} from './src/ui/images';
const fixture={calls:[],identities:{collection:'collection:1','selected-tab':'tab:1'},hold:false,text:[],bitmapCalls:0,holdBitmap:false,samples:{collection:{source:'collection',identity:'collection:1',url:'https://www.youtube.com/feed/subscriptions',title:'Coleção associada a inscrições',videos:[{id:'abcdefghijk',title:'Somente coleção congelada',url:'https://www.youtube.com/watch?v=abcdefghijk',source:'user-provided',views:11}]},'selected-tab':{source:'selected-tab',identity:'tab:1',url:'https://www.youtube.com/results?search_query=authorized',title:'Busca autorizada selecionada',videos:[{id:'ABCDEFGHIJK',title:'Somente aba selecionada',url:'https://www.youtube.com/watch?v=ABCDEFGHIJK',source:'youtube-dom',views:22}]}}};
Object.assign(window,{fixture,imageTools:initImageTools({contextIdentity:source=>fixture.identities[source],captureContext:request=>{fixture.calls.push({source:request.source,expectedIdentity:request.expectedIdentity});return fixture.hold?new Promise(resolve=>fixture.resolve=resolve):Promise.resolve(structuredClone(fixture.samples[request.source]));}})});
const draw=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){fixture.text.push(text);return draw.call(this,text,...args);};
const bitmap=window.createImageBitmap;window.createImageBitmap=async(...args)=>{fixture.bitmapCalls++;if(fixture.holdBitmap)await new Promise(resolve=>fixture.releaseBitmap=resolve);return bitmap(...args);};`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife' })).outputFiles[0].text;
  browser = await chromium.launch({ executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] });
});
test.afterAll(async () => { await browser?.close(); });
test.beforeEach(async () => {
  unexpected = []; context = await browser.newContext({ acceptDownloads: true });
  await context.route('**/*', route => {
    if (route.request().url() === `${origin}/`) return route.fulfill({ contentType: 'text/html', body: '<section id="images"></section><script src="/bundle.js"></script>' });
    if (route.request().url() === `${origin}/bundle.js`) return route.fulfill({ contentType: 'text/javascript', body: bundle });
    unexpected.push(route.request().url()); return route.abort();
  });
  page = await context.newPage(); await page.goto(`${origin}/`);
});
test.afterEach(async () => { expect(unexpected).toEqual([]); await context.close(); });
async function png(color = '#555555') { return Buffer.from(await page.evaluate(color => { const c = document.createElement('canvas'); c.width = 32; c.height = 16; const ctx = c.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 32, 16); return c.toDataURL().split(',')[1]; }, color), 'base64'); }
async function upload(id: string, name: string, color?: string) { await page.locator(id).setInputFiles({ name, mimeType: 'image/png', buffer: await png(color) }); await expect(page.locator('#image-preview')).toBeEnabled(); }
async function calls() { return page.evaluate(() => (window as unknown as FixtureWindow).fixture.calls); }

test('Done confirms metadata/avatar A and Reset restores A after editing B, without changing any source', async () => {
  await upload('#image-file', 'original.png');
  await page.locator('#preview-channel').fill('Canal A'); await page.locator('#preview-views').fill('100 views simuladas A'); await page.locator('#preview-date').fill('Data simulada A'); await page.locator('#preview-duration').fill('01:23'); await upload('#preview-avatar', 'avatar-A.png', '#ff0000');
  await page.locator('#metadata-done').click(); await expect(page.locator('#preview-status')).toContainText('confirmados somente');
  await page.locator('#preview-metadata summary').click(); await page.locator('#preview-channel').fill('Canal B'); await page.locator('#preview-views').fill('999 views simuladas B'); await page.locator('#preview-date').fill('Data simulada B'); await page.locator('#preview-duration').fill('09:59'); await upload('#preview-avatar', 'avatar-B.png', '#0000ff');
  await page.locator('#metadata-reset').click(); await expect(page.locator('#preview-channel')).toHaveValue('Canal A'); await expect(page.locator('#preview-views')).toHaveValue('100 views simuladas A'); await expect(page.locator('#preview-date')).toHaveValue('Data simulada A'); await expect(page.locator('#preview-duration')).toHaveValue('01:23');
  expect(await page.locator('#preview-avatar').evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe('avatar-A.png');
  await page.locator('#image-preview').click(); await expect(page.locator('#image-output')).toBeVisible();
  const text = await page.evaluate(() => (window as unknown as FixtureWindow).fixture.text.join('\n')); expect(text).toContain('Canal A'); expect(text).toContain('100 views simuladas A'); expect(text).not.toContain('999 views simuladas B'); expect(await calls()).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).fixture.samples.collection.videos[0].views)).toBe(11);
});

test('metadata/avatar Reset preserves candidate two for both the preview and compression until image files change', async () => {
  await upload('#image-file', 'original.png', '#00ff00'); const red = await png('#ff0000'), blue = await png('#0000ff');
  await page.locator('#candidate-file').setInputFiles([{ name: 'first-red.png', mimeType: 'image/png', buffer: red }, { name: 'second-blue.png', mimeType: 'image/png', buffer: blue }]); await expect(page.locator('#image-preview')).toBeEnabled();
  await page.locator('#preview-channel').fill('Confirmado A'); await upload('#preview-avatar', 'avatar-A.png', '#ffff00'); await page.locator('#preview-mode').selectOption('candidate');
  await page.locator('#image-preview').click(); await expect(page.locator('#image-output')).toBeVisible(); await page.locator('#image-variants button').nth(1).click(); await expect(page.locator('#preview-status')).toContainText('candidata 2');
  await page.locator('#metadata-done').click(); await expect(page.locator('#preview-status')).toContainText('candidata 2');
  await page.locator('#preview-metadata summary').click(); await page.locator('#preview-channel').fill('Rascunho B'); await upload('#preview-avatar', 'avatar-B.png', '#ff00ff');
  await expect(page.locator('#image-variants button').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#metadata-reset').click(); await expect(page.locator('#preview-channel')).toHaveValue('Confirmado A'); await expect(page.locator('#image-variants button').nth(1)).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('#preview-avatar').evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe('avatar-A.png');
  await page.locator('#image-preview').click(); await expect(page.locator('#preview-status')).toContainText('candidata 2');
  const pixel = await page.locator('#image-output').evaluate((image: HTMLImageElement) => { const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0); return [...ctx.getImageData(110, 310, 1, 1).data]; }); expect(pixel[2]).toBeGreaterThan(240); expect(pixel[0]).toBeLessThan(10);
  await page.locator('#compression-source').selectOption('candidate'); await page.locator('#compression-format').selectOption('image/png'); const pending = page.waitForEvent('download'); await page.locator('#compress').click(); const downloaded = await pending; expect(await readFile((await downloaded.path())!)).toEqual(blue);
  await page.locator('#candidate-file').setInputFiles([{ name: 'new-first.png', mimeType: 'image/png', buffer: red }, { name: 'new-second.png', mimeType: 'image/png', buffer: blue }]); await expect(page.locator('#image-variants button').nth(0)).toHaveAttribute('aria-pressed', 'true');
});

test('loading collection versus selected tab is explicit and uses separate frozen rows and exact observed context', async () => {
  expect(await calls()).toEqual([]); await upload('#image-file', 'original.png'); await page.locator('#image-preview').click(); await expect(page.locator('#image-output')).toBeVisible(); expect(await calls()).toEqual([]);
  await page.locator('#preview-source').selectOption('loaded'); await page.locator('#image-preview').click(); await expect(page.locator('#image-info')).toContainText('Carregue explicitamente'); expect(await calls()).toEqual([]);
  await page.locator('#preview-load-context').click(); await expect(page.locator('#preview-source-info')).toContainText('Coleção local congelada'); await expect(page.locator('#preview-source-info')).toContainText('https://www.youtube.com/feed/subscriptions'); await expect(page.locator('#preview-feed')).toHaveValue('other');
  await page.evaluate(() => { const s = (window as unknown as FixtureWindow).fixture; s.text = []; s.samples.collection.videos[0].title = 'Mutação posterior na coleção'; });
  await page.locator('#image-preview').click(); await expect(page.locator('#image-output')).toBeVisible(); expect(await page.evaluate(() => (window as unknown as FixtureWindow).fixture.text.join('\n'))).toContain('Somente coleção');
  await page.locator('#preview-source').selectOption('selected-tab'); await page.locator('#preview-feed').selectOption('trending'); expect(await calls()).toHaveLength(1); await page.locator('#preview-load-context').click();
  await expect(page.locator('#preview-source-info')).toContainText('https://www.youtube.com/results?search_query=authorized'); await expect(page.locator('#preview-source-info')).toContainText('solicitado era Em alta; usaremos Busca'); await expect(page.locator('#preview-feed')).toHaveValue('search'); await expect(page.locator('#preview-feed')).toBeDisabled();
  await page.evaluate(() => { (window as unknown as FixtureWindow).fixture.text = []; }); await page.locator('#image-preview').click(); await expect(page.locator('#image-output')).toBeVisible();
  const text = await page.evaluate(() => (window as unknown as FixtureWindow).fixture.text.join('\n')); expect(text).toContain('Somente aba'); expect(text).not.toContain('Somente coleção'); expect(await calls()).toEqual([{ source: 'collection', expectedIdentity: 'collection:1' }, { source: 'selected-tab', expectedIdentity: 'tab:1' }]);
});

test('tab identity changes and cancelled late captures cannot publish the old sample or query again automatically', async () => {
  await upload('#image-file', 'original.png'); await page.locator('#preview-source').selectOption('selected-tab'); await page.evaluate(() => { (window as unknown as FixtureWindow).fixture.hold = true; }); await page.locator('#preview-load-context').click();
  await page.evaluate(() => { const s = (window as unknown as FixtureWindow).fixture; s.identities['selected-tab'] = 'tab:2'; s.resolve!(structuredClone(s.samples['selected-tab'])); });
  await expect(page.locator('#preview-source-info')).toContainText('mudou durante a captura'); await page.locator('#image-preview').click(); await expect(page.locator('#image-output')).toBeHidden(); expect(await calls()).toHaveLength(1);
  await page.evaluate(() => { const s = (window as unknown as FixtureWindow).fixture; s.identities['selected-tab'] = 'tab:1'; }); await page.locator('#preview-load-context').click();
  await page.locator('#preview-cancel-context').click(); await page.locator('#preview-source').selectOption('illustrative'); await page.evaluate(() => { const s = (window as unknown as FixtureWindow).fixture; s.resolve!(structuredClone(s.samples['selected-tab'])); });
  await expect(page.locator('#preview-source-info')).toContainText('Nenhuma coleta foi iniciada'); await expect(page.locator('#image-output')).toBeHidden(); expect(await calls()).toHaveLength(2);
});

test('changing authorized tab while image decoding is pending discards the composition without another capture', async () => {
  await upload('#image-file', 'original.png'); await page.locator('#preview-source').selectOption('selected-tab'); await page.locator('#preview-load-context').click(); await expect(page.locator('#preview-source-info')).toContainText('Aba selecionada');
  await page.evaluate(() => { (window as unknown as FixtureWindow).fixture.holdBitmap = true; }); await page.locator('#image-preview').click(); await expect.poll(() => page.evaluate(() => (window as unknown as FixtureWindow).fixture.bitmapCalls)).toBe(1);
  await page.evaluate(() => { const s = (window as unknown as FixtureWindow).fixture; s.identities['selected-tab'] = 'tab:2'; s.holdBitmap = false; s.releaseBitmap!(); });
  await expect(page.locator('#preview-source-info')).toContainText('Fonte alterada durante a composição'); await expect(page.locator('#image-output')).toBeHidden(); await expect(page.locator('#preview-download')).toBeDisabled(); expect(await calls()).toHaveLength(1);
});

test('official sample and oversized avatar fail safely without replacing the confirmed baseline', async () => {
  await upload('#image-file', 'original.png'); await page.locator('#preview-channel').fill('Confirmado A'); await page.locator('#metadata-done').click();
  await page.evaluate(() => { (window as unknown as FixtureWindow).fixture.samples.collection.videos[0].source = 'youtube-data-api'; }); await page.locator('#preview-source').selectOption('loaded'); await page.locator('#preview-load-context').click(); await expect(page.locator('#preview-source-info')).toContainText('API oficial');
  const bad = await png(); bad.writeUInt32BE(8000, 16); bad.writeUInt32BE(8000, 20); const before = await page.evaluate(() => (window as unknown as FixtureWindow).fixture.bitmapCalls);
  await page.locator('#preview-avatar').setInputFiles({ name: 'giant.png', mimeType: 'image/png', buffer: bad }); await expect(page.locator('#image-info')).toContainText('megapixels'); expect(await page.evaluate(() => (window as unknown as FixtureWindow).fixture.bitmapCalls)).toBe(before);
  await page.locator('#preview-metadata summary').click(); await page.locator('#preview-channel').fill('Inválido B'); await page.locator('#metadata-done').click(); await expect(page.locator('#image-info')).toContainText('Valide um avatar');
  await page.locator('#metadata-reset').click(); await expect(page.locator('#preview-channel')).toHaveValue('Confirmado A'); expect(await page.locator('#preview-avatar').evaluate((input: HTMLInputElement) => input.files?.length)).toBe(0);
});
