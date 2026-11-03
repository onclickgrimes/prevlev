import {test,expect,chromium,type Browser,type Page} from '@playwright/test';
import {build} from 'esbuild';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
let browser:Browser,script:string;
interface FixtureWindow {__exports:{state:{model:string;origin:string;backendOrigin:string};snapshot:{url:string;videoId:string};attempts:number;};}
test.beforeAll(async()=>{
 browser=await chromium.launch({executablePath:process.env.PREVLEV_CHROMIUM_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
 script=(await build({stdin:{contents:`import {initTranscriptExtras} from './src/ui/transcript-extra';
 const segments=[{start:1,duration:2,text:'Texto original observado'},{start:4,duration:0,text:'Final desconhecido'}];
 const snapshot={url:'https://www.youtube.com/watch?v=abcdefghijk',title:'Transcrição fixture',videoId:'abcdefghijk',videos:[],comments:[],transcript:segments,warnings:[]};
 const fixture={state:{model:'fixture:text',origin:'http://127.0.0.1:7814',backendOrigin:'http://127.0.0.1:8787'},snapshot,attempts:0};
 const area=document.querySelector('#transcript-text');area.value=segments.map(segment=>segment.text).join('\\n');
 const tools=initTranscriptExtras({segments:()=>segments,text:()=>area.value,metadata:()=>snapshot,aiContext:()=>'',aiProvenance:()=>fixture.state});
 for(const [feature,text]of [['transcript-summary','Resumo fixture'],['transcript-topics','Tópicos fixture'],['transcript-script','Roteiro fixture']])document.querySelector('[data-generate="'+feature+'"]').addEventListener('click',()=>{const request=tools.beginAi(feature);if(request.cached)return;fixture.attempts++;tools.completeAi(feature,{status:'ok',source:'test:injected-ai',data:{text,model:fixture.state.model,generated:true}},request.requestId);});
 Object.assign(window,{__exports:fixture});`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife'})).outputFiles[0].text;
});
test.afterAll(async()=>{await browser?.close();});
async function fixture(){const page=await browser.newPage({acceptDownloads:true}),requests:string[]=[];await page.route('**/*',async route=>{requests.push(route.request().url());await route.abort();});await page.setContent('<div class="card"><textarea id="transcript-text"></textarea><input id="transcript-file" accept=".vtt"><pre id="transcript-result"></pre><button data-generate="transcript-summary">Resumo fixture</button><button data-generate="transcript-topics">Tópicos fixture</button><button data-generate="transcript-script">Roteiro fixture</button></div>');await page.addScriptTag({content:script});return{page,requests};}
async function exported(page:Page,id:string){const waiting=page.waitForEvent('download');await page.locator(`#transcript-${id}`).click();const download=await waiting;return{name:download.suggestedFilename(),text:await readFile((await download.path())!,'utf8')};}
test('explicit JSON CSV Markdown exports include all available outputs and provenance without generating or sending',async()=>{
 const{page,requests}=await fixture();
 const initial=JSON.parse((await exported(page,'export-json')).text);expect(initial).not.toHaveProperty('aiResults');expect(await page.evaluate(()=>(window as unknown as FixtureWindow).__exports.attempts)).toBe(0);
 for(const feature of ['transcript-summary','transcript-topics','transcript-script'])await page.locator(`[data-generate="${feature}"]`).click();
 const report=JSON.parse((await exported(page,'export-json')).text);expect(report.aiResults).toHaveLength(3);expect(report.segments[1]).toMatchObject({start:4,end:null,endBasis:'unknown'});
 expect(report.aiResults[0]).toMatchObject({feature:'transcript-summary',generated:true,text:'Resumo fixture',source:'test:injected-ai',model:'fixture:text',requestedModel:'fixture:text',origin:'http://127.0.0.1:7814',backendOrigin:'http://127.0.0.1:8787',context:{videoId:'abcdefghijk',inputKind:'timed-transcript',segmentCount:2}});
 const csv=await exported(page,'export-csv');expect(csv.name).toBe('prevlev-transcricao.csv');expect(csv.text).toContain('"aiOrigin"');expect(csv.text).toContain('"aiBackendOrigin"');expect(csv.text.match(/"generated-ai"/g)).toHaveLength(3);expect(csv.text.match(/Resumo fixture/g)).toHaveLength(1);
 const markdown=await exported(page,'metadata-md');expect(markdown.text).toContain('## Resumo · gerado por IA');expect(markdown.text).toContain('## Tópicos · gerado por IA');expect(markdown.text).toContain('## Roteiro · gerado por IA');expect(markdown.text).toContain('Backend: http://127.0.0.1:8787');expect(markdown.text).toContain('não recebe timestamps');
 expect(await page.evaluate(()=>(window as unknown as FixtureWindow).__exports.attempts)).toBe(3);expect(requests).toEqual([]);await page.close();
});
test('changed backend context excludes the old result from every export and plain text receives no original timestamps',async()=>{
 const{page,requests}=await fixture();await page.locator('[data-generate="transcript-summary"]').click();
 await page.evaluate(()=>{(window as unknown as FixtureWindow).__exports.state.backendOrigin='http://127.0.0.1:8899';});
 for(const id of ['export-json','export-csv','metadata-md'])expect((await exported(page,id)).text).not.toContain('Resumo fixture');
 await expect(page.locator('#transcript-copy-summary')).toBeDisabled();expect(await page.evaluate(()=>(window as unknown as FixtureWindow).__exports.attempts)).toBe(1);
 await page.locator('#transcript-text').fill('Transcrição editada sem horários');await page.locator('[data-generate="transcript-summary"]').click();
 const report=JSON.parse((await exported(page,'export-json')).text);expect(report.timestampsAvailable).toBe(false);expect(report.segments).toEqual([]);expect(report.aiResults[0]).toMatchObject({backendOrigin:'http://127.0.0.1:8899',context:{inputKind:'plain-text',segmentCount:0}});
 const csv=(await exported(page,'export-csv')).text;expect(csv).toContain('transcript-plain-text');expect(csv).not.toContain('startTimestamp');expect(csv).not.toContain('00:00:');
 expect(requests).toEqual([]);expect(await page.evaluate(()=>(window as unknown as FixtureWindow).__exports.attempts)).toBe(2);await page.close();
});
