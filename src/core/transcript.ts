import type { TranscriptSegment } from "../shared/types";
import { parseDuration, videoIdFromUrl } from "./parse.ts";

export const TRANSCRIPT_ROW_SELECTOR = 'ytd-transcript-segment-renderer,transcript-segment-view-model,[data-transcript-segment],[data-prevlev-transcript-segment]';
export interface TranscriptTimingOptions {playerEndSeconds?:number;estimateFinalSeconds?:number;}
export interface TranscriptMetadata {title?:string;videoUrl?:string;videoId?:string;exportedAt?:string;}
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

export function transcriptMarkdown(
  segments: readonly TranscriptSegment[],
  title = "Transcrição",
  metadata?:TranscriptMetadata,
): string {
  const context=metadata?safeMetadata({...metadata,title}):undefined;
  return `# ${title.replace(/[\\`*_{}[\]<>#]/g,'\\$&').replace(/[\r\n]/g, " ")}\n\n${context?`Vídeo: ${(context.videoUrl??'não informado').replace(/[\\`*_{}[\]<>#]/g,'\\$&')}\n\nExportado em: ${context.exportedAt}\n\n`:''}${segments.map((segment) => `- **${timestamp(segment.start, false)}** ${segment.text.replace(/[\\`*_{}[\]<>#]/g, "\\$&").replace(/\r?\n/g, " ")}`).join("\n")}\n`;
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
export function transcriptExport(segments:readonly TranscriptSegment[],metadata:TranscriptMetadata={},options:TranscriptTimingOptions={},plainText?:string){const resolved=resolveTranscriptEnds(segments,options);return {schemaVersion:1,kind:'transcript-export',...safeMetadata(metadata),text:plainText??transcriptText(resolved),timestampsAvailable:resolved.length>0,segments:resolved,limitations:['Somente os trechos fornecidos ou já observados; não comprova transcrição completa.',...(!resolved.length?['Texto sem timestamps conhecidos; nenhum horário foi inventado.']:[]),...(resolved.some(segment=>segment.end===null)?['Há finais desconhecidos; VTT/SRT omitem esses cues. JSON/CSV/Markdown conservam seus textos e inícios.']:[]),...(resolved.some(segment=>segment.endBasis==='estimated-opt-in')?['Há finais estimados com opção explícita.']:[])]};}
export function transcriptRows(segments:readonly TranscriptSegment[],metadata:TranscriptMetadata={},options:TranscriptTimingOptions={}):Record<string,unknown>[] {const report=transcriptExport(segments,metadata,options);return report.segments.map(segment=>({...segment,title:report.title,videoUrl:report.videoUrl,videoId:report.videoId,exportedAt:report.exportedAt,startTimestamp:timestamp(segment.start),endTimestamp:segment.end===null?null:timestamp(segment.end)}));}
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
