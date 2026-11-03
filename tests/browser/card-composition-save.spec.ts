import { test, expect, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import type { CardCompositionAssetMetadata, CardCompositionTools } from '../../src/ui/card-composition';

interface Fixture { cardComposer: CardCompositionTools; holdSave: boolean; releaseSave?: () => void; saveCalls: number; saved: { metadata: CardCompositionAssetMetadata; type: string; bytes: number[] }[]; changeSnapshot(): void; }
let browser: Browser, context: BrowserContext, page: Page, bundle: string;
const unexpected: string[] = [];
test.beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `import {initCardCompositionTools} from './src/ui/card-composition';
    let snapshot={url:'https://www.youtube.com/',title:'Collection',videos:[{id:'abcdefghijk',title:'Vídeo observado',url:'https://www.youtube.com/watch?v=abcdefghijk',source:'youtube-dom'},{id:'ABCDEFGHIJK',title:'Official',url:'https://www.youtube.com/watch?v=ABCDEFGHIJK',source:'youtube-data-api'}],comments:[],transcript:[],warnings:[]};
    window.saved=[];window.saveCalls=0;window.holdSave=false;window.changeSnapshot=()=>{snapshot={...snapshot,title:'Collection changed'};};
    window.cardComposer=initCardCompositionTools({snapshot:()=>snapshot,saveAsset:async(blob,metadata,guard)=>{window.saveCalls++;if(window.holdSave)await new Promise(resolve=>window.releaseSave=resolve);const bytes=Array.from(new Uint8Array(await blob.arrayBuffer()).slice(0,8));if(!guard())return false;window.saved.push({metadata,type:blob.type,bytes});return {id:'local-asset-'+window.saved.length};}});`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife' })).outputFiles[0].text;
  browser = await chromium.launch({ executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] });
});
test.afterAll(async () => { await browser?.close(); });
test.beforeEach(async () => {
  context = await browser.newContext({ acceptDownloads: true }); unexpected.length = 0;
  await context.route('**/*', route => { const url = route.request().url(); if (url === 'http://card-save.test/') return route.fulfill({ contentType: 'text/html', body: '<section id="card-composition"></section><script src="/bundle.js"></script>' }); if (url === 'http://card-save.test/bundle.js') return route.fulfill({ contentType: 'text/javascript', body: bundle }); unexpected.push(url); return route.abort(); });
  page = await context.newPage(); await page.goto('http://card-save.test/');
});
test.afterEach(async () => { expect(unexpected).toEqual([]); await context?.close(); });
async function upload() {
  const data = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 40; canvas.getContext('2d')!.fillRect(0, 0, 80, 40); return canvas.toDataURL().split(',')[1]; });
  await page.locator('#card-compose-file').setInputFiles({ name: 'owned.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
}
async function manual(url = 'https://example.test/my-video') {
  await upload(); await page.locator('#card-compose-title').fill('Meu título'); if (url) await page.locator('#card-compose-url').fill(url);
  await page.locator('#card-compose-render').click(); await expect(page.locator('#card-compose-output')).toBeVisible();
}

test('only an explicit action saves the current real PNG with a declared HTTPS reference; PNG download remains available without a URL', async () => {
  await manual(''); await expect(page.locator('#card-compose-save')).toBeDisabled(); await expect(page.locator('#card-compose-download')).toBeEnabled();
  const waiting = page.waitForEvent('download'); await page.locator('#card-compose-download').click(); expect((await waiting).suggestedFilename()).toBe('prevlev-composicao-local.png');
  expect(await page.evaluate(() => (window as unknown as Fixture).saveCalls)).toBe(0);
  await page.locator('#card-compose-url').fill('https://example.test/my-video'); await expect(page.locator('#card-compose-output')).toBeHidden();
  await page.locator('#card-compose-render').click(); await expect(page.locator('#card-compose-save')).toBeEnabled(); await page.locator('#card-compose-save').click();
  await expect(page.locator('#card-compose-status')).toContainText('Composição salva');
  const saved = await page.evaluate(() => (window as unknown as Fixture).saved);
  expect(saved).toHaveLength(1); expect(saved[0]).toMatchObject({ type: 'image/png', bytes: [137, 80, 78, 71, 13, 10, 26, 10], metadata: { title: 'Meu título', url: 'https://example.test/my-video', source: 'user-provided', provenance: { kind: 'composition', sourceUrl: 'https://example.test/my-video', fileName: 'owned.png' } } });
});

test('selected metadata saves the actual video URL and provenance, never an official record or invented reference', async () => {
  await upload(); await page.locator('#card-compose-source').selectOption('snapshot'); await page.locator('#card-compose-load').click(); await expect(page.locator('#card-compose-video option')).toHaveCount(2); await page.locator('#card-compose-video').selectOption('0');
  await page.locator('#card-compose-render').click(); await expect(page.locator('#card-compose-save')).toBeEnabled(); await page.locator('#card-compose-save').click();
  await expect(page.locator('#card-compose-status')).toContainText('Composição salva');
  expect((await page.evaluate(() => (window as unknown as Fixture).saved))[0].metadata).toMatchObject({ title: 'Vídeo observado', url: 'https://www.youtube.com/watch?v=abcdefghijk', source: 'youtube-dom', provenance: { kind: 'composition', sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk', videoId: 'abcdefghijk' } });
});

test('cancelling a held persistence callback invalidates its guard and never automatically retries', async () => {
  await manual(); await page.evaluate(() => { (window as unknown as Fixture).holdSave = true; }); await page.locator('#card-compose-save').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).saveCalls)).toBe(1);
  await page.locator('#card-compose-save-cancel').click(); await page.evaluate(() => (window as unknown as Fixture).releaseSave?.());
  await expect(page.locator('#card-compose-save')).toBeEnabled(); await expect(page.locator('#card-compose-status')).toContainText('Cancelamento solicitado');
  expect(await page.evaluate(() => (window as unknown as Fixture).saved)).toHaveLength(0); expect(await page.evaluate(() => (window as unknown as Fixture).saveCalls)).toBe(1);
});

test('collection replacement and unannounced snapshot changes prevent late persistence', async () => {
  await upload(); await page.locator('#card-compose-source').selectOption('snapshot'); await page.locator('#card-compose-load').click(); await page.locator('#card-compose-video').selectOption('0'); await page.locator('#card-compose-render').click(); await expect(page.locator('#card-compose-save')).toBeEnabled();
  await page.evaluate(() => { (window as unknown as Fixture).holdSave = true; }); await page.locator('#card-compose-save').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).saveCalls)).toBe(1);
  await page.evaluate(() => { const fixture = window as unknown as Fixture; fixture.changeSnapshot(); fixture.releaseSave?.(); });
  await expect(page.locator('#card-compose-status')).toContainText('contexto mudou'); await expect(page.locator('#card-compose-save')).toBeDisabled(); expect(await page.evaluate(() => (window as unknown as Fixture).saved)).toHaveLength(0);
  await page.locator('#card-compose-load').click(); await page.locator('#card-compose-video').selectOption('0'); await page.locator('#card-compose-render').click(); await expect(page.locator('#card-compose-save')).toBeEnabled(); await page.locator('#card-compose-save').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).saveCalls)).toBe(2);
  await page.evaluate(() => { const fixture = window as unknown as Fixture; fixture.cardComposer.invalidateSnapshot(); fixture.releaseSave?.(); });
  await expect(page.locator('#card-compose-output')).toBeHidden(); expect(await page.evaluate(() => (window as unknown as Fixture).saved)).toHaveLength(0);
});
