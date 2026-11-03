// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {transcriptCsv,transcriptExport,transcriptMarkdown,transcriptRows,transcriptText,type TranscriptAiFeature,type TranscriptAiResult} from '../src/core/transcript';
import {initTranscriptExtras} from '../src/ui/transcript-extra';
import {downloadBlob} from '../src/core/media';
import type {PageSnapshot} from '../src/shared/types';
vi.mock('../src/core/media',()=>({downloadBlob:vi.fn()}));
const url='https://www.youtube.com/watch?v=abcdefghijk';
const segments=[{start:1,duration:2,text:'Original 🪐'},{start:4,duration:0,text:'Último sem fim'}];
const text=transcriptText(segments);
const metadata={title:'Título observado',videoUrl:url,videoId:'abcdefghijk',exportedAt:'2026-11-03T12:00:00.000Z'};
const features:TranscriptAiFeature[]=['transcript-summary','transcript-topics','transcript-script'];
function result(feature:TranscriptAiFeature='transcript-summary',content='Resumo fornecido pela fixture'):TranscriptAiResult{return {feature,text:content,generated:true,source:'fixture:ai',model:'fixture:text',requestedModel:'fixture:text',origin:'http://127.0.0.1:7814',backendOrigin:'http://127.0.0.1:8787',receivedAt:'2026-11-03T11:59:00.000Z',context:{videoUrl:url,videoId:'abcdefghijk',inputKind:'timed-transcript',inputCharacters:text.length,segmentCount:segments.length}};}
afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();vi.mocked(downloadBlob).mockClear();});
describe('transcript exports include existing generated results separately',()=>{
 it('extends schema1 additively while preserving original timestamps and unknown final ends',()=>{
  const original=transcriptExport(segments,metadata);
  expect(original).not.toHaveProperty('aiResults');
  const report=transcriptExport(segments,{...metadata,aiResults:features.map(feature=>result(feature))});
  expect(report).toMatchObject({schemaVersion:1,kind:'transcript-export',text,videoUrl:url,videoId:'abcdefghijk'});
  expect(report.segments).toEqual(original.segments);expect(report.segments[1]).toMatchObject({end:null,endBasis:'unknown'});
  expect(report.aiResults).toHaveLength(3);expect(report.aiResults?.[0]).toMatchObject({generated:true,model:'fixture:text',source:'fixture:ai',origin:'http://127.0.0.1:7814',backendOrigin:'http://127.0.0.1:8787',context:{inputCharacters:text.length,segmentCount:2}});
  expect(report.aiResults?.[0]).not.toHaveProperty('start');
 });
 it('writes each AI result once in CSV with provenance columns and no borrowed timestamps',()=>{
  const meta={...metadata,aiResults:features.map(feature=>result(feature,`${feature} fixture`))},rows=transcriptRows(segments,meta),csv=transcriptCsv(segments,meta);
  expect(rows).toHaveLength(5);expect(rows.slice(0,2).every(row=>row.kind==='transcript-segment')).toBe(true);
  for(const row of rows.slice(2)){expect(row.kind).toBe('generated-ai');expect(row.generated).toBe(true);expect(row).not.toHaveProperty('start');expect(row).not.toHaveProperty('endTimestamp');}
  expect(csv).toContain('"aiSource"');expect(csv).toContain('"aiModel"');expect(csv).toContain('"aiOrigin"');expect(csv).toContain('"aiBackendOrigin"');expect(csv).toContain('"aiContextInputCharacters"');
  expect(csv).toContain('"00:00:01.000"');expect(csv).toContain('"00:00:04.000"');
  for(const feature of features)expect(csv.split(`${feature} fixture`)).toHaveLength(2);
  const formula=transcriptCsv(segments,{...metadata,aiResults:[result('transcript-summary','=HYPERLINK("https://example.invalid")')]});expect(formula).toContain('"\'=HYPERLINK');
 });
 it('labels generated Markdown and fences untrusted generated text without treating it as transcript',()=>{
  const content='```\n# Não é título do documento\n<script>untrusted()</script>\n```',markdown=transcriptMarkdown(segments,metadata.title,{...metadata,aiResults:[result('transcript-summary',content)]});
  expect(markdown).toContain('## Resumo · gerado por IA');expect(markdown).toContain('Modelo confirmado: fixture:text');expect(markdown).toContain('Backend: http://127.0.0.1:8787');expect(markdown).toContain(`\`\`\`\`text\n${content}\n\`\`\`\``);expect(markdown).toContain('não recebe timestamps');
 });
 it('keeps unknown provenance null and filters results attached to another video or material',()=>{
  const unknown={...result(),source:null,model:null,requestedModel:null,origin:'https://user:secret@example.invalid',backendOrigin:'http://127.0.0.1:8787/?token=secret'};
  const report=transcriptExport(segments,{...metadata,aiResults:[unknown]});
  expect(report.aiResults?.[0]).toMatchObject({source:null,model:null,requestedModel:null,origin:null,backendOrigin:null});expect(JSON.stringify(report)).not.toContain('secret');
  expect(transcriptExport(segments,{...metadata,videoId:'bbbbbbbbbbb',aiResults:[result()]})).not.toHaveProperty('aiResults');
  expect(transcriptExport(segments,{...metadata,aiResults:[{...result(),context:{...result().context,inputCharacters:1}}]})).not.toHaveProperty('aiResults');
 });
});
function fixture(plain=false){
 document.body.innerHTML='<div class="card"><textarea id="transcript-text"></textarea><input id="transcript-file" accept=".vtt"><pre id="transcript-result"></pre></div>';
 const textarea=document.getElementById('transcript-text')as HTMLTextAreaElement;textarea.value=plain?'Texto sem horários conhecidos':text;
 const snapshot:PageSnapshot={url,title:'Título observado',videoId:'abcdefghijk',videos:[],comments:[],transcript:plain?[]:segments,warnings:[]};
 const state={model:'fixture:text',origin:'http://127.0.0.1:7814',backendOrigin:'http://127.0.0.1:8787'};let attempts=0;
 const tools=initTranscriptExtras({segments:()=>snapshot.transcript,text:()=>textarea.value,metadata:()=>snapshot,aiContext:()=>'',aiProvenance:()=>({...state})});
 const complete=(feature:TranscriptAiFeature,content=`Texto gerado: ${feature}`,model=state.model)=>{const request=tools.beginAi(feature);if(!request.cached){attempts++;tools.completeAi(feature,{status:'ok',source:'fixture:ai',data:{text:content,model,generated:true}},request.requestId);}return request;};
 return {tools,complete,textarea,snapshot,state,attempts:()=>attempts};
}
async function exported(button='export-json'):Promise<string>{
 vi.mocked(downloadBlob).mockClear();document.getElementById(`transcript-${button}`)!.click();
 await vi.waitFor(()=>expect(downloadBlob).toHaveBeenCalledOnce());
 const blob=vi.mocked(downloadBlob).mock.calls[0][0];return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsText(blob);});
}
describe('explicit exports inspect only the current valid cache',()=>{
 it('exports all three cached result types with selected/confirmed provenance without a request',async()=>{
  const f=fixture(),fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  for(const feature of features)f.complete(feature);
  const report=JSON.parse(await exported());expect(report.aiResults).toHaveLength(3);
  expect(report.aiResults[0]).toMatchObject({generated:true,source:'fixture:ai',model:'fixture:text',requestedModel:'fixture:text',origin:f.state.origin,backendOrigin:f.state.backendOrigin,context:{videoUrl:url,videoId:'abcdefghijk',inputCharacters:text.length,segmentCount:2}});
  expect(Number.isFinite(Date.parse(report.aiResults[0].receivedAt))).toBe(true);
  expect(await exported('export-csv')).toContain('generated-ai');expect(await exported('metadata-md')).toContain('gerado por IA');
  expect(f.attempts()).toBe(3);expect(fetcher).not.toHaveBeenCalled();
 });
 it.each(['text','video','model','origin','backend']as const)('omits cached output after changing %s even without a UI invalidation event',async kind=>{
  const f=fixture();f.complete('transcript-summary','STALE_DO_NOT_EXPORT');
  if(kind==='text')f.textarea.value='x'.repeat(text.length);
  if(kind==='video'){f.snapshot.url='https://www.youtube.com/watch?v=bbbbbbbbbbb';f.snapshot.videoId='bbbbbbbbbbb';}
  if(kind==='model')f.state.model='fixture:other';
  if(kind==='origin')f.state.origin='http://127.0.0.1:7815';
  if(kind==='backend')f.state.backendOrigin='http://127.0.0.1:8899';
  const report=await exported();expect(report).not.toContain('STALE_DO_NOT_EXPORT');expect(JSON.parse(report)).not.toHaveProperty('aiResults');expect((document.getElementById('transcript-copy-summary')as HTMLButtonElement).disabled).toBe(true);expect(f.attempts()).toBe(1);
 });
 it('exports a plain transcript and generated CSV row with no invented original timestamps',async()=>{
  const f=fixture(true);f.complete('transcript-summary');
  const report=JSON.parse(await exported());expect(report.timestampsAvailable).toBe(false);expect(report.segments).toEqual([]);expect(report.aiResults[0].context).toMatchObject({inputKind:'plain-text',segmentCount:0});
  const csv=await exported('export-csv');expect(csv).toContain('transcript-plain-text');expect(csv).toContain('generated-ai');expect(csv).not.toContain('startTimestamp');expect(csv).not.toContain('00:00:');
  expect(await exported('metadata-md')).toContain('## Transcrição sem timestamps');
 });
 it('does not export a pending response, failed response or a model mismatch',async()=>{
  const f=fixture(),request=f.tools.beginAi('transcript-summary');
  expect(JSON.parse(await exported())).not.toHaveProperty('aiResults');
  f.state.backendOrigin='http://127.0.0.1:8899';f.tools.completeAi('transcript-summary',{status:'ok',source:'fixture',data:{text:'LATE_STALE',model:'fixture:text'}},request.requestId);
  expect(await exported()).not.toContain('LATE_STALE');
  f.complete('transcript-topics','WRONG_MODEL','fixture:wrong');expect(await exported()).not.toContain('WRONG_MODEL');
  const failed=f.tools.beginAi('transcript-script');f.tools.completeAi('transcript-script',{status:'error',source:'fixture',error:'Não concluído'},failed.requestId);expect(JSON.parse(await exported())).not.toHaveProperty('aiResults');
 });
});
