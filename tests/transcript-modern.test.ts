// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {JSDOM} from 'jsdom';
import {parseTranscript,transcriptText,transcriptVtt,transcriptSrt,transcriptExport,transcriptRows,transcriptMarkdown,resolveTranscriptEnds} from '../src/core/transcript';
import {readVisibleTranscript} from '../src/content/youtube';
import {mountTimeline,type TimelineController} from '../src/content/timeline';
import {initTranscriptExtras} from '../src/ui/transcript-extra';
import type {PageSnapshot} from '../src/shared/types';
vi.mock('../src/core/media',()=>({captureFrame:vi.fn(),downloadBlob:vi.fn()}));
let controller:TimelineController|undefined;
afterEach(()=>{controller?.cleanup();controller=undefined;document.body.replaceChildren();vi.restoreAllMocks();});
const modern=(time:string,text:string)=>`<transcript-segment-view-model><div class="ytwTranscriptSegmentViewModelTimestamp">${time}</div><div class="ytwTranscriptSegmentViewModelText">${text}</div></transcript-segment-view-model>`;
function player(doc:Document){const video=doc.createElement('video');video.className='html5-main-video';Object.defineProperties(video,{duration:{value:100,configurable:true},paused:{value:true,writable:true,configurable:true}});video.play=vi.fn(async()=>{});video.pause=vi.fn();doc.body.prepend(video);return video;}

describe('parsers modernos, legados e arquivos com tempos reais',()=>{
 it('unifica DOM moderno e legado com Unicode, data-start-ms e timestamp0 sem duplicação de wrappers',()=>{
   const expected=[{start:0,duration:5.25,text:'Olá 🪐 café & chá'},{start:5.25,duration:0,text:'Segundo <script>'}];
   document.body.innerHTML=`${modern('0:00','Olá 🪐 café &amp; chá')}<transcript-segment-view-model data-start-ms="5250"><div class="ytwTranscriptSegmentViewModelTimestamp">?</div><div class="ytwTranscriptSegmentViewModelText">Segundo &lt;script&gt;</div></transcript-segment-view-model>`;
   expect(parseTranscript(document)).toEqual(expected);expect(readVisibleTranscript(document)).toEqual(expected);
   document.body.innerHTML='<ytd-transcript-segment-renderer><span class="segment-timestamp">0:00</span><span class="segment-text">Olá 🪐 café &amp; chá</span></ytd-transcript-segment-renderer><ytd-transcript-segment-renderer><span data-start="5.25">5.25</span><span class="segment-text">Segundo &lt;script&gt;</span></ytd-transcript-segment-renderer>';
   expect(readVisibleTranscript(document)).toEqual(expected);
 });
 it('lê Document de outra janela sem depender de instanceof global',()=>{
   const dom=new JSDOM(modern('1:02','Outra janela 🪐'));expect(parseTranscript(dom.window.document)).toEqual([{start:62,duration:0,text:'Outra janela 🪐'}]);dom.window.close();
 });
 it('preserva VTT com IDs/settings, NOTE, marcação de fala, UTF8 e milissegundos',()=>{
   const vtt='WEBVTT\r\n\r\nNOTE metadados que não são fala\r\n\r\ncue-a\r\n00:00:01.250 --> 00:00:03.750 align:start\r\n<v Pessoa><b>Olá</b> &amp; café 🪐</v>\r\nsegunda linha\r\n\r\n00:04.000 --> 00:05.500\r\nSegundo trecho';
   const parsed=parseTranscript(vtt);expect(parsed).toEqual([{start:1.25,duration:2.5,text:'Olá & café 🪐 segunda linha'},{start:4,duration:1.5,text:'Segundo trecho'}]);expect(parseTranscript(transcriptVtt(parsed))).toEqual(parsed);
 });
 it('preserva SRT em vez de transformar o arquivo em texto sem timestamps',()=>{
   const srt='1\r\n00:00:01,250 --> 00:00:02,750\r\nOlá mundo\r\n\r\n2\r\n00:01:02,000 --> 00:01:05,000\r\nOutra linha';const segments=parseTranscript(srt);expect(segments).toEqual([{start:1.25,duration:1.5,text:'Olá mundo'},{start:62,duration:3,text:'Outra linha'}]);expect(parseTranscript(transcriptSrt(segments))).toEqual(segments);
 });
 it('ignora cues inválidos e texto puro sem inventar horários',()=>{
   expect(parseTranscript('Texto puro sem timestamp')).toEqual([]);expect(parseTranscript('WEBVTT\n\n00:02.000 --> 00:01.000\nFim antes do início\n\n00:00:00.000 --> 00:00:01.000\nVálido')).toEqual([{start:0,duration:1,text:'Válido'}]);expect(()=>parseTranscript('a'.repeat(5_000_001))).toThrow('limite');
   expect(parseTranscript([{start:null,text:'Sem início real'},{start:'',text:'Também desconhecido'}])).toEqual([]);
 });
});

describe('finais de cue e metadados sem durações fabricadas',()=>{
 const segments=[{start:0,duration:0,text:'Primeiro'},{start:5,duration:0,text:'Último sem fim'}];
 it('usa próximo timestamp e omite final desconhecido com NOTE, conservando texto em JSON',()=>{
   const vtt=transcriptVtt(segments);expect(vtt).toContain('00:00:00.000 --> 00:00:05.000');expect(vtt).toContain('NOTE Prevlev');expect(vtt).not.toContain('00:00:05.000 -->');expect(vtt).not.toContain('00:00:07.000');
   const report=transcriptExport(segments);expect(report.segments[1]).toMatchObject({text:'Último sem fim',end:null,endBasis:'unknown'});expect(report.text).toContain('Último sem fim');expect(report.limitations.join(' ')).toContain('desconhecidos');
 });
 it('aceita fim real do player ou estimativa explicitamente escolhida sem silenciá-la',()=>{
   expect(transcriptVtt(segments,{playerEndSeconds:9})).toContain('00:00:05.000 --> 00:00:09.000');const estimated=transcriptVtt(segments,{estimateFinalSeconds:2});expect(estimated).toContain('00:00:05.000 --> 00:00:07.000');expect(estimated).toContain('estimada por opcao explicita');expect(resolveTranscriptEnds(segments,{playerEndSeconds:9})[1].endBasis).toBe('player-end');
 });
 it('exporta URL, data de exportação e inícios/finais explícitos em formatos estruturados',()=>{
   const metadata={title:'Título 🪐',videoUrl:'https://www.youtube.com/watch?v=abcdefghijk',exportedAt:'2026-11-03T12:00:00Z'},report=transcriptExport(segments,metadata);expect(report).toMatchObject({title:metadata.title,videoUrl:metadata.videoUrl,videoId:'abcdefghijk',exportedAt:'2026-11-03T12:00:00.000Z'});expect(transcriptRows(segments,metadata)[1]).toMatchObject({startTimestamp:'00:00:05.000',endTimestamp:null,videoUrl:metadata.videoUrl});expect(transcriptMarkdown(segments,metadata.title,metadata)).toContain('Exportado em: 2026-11-03T12:00:00.000Z');
 });
});

describe('timeline acumula virtualização e preserva identidade de seleção',()=>{
 it('A/B → B/C mantém A/B/C, seleção por timestamp, busca e atualização/reordenação determinística',()=>{
   const dom=new JSDOM(`<div id="loaded">${modern('0:01','Alpha')}${modern('0:05','Beta')}</div>`,{url:'https://www.youtube.com/watch?v=abcdefghijk'}),doc=dom.window.document;player(doc);controller=mountTimeline(doc);const shadow=doc.getElementById('prevlev-timeline')!.shadowRoot!,search=shadow.getElementById('search')as HTMLInputElement;search.value='Beta';search.dispatchEvent(new dom.window.Event('input'));const checkbox=shadow.querySelector<HTMLInputElement>('.segment input')!;checkbox.checked=true;checkbox.dispatchEvent(new dom.window.Event('change'));
   doc.getElementById('loaded')!.innerHTML=modern('0:10','Gamma')+modern('0:05','Beta atualizada');controller.refresh();expect(controller.getState().segments.map(item=>item.text)).toEqual(['Alpha','Beta atualizada','Gamma']);expect(search.value).toBe('Beta');expect(shadow.querySelector<HTMLInputElement>('.segment input')!.checked).toBe(true);expect(shadow.getElementById('count')!.textContent).toContain('1 selecionados');
   doc.getElementById('loaded')!.innerHTML=modern('0:00','Antes')+modern('0:05','Beta atualizada');controller.refresh();expect(controller.getState().segments.map(item=>item.text)).toEqual(['Antes','Alpha','Beta atualizada','Gamma']);expect(shadow.querySelector<HTMLInputElement>('.segment input')!.checked).toBe(true);
   dom.window.history.pushState(null,'','/watch?v=bbbbbbbbbbb');controller.refresh();expect(controller.getState().segments).toEqual([]);expect(search.value).toBe('');doc.getElementById('loaded')!.innerHTML=modern('0:02','Novo vídeo');controller.refresh();expect(controller.getState().segments.map(item=>item.text)).toEqual(['Novo vídeo']);controller.cleanup();controller=undefined;dom.window.close();
 });
 it('troca do elemento player no mesmo vídeo não apaga trechos já observados',()=>{
   const dom=new JSDOM(`<div id="loaded">${modern('0:01','Alpha')}${modern('0:05','Beta')}</div>`,{url:'https://www.youtube.com/watch?v=abcdefghijk'}),doc=dom.window.document;const old=player(doc);controller=mountTimeline(doc);old.remove();doc.getElementById('loaded')!.innerHTML=modern('0:10','Gamma');player(doc);controller.refresh();expect(controller.getState().segments.map(item=>item.text)).toEqual(['Alpha','Beta','Gamma']);controller.cleanup();controller=undefined;dom.window.close();
 });
 it('limita acumulação a5000 sem expulsar selecionados para aceitar dados novos',()=>{
   const dom=new JSDOM(`<div id="loaded">${Array.from({length:5001},(_,i)=>`<transcript-segment-view-model data-start="${i}"><div class="ytwTranscriptSegmentViewModelText">Trecho ${i}</div></transcript-segment-view-model>`).join('')}</div>`,{url:'https://www.youtube.com/watch?v=abcdefghijk'}),doc=dom.window.document;player(doc);controller=mountTimeline(doc);expect(controller.getState().segments).toHaveLength(5000);doc.getElementById('loaded')!.innerHTML=modern('02:00:00','Além do limite');controller.refresh();expect(controller.getState().segments).toHaveLength(5000);expect(controller.getState().segments[0].text).toBe('Trecho 0');expect(controller.getState().limitations.join(' ')).toContain('5000');controller.cleanup();controller=undefined;dom.window.close();
 });
});

describe('caches e cópias separados vinculados à entrada atual',()=>{
 function fixture(){document.body.innerHTML='<div class="card"><textarea id="transcript-text"></textarea><input id="transcript-file" accept=".vtt"><pre id="transcript-result"></pre></div>';const segments=[{start:1,duration:2,text:'Original 🪐'}],textarea=document.getElementById('transcript-text')as HTMLTextAreaElement;textarea.value=transcriptText(segments);const metadata:PageSnapshot={url:'https://www.youtube.com/watch?v=abcdefghijk',title:'Teste',videoId:'abcdefghijk',videos:[],comments:[],transcript:segments,warnings:[]};let model='fixture:a';const tools=initTranscriptExtras({segments:()=>segments,text:()=>textarea.value,metadata:()=>metadata,aiContext:()=>model});return {tools,textarea,metadata,model:(value:string)=>{model=value;}};}
 it('cacheia somente conclusão válida e distingue resumo/tópicos/roteiro sem chamadas próprias',()=>{
   const {tools}=fixture(),request=tools.beginAi('transcript-summary');expect(request.cached).toBe(false);expect(document.getElementById('transcript-ai-state')!.textContent).toContain('processamento');tools.completeAi('transcript-summary',{status:'ok',source:'fixture',data:{text:'Resumo de fixture'}},request.requestId);expect(tools.beginAi('transcript-summary').cached).toBe(true);expect((document.getElementById('transcript-copy-summary')as HTMLButtonElement).disabled).toBe(false);expect((document.getElementById('transcript-copy-script')as HTMLButtonElement).disabled).toBe(true);document.getElementById('transcript-ai-back')!.click();expect(document.getElementById('transcript-result')!.textContent).toBe('');expect(tools.beginAi('transcript-summary').cached).toBe(true);
 });
 it('invalida resultados por texto/modelo/vídeo e ignora respostas antigas',()=>{
   const {tools,textarea,metadata,model}=fixture(),request=tools.beginAi('transcript-summary');textarea.value='Editado';textarea.dispatchEvent(new Event('input'));tools.completeAi('transcript-summary',{status:'ok',source:'fixture',data:{text:'RESULTADO ANTIGO'}},request.requestId);expect(document.getElementById('transcript-result')!.textContent).toBe('');expect((document.getElementById('transcript-copy-summary')as HTMLButtonElement).disabled).toBe(true);
   const newer=tools.beginAi('transcript-topics');model('fixture:b');metadata.url='https://www.youtube.com/watch?v=bbbbbbbbbbb';tools.completeAi('transcript-topics',{status:'ok',source:'fixture',data:{text:'NÃO EXIBIR'}},newer.requestId);expect(document.getElementById('transcript-result')!.textContent).toBe('');expect(document.getElementById('transcript-ai-state')!.textContent).toContain('descartado');
 });
});
