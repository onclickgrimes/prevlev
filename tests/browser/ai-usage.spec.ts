import { test, expect, chromium, type Browser } from '@playwright/test';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import type { AiUsageJournal } from '../../src/core/ai-usage';

let browser: Browser, bundle: string;
test.beforeAll(async () => {
  browser = await chromium.launch({ executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] });
  bundle = (await build({ stdin: { contents: "import {AiUsageJournal} from './src/core/ai-usage'; import {mountAiUsage} from './src/ui/ai-usage'; window.usage=new AiUsageJournal(); window.usageView=mountAiUsage(document.getElementById('host'),window.usage);", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife' })).outputFiles[0].text;
});
test.afterAll(async () => { await browser?.close(); });

test('opening the passive panel counts nothing; fixture actions distinguish block, POST, response and uncertainty', async () => {
  const page = await browser.newPage(); const requests: string[] = []; page.on('request', request => requests.push(request.url()));
  await page.setContent('<main id="host"></main>'); await page.addScriptTag({ content: bundle });
  await expect(page.locator('#ai-usage-totals')).toContainText('0 tentativas preparadas; 0 POSTs'); await expect(page.locator('#ai-usage-clear')).toBeDisabled();
  await expect(page.locator('#ai-usage')).toContainText('não comprova chegada ao backend, envio ao provedor');
  await page.evaluate(() => {
    const usage = (window as unknown as { usage: AiUsageJournal }).usage;
    const blocked = usage.begin({ feature: 'transcript-summary' }); usage.blocked(blocked);
    const response = usage.begin({ feature: 'comment-analysis', model: 'fixture:text', backendOrigin: 'http://127.0.0.1:8787', origin: 'http://127.0.0.1:7814' }); usage.dispatched(response); usage.complete(response, { status: 'error', source: 'fixture:backend' });
    const uncertain = usage.begin({ feature: 'thumbnail-generation' }); usage.dispatched(uncertain); usage.complete(uncertain, { status: 'error', source: 'prevlev:client' });
    usage.cacheHit('transcript-summary');
  });
  await expect(page.locator('#ai-usage-totals')).toContainText('3 tentativas preparadas; 2 POSTs ao backend iniciados; 1 bloqueadas');
  await expect(page.locator('#ai-usage-totals')).toContainText('ok 0, erro 1'); await expect(page.locator('#ai-usage-totals')).toContainText('1 resultados incertos'); await expect(page.locator('#ai-usage-totals')).toContainText('1 reutilizações locais de cache');
  await expect(page.locator('#ai-usage-rows')).toContainText('Bloqueada antes de iniciar o POST'); await expect(page.locator('#ai-usage-rows')).toContainText('Backend respondeu: error'); await expect(page.locator('#ai-usage-rows')).toContainText('POST iniciado; resultado final não confirmado');
  expect(requests).toEqual([]); await page.close();
});

test('shows sanitized provenance and bounded retention, then clears without accepting stale callbacks', async () => {
  const page = await browser.newPage(); await page.setContent('<main id="host"></main>'); await page.addScriptTag({ content: bundle });
  const oldId = await page.evaluate(() => {
    const usage = (window as unknown as { usage: AiUsageJournal }).usage;
    for (let index = 0; index < 22; index++) {
      const id = usage.begin({ feature: 'transcript-summary', model: 'fixture:text', backendOrigin: 'https://user:PRIVATE_TOKEN@backend.example/PRIVATE_PATH?token=PRIVATE_QUERY', origin: 'http://127.0.0.1:7814/private' }); usage.dispatched(id); usage.complete(id, { status: 'ok', source: 'fixture:backend' });
    }
    const id = usage.begin({ feature: 'thumbnail-generation' }); usage.dispatched(id); return id;
  });
  await expect(page.locator('#ai-usage-rows tr')).toHaveCount(20); await expect(page.locator('#ai-usage-retention')).toContainText('3 registros antigos descartados');
  await expect(page.locator('#ai-usage-rows')).toContainText('https://backend.example'); await expect(page.locator('#ai-usage')).not.toContainText('PRIVATE'); await expect(page.locator('#ai-usage img')).toHaveCount(0);
  await page.locator('#ai-usage-clear').click(); await expect(page.locator('#ai-usage-totals')).toContainText('0 tentativas preparadas; 0 POSTs');
  await page.evaluate(old => {
    const usage = (window as unknown as { usage: AiUsageJournal }).usage; usage.begin({ feature: 'transcript-topics' }); usage.complete(old, { status: 'ok', source: 'fixture:backend' });
  }, oldId);
  await expect(page.locator('#ai-usage-totals')).toContainText('1 tentativas preparadas; 0 POSTs'); await expect(page.locator('#ai-usage-totals')).toContainText('ok 0'); await expect(page.locator('#ai-usage-rows tr')).toHaveCount(1);
  await page.close();
});
