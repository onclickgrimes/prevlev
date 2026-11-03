import { decodeImageBitmap, preflightImage, withImageDecodeSlot } from './image-preflight';
import { inspectImageBytes, type ImageInfo } from '../shared/image-header.mjs';
import {isoBoundary} from './observations';

export const SWIPE_ASSET_MAX_BYTES = 3 * 1024 * 1024;
export interface SwipeAssetProvenance {
  kind:'file'|'capture'|'composition'|'thumbnail';sourceUrl:string;videoId?:string;fileName?:string;createdAt?:string;
}
export interface SwipeAssetMetadata extends Omit<SwipeAssetProvenance,'createdAt'> {
  version:1;id:string;mime:ImageInfo['type'];bytes:number;width:number;height:number;createdAt:string;
}
const sourceUrl=(value:unknown):string=>{if(typeof value!=='string'||value.length>4096||/\p{Cc}/u.test(value)||value.includes('\\'))throw new Error('Origem do ativo inválida.');const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)throw new Error('Origem do ativo exige HTTPS sem credenciais.');return url.href;};

/** Pure validation shared with the personal backend; no decoder, URL load or filesystem work. */
export function inspectSwipeAssetDataUrl(value:unknown):{info:ImageInfo;bytes:Uint8Array<ArrayBuffer>} {
  if(typeof value!=='string'||value.length>4*1024*1024)throw new Error('Ativo local excede o orçamento de 4 MiB da biblioteca.');
  const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!match||match[2].length%4!==0)throw new Error('Ativo exige PNG, JPEG ou WebP estático em base64 canônico.');
  let binary:string;try{binary=atob(match[2]);}catch{throw new Error('Base64 do ativo inválido.');}
  if(btoa(binary)!==match[2]||binary.length>SWIPE_ASSET_MAX_BYTES)throw new Error('Ativo base64 inválido ou acima de 3 MiB.');
  const bytes=Uint8Array.from(binary,char=>char.charCodeAt(0)),info=inspectImageBytes(bytes,match[1],{maxBytes:SWIPE_ASSET_MAX_BYTES});return {info,bytes};
}
export function normalizeSwipeAsset(value:unknown,image:unknown):SwipeAssetMetadata|undefined {
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Metadados do ativo inválidos.');
  const asset=value as Record<string,unknown>,{info}=inspectSwipeAssetDataUrl(image);
  if(asset.version!==1||typeof asset.id!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(asset.id)||!['file','capture','composition','thumbnail'].includes(String(asset.kind))||asset.mime!==info.type||asset.bytes!==info.bytes||asset.width!==info.width||asset.height!==info.height||typeof asset.createdAt!=='string'||asset.createdAt.length>50||!Number.isFinite(Date.parse(asset.createdAt)))throw new Error('Metadados do ativo divergem dos bytes da imagem ou têm identidade inválida.');
  if(asset.videoId!==undefined&&(typeof asset.videoId!=='string'||!/^[A-Za-z0-9_-]{11}$/.test(asset.videoId)))throw new Error('ID de vídeo do ativo inválido.');
  if(asset.fileName!==undefined&&(typeof asset.fileName!=='string'||asset.fileName.length>200||/\p{Cc}/u.test(asset.fileName)))throw new Error('Nome de arquivo do ativo inválido.');
  if(!asset.createdAt.includes('T')||!/(?:Z|[+-]\d{2}:\d{2})$/.test(asset.createdAt))throw new Error('Data do ativo exige um timestamp real com fuso.');
  return {version:1,id:asset.id,kind:asset.kind as SwipeAssetMetadata['kind'],sourceUrl:sourceUrl(asset.sourceUrl),mime:info.type,bytes:info.bytes,width:info.width,height:info.height,createdAt:new Date(isoBoundary(asset.createdAt,false)).toISOString(),...(asset.videoId?{videoId:asset.videoId as string}:{}),...(asset.fileName?{fileName:asset.fileName as string}:{})};
}

/** Explicit local action only. Preflight and actual bounded decoding precede encoding/persistence. */
export async function createSwipeAsset(blob:Blob,provenance:SwipeAssetProvenance,options:{signal?:AbortSignal}={}):Promise<{image:string;asset:SwipeAssetMetadata}> {
  const deadline=performance.now()+15000,work={signal:options.signal,deadline,maxBytes:SWIPE_ASSET_MAX_BYTES},info=await preflightImage(blob,work);
  const bitmap=await decodeImageBitmap(blob,work);bitmap.close();options.signal?.throwIfAborted();
  const bytes=new Uint8Array(await withImageDecodeSlot(()=>blob.arrayBuffer(),work));options.signal?.throwIfAborted();
  let binary='';for(let offset=0;offset<bytes.length;offset+=16384)binary+=String.fromCharCode(...bytes.subarray(offset,offset+16384));
  const image=`data:${info.type};base64,${btoa(binary)}`,asset=normalizeSwipeAsset({version:1,id:crypto.randomUUID(),kind:provenance.kind,sourceUrl:provenance.sourceUrl,videoId:provenance.videoId,fileName:provenance.fileName,createdAt:provenance.createdAt??new Date().toISOString(),mime:info.type,bytes:info.bytes,width:info.width,height:info.height},image)!;
  return {image,asset};
}
