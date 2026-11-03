import type { TranscriptSegment } from "../shared/types";
import { parseDuration, videoIdFromUrl } from "./parse.ts";
import { toCsv } from "./export";

export const TRANSCRIPT_ROW_SELECTOR = 'ytd-transcript-segment-renderer,transcript-segment-view-model,[data-transcript-segment],[data-prevlev-transcript-segment]';
export interface TranscriptTimingOptions {playerEndSeconds?:number;estimateFinalSeconds?:number;}
export type TranscriptAiFeature = 'transcript-summary' | 'transcript-topics' | 'transcript-script';
export interface TranscriptAiProvenance {model?:string;origin?:string;backendOrigin?:string;}
export interface TranscriptAiResult {
  feature:TranscriptAiFeature;text:string;generated:true;source:string|null;
  model:string|null;requestedModel:string|null;origin:string|null;backendOrigin:string|null;receivedAt:string;
  context:{videoUrl:string|null;videoId:string|null;inputKind:'timed-transcript'|'plain-text';inputCharacters:number;segmentCount:number;};
}
export interface TranscriptMetadata {title?:string;videoUrl?:string;videoId?:string;exportedAt?:string;aiResults?:readonly TranscriptAiResult[];}
export interface TimedTranscriptSegment extends TranscriptSegment {end:number|null;endBasis:'provided-duration'|'next-segment'|'player-end'|'estimated-opt-in'|'unknown';}
const numeric=(value:unknown):number|undefined=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value.trim())?Number(value):undefined;
function captionTime(value:string):number|undefined {const parts=value.trim().replace(',','.').split(':');if(parts.length<2||parts.length>3||!parts.every((part,index)=>index===parts.length-1?/^\d{1,2}(?:\.\d{1,9})?$/.test(part):/^\d+$/.test(part))||parts.slice(1).some(part=>Number(part)>=60))return undefined;return parts.reduce((total,part)=>total*60+Number(part),0);}
function captionDecode(value:string):string {return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/gi,entity=>{const named:Record<string,string>={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '};if(named[entity.toLowerCase()])return named[entity.toLowerCase()];const code=entity[2]?.toLowerCase()==='x'?parseInt(entity.slice(3,-1),16):Number(entity.slice(2,-1));return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):'�';});}
function captionFile(value:string):TranscriptSegment[] {const blocks=value.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split(/\n[ \t]*\n+/),segments:TranscriptSegment[]=[];for(const block of blocks){const lines=block.split('\n');if(/^(?:WEBVTT|NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/.test(lines[0]?.trim()??''))continue;const index=lines.findIndex(line=>line.includes('-->'));if(index<0||index>1)continue;const timing=/^\s*(\d+(?::\d{1,2}){1,2}[.,]\d{1,9})\s+-->\s+(\d+(?::\d{1,2}){1,2}[.,]\d{1,9})(?:\s+.*)?$/.exec(lines[index]);if(!timing)continue;const start=captionTime(timing[1]),end=captionTime(timing[2]);if(start===undefined||end===undefined||end<=start)continue;const text=captionDecode(lines.slice(index+1).join('\n').replace(/<\/?(?:c(?:\.[^\s>]*)?|v(?:\s+[^>]*)?|lang(?:\s+[^>]*)?|b|i|u|ruby|rt)>/gi,''));segments.push({start,duration:end-start,text});if(segments.length>=5000)break;}return validate(segments);}

export function parseTranscript(
  input: string | Document | unknown,
): TranscriptSegment[] {
  if (typeof input === "string") {
    if(input.length>5_000_000)throw new Error('Transcrição acima do limite de 5 milhões de caracteres.');
    const text = input.trim();
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        return parseTranscript(JSON.parse(text));
      } catch {
        return [];
      }
    }
    if(/^WEBVTT(?:\s|$)/.test(text)||/\d{1,2}:\d{2}[.,]\d{1,9}\s+-->/.test(text))return captionFile(text);
    if (text.startsWith("<") && typeof DOMParser !== "undefined")
      return parseTranscript(new DOMParser().parseFromString(text, "text/xml"));
    return [];
  }
  if (input&&typeof input==='object'&&(input as Document).nodeType===9&&typeof (input as Document).querySelectorAll==='function') {
    const document=input as Document;
    const xml = Array.from(document.querySelectorAll("text[start], p[t]")).map(
      (node) => ({
        start: node.hasAttribute("start")
          ? (numeric(node.getAttribute("start"))??NaN)
          : (numeric(node.getAttribute("t"))??NaN) / 1000,
        duration: node.hasAttribute("dur")
          ? Number(node.getAttribute("dur"))
          : Number(node.getAttribute("d") ?? 0) / 1000,
        text: node.textContent ?? "",
      }),
    );
    if (xml.length) return validate(xml);
    const rows = Array.from(
      document.querySelectorAll(TRANSCRIPT_ROW_SELECTOR),
    ).filter(row=>!row.parentElement?.closest(TRANSCRIPT_ROW_SELECTOR));
    const readTime=(row:Element|undefined):number|undefined=>{if(!row)return undefined;const time=row.querySelector('.segment-timestamp,[class*="ytwTranscriptSegmentViewModelTimestamp"],[data-start],[data-start-ms]');for(const item of [row,time]){if(!item)continue;for(const [attribute,factor]of [['data-start-ms',1000],['data-start',1],['data-start-time',1]]as const){const raw=numeric(item.getAttribute(attribute));if(raw!==undefined)return raw/factor;}}return captionTime(time?.textContent??'')??parseDuration(time?.textContent??'');};
    return validate(
      rows.map((row, index) => {
        const start=readTime(row),end=readTime(rows[index+1]);
        return {
          start: start ?? NaN,
          duration:
            end !== undefined && start !== undefined
              ? Math.max(0, end - start)
              : 0,
          text:
            row.querySelector('.segment-text,[class*="ytwTranscriptSegmentViewModelText"],[data-text]')?.textContent ?? row.getAttribute('data-text') ?? "",
        };
      }),
    );
  }
  if (!input || typeof input !== "object") return [];
  if (Array.isArray(input))
    return validate(
      input.map((entry) => {
        const item = asRecord(entry);
        return {
          start: numeric(item.start)??NaN,
          duration: item.duration===undefined?0:(numeric(item.duration)??NaN),
          text: typeof item.text==='string'?item.text:'',
        };
      }),
    );
  const root = asRecord(input);
  if (Array.isArray(root.events))
    return validate(
      root.events.map((event) => {
        const item = asRecord(event);
        const segments = Array.isArray(item.segs) ? item.segs : [];
        return {
          start: (numeric(item.tStartMs)??NaN) / 1000,
          duration: item.dDurationMs===undefined?0:(numeric(item.dDurationMs)??NaN)/1000,
          text: segments
            .map((segment) => String(asRecord(segment).utf8 ?? ""))
            .join(""),
        };
      }),
    );
  return [];
}

export function transcriptText(
  segments: readonly TranscriptSegment[],
  timestamps = false,
): string {
  return segments
    .map(
      (segment) =>
        `${timestamps ? `[${timestamp(segment.start, false)}] ` : ""}${segment.text}`,
    )
    .join("\n");
}

export function transcriptVtt(segments: readonly TranscriptSegment[], options:TranscriptTimingOptions={}): string {
  const resolved=resolveTranscriptEnds(segments,options),notes=resolved.filter(segment=>segment.end===null).map(segment=>`NOTE Prevlev: trecho iniciado em ${timestamp(segment.start)} omitido porque o fim e desconhecido.\n`);
  if(resolved.some(segment=>segment.endBasis==='estimated-opt-in'))notes.unshift('NOTE Prevlev: duracao final estimada por opcao explicita do usuario.\n');
  return `WEBVTT\n\n${notes.length?notes.join('\n')+'\n':''}${resolved.filter((segment):segment is TimedTranscriptSegment&{end:number}=>segment.end!==null).map((segment,index)=>`${index+1}\n${timestamp(segment.start)} --> ${timestamp(segment.end)}\n${segment.text.replace(/-->/g,'→').replace(/\r?\n\r?\n/g,'\n')}\n`).join('\n')}`;
}

const AI_LABELS:Record<TranscriptAiFeature,string>={'transcript-summary':'Resumo','transcript-topics':'Tópicos','transcript-script':'Roteiro'};
const markdownText=(value:string)=>value.replace(/[\\`*_{}[\]<>#]/g,'\\$&').replace(/[\r\n]/g,' ');
function fencedText(text:string):string {let length=3;for(const match of text.matchAll(/`+/g))length=Math.max(length,match[0].length+1);const fence='`'.repeat(length);return `${fence}text\n${text}\n${fence}`;}
export function transcriptMarkdown(
  segments: readonly TranscriptSegment[],
  title = "Transcrição",
  metadata?:TranscriptMetadata,
  plainText?:string,
): string {
  const report=transcriptExport(segments,{...metadata,title},{},plainText);
  const header=`# ${markdownText(title)}\n\n${metadata?`Vídeo: ${markdownText(report.videoUrl??'não informado')}\n\nExportado em: ${report.exportedAt}\n\n`:''}`;
  const original=segments.length?segments.map(segment=>`- **${timestamp(segment.start,false)}** ${markdownText(segment.text)}`).join('\n'):plainText?`## Transcrição sem timestamps\n\n${fencedText(plainText)}`:'';
  const generated=(report.aiResults??[]).map(result=>`## ${AI_LABELS[result.feature]} · gerado por IA\n\nFonte: ${markdownText(result.source??'desconhecida')}\n\nModelo confirmado: ${markdownText(result.model??'desconhecido')}\n\nModelo solicitado: ${markdownText(result.requestedModel??'desconhecido')}\n\nOrigem do provedor: ${markdownText(result.origin??'desconhecida')}\n\nBackend: ${markdownText(result.backendOrigin??'desconhecido')}\n\nRecebido nesta sessão em: ${result.receivedAt}\n\nContexto: ${result.context.inputCharacters} caracteres, ${result.context.segmentCount} segmentos; ${result.context.inputKind==='timed-transcript'?'transcrição com horários conhecidos':'texto sem horários conhecidos'}. O conteúdo gerado não recebe timestamps da transcrição.\n\n${fencedText(result.text)}`).join('\n\n');
  return `${header}${original}${generated?`\n\n${generated}`:''}\n`;
}

function validate(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments
    .filter(
      (segment) =>
        Number.isFinite(segment.start) &&
        segment.start >= 0 &&
        Number.isFinite(segment.duration) &&
        segment.duration >= 0 &&
        segment.text.trim(),
    )
    .map((segment) => ({
      ...segment,
      text: segment.text.replace(/\s+/g, " ").trim(),
    }))
    .sort((a, b) => a.start - b.start).slice(0,5000);
}
export const transcriptTimestamp=timestamp;
export function resolveTranscriptEnds(segments:readonly TranscriptSegment[],options:TranscriptTimingOptions={}):TimedTranscriptSegment[] {const sorted=validate([...segments]);if(options.playerEndSeconds!==undefined&&(!Number.isFinite(options.playerEndSeconds)||options.playerEndSeconds<=0))throw new Error('Duração real do player inválida.');if(options.estimateFinalSeconds!==undefined&&(!Number.isFinite(options.estimateFinalSeconds)||options.estimateFinalSeconds<=0||options.estimateFinalSeconds>300))throw new Error('A estimativa explícita deve ficar entre 0 e 300 segundos.');return sorted.map((segment,index)=>{const next=sorted.slice(index+1).find(other=>other.start>segment.start)?.start;let end:number|null=null,endBasis:TimedTranscriptSegment['endBasis']='unknown';if(segment.duration>0){end=segment.start+segment.duration;endBasis='provided-duration';}else if(next!==undefined){end=next;endBasis='next-segment';}else if(options.playerEndSeconds!==undefined&&options.playerEndSeconds>segment.start){end=options.playerEndSeconds;endBasis='player-end';}else if(options.estimateFinalSeconds!==undefined){end=segment.start+options.estimateFinalSeconds;endBasis='estimated-opt-in';}return {...segment,end,endBasis};});}
export function transcriptSrt(segments:readonly TranscriptSegment[],options:TranscriptTimingOptions={}):string{return resolveTranscriptEnds(segments,options).filter((segment):segment is TimedTranscriptSegment&{end:number}=>segment.end!==null).map((segment,index)=>`${index+1}\n${timestamp(segment.start).replace('.',',')} --> ${timestamp(segment.end).replace('.',',')}\n${segment.text}\n`).join('\n');}
function safeMetadata(metadata:TranscriptMetadata){let videoUrl:string|null=null;try{const url=new URL(metadata.videoUrl??'');if(url.protocol==='https:'&&['www.youtube.com','youtube.com','m.youtube.com','youtu.be','studio.youtube.com'].includes(url.hostname)&&!url.username&&!url.password)videoUrl=url.href;}catch{/* Unknown video context remains unknown. */}const exportedAt=metadata.exportedAt??new Date().toISOString();if(!Number.isFinite(Date.parse(exportedAt)))throw new Error('Data de exportação inválida.');return {title:metadata.title??'Transcrição',videoUrl,videoId:metadata.videoId&&/^[\w-]{11}$/.test(metadata.videoId)?metadata.videoId:videoUrl?videoIdFromUrl(videoUrl)??null:null,exportedAt:new Date(exportedAt).toISOString()};}
function optionalString(value:unknown,max=500):string|null {return typeof value==='string'&&value.trim()&&value.length<=max?value:null;}
export function transcriptAiOrigin(value:unknown):string|null {
  if(typeof value!=='string')return null;
  try {const url=new URL(value);return url.origin===value&&!url.username&&!url.password&&(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))?url.origin:null;}catch{return null;}
}
/** Whitelist non-secret selected provenance; callback internals and credentials are never copied. */
export function transcriptAiProvenance(value:TranscriptAiProvenance|undefined):{model:string|null;origin:string|null;backendOrigin:string|null} {
  return {model:optionalString(value?.model),origin:transcriptAiOrigin(value?.origin),backendOrigin:transcriptAiOrigin(value?.backendOrigin)};
}
function safeAiResults(results:readonly TranscriptAiResult[]|undefined,metadata:ReturnType<typeof safeMetadata>,text:string,segments:readonly TranscriptSegment[]):TranscriptAiResult[] {
  if(!results)return[];
  const seen=new Set<TranscriptAiFeature>(),accepted:TranscriptAiResult[]=[];
  for(const result of results){
    const context=result?.context;
    if(!result||!Object.hasOwn(AI_LABELS,result.feature)||seen.has(result.feature)||result.generated!==true||typeof result.text!=='string'||!result.text.trim()||!context||context.videoUrl!==metadata.videoUrl||context.videoId!==metadata.videoId||context.inputCharacters!==text.length||context.segmentCount!==segments.length||context.inputKind!==(segments.length?'timed-transcript':'plain-text')||!Number.isFinite(Date.parse(result.receivedAt)))continue;
    accepted.push({feature:result.feature,text:result.text,generated:true,source:optionalString(result.source),model:optionalString(result.model),requestedModel:optionalString(result.requestedModel),origin:transcriptAiOrigin(result.origin),backendOrigin:transcriptAiOrigin(result.backendOrigin),receivedAt:new Date(result.receivedAt).toISOString(),context:{videoUrl:metadata.videoUrl,videoId:metadata.videoId,inputKind:context.inputKind,inputCharacters:text.length,segmentCount:segments.length}});seen.add(result.feature);
  }
  return accepted;
}
export function transcriptExport(segments:readonly TranscriptSegment[],metadata:TranscriptMetadata={},options:TranscriptTimingOptions={},plainText?:string){
  const resolved=resolveTranscriptEnds(segments,options),context=safeMetadata(metadata),text=plainText??transcriptText(resolved),aiResults=safeAiResults(metadata.aiResults,context,text,resolved);
  return {schemaVersion:1,kind:'transcript-export',...context,text,timestampsAvailable:resolved.length>0,segments:resolved,...(aiResults.length?{aiResults}:{}),limitations:['Somente os trechos fornecidos ou já observados; não comprova transcrição completa.',...(!resolved.length?['Texto sem timestamps conhecidos; nenhum horário foi inventado.']:[]),...(resolved.some(segment=>segment.end===null)?['Há finais desconhecidos; VTT/SRT omitem esses cues. JSON/CSV/Markdown conservam seus textos e inícios.']:[]),...(resolved.some(segment=>segment.endBasis==='estimated-opt-in')?['Há finais estimados com opção explícita.']:[]),...(aiResults.length?['Resumo, tópicos e roteiro anexados são conteúdo gerado por IA já disponível e válido nesta sessão; revise erros e inferências. Não são segmentos originais nem receberam timestamps da transcrição.']:[])]};
}
export function transcriptRows(segments:readonly TranscriptSegment[],metadata:TranscriptMetadata={},options:TranscriptTimingOptions={},plainText?:string):Record<string,unknown>[] {
  const report=transcriptExport(segments,metadata,options,plainText),base={title:report.title,videoUrl:report.videoUrl,videoId:report.videoId,exportedAt:report.exportedAt};
  const rows:Record<string,unknown>[]=report.segments.map(segment=>({...segment,...base,kind:'transcript-segment',startTimestamp:timestamp(segment.start),endTimestamp:segment.end===null?null:timestamp(segment.end)}));
  if(!rows.length&&plainText)rows.push({...base,kind:'transcript-plain-text',text:plainText});
  for(const result of report.aiResults??[])rows.push({...base,kind:'generated-ai',text:result.text,generated:true,aiFeature:result.feature,aiLabel:AI_LABELS[result.feature],aiSource:result.source,aiModel:result.model,aiRequestedModel:result.requestedModel,aiOrigin:result.origin,aiBackendOrigin:result.backendOrigin,aiReceivedAt:result.receivedAt,aiContextVideoUrl:result.context.videoUrl,aiContextVideoId:result.context.videoId,aiContextInputKind:result.context.inputKind,aiContextInputCharacters:result.context.inputCharacters,aiContextSegmentCount:result.context.segmentCount});
  return rows;
}

/** Heterogeneous segment/AI rows need the union of columns, without repeating AI text. */
export function transcriptCsv(segments:readonly TranscriptSegment[],metadata:TranscriptMetadata={},options:TranscriptTimingOptions={},plainText?:string):string {
  const rows=transcriptRows(segments,metadata,options,plainText),columns=[...new Set(rows.flatMap(row=>Object.keys(row)))];
  return toCsv(rows,columns);
}

function timestamp(seconds: number, milliseconds = true): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(ms / 3600000),
    minutes = Math.floor(ms / 60000) % 60,
    secs = Math.floor(ms / 1000) % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}${milliseconds ? `.${String(ms % 1000).padStart(3, "0")}` : ""}`;
}
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
