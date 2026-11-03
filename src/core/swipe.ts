import type { SwipeItem } from '../shared/storage';
import type { VideoRecord } from '../shared/types';
import { videoIdFromUrl } from './parse.ts';
import { toCsv } from './export.ts';
import { isoBoundary } from './observations.ts';

export const SWIPE_MAX_ITEMS=5000;
export const SWIPE_MAX_BYTES=4*1024*1024;
export type SwipeType='video'|'channel'|'other';
export interface SwipeReference extends SwipeItem {type:SwipeType;tags:string[];notes:string;}
export interface SwipeFilter {query?:string;folder?:string;tag?:string;type?:SwipeType|'';}
export interface SwipeFields {title:string;url:string;folder?:string;type?:SwipeType;tags?:string[]|string;notes?:string;thumbnail?:string;source?:VideoRecord['source'];}
const plain=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const normalizeSwipeText=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR').replace(/\s+/g,' ').trim();
const text=(value:unknown,name:string,max:number,fallback=''):string=>{
 if(value===undefined)return fallback;
 if(typeof value!=='string'||value.length>max)throw new Error(`${name} deve ser texto com até ${max} caracteres.`);
 return value.trim();
};
function date(value:unknown,name:string):string|undefined{
 if(value===undefined||value==='')return undefined;
 if(typeof value!=='string'||value.length>50||!Number.isFinite(Date.parse(value))||!value.includes('T')||!/(?:Z|[+-]\d{2}:\d{2})$/.test(value))throw new Error(`${name} inválida; preserve o timestamp com fuso horário.`);
 try{return new Date(isoBoundary(value,false)).toISOString();}catch{throw new Error(`${name} inválida; use um timestamp real com fuso horário.`);}
}
export function safeReferenceUrl(value:unknown):string{
 if(typeof value!=='string'||value.length>4096||!value.trim()||value.includes('\\')||/\p{Cc}/u.test(value))throw new Error('Informe uma URL HTTPS válida, sem credenciais.');
 let url:URL;try{url=new URL(value.trim());}catch{throw new Error('Informe uma URL HTTPS válida, sem credenciais.');}
 if(url.protocol!=='https:'||url.username||url.password)throw new Error('Informe uma URL HTTPS válida, sem credenciais.');
 return url.href;
}
export function inferSwipeType(url:string):SwipeType{
 if(videoIdFromUrl(url))return 'video';
 const parsed=new URL(url);
 return /(^|\.)youtube\.com$/.test(parsed.hostname)&&/^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/?$/.test(parsed.pathname)?'channel':'other';
}
function thumbnail(value:unknown):string|undefined{const url=text(value,'Thumbnail',4096);return url?safeReferenceUrl(url):undefined;}
function legacyImage(value:unknown):string|undefined{
 if(value===undefined||value==='')return undefined;
 if(typeof value!=='string')throw new Error('Imagem antiga inválida.');
 if(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))return value;
 return safeReferenceUrl(value);
}
export function parseSwipeTags(value:unknown):string[]{
 const source=typeof value==='string'?value.split(','):value===undefined?[]:value;
 if(!Array.isArray(source)||source.length>100)throw new Error('Informe até 20 tags, separadas por vírgula.');
 const tags:string[]=[],seen=new Set<string>();
 for(const raw of source){const tag=text(raw,'Tag',50);if(!tag)continue;const key=normalizeSwipeText(tag);if(!seen.has(key)){seen.add(key);tags.push(tag);}}
 if(tags.length>20)throw new Error('Cada referência aceita até 20 tags distintas.');
 return tags;
}
function legacyId(value:string):string{let hash=2166136261;for(const character of value){hash^=character.codePointAt(0)!;hash=Math.imul(hash,16777619);}return `legacy-${(hash>>>0).toString(16)}`;}
export function normalizeSwipeItem(value:unknown,index=0):SwipeReference{
 if(!plain(value))throw new Error('Referência inválida na biblioteca.');
 if(value.source==='youtube-data-api')throw new Error('Referências marcadas como youtube-data-api não podem ser persistidas na biblioteca local.');
 if(value.source!==undefined&&!['youtube-dom','public-page','user-provided'].includes(String(value.source)))throw new Error('Origem da referência desconhecida.');
 const title=text(value.title,'Título',1000);if(!title)throw new Error('Informe um título para a referência.');
 const url=safeReferenceUrl(value.url),folder=text(value.folder,'Pasta',120,'Referências')||'Referências';
 const id=text(value.id,'ID da referência',120)||legacyId(`${url}\n${index}`);if(/\p{Cc}/u.test(id))throw new Error('ID da referência inválido.');
 const type=value.type??inferSwipeType(url);if(!['video','channel','other'].includes(String(type)))throw new Error('Tipo de referência desconhecido.');
 const createdAt=date(value.createdAt,'Data de criação')??'',updatedAt=date(value.updatedAt,'Data de edição');
 const image=legacyImage(value.image),preview=thumbnail(value.thumbnail),notes=text(value.notes,'Notas',10000);
 return {id,title,url,folder,type:type as SwipeType,tags:parseSwipeTags(value.tags),notes,createdAt,...(updatedAt?{updatedAt}:{}),...(preview?{thumbnail:preview}:{}),...(image?{image}:{}),...(value.source?{source:value.source as VideoRecord['source']}:{} )};
}
export function ensureSwipeBudget(items:readonly SwipeItem[]):number{
 if(items.length>SWIPE_MAX_ITEMS)throw new Error('A biblioteca aceita até 5000 referências. Exporte e remova itens antes de adicionar outros.');
 const bytes=new TextEncoder().encode(JSON.stringify({swipe:items})).byteLength;
 if(bytes>SWIPE_MAX_BYTES)throw new Error('A biblioteca excede 4 MiB. Exporte e reduza notas ou imagens antes de salvar. Nenhum item foi truncado.');
 return bytes;
}
export function normalizeSwipeLibrary(value:unknown):SwipeReference[]{
 if(value===undefined)return [];
 if(!Array.isArray(value))throw new Error('A biblioteca local tem formato incompatível; seus dados foram preservados.');
 ensureSwipeBudget(value as SwipeItem[]);
 const items=value.map(normalizeSwipeItem);ensureSwipeBudget(items);
 return items;
}
export function createSwipeReference(fields:SwipeFields,now=new Date().toISOString()):SwipeReference{
 return normalizeSwipeItem({...fields,id:crypto.randomUUID(),createdAt:now});
}
export function editSwipeReference(item:SwipeItem,fields:SwipeFields,now=new Date().toISOString()):SwipeReference{
 return normalizeSwipeItem({...item,...fields,id:item.id,createdAt:item.createdAt,updatedAt:now});
}
export function swipeIdentity(item:Pick<SwipeItem,'url'>):string{
 const url=safeReferenceUrl(item.url),id=videoIdFromUrl(url);if(id)return `video:${id}`;
 const parsed=new URL(url);if(inferSwipeType(url)==='channel')return `channel:${parsed.pathname.startsWith('/@')?parsed.pathname.toLowerCase().replace(/\/$/,''):parsed.pathname.replace(/\/$/,'')}`;
 return url;
}
/** Imports keep local IDs and metadata on conflict; counts make every skipped row visible. */
export function mergeSwipeImport(existing:readonly SwipeItem[],incoming:readonly SwipeItem[]):{items:SwipeReference[];added:number;duplicates:number;conflicts:number}{
 const items=normalizeSwipeLibrary([...existing]),ids=new Map(items.map(item=>[item.id,item])),urls=new Set(items.map(swipeIdentity));let added=0,duplicates=0,conflicts=0;
 for(const candidate of normalizeSwipeLibrary([...incoming])){
  const sameId=ids.get(candidate.id),key=swipeIdentity(candidate);
  if(sameId){if(swipeIdentity(sameId)===key)duplicates++;else conflicts++;continue;}
  if(urls.has(key)){duplicates++;continue;}
  items.push(candidate);ids.set(candidate.id,candidate);urls.add(key);added++;
 }
 ensureSwipeBudget(items);return {items,added,duplicates,conflicts};
}
export function filterSwipe(items:readonly SwipeItem[],filter:SwipeFilter={}):SwipeReference[]{
 const words=normalizeSwipeText(filter.query??'').split(' ').filter(Boolean);
 return normalizeSwipeLibrary([...items]).filter(item=>{
  if(filter.folder&&normalizeSwipeText(item.folder)!==normalizeSwipeText(filter.folder))return false;
  if(filter.tag&&!item.tags.some(tag=>normalizeSwipeText(tag)===normalizeSwipeText(filter.tag!)))return false;
  if(filter.type&&item.type!==filter.type)return false;
  const haystack=normalizeSwipeText([item.title,item.url,item.folder,item.notes,...item.tags].join(' '));return words.every(word=>haystack.includes(word));
 });
}
export function parseSwipeImport(value:unknown):SwipeReference[]{
 if(plain(value)&&value.source==='youtube-data-api')throw new Error('Dados da API oficial não podem alimentar a biblioteca local.');
 if(Array.isArray(value))return normalizeSwipeLibrary(value);
 if(!plain(value)||value.format!=='prevlev-swipe'||value.version!==2||!Array.isArray(value.items))throw new Error('Use um JSON Prevlev Swipe versão 2 ou uma lista antiga de referências.');
 return normalizeSwipeLibrary(value.items);
}
export function exportSwipeJson(items:readonly SwipeItem[],now=new Date().toISOString()):string{
 return JSON.stringify({format:'prevlev-swipe',version:2,exportedAt:date(now,'Data da exportação'),items:normalizeSwipeLibrary([...items])},null,2);
}
export function exportSwipeCsv(items:readonly SwipeItem[]):string{
 return toCsv(normalizeSwipeLibrary([...items]).map(item=>({...item})),['id','type','title','url','folder','tags','notes','thumbnail','createdAt','updatedAt','source']);
}

/** Bounded RFC4180-style CSV reader; cell contents stay data, never HTML or formulas. */
export function parseSwipeCsv(input:string):SwipeReference[]{
 if(new TextEncoder().encode(input).byteLength>SWIPE_MAX_BYTES)throw new Error('O CSV excede 4 MiB. Nenhuma referência foi alterada.');
 const csv=input.replace(/^\uFEFF/,''),rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
 const finishCell=()=>{row.push(cell);cell='';closed=false;if(row.length>20)throw new Error('O CSV tem colunas demais. Use o formato exportado pelo Prevlev.');};
 const finishRow=()=>{finishCell();if(row.some(value=>value!==''))rows.push(row);row=[];if(rows.length>SWIPE_MAX_ITEMS+1)throw new Error('O CSV aceita até 5000 referências.');};
 for(let index=0;index<csv.length;index++){
  const character=csv[index];
  if(quoted){if(character==='"'){if(csv[index+1]==='"'){cell+='"';index++;}else{quoted=false;closed=true;}}else cell+=character;continue;}
  if(character===','){finishCell();continue;}
  if(character==='\n'||character==='\r'){if(character==='\r'&&csv[index+1]==='\n')index++;finishRow();continue;}
  if(character==='"'){if(cell||closed)throw new Error('Aspas inválidas no CSV.');quoted=true;continue;}
  if(closed)throw new Error('Conteúdo inválido após aspas no CSV.');cell+=character;
 }
 if(quoted)throw new Error('O CSV terminou com aspas abertas.');if(cell||row.length||closed)finishRow();
 const headers=rows.shift();if(!headers||!headers.includes('title')||!headers.includes('url')||new Set(headers).size!==headers.length)throw new Error('O CSV exige colunas title e url, sem cabeçalhos duplicados.');
 const allowed=new Set(['id','type','title','url','folder','tags','notes','thumbnail','createdAt','updatedAt','source']);if(headers.some(header=>!allowed.has(header)))throw new Error('O CSV contém uma coluna desconhecida. Use o formato exportado pelo Prevlev.');
 return normalizeSwipeLibrary(rows.map(values=>{
  if(values.length!==headers.length)throw new Error('Uma linha CSV tem quantidade diferente de colunas.');
  const item:Record<string,unknown>={};headers.forEach((header,index)=>{if(values[index]!==''||header==='title'||header==='url')item[header]=values[index];});
  if(typeof item.tags==='string'&&item.tags.trim().startsWith('[')){try{item.tags=JSON.parse(item.tags);}catch{throw new Error('Tags JSON inválidas no CSV.');}}
  return item;
 }));
}
