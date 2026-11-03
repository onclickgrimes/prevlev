import { test, expect, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';

let browser: Browser, context: BrowserContext, page: Page, bundle: string, unexpected: string[];
test.beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `import { initCardCompositionTools } from './src/ui/card-composition';
const snapshot = {videos:[{id:'abcdefghijk',title:'Primeiro vídeo observado',url:'https://www.youtube.com/watch?v=abcdefghijk',channel:'Canal A',views:10,source:'youtube-dom',observedAt:'2026-01-01T00:00:00Z'},{id:'ABCDEFGHIJK',title:'Segundo vídeo',url:'https://www.youtube.com/watch?v=ABCDEFGHIJK',source:'user-provided'},{id:'aaaaaaaaaaa',title:'API excluída',url:'https://www.youtube.com/watch?v=aaaaaaaaaaa',source:'youtube-data-api'}]};
Object.assign(window,{cardComposer:initCardCompositionTools({snapshot:()=>snapshot})});`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife' })).outputFiles[0].text;
  browser = await chromium.launch({ executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] });
});
test.afterAll(async () => { await browser?.close(); });
test.beforeEach(async () => {
  unexpected = []; context = await browser.newContext({ acceptDownloads: true });
  await context.route('**/*', route => { const url = route.request().url(); if (url === 'http://card.test/') return route.fulfill({ contentType: 'text/html', body: '<section id="card-composition"></section><script src="/bundle.js"></script>' }); if (url === 'http://card.test/bundle.js') return route.fulfill({ contentType: 'text/javascript', body: bundle }); unexpected.push(url); return route.abort(); });
  page = await context.newPage(); await page.goto('http://card.test/');
});
test.afterEach(async () => { expect(unexpected).toEqual([]); await context.close(); });
async function upload() {
  const data = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 80; c.height = 40; const ctx = c.getContext('2d')!; ctx.fillStyle = '#fc0000'; ctx.fillRect(0, 0, 40, 40); ctx.fillStyle = '#0000fc'; ctx.fillRect(40, 0, 40, 40); return c.toDataURL().split(',')[1]; });
  await page.locator('#card-compose-file').setInputFiles({ name: 'own.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
}
async function pixels() { return page.locator('#card-compose-output').evaluate(async (img: HTMLImageElement) => { await img.decode(); const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight; const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0); return { width: canvas.width, height: canvas.height, corner: [...ctx.getImageData(0, 0, 1, 1).data], center: [...ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 4), 1, 1).data] }; }); }
test('composes a PNG with transparency, scaling and explicit snapshot provenance', async () => {
  await upload(); await page.locator('#card-compose-source').selectOption('snapshot'); await page.locator('#card-compose-load').click(); await expect(page.locator('#card-compose-video option')).toHaveCount(3); await page.locator('#card-compose-video').selectOption('0');
  await expect(page.locator('#card-compose-provenance')).toContainText('abcdefghijk'); await expect(page.locator('#card-compose-provenance')).toContainText('página YouTube observada');
  await page.locator('#card-compose-background').selectOption('transparent'); await page.locator('#card-compose-render').click(); await expect(page.locator('#card-compose-output')).toBeVisible();
  expect(await pixels()).toMatchObject({ width: 640, height: 600, corner: [0, 0, 0, 0] }); await expect(page.locator('#card-compose-status')).toContainText('abcdefghijk');
  await page.locator('#card-compose-scale').selectOption('2'); await expect(page.locator('#card-compose-download')).toBeDisabled(); await page.locator('#card-compose-render').click(); await expect(page.locator('#card-compose-output')).toBeVisible(); expect(await pixels()).toMatchObject({ width: 1280, height: 1200, corner: [0, 0, 0, 0] });
  const pending = page.waitForEvent('download'); await page.locator('#card-compose-download').click(); expect((await pending).suggestedFilename()).toBe('prevlev-composicao-local.png');
  await page.locator('#card-compose-video').selectOption('1'); await expect(page.locator('#card-compose-output')).toBeHidden(); await expect(page.locator('#card-compose-download')).toBeDisabled(); await page.locator('#card-compose-render').click(); await expect(page.locator('#card-compose-status')).toContainText('ABCDEFGHIJK');
});
test('short format, light and custom backgrounds are rendered locally', async () => {
  await upload(); await page.locator('#card-compose-title').fill('Título informado'); await page.locator('#card-compose-format').selectOption('short'); await page.locator('#card-compose-background').selectOption('light'); await page.locator('#card-compose-render').click(); await expect(page.locator('#card-compose-output')).toBeVisible(); expect(await pixels()).toMatchObject({ width: 440, height: 820, corner: [238, 238, 239, 255] });
  await page.locator('#card-compose-background').selectOption('custom'); await page.locator('#card-compose-color').fill('#123456'); await page.locator('#card-compose-render').click(); await expect(page.locator('#card-compose-output')).toBeVisible(); expect((await pixels()).corner).toEqual([18, 52, 86, 255]);
});

test('invalidating a changed snapshot clears selections, provenance and any generated preview', async () => {
  await upload(); await page.locator('#card-compose-source').selectOption('snapshot'); await page.locator('#card-compose-load').click(); await page.locator('#card-compose-video').selectOption('0'); await page.locator('#card-compose-render').click(); await expect(page.locator('#card-compose-output')).toBeVisible();
  await page.evaluate(() => (window as unknown as { cardComposer: { invalidateSnapshot(): void } }).cardComposer.invalidateSnapshot());
  await expect(page.locator('#card-compose-video option')).toHaveCount(1); await expect(page.locator('#card-compose-provenance')).not.toContainText('abcdefghijk'); await expect(page.locator('#card-compose-output')).toBeHidden(); await expect(page.locator('#card-compose-download')).toBeDisabled();
  await page.locator('#card-compose-render').click(); await expect(page.locator('#card-compose-status')).toContainText('selecione um vídeo');
});
test('prevents concurrent decoding and discards a result after inputs change', async () => {
  await upload(); await page.locator('#card-compose-title').fill('Primeiro título');
  await page.evaluate(() => {
    const real = window.createImageBitmap; let resolve: (() => void) | undefined;
    Object.assign(window, { releaseCardDecode: () => resolve?.(), cardDecodeCalls: 0 });
    window.createImageBitmap = (async (source: ImageBitmapSource) => {
      (window as unknown as { cardDecodeCalls: number }).cardDecodeCalls++;
      await new Promise<void>(done => { resolve = done; });
      return real(source);
    }) as typeof createImageBitmap;
  });
  await page.locator('#card-compose-render').click(); await expect(page.locator('#card-compose-render')).toBeDisabled();
  await expect.poll(() => page.evaluate(() => (window as unknown as { cardDecodeCalls: number }).cardDecodeCalls)).toBe(1);
  await page.locator('#card-compose-title').fill('Outro título');
  await page.evaluate(() => { document.getElementById('card-compose-render')!.click(); (window as unknown as { releaseCardDecode(): void }).releaseCardDecode(); });
  await expect(page.locator('#card-compose-render')).toBeEnabled(); await expect(page.locator('#card-compose-output')).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { cardDecodeCalls: number }).cardDecodeCalls)).toBe(1);
});
