import { test, expect, chromium, type Browser } from '@playwright/test';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';

let browser: Browser, bundle: string;
test.beforeAll(async () => {
  browser = await chromium.launch({ executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] });
  bundle = (await build({ stdin: { contents: "import {mountMidrollTools} from './src/ui/midroll-tools'; window.tools=mountMidrollTools(document,()=>window.changes++);", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife' })).outputFiles[0].text;
});
test.afterAll(async () => { await browser?.close(); });
const html = '<section id="studio"><input id="duration" value="600"><input id="interval" value="180"><label><input type="file" id="midroll-audio"></label><button id="audio-analyze">Analyze</button><p id="audio-info"></p></section><input id="native-studio-playhead" value="native-untouched"><button id="add-ad-break">Native add</button>';

test('fractional playhead needs a declared grid; local timeline navigation never controls Studio', async () => {
  const page = await browser.newPage(); let requests = 0; page.on('request', () => requests++);
  await page.setContent(html); await page.evaluate(() => { (window as unknown as { changes: number; nativeClicks: number }).changes = 0; (window as unknown as { nativeClicks: number }).nativeClicks = 0; document.querySelector('#add-ad-break')!.addEventListener('click', () => (window as unknown as { nativeClicks: number }).nativeClicks++); });
  await page.addScriptTag({ content: bundle });
  await page.locator('#midroll-mode').selectOption('quantity'); await page.locator('#midroll-quantity').fill('2');
  await page.locator('#midroll-include-playhead').check(); await page.locator('#midroll-playhead').fill('250.5');
  await expect(page.locator('#midroll-timeline-selected')).toContainText('fracionária');
  await expect(page.locator('#midroll-timeline-track button')).toHaveCount(0);
  await page.locator('#midroll-position-precision').selectOption('frames');
  await expect(page.locator('#midroll-timeline-selected')).toContainText('FPS');
  await page.locator('#midroll-position-fps').fill('30');
  const plan = await page.evaluate(() => (window as unknown as { tools: { getPlan(): unknown } }).tools.getPlan());
  expect(plan).toMatchObject({ positions: [200, 250.5, 400], positionPrecision: 'frames', positionFps: 30, analysisFps: undefined });
  await expect(page.locator('#midroll-timeline-track button')).toHaveCount(3);
  await page.getByRole('button', { name: 'Selecionar marcador 2: 250.5 segundos da prévia local' }).click();
  await expect(page.locator('#midroll-timeline-position')).toHaveValue('250.5'); await expect(page.locator('#midroll-timeline-selected')).toContainText('Marcador 2/3 selecionado');
  await page.locator('#midroll-timeline-position').fill('300.5'); await page.locator('#midroll-timeline-seek').click();
  await expect(page.locator('#midroll-timeline-selected')).toContainText('Cursor local: 300.5 s');
  await expect(page.locator('#midroll-playhead')).toHaveValue('250.5');
  await page.locator('#midroll-timeline-next').click(); await expect(page.locator('#midroll-timeline-position')).toHaveValue('400');
  await page.locator('#midroll-timeline-previous').click(); await expect(page.locator('#midroll-timeline-position')).toHaveValue('250.5');
  await page.locator('#midroll-timeline-position').fill('300.5'); await page.locator('#midroll-timeline-seek').click(); await page.locator('#midroll-use-local-playhead').click();
  await expect(page.locator('#midroll-playhead')).toHaveValue('300.5');
  expect(await page.evaluate(() => (window as unknown as { tools: { getPlan(): { positions: number[] } } }).tools.getPlan().positions)).toEqual([200, 300.5, 400]);
  await expect(page.locator('#native-studio-playhead')).toHaveValue('native-untouched'); expect(await page.evaluate(() => (window as unknown as { nativeClicks: number }).nativeClicks)).toBe(0); expect(requests).toBe(0);
  await page.close();
});

test('local seek validates frame precision and edges without silently changing the planned playhead', async () => {
  const page = await browser.newPage(); await page.setContent(html); await page.addScriptTag({ content: bundle });
  await page.locator('#midroll-position-precision').selectOption('frames'); await page.locator('#midroll-position-fps').fill('30');
  await page.locator('#midroll-timeline-position').fill('250.51'); await page.locator('#midroll-timeline-seek').click();
  await expect(page.locator('#midroll-timeline-selected')).toContainText('manteve a posição anterior');
  await page.locator('#midroll-timeline-position').fill('0'); await page.locator('#midroll-timeline-seek').click(); await page.locator('#midroll-use-local-playhead').click();
  await expect(page.locator('#audio-info')).toContainText('fora da faixa'); await expect(page.locator('#midroll-include-playhead')).not.toBeChecked();
  await page.locator('#midroll-timeline-position').fill('599'); await page.locator('#midroll-timeline-seek').click(); await page.locator('#midroll-use-local-playhead').click();
  await expect(page.locator('#midroll-playhead')).toHaveValue('599');
  await page.locator('#midroll-position-fps').fill('29.97'); await expect(page.locator('#midroll-timeline-track button')).toHaveCount(0); await expect(page.locator('#midroll-use-local-playhead')).toBeDisabled();
  await page.close();
});
