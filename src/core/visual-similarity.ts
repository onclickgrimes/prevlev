import {toCsv} from './export';

/** dHash compares neighboring luminance values after compositing onto white and resizing to 9×8.
 * It measures coarse structure, not color, semantics, or identity. Only still PNG, JPEG and WebP are accepted. */
export const VISUAL_LIMITS={candidates:20,fileBytes:10*1024*1024,totalBytes:50*1024*1024,pixels:20_000_000,dimension:16_384,durationMs:15_000} as const;
export interface VisualMatch {index:number;name:string;distance:number;similarity:number;hash:string;duplicateOf?:string;}
export interface VisualInvalid {index:number;name:string;error:string;}
export interface VisualReport {algorithm:string;reference:string;matches:VisualMatch[];invalid:VisualInvalid[];}
const algorithm='dHash 64-bit; luminância; transparência sobre branco';
const abortError=()=>new DOMException('Comparação cancelada.','AbortError');
class TimeLimit extends Error {constructor(){super('Tempo limite da comparação local atingido.');}}
function check(signal:AbortSignal|undefined,deadline:number):void {if(signal?.aborted)throw abortError();if(performance.now()>=deadline)throw new TimeLimit();}
function controlled<T>(promise:Promise<T>,signal:AbortSignal|undefined,deadline:number,dispose?:(value:T)=>void):Promise<T>{
  return new Promise((resolve,reject)=>{
    let done=false;
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);};
    const fail=(error:Error)=>{if(done)return;done=true;cleanup();reject(error);};
    const onAbort=()=>fail(abortError());
    const timer=setTimeout(()=>fail(new TimeLimit()),Math.max(0,deadline-performance.now()));
    signal?.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted)onAbort();
    promise.then(value=>{if(done){dispose?.(value);return;}done=true;cleanup();resolve(value);},error=>{if(!done){done=true;cleanup();reject(error);}});
  });
}
export function hashPixels(data:Uint8ClampedArray):string {
  if(data.length!==9*8*4)throw new Error('Pixels inválidos para dHash.');
  const brightness=(pixel:number)=>{const i=pixel*4,alpha=data[i+3]/255;return (0.299*data[i]+0.587*data[i+1]+0.114*data[i+2])*alpha+255*(1-alpha);};
  let hash=0n;
  for(let y=0;y<8;y++)for(let x=0;x<8;x++)hash=(hash<<1n)|(brightness(y*9+x)>brightness(y*9+x+1)?1n:0n);
  return hash.toString(16).padStart(16,'0');
}
export function hammingDistance(a:string,b:string):number {
  if(!/^[\da-f]{16}$/i.test(a)||!/^[\da-f]{16}$/i.test(b))throw new Error('Hash visual inválido.');
  let bits=BigInt(`0x${a}`)^BigInt(`0x${b}`),distance=0;while(bits){distance++;bits&=bits-1n;}return distance;
}
function validateFile(file:File):void {
  if(!file.size||file.size>VISUAL_LIMITS.fileBytes)throw new Error('Arquivo vazio ou acima de 10 MiB.');
  if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Formato não suportado: use PNG, JPEG ou WebP estático.');
}
function validateDimensions(width:number,height:number):void {
  if(!width||!height)throw new Error('Dimensões inválidas no cabeçalho da imagem.');
  if(width>VISUAL_LIMITS.dimension||height>VISUAL_LIMITS.dimension||width*height>VISUAL_LIMITS.pixels)throw new Error('Imagem excede 20 megapixels ou 16384 pixels por lado.');
}
/** Inspect the actual container before invoking an image decoder; reject animation and ambiguous containers. */
export function inspectImageHeader(buffer:ArrayBuffer,type:string,checkWork:()=>void=()=>{}):void {
  const b=new Uint8Array(buffer),view=new DataView(buffer);
  const bad=():never=>{throw new Error('Cabeçalho de imagem inválido ou formato incompatível.');};
  const tag=(offset:number,text:string)=>offset+text.length<=b.length&&Array.from(text).every((c,i)=>b[offset+i]===c.charCodeAt(0));
  const bounds=(pos:number,size:number)=>pos>=0&&size>=0&&pos+size<=b.length;
  const u24=(pos:number)=>b[pos]+b[pos+1]*256+b[pos+2]*65536;
  if(type==='image/png'){
    if(b.length<33||![137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v)||view.getUint32(8)!==13||!tag(12,'IHDR'))return bad();
    validateDimensions(view.getUint32(16),view.getUint32(20));
    let offset=8,ihdr=0,idat=false,ended=false,iterations=0;
    while(bounds(offset,12)){
      if((iterations++&1023)===0)checkWork();
      const size=view.getUint32(offset);if(!bounds(offset+8,size+4))return bad();
      if(tag(offset+4,'IHDR')&&++ihdr!==1)return bad();
      if(tag(offset+4,'acTL')||tag(offset+4,'fcTL')||tag(offset+4,'fdAT'))throw new Error('Imagens animadas não são suportadas.');
      if(tag(offset+4,'IDAT'))idat=true;
      offset+=size+12;
      if(tag(offset-size-8,'IEND')){if(size!==0) return bad();ended=true;break;}
    }
    if(!ended||!idat||offset!==b.length)return bad();
    return;
  }
  if(type==='image/jpeg'){
    if(b.length<4||b[0]!==0xff||b[1]!==0xd8)return bad();
    let offset=2,found=false,iterations=0;
    while(offset<b.length){
      if((iterations++&1023)===0)checkWork();
      if(b[offset++]!==0xff)return bad();while(offset<b.length&&b[offset]===0xff)offset++;
      if(offset>=b.length)return bad();const marker=b[offset++];
      if(marker===0xda){if(!found||!bounds(offset,2)||view.getUint16(offset)<2||!bounds(offset,view.getUint16(offset)))return bad();return;}
      if(marker===0xd9||marker===0x00||marker===0xd8)return bad();
      if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
      if(!bounds(offset,2))return bad();const size=view.getUint16(offset);if(size<2||!bounds(offset,size))return bad();
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
        if(found||size<8)return bad();validateDimensions(view.getUint16(offset+5),view.getUint16(offset+3));found=true;
      }
      offset+=size;
    }
    return bad();
  }
  if(type==='image/webp'){
    if(b.length<20||!tag(0,'RIFF')||!tag(8,'WEBP')||view.getUint32(4,true)+8!==b.length)return bad();
    let offset=12,canvasWidth=0,canvasHeight=0,imageWidth=0,imageHeight=0,extended=false,iterations=0;
    while(bounds(offset,8)){
      if((iterations++&1023)===0)checkWork();
      const size=view.getUint32(offset+4,true),pos=offset+8;if(!bounds(pos,size+(size%2)))return bad();
      if(tag(offset,'VP8X')){if(extended||offset!==12||size!==10)return bad();extended=true;if(b[pos]&2)throw new Error('Imagens animadas não são suportadas.');canvasWidth=1+u24(pos+4);canvasHeight=1+u24(pos+7);validateDimensions(canvasWidth,canvasHeight);}
      if(tag(offset,'ANIM')||tag(offset,'ANMF'))throw new Error('Imagens animadas não são suportadas.');
      if(tag(offset,'VP8 ')||tag(offset,'VP8L')){
        if(imageWidth)return bad();
        if(tag(offset,'VP8 ')){if(size<10||(b[pos]&1)!==0||b[pos+3]!==0x9d||b[pos+4]!==0x01||b[pos+5]!==0x2a)return bad();imageWidth=view.getUint16(pos+6,true)&0x3fff;imageHeight=view.getUint16(pos+8,true)&0x3fff;}
        else{if(size<5||b[pos]!==0x2f)return bad();const packed=view.getUint32(pos+1,true);imageWidth=(packed&0x3fff)+1;imageHeight=((packed>>>14)&0x3fff)+1;}
        validateDimensions(imageWidth,imageHeight);
      }
      offset=pos+size+(size%2);
    }
    if(offset!==b.length||!imageWidth||(extended&&(imageWidth!==canvasWidth||imageHeight!==canvasHeight)))return bad();
    return;
  }
  return bad();
}
async function inspect(file:File,signal:AbortSignal|undefined,deadline:number):Promise<{hash:string;digest:string}>{
  check(signal,deadline);validateFile(file);
  const bytes=await controlled(file.arrayBuffer(),signal,deadline);check(signal,deadline);
  inspectImageHeader(bytes,file.type,()=>check(signal,deadline));check(signal,deadline);
  const digestBytes=await controlled(crypto.subtle.digest('SHA-256',bytes),signal,deadline);
  const digest=Array.from(new Uint8Array(digestBytes),b=>b.toString(16).padStart(2,'0')).join('');
  let bitmap:ImageBitmap;
  try{bitmap=await controlled(createImageBitmap(new Blob([bytes],{type:file.type})),signal,deadline,value=>value.close());}
  catch(error){if(error instanceof TimeLimit || (error instanceof DOMException&&error.name==='AbortError'))throw error;throw new Error('Imagem inválida ou não decodificável.');}
  try{
    check(signal,deadline);
    validateDimensions(bitmap.width,bitmap.height);
    const canvas=document.createElement('canvas');canvas.width=9;canvas.height=8;const context=canvas.getContext('2d');if(!context)throw new Error('Canvas 2D indisponível.');
    context.fillStyle='#fff';context.fillRect(0,0,9,8);context.drawImage(bitmap,0,0,9,8);
    const hash=hashPixels(context.getImageData(0,0,9,8).data);check(signal,deadline);return {hash,digest};
  }finally{bitmap.close();}
}
export async function compareLocalImages(reference:File,candidates:readonly File[],options:{signal?:AbortSignal;durationMs?:number}={}):Promise<VisualReport>{
  const duration=options.durationMs??VISUAL_LIMITS.durationMs;
  if(!Number.isFinite(duration)||duration<=0||duration>VISUAL_LIMITS.durationMs)throw new Error('Limite de tempo inválido.');
  if(!reference||!candidates.length||candidates.length>VISUAL_LIMITS.candidates)throw new Error('Selecione uma referência e de 1 a 20 candidatas locais.');
  if([reference,...candidates].reduce((sum,file)=>sum+file.size,0)>VISUAL_LIMITS.totalBytes)throw new Error('Os arquivos somados excedem 50 MiB.');
  const deadline=performance.now()+duration,signal=options.signal;const base=await inspect(reference,signal,deadline);
  const seen=new Map([[base.digest,`Referência: ${reference.name}`]]),matches:VisualMatch[]=[],invalid:VisualInvalid[]=[];
  for(let index=0;index<candidates.length;index++){
    const file=candidates[index];check(signal,deadline);
    try{
      const item=await inspect(file,signal,deadline),distance=hammingDistance(base.hash,item.hash),duplicateOf=seen.get(item.digest);
      if(!duplicateOf)seen.set(item.digest,file.name);
      matches.push({index,name:file.name,distance,similarity:(64-distance)/64*100,hash:item.hash,...(duplicateOf?{duplicateOf}:{})});
    }catch(error){if(error instanceof TimeLimit||(error instanceof DOMException&&error.name==='AbortError'))throw error;invalid.push({index,name:file.name,error:error instanceof Error?error.message:'Falha ao ler imagem.'});}
  }
  check(signal,deadline);matches.sort ( (a,b)=>a.distance-b.distance||a.index-b.index );
  return {algorithm,reference:reference.name,matches,invalid};
}
export function visualReportCsv(report:VisualReport):string {
  const rows:Record<string,unknown>[] = report.matches.map(m=>({referencia:report.reference,arquivo:m.name,estado:'comparado',distancia:m.distance,similaridade_percentual:m.similarity,hash:m.hash,duplicado_de:m.duplicateOf??'',erro:''}));
  rows.push(...report.invalid.map(item=>({referencia:report.reference,arquivo:item.name,estado:'inválido',erro:item.error})));
  return toCsv(rows,['referencia','arquivo','estado','distancia','similaridade_percentual','hash','duplicado_de','erro']);
}
export function visualReportJson(report:VisualReport):string {return JSON.stringify(report,null,2);}
