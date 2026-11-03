import { test, expect, chromium, type Browser, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { TranscriptExtras } from '../../src/ui/transcript-extra';
import type { TranscriptInputSource } from '../../src/core/transcript';

interface FixtureWindow { sourceFixture: { state: { source: TranscriptInputSource }; snapshot: { title: string; url: string; videoId: string }; tools: TranscriptExtras; attempts: number }; }
let browser: Browser, bundle: string;
test.beforeAll(async () => {
  browser = await chromium.launch({ executablePath: process.env.PREVLEV_CHROMIUM_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] });
  bundle = (await build({ stdin: { contents: `import {initTranscriptExtras} from './src/ui/transcript-extra'; import {parseTranscriptImport,transcriptText,type TranscriptInputSource} from './src/core/transcript';
    const area=document.querySelector<HTMLTextAreaElement>('#transcript-text')!,file=document.querySelector<HTMLInputElement>('#transcript-file')!;
    let segments=[{start:1,duration:2,text:'Texto observado da coleta A'}];
    const snapshot={title:'Título privado da coleta A',url:'https://www.youtube.com/watch?v=abcdefghijk',videoId:'abcdefghijk',videos:[],comments:[],transcript:segments,warnings:[]};
    const state={source:{kind:'observed-page',videoAssociation:'observed'} as TranscriptInputSource};
    const fixture={state,snapshot,tools:undefined,attempts:0}; area.value=transcriptText(segments);
    area.addEventListener('input',()=>{state.source={...state.source,kind:'edited-text',videoAssociation:'none'};});
    const tools=initTranscriptExtras({segments:()=>segments,text:()=>area.value,metadata:()=>snapshot,inputSource:()=>state.source,aiContext:()=>'',aiProvenance:()=>({model:'fixture:text',origin:'http://127.0.0.1:7814',backendOrigin:'http://127.0.0.1:8787'})}); fixture.tools=tools;
    file.addEventListener('change',async()=>{const selected=file.files?.[0];if(!selected)return;segments=parseTranscriptImport(await selected.text());area.value=transcriptText(segments);state.source={kind:'imported-file',fileName:selected.name,importedAt:'2026-11-03T12:00:00Z',videoAssociation:'none'};tools.invalidate();});
    document.querySelector('#associate')!.addEventListener('click',()=>{if(state.source.kind==='observed-page')return;state.source={...state.source,videoAssociation:'user-declared'};tools.invalidate();});
    document.querySelector('#generate')!.addEventListener('click',()=>{const request=tools.beginAi('transcript-summary');if(request.cached)return;fixture.attempts++;tools.completeAi('transcript-summary',{status:'ok',source:'fixture:ai',data:{text:'Resumo fixture '+fixture.attempts,model:'fixture:text',generated:true}},request.requestId);});
    Object.assign(window,{sourceFixture:fixture});`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife' })).outputFiles[0].text;
});
test.afterAll(async () => { await browser?.close(); });
async function fixture() {
  const page = await browser.newPage({ acceptDownloads: true }), requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.setContent('<div class="card"><textarea id="transcript-text"></textarea><input id="transcript-file" type="file" accept=".vtt,.srt"><pre id="transcript-result"></pre><button id="associate">Associar explicitamente à coleta</button><button id="generate">Gerar fixture</button></div>');
  await page.addScriptTag({ content: bundle });
  return { page, requests };
}
async function exported(page: Page, id = 'export-json') {
  const waiting = page.waitForEvent('download'); await page.locator(`#transcript-${id}`).click();
  const download = await waiting; return readFile((await download.path())!, 'utf8');
}
async function importFile(page: Page) {
  await page.locator('#transcript-file').setInputFiles({ name: 'legendas próprias.vtt', mimeType: 'text/vtt', buffer: Buffer.from('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nFala importada\n\n00:00:04.000 --> 00:00:05.000\nOutra fala importada\n') });
  await expect(page.locator('#transcript-input-source')).toContainText('arquivo importado');
}

test('file exports stay unassociated until an explicit declaration; editing removes the declaration and cached results', async () => {
  const { page, requests } = await fixture(); await importFile(page);
  const unknown = JSON.parse(await exported(page));
  expect(unknown).toMatchObject({ title: 'Transcrição importada: legendas próprias.vtt', videoUrl: null, videoId: null, inputSource: { kind: 'imported-file', fileName: 'legendas próprias.vtt', videoAssociation: 'none' } });
  for (const content of [JSON.stringify(unknown), await exported(page, 'export-csv'), await exported(page, 'metadata-md')]) { expect(content).not.toContain('abcdefghijk'); expect(content).not.toContain('Título privado da coleta A'); expect(content).toContain('imported-file'); }
  await page.locator('#generate').click();
  let generated = JSON.parse(await exported(page)); expect(generated.aiResults[0].context).toMatchObject({ videoUrl: null, videoId: null, inputSource: { videoAssociation: 'none' } });
  await page.evaluate(() => { const snapshot = (window as unknown as FixtureWindow).sourceFixture.snapshot; snapshot.title = 'Título privado da coleta B'; snapshot.videoId = 'bbbbbbbbbbb'; snapshot.url = 'https://www.youtube.com/watch?v=bbbbbbbbbbb'; });
  await page.locator('#generate').click(); expect(await page.evaluate(() => (window as unknown as FixtureWindow).sourceFixture.attempts)).toBe(1);
  await page.locator('#associate').click(); await expect(page.locator('#transcript-copy-summary')).toBeDisabled();
  await expect(page.locator('#transcript-input-source')).toContainText('declarada pelo usuário');
  const declared = JSON.parse(await exported(page)); expect(declared).toMatchObject({ title: 'Título privado da coleta B', videoId: 'bbbbbbbbbbb', videoUrl: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', inputSource: { videoAssociation: 'user-declared' } }); expect(declared).not.toHaveProperty('aiResults');
  await page.locator('#generate').click(); generated = JSON.parse(await exported(page)); expect(generated.aiResults[0].context).toMatchObject({ videoId: 'bbbbbbbbbbb', inputSource: { videoAssociation: 'user-declared' } });
  await page.locator('#transcript-text').fill('Texto editado pelo usuário, sem horários.');
  await expect(page.locator('#transcript-copy-summary')).toBeDisabled(); await expect(page.locator('#transcript-input-source')).toContainText('texto editado');
  const edited = JSON.parse(await exported(page)); expect(edited).toMatchObject({ title: 'Transcrição editada', videoUrl: null, videoId: null, segments: [], inputSource: { kind: 'edited-text', videoAssociation: 'none' } }); expect(edited).not.toHaveProperty('aiResults');
  expect(await exported(page, 'metadata-md')).not.toContain('Título privado da coleta B'); expect(await page.evaluate(() => (window as unknown as FixtureWindow).sourceFixture.attempts)).toBe(2); expect(requests).toEqual([]); await page.close();
});

test('source changes invalidate cache and late results even without an invalidation event; invalid provenance cannot export', async () => {
  const { page, requests } = await fixture(); await importFile(page); await page.locator('#generate').click();
  await page.evaluate(() => { (window as unknown as FixtureWindow).sourceFixture.state.source.fileName = 'outro arquivo.vtt'; });
  expect(JSON.parse(await exported(page))).not.toHaveProperty('aiResults'); await expect(page.locator('#transcript-copy-summary')).toBeDisabled();
  await page.evaluate(() => {
    const fixture = (window as unknown as FixtureWindow).sourceFixture, request = fixture.tools.beginAi('transcript-topics');
    fixture.state.source = { ...fixture.state.source, videoAssociation: 'user-declared' };
    fixture.tools.completeAi('transcript-topics', { status: 'ok', source: 'fixture:ai', data: { text: 'LATE_SOURCE_DO_NOT_EXPORT', model: 'fixture:text' } }, request.requestId);
  });
  expect(await exported(page)).not.toContain('LATE_SOURCE_DO_NOT_EXPORT');
  const downloads: string[] = []; page.on('download', download => downloads.push(download.suggestedFilename()));
  await page.evaluate(() => { (window as unknown as FixtureWindow).sourceFixture.state.source.importedAt = '2026-02-30T12:00:00Z'; });
  await page.locator('#transcript-export-json').click(); await expect(page.locator('#transcript-ai-state')).toContainText('Proveniência de transcrição inválida');
  expect(downloads).toEqual([]); expect(requests).toEqual([]); await page.close();
});
