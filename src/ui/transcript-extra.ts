import type {PageSnapshot,RemoteResponse,TranscriptSegment} from '../shared/types';
import {parseTranscript,transcriptText,transcriptExport,transcriptCsv,transcriptMarkdown,transcriptSrt,transcriptAiProvenance,type TranscriptAiFeature,type TranscriptAiProvenance,type TranscriptAiResult} from '../core/transcript';
import {downloadBlob} from '../core/media';

export type {TranscriptAiFeature,TranscriptAiProvenance} from '../core/transcript';
export interface TranscriptExtras {invalidate():void;beginAi(feature:TranscriptAiFeature):{cached:boolean;requestId:number};completeAi(feature:TranscriptAiFeature,result:RemoteResponse,requestId:number):void;failAi(feature:TranscriptAiFeature,error:unknown,requestId:number):void;}
interface Dependencies {segments:()=>TranscriptSegment[];text:()=>string;metadata:()=>PageSnapshot;aiContext?:()=>string;aiProvenance?:()=>TranscriptAiProvenance;}
interface CachedAiEntry {key:string;result:TranscriptAiResult;}
interface PendingAi {feature:TranscriptAiFeature;requestId:number;key:string;provenance:ReturnType<typeof transcriptAiProvenance>;context:TranscriptAiResult['context'];}
const mounted=new WeakMap<Element,TranscriptExtras>();
const labels:Record<TranscriptAiFeature,string>={'transcript-summary':'Resumo','transcript-topics':'Tópicos','transcript-script':'Roteiro'};
export function initTranscriptExtras(deps:Dependencies):TranscriptExtras {
  const textarea=document.getElementById('transcript-text') as HTMLTextAreaElement|null,card=textarea?.closest('.card');
  if(!textarea||!card)throw new Error('O painel de transcrição não está disponível.');
  const existing=mounted.get(card);if(existing)return existing;
  let cache=new Map<TranscriptAiFeature,CachedAiEntry>(),pending:PendingAi|undefined,serial=0;
  const host=document.createElement('div');host.id='transcript-extras';host.innerHTML=`<div class="actions"><button id="transcript-copy-timestamps">Copiar timestamps + texto</button><button id="transcript-export-json">JSON com metadados</button><button id="transcript-export-csv">CSV com timestamps</button><button id="transcript-metadata-md">Markdown com metadados</button><button id="transcript-srt">Baixar SRT</button></div><p class="muted">Metadados usam o contexto da coleta atual. Horários só acompanham o texto original sem edição ou legendas importadas com timestamps. Finais desconhecidos não recebem duração inventada. JSON, CSV e Markdown incluem apenas resumo, tópicos e roteiro já gerados e ainda válidos nesta sessão, separados do texto original e com procedência; exportar nunca gera IA.</p><div class="actions"><button id="transcript-copy-summary" disabled>Copiar resumo</button><button id="transcript-copy-topics" disabled>Copiar tópicos</button><button id="transcript-copy-script" disabled>Copiar roteiro</button><button id="transcript-ai-back">Voltar à transcrição</button></div><p id="transcript-ai-state" role="status" aria-live="polite">Resumo, tópicos e roteiro só são gerados após os botões explícitos de IA. Nenhum resultado em cache foi carregado.</p>`;card.append(host);
  const get=<T extends HTMLElement=HTMLElement>(id:string)=>host.querySelector<T>(`#transcript-${id}`)!;
  const output=document.getElementById('transcript-result')!;
  const status=(value:string,error=false)=>{get('ai-state').textContent=value;get('ai-state').classList.toggle('error',error);};
  const timed=()=>{const current=deps.text(),segments=deps.segments();return current===transcriptText(segments)?segments:parseTranscript(current);};
  const metadata=()=>{const snapshot=deps.metadata();return {title:snapshot.title||'Transcrição',videoUrl:snapshot.url,videoId:snapshot.videoId};};
  const provenance=()=>transcriptAiProvenance(deps.aiProvenance?.());
  const context=()=>JSON.stringify({text:deps.text(),segments:timed(),url:deps.metadata().url,videoId:deps.metadata().videoId,ai:deps.aiContext?.()??'',provenance:provenance()});
  const updateCopies=()=>{for(const [feature,id]of [['transcript-summary','copy-summary'],['transcript-topics','copy-topics'],['transcript-script','copy-script']]as const)get<HTMLButtonElement>(id).disabled=cache.get(feature)?.key!==context();};
  const invalidate=()=>{cache=new Map();pending=undefined;serial++;output.textContent='';output.hidden=false;updateCopies();status('Conteúdo ou contexto alterado. Os resultados anteriores foram descartados.');};
  const show=(feature:TranscriptAiFeature,entry:CachedAiEntry,cached=false)=>{output.hidden=false;output.textContent=entry.result.text;status(`${labels[feature]} ${cached?'recuperado do cache desta sessão':'concluído'} · ${entry.result.source??'fonte desconhecida'}. Revise o conteúdo gerado.`);};
  const controller:TranscriptExtras={
    invalidate,
    beginAi(feature){
      const key=context(),stored=cache.get(feature);
      if(stored?.key===key){show(feature,stored,true);return {cached:true,requestId:0};}
      if(pending)throw new Error('Aguarde a análise atual concluir antes de iniciar outra.');
      if(!deps.text().trim())throw new Error('Colete ou importe uma transcrição antes de solicitar IA.');
      for(const [name,entry]of cache)if(entry.key!==key)cache.delete(name);updateCopies();
      const requestId=++serial,report=transcriptExport(timed(),metadata(),{},deps.text());
      pending={feature,requestId,key,provenance:provenance(),context:{videoUrl:report.videoUrl,videoId:report.videoId,inputKind:report.timestampsAvailable?'timed-transcript':'plain-text',inputCharacters:report.text.length,segmentCount:report.segments.length}};
      output.hidden=false;output.textContent='';status(`${labels[feature]} em processamento no backend escolhido…`);return {cached:false,requestId};
    },
    completeAi(feature,result,requestId){
      if(!pending||pending.feature!==feature||pending.requestId!==requestId)return;
      const active=pending;pending=undefined;
      if(active.key!==context()){invalidate();status('A entrada mudou durante a análise. O resultado antigo foi descartado.');return;}
      const data=result.data&&typeof result.data==='object'?result.data as Record<string,unknown>:{};
      if(result.status!=='ok'||typeof data.text!=='string'||!data.text.trim()){status(result.error??'A IA não retornou texto concluído. Nenhum resultado foi colocado em cache.',true);return;}
      const model=typeof data.model==='string'&&data.model.trim()&&data.model.length<=500?data.model:null;
      if(model&&active.provenance.model&&model!==active.provenance.model){status('O modelo retornado difere da seleção da solicitação. Nenhum resultado foi colocado em cache.',true);return;}
      const entry:CachedAiEntry={key:active.key,result:{feature,text:data.text,generated:true,source:typeof result.source==='string'?result.source:null,model,requestedModel:active.provenance.model,origin:active.provenance.origin,backendOrigin:active.provenance.backendOrigin,receivedAt:new Date().toISOString(),context:active.context}};
      cache.set(feature,entry);show(feature,entry);updateCopies();
    },
    failAi(feature,error,requestId){if(pending?.feature!==feature||pending.requestId!==requestId)return;pending=undefined;status(error instanceof Error?error.message:'Não foi possível concluir a análise.',true);},
  };
  const perform=(task:()=>unknown)=>{void Promise.resolve().then(task).catch(error=>status(error instanceof Error?error.message:'A operação local falhou.',true));};
  const copy=async(text:string)=>{if(!navigator.clipboard?.writeText)throw new Error('Área de transferência indisponível neste navegador.');await navigator.clipboard.writeText(text);};
  get('copy-timestamps').addEventListener('click',()=>perform(async()=>{const segments=timed();if(!segments.length)throw new Error('Timestamps originais indisponíveis para o texto atual.');await copy(transcriptText(segments,true));status('Texto com timestamps originais copiado.');}));
  for(const [feature,id]of [['transcript-summary','copy-summary'],['transcript-topics','copy-topics'],['transcript-script','copy-script']]as const)get(id).addEventListener('click',()=>perform(async()=>{const entry=cache.get(feature);if(!entry||entry.key!==context()){invalidate();throw new Error('O conteúdo mudou; gere novamente antes de copiar este resultado.');}await copy(entry.result.text);status(`${labels[feature]} copiado separadamente da transcrição.`);}));
  get('ai-back').addEventListener('click',()=>{output.textContent='';status('Transcrição original exibida. Resultados válidos continuam disponíveis para cópia nesta sessão.');textarea.focus();});
  const save=(content:string,name:string,type:string)=>downloadBlob(new Blob([content],{type}),name);
  const exportMetadata=()=>{
    const key=context();for(const [feature,entry]of cache)if(entry.key!==key)cache.delete(feature);updateCopies();
    return {...metadata(),aiResults:[...cache.values()].filter(entry=>entry.key===key).map(entry=>entry.result)};
  };
  get('export-json').addEventListener('click',()=>perform(()=>{if(!deps.text().trim())throw new Error('Nenhum texto disponível.');save(JSON.stringify(transcriptExport(timed(),exportMetadata(),{},deps.text()),null,2),'prevlev-transcricao.json','application/json');status('JSON exportado com contexto, horários conhecidos e resultados de IA válidos já disponíveis. Nenhuma geração foi iniciada.');}));
  get('export-csv').addEventListener('click',()=>perform(()=>{const text=deps.text();if(!text.trim())throw new Error('Nenhum texto disponível.');save(transcriptCsv(timed(),exportMetadata(),{},text),'prevlev-transcricao.csv','text/csv;charset=utf-8');status('CSV exportado com a transcrição e cada resultado de IA válido em uma linha separada, sem timestamps inventados. Nenhuma geração foi iniciada.');}));
  get('metadata-md').addEventListener('click',()=>perform(()=>{const text=deps.text();if(!text.trim())throw new Error('Nenhum texto disponível.');const meta=exportMetadata();save(transcriptMarkdown(timed(),meta.title,meta,text),'prevlev-transcricao-metadados.md','text/markdown;charset=utf-8');status('Markdown exportado com transcrição, metadados e resultados de IA válidos já disponíveis. Nenhuma geração foi iniciada.');}));
  get('srt').addEventListener('click',()=>perform(()=>{const segments=timed(),report=transcriptExport(segments,metadata()),content=transcriptSrt(segments);if(!content)throw new Error('Nenhum cue tem fim conhecido. Use JSON para conservar texto e inícios desconhecidos.');save(content,'prevlev-transcricao.srt','application/x-subrip;charset=utf-8');const omitted=report.segments.filter(segment=>segment.end===null).length;status(`SRT exportado.${omitted?` ${omitted} cue(s) sem fim conhecido foram omitidos; JSON conserva todos os textos.`:''}`);}));
  textarea.addEventListener('input',invalidate);
  const file=document.getElementById('transcript-file') as HTMLInputElement|null;if(file&&!file.accept.includes('.srt'))file.accept+=',.srt';
  mounted.set(card,controller);return controller;
}
