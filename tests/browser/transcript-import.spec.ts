import { test, expect, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';

interface ImportFixture { segments: { start: number; duration: number; text: string }[]; markdown(): string }
let browser: Browser, context: BrowserContext, page: Page, bundle: string, unexpected: string[];
test.beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `import {parseTranscriptImport,transcriptText,transcriptMarkdown} from './src/core/transcript';
const state={segments:[{start:2,duration:1,text:'Entrada anterior preservada'}],markdown:()=>transcriptMarkdown(state.segments,'Transcrição fornecida')};Object.assign(window,{importFixture:state});
const text=document.querySelector('#text'),status=document.querySelector('#status');text.value=transcriptText(state.segments);
document.querySelector('#file').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{const input=await file.text(),next=parseTranscriptImport(input,{fileName:file.name});state.segments=next;text.value=next.length?transcriptText(next):input;status.textContent=next.length+' segmentos aplicados';}catch(error){status.textContent=error.message;}});`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife' })).outputFiles[0].text;
  browser = await chromium.launch({ executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] });
});
test.afterAll(async () => { await browser?.close(); });
test.beforeEach(async () => {
  unexpected = []; context = await browser.newContext();
  await context.route('**/*', route => {
    if (route.request().url() === 'http://transcript-import.test/') return route.fulfill({ contentType: 'text/html', body: '<input id="file" type="file"><textarea id="text"></textarea><p id="status" role="status"></p><script src="/bundle.js"></script>' });
    if (route.request().url() === 'http://transcript-import.test/bundle.js') return route.fulfill({ contentType: 'text/javascript', body: bundle });
    unexpected.push(route.request().url()); return route.abort();
  });
  page = await context.newPage(); await page.goto('http://transcript-import.test/');
});
test.afterEach(async () => { expect(unexpected).toEqual([]); await context.close(); });

test('a mixed valid/invalid VTT file reports the bad cue and preserves the previous input atomically', async () => {
  const input = 'WEBVTT\n\n00:00:03.125 --> 00:00:05.750\nParte válida\n\n00:00:09.000 --> 00:00:08.000\nParte inválida';
  await page.locator('#file').setInputFiles({ name: 'mixed.vtt', mimeType: 'text/vtt', buffer: Buffer.from(input) });
  await expect(page.locator('#status')).toContainText('linha 6'); await expect(page.locator('#status')).toContainText('nenhum trecho foi aplicado'); await expect(page.locator('#text')).toHaveValue('Entrada anterior preservada');
  expect(await page.evaluate(() => (window as unknown as { importFixture: ImportFixture }).importFixture.segments)).toEqual([{ start: 2, duration: 1, text: 'Entrada anterior preservada' }]);
  await page.locator('#file').setInputFiles({ name: 'malformed.srt', mimeType: 'application/x-subrip', buffer: Buffer.from('1\nBAD TIMING\nEsta fala não pode desaparecer') });
  await expect(page.locator('#status')).toContainText('sem linha de início/fim'); await expect(page.locator('#text')).toHaveValue('Entrada anterior preservada');
});

test('valid VTT/SRT files retain real fractional starts in parsed state and Markdown', async () => {
  await page.locator('#file').setInputFiles({ name: 'valid.vtt', mimeType: 'text/vtt', buffer: Buffer.from('WEBVTT\n\n00:00:03.125 --> 00:00:05.750\nFração real 🪐') });
  await expect(page.locator('#status')).toHaveText('1 segmentos aplicados'); await expect(page.locator('#text')).toHaveValue('Fração real 🪐');
  const result = await page.evaluate(() => { const state = (window as unknown as { importFixture: ImportFixture }).importFixture; return { start: state.segments[0].start, markdown: state.markdown() }; }); expect(result.start).toBe(3.125); expect(result.markdown).toContain('**00:00:03.125** Fração real 🪐');
  await page.locator('#file').setInputFiles({ name: 'valid.srt', mimeType: 'application/x-subrip', buffer: Buffer.from('1\n00:00:03,125 --> 00:00:05,750\nSRT fracionário') });
  await expect(page.locator('#text')).toHaveValue('SRT fracionário'); expect(await page.evaluate(() => (window as unknown as { importFixture: ImportFixture }).importFixture.markdown())).toContain('**00:00:03.125** SRT fracionário');
});
