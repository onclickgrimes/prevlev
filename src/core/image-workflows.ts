import {fitDimensions,loadImage} from './media';
import {decodeImageBitmap} from './image-preflight';
import type {VideoRecord} from '../shared/types';

export type ImageFormat='image/jpeg'|'image/png'|'image/webp';
export interface TargetCompressionOptions {
  targetBytes:number; maxWidth?:number; maxHeight?:number; quality?:number;
  minQuality?:number; minDimension?:number; maxIterations?:number;
  maxDurationMs?:number; type?:ImageFormat; flattenBackground?:string;
  signal?:AbortSignal;
}
export interface CompressionCandidate {width:number;height:number;quality?:number;type:ImageFormat;}
export interface CompressionSearchResult extends CompressionCandidate {
  blob:Blob;bytes:number;targetBytes:number;targetMet:boolean;iterations:number;
  elapsedMs:number;reason:'target-met'|'original-preserved'|'iteration-limit'|'dimension-floor'|'time-limit';
}
export interface TargetCompressionResult extends CompressionSearchResult {
  originalBytes:number;sourceWidth:number;sourceHeight:number;hadAlpha:boolean;
  alphaPreserved:boolean;flattened:boolean;
}
class ImageTimeLimit extends Error {
  constructor(){super('Tempo limite do processamento local atingido. Reduza a imagem ou tente novamente.');}
}
const now=()=>performance.now();
function cancelled():DOMException{return new DOMException('Processamento cancelado.','AbortError');}
function check(signal:AbortSignal|undefined,deadline:number):void {
  if(signal?.aborted)throw cancelled();
  if(now()>=deadline)throw new ImageTimeLimit();
}
function controlled<T>(work:Promise<T>,signal:AbortSignal|undefined,deadline:number,dispose?:(value:T)=>void):Promise<T>{
  return new Promise((resolve,reject)=>{
    let settled=false;
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    const fail=(error:Error)=>{if(settled)return;settled=true;cleanup();reject(error);};
    const abort=()=>fail(cancelled());
    const timer=setTimeout(()=>fail(new ImageTimeLimit()),Math.max(0,deadline-now()));
    signal?.addEventListener('abort',abort,{once:true});
    work.then(value=>{if(settled){dispose?.(value);return;}settled=true;cleanup();resolve(value);},error=>{if(!settled){settled=true;cleanup();reject(error);}});
    if(signal?.aborted)abort();
  });
}
function dimensions(width:number,height:number):void {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>16384||height>16384||width*height>32_000_000)throw new Error('Imagem fora do limite local de 32 megapixels e 16384 pixels por lado.');
}
function optionsFor(options:TargetCompressionOptions){
  const targetBytes=options.targetBytes,quality=options.quality??0.85,minQuality=options.minQuality??Math.min(0.2,quality);
  const maxWidth=options.maxWidth??1280,maxHeight=options.maxHeight??720,maxIterations=options.maxIterations??20,maxDurationMs=options.maxDurationMs??5000,minDimension=options.minDimension??32,type=options.type??'image/jpeg';
  if(!Number.isSafeInteger(targetBytes)||targetBytes<1||targetBytes>50*1024*1024)throw new Error('A meta deve ser de 1 byte a 50 MiB.');
  if(!Number.isFinite(quality)||quality<0.1||quality>1||!Number.isFinite(minQuality)||minQuality<0.05||minQuality>quality)throw new Error('Qualidades inválidas: máxima entre 0,1 e 1, mínima entre 0,05 e a máxima.');
  if(!Number.isInteger(maxIterations)||maxIterations<1||maxIterations>40||!Number.isFinite(maxDurationMs)||maxDurationMs<10||maxDurationMs>15000)throw new Error('Use de 1 a 40 tentativas e um tempo entre 10 e 15000 ms.');
  if(!Number.isInteger(minDimension)||minDimension<1||minDimension>16384)throw new Error('Resolução mínima inválida.');
  dimensions(maxWidth,maxHeight);
  if(!['image/jpeg','image/png','image/webp'].includes(type))throw new Error('Escolha JPEG, PNG ou WebP.');
  return {targetBytes,quality,minQuality,maxWidth,maxHeight,maxIterations,maxDurationMs,minDimension,type};
}

/** Bounded search shared by the real canvas encoder and deterministic fixtures. */
export async function findCompressionCandidate(source:{width:number;height:number},options:TargetCompressionOptions,encode:(candidate:CompressionCandidate)=>Promise<Blob>):Promise<CompressionSearchResult>{
  const config=optionsFor(options);dimensions(source.width,source.height);
  const started=now(),deadline=started+config.maxDurationMs;
  let size=fitDimensions(source.width,source.height,config.maxWidth,config.maxHeight);
  const initial={...size};let scale=1,quality=config.quality,iterations=0;
  let best:Omit<CompressionSearchResult,'targetMet'|'iterations'|'elapsedMs'|'reason'>|undefined;
  const finish=(reason:CompressionSearchResult['reason']):CompressionSearchResult=>{
    if(!best)throw new ImageTimeLimit();
    return {...best,targetMet:best.bytes<=config.targetBytes,iterations,elapsedMs:Math.round(now()-started),reason};
  };
  while(iterations<config.maxIterations){
    try {
      check(options.signal,deadline);
      const candidate:CompressionCandidate={...size,type:config.type,...(config.type==='image/png'?{}:{quality})};
      iterations++;
      const blob=await controlled(encode(candidate),options.signal,deadline);
      check(options.signal,deadline);
      if(blob.type!==config.type||!blob.size)throw new Error('O navegador não codificou o formato solicitado. Nenhum arquivo foi apresentado como válido.');
      if(!best||blob.size<best.bytes)best={...candidate,blob,bytes:blob.size,targetBytes:config.targetBytes};
      if(blob.size<=config.targetBytes)return finish('target-met');
      if(config.type!=='image/png'&&quality>config.minQuality){quality=Math.max(config.minQuality,Math.round((quality-0.2)*1000)/1000);continue;}
      const longest=Math.max(size.width,size.height);
      if(longest<=config.minDimension)return finish('dimension-floor');
      scale=Math.max(config.minDimension/Math.max(initial.width,initial.height),scale*0.8);
      const next=fitDimensions(source.width,source.height,initial.width*scale,initial.height*scale);
      if(next.width===size.width&&next.height===size.height)return finish('dimension-floor');
      size=next;quality=config.quality;
    } catch(error){
      if(error instanceof ImageTimeLimit&&best)return finish('time-limit');
      throw error;
    }
  }
  return finish('iteration-limit');
}

interface Decoded {source:CanvasImageSource;width:number;height:number;close:()=>void;}
async function decode(blob:Blob,signal:AbortSignal|undefined,deadline:number):Promise<Decoded>{
  check(signal,deadline);
  let result:Decoded;
  if(typeof createImageBitmap==='function'){
    const bitmap=await decodeImageBitmap(blob,{signal,deadline});
    result={source:bitmap,width:bitmap.width,height:bitmap.height,close:()=>bitmap.close()};
  }else{
    const image=await loadImage(blob,{signal,deadline});
    result={source:image,width:image.naturalWidth,height:image.naturalHeight,close:()=>{}};
  }
  try{dimensions(result.width,result.height);check(signal,deadline);return result;}catch(error){result.close();throw error;}
}
function canvasAt(width:number,height:number){
  dimensions(width,height);const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('Canvas 2D indisponível neste navegador.');
  return {canvas,context};
}
function encoded(canvas:HTMLCanvasElement,type:ImageFormat,quality?:number):Promise<Blob>{
  return new Promise((resolve,reject)=>{try{canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Não foi possível codificar a imagem local.')),type,quality);}catch{reject(new Error('O navegador não conseguiu codificar a imagem local.'));}});
}

/** EXIF orientation is applied once by browser decoding. Alpha is inspected, never silently flattened. */
export async function compressToTarget(blob:Blob,options:TargetCompressionOptions):Promise<TargetCompressionResult>{
  const config=optionsFor(options),started=now(),deadline=started+config.maxDurationMs;
  const image=await decode(blob,options.signal,deadline);
  let sourceCanvas:HTMLCanvasElement|undefined;
  try{
    const source=canvasAt(image.width,image.height);sourceCanvas=source.canvas;source.context.drawImage(image.source,0,0);
    const pixels=source.context.getImageData(0,0,image.width,image.height).data;
    let hadAlpha=false;
    for(let index=3;index<pixels.length;index+=4){if((index&262143)===3)check(options.signal,deadline);if(pixels[index]!==255){hadAlpha=true;break;}}
    check(options.signal,deadline);
    if(config.type==='image/jpeg'&&hadAlpha&&!options.flattenBackground)throw new Error('Esta imagem tem transparência. Escolha PNG/WebP ou autorize explicitamente achatar sobre uma cor para JPEG.');
    if(options.flattenBackground&&!/^#[0-9a-f]{6}$/i.test(options.flattenBackground))throw new Error('Escolha uma cor de fundo hexadecimal válida para achatar a transparência.');
    if(blob.type===config.type&&blob.size<=config.targetBytes&&image.width<=config.maxWidth&&image.height<=config.maxHeight&&!options.flattenBackground){
      return {blob,bytes:blob.size,targetBytes:config.targetBytes,targetMet:true,width:image.width,height:image.height,type:config.type,iterations:0,elapsedMs:Math.round(now()-started),reason:'original-preserved',originalBytes:blob.size,sourceWidth:image.width,sourceHeight:image.height,hadAlpha,alphaPreserved:hadAlpha,flattened:false};
    }
    const result=await findCompressionCandidate({width:image.width,height:image.height},{...options,maxDurationMs:Math.max(10,deadline-now())},async candidate=>{
      check(options.signal,deadline);const target=canvasAt(candidate.width,candidate.height);
      if(config.type==='image/jpeg'&&options.flattenBackground){target.context.fillStyle=options.flattenBackground;target.context.fillRect(0,0,candidate.width,candidate.height);}
      target.context.imageSmoothingEnabled=true;target.context.imageSmoothingQuality='high';target.context.drawImage(source.canvas,0,0,candidate.width,candidate.height);
      try{return await controlled(encoded(target.canvas,candidate.type,candidate.quality),options.signal,deadline);}finally{target.canvas.width=target.canvas.height=1;}
    });
    return {...result,elapsedMs:Math.round(now()-started),originalBytes:blob.size,sourceWidth:image.width,sourceHeight:image.height,hadAlpha,alphaPreserved:hadAlpha&&config.type!=='image/jpeg',flattened:hadAlpha&&config.type==='image/jpeg'};
  }finally{image.close();if(sourceCanvas)sourceCanvas.width=sourceCanvas.height=1;}
}

export interface PreviewVersion {image:Blob;title:string;channel?:string;}
/** Cyclic pairing follows max(N images,N titles), never their Cartesian product. */
export function buildCyclicVersions(images:readonly Blob[],titles:readonly string[],channel='Seu canal'):PreviewVersion[]{
  const clean=titles.map(title=>title.trim()).filter(Boolean);
  if(images.length>6||clean.length>6)throw new Error('Use até 6 imagens e 6 títulos por prévia.');
  if(!images.length)return[];
  const labels=clean.length?clean:['Título do vídeo'];
  return Array.from({length:Math.max(images.length,labels.length)},(_,index)=>({image:images[index%images.length],title:labels[index%labels.length],channel}));
}
export interface HomePreviewOptions {
  original:PreviewVersion;candidate:PreviewVersion;candidates?:PreviewVersion[];
  context?:'desktop'|'mobile'|'list';mode?:'side-by-side'|'original'|'candidate'|'gallery';
  theme?:'dark'|'light';position?:'first'|'random';seed?:number;
  feed?:'home'|'trending'|'subscriptions'|'channel'|'search';feedLabel?:string;contextVideos?:readonly VideoRecord[];
  metadata?:{views?:string;date?:string;duration?:string};avatar?:Blob;signal?:AbortSignal;
}
function lines(context:CanvasRenderingContext2D,text:string,width:number,maxLines:number):string[]{
  const words=text.replace(/\s+/g,' ').trim().split(' '),result:string[]=[];let line='';
  for(let index=0;index<words.length;index++){
    const next=line?`${line} ${words[index]}`:words[index];
    if(context.measureText(next).width>width&&line){result.push(line);line=words[index];if(result.length===maxLines-1){line=[line,...words.slice(index+1)].join(' ');break;}}else line=next;
  }
  if(result.length<maxLines&&line)result.push(line);
  return result.map(value=>{let clipped=value;while(clipped&&context.measureText(`${clipped}…`).width>width)clipped=clipped.slice(0,-1);return clipped===value?value:`${clipped}…`;});
}
function drawCover(context:CanvasRenderingContext2D,image:Decoded,x:number,y:number,width:number,height:number){
  const scale=Math.max(width/image.width,height/image.height);context.save();context.beginPath();context.roundRect(x,y,width,height,9);context.clip();context.drawImage(image.source,x+(width-image.width*scale)/2,y+(height-image.height*scale)/2,image.width*scale,image.height*scale);context.restore();
}
function layout(width:number,count:number,kind:'desktop'|'mobile'|'list'){
  const columns=kind==='desktop'?(width>900?3:2):1;
  const inset=kind==='desktop'?52:18,gap=18,cardWidth=(width-inset-18-(columns-1)*gap)/columns;
  const thumbWidth=kind==='list'?Math.min(310,cardWidth*0.4):cardWidth;
  const thumbHeight=thumbWidth*9/16,rowHeight=kind==='list'?Math.max(thumbHeight+24,140):thumbHeight+137;
  return {columns,inset,gap,cardWidth,thumbWidth,thumbHeight,rowHeight,height:184+Math.ceil(count/columns)*rowHeight+24};
}
interface PreviewCard {image?:Decoded;version?:PreviewVersion;observed?:VideoRecord;}
function contextCards(versions:PreviewVersion[],images:Map<Blob,Decoded>,position:'first'|'random',seed:number,records:readonly VideoRecord[]=[]):PreviewCard[]{
  const cards:PreviewCard[]=versions.map(version=>({version,image:images.get(version.image)}));
  const observed=records.filter(record=>record.source!=='youtube-data-api'&&typeof record.title==='string'&&record.title.trim()).slice(0,8);
  const surrounding:PreviewCard[]=observed.length?observed.map(record=>({observed:record})): [{},{}];
  const before=position==='first'?0:Math.abs(Math.trunc(seed))%(surrounding.length+1);
  return [...surrounding.slice(0,before),...cards,...surrounding.slice(before)];
}
function viewport(context:CanvasRenderingContext2D,cards:PreviewCard[],avatar:Decoded|undefined,x:number,y:number,width:number,kind:'desktop'|'mobile'|'list',label:string,options:HomePreviewOptions){
  const dark=(options.theme??'dark')==='dark',palette=dark?{background:'#151820',text:'#f4f5fb',muted:'#aab4c8',surface:'#2e3544'}:{background:'#f8f9fc',text:'#1b2030',muted:'#5d687c',surface:'#e0e5ef'};
  const grid=layout(width,cards.length,kind);
  context.save();context.translate(x,y);context.fillStyle=palette.background;context.fillRect(0,0,width,grid.height);
  context.fillStyle=palette.text;context.font='bold 19px sans-serif';context.fillText(label,18,32);
  const feed=options.feed??'home',feedNames={home:'Página inicial',trending:'Em alta',subscriptions:'Inscrições',channel:`Canal: ${options.feedLabel||'Seu canal'}`,search:`Busca: ${options.feedLabel||'termo de exemplo'}`};
  context.fillStyle=palette.muted;context.font='13px sans-serif';context.fillText(`${feedNames[feed]} · ${kind==='mobile'?'celular':kind==='list'?'lista':'desktop'} · ${dark?'escuro':'claro'}`,18,56,width-36);
  context.fillStyle=palette.surface;context.fillRect(16,75,width-32,38);context.fillStyle=palette.muted;context.fillText('Pesquisar vídeos',30,100);
  const chips={home:['Tudo','Para você','Recentes'],trending:['Em alta','Música','Jogos'],subscriptions:['Inscritos','Hoje','Recentes'],channel:['Vídeos','Populares','Recentes'],search:['Relevância','Recentes','Filtros']}[feed];
  for(const [index,text] of chips.entries()){context.fillStyle=index===0?'#7464da':palette.surface;context.fillRect(18+index*100,129,90,29);context.fillStyle=index===0?'#fff':palette.text;context.fillText(text,28+index*100,149);}
  if(kind==='desktop'){context.fillStyle=palette.surface;for(let row=0;row<5;row++)context.fillRect(16,195+row*48,22,23);}
  cards.forEach((card,index)=>{
    const cardX=grid.inset+(index%grid.columns)*(grid.cardWidth+grid.gap),cardY=184+Math.floor(index/grid.columns)*grid.rowHeight;
    const textX=kind==='list'?cardX+grid.thumbWidth+18:cardX+42,textY=kind==='list'?cardY+21:cardY+grid.thumbHeight+28,textWidth=kind==='list'?grid.cardWidth-grid.thumbWidth-22:grid.cardWidth-46;
    if(card.image)drawCover(context,card.image,cardX,cardY,grid.thumbWidth,grid.thumbHeight);
    else {context.fillStyle=palette.surface;context.fillRect(cardX,cardY,grid.thumbWidth,grid.thumbHeight);context.fillStyle=palette.muted;context.font='13px sans-serif';context.fillText(card.observed?'Imagem não carregada · amostra':'Contexto ilustrativo',cardX+12,cardY+grid.thumbHeight/2,grid.thumbWidth-24);}
    if(card.version){
      const duration=(options.metadata?.duration??'10:00').slice(0,20);context.font='bold 12px sans-serif';const badgeWidth=Math.min(grid.thumbWidth-8,context.measureText(duration).width+12);context.fillStyle='#000c';context.fillRect(cardX+grid.thumbWidth-badgeWidth-5,cardY+grid.thumbHeight-24,badgeWidth,19);context.fillStyle='#fff';context.fillText(duration,cardX+grid.thumbWidth-badgeWidth+1,cardY+grid.thumbHeight-10,badgeWidth-8);
      if(kind!=='list'){
        context.save();context.beginPath();context.arc(cardX+16,cardY+grid.thumbHeight+25,16,0,Math.PI*2);context.clip();
        if(avatar)drawCover(context,avatar,cardX,cardY+grid.thumbHeight+9,32,32);else {context.fillStyle='#7464da';context.fillRect(cardX,cardY+grid.thumbHeight+9,32,32);context.fillStyle='#fff';context.font='bold 17px sans-serif';context.fillText((card.version.channel||'P').slice(0,1).toUpperCase(),cardX+10,cardY+grid.thumbHeight+31);}context.restore();
      }
    }else if(card.observed?.durationSeconds!==undefined&&Number.isFinite(card.observed.durationSeconds)&&card.observed.durationSeconds>=0){
      const seconds=Math.floor(card.observed.durationSeconds),duration=seconds>=3600?`${Math.floor(seconds/3600)}:${String(Math.floor(seconds%3600/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`:`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
      context.font='bold 12px sans-serif';const badgeWidth=context.measureText(duration).width+12;context.fillStyle='#000c';context.fillRect(cardX+grid.thumbWidth-badgeWidth-5,cardY+grid.thumbHeight-24,badgeWidth,19);context.fillStyle='#fff';context.fillText(duration,cardX+grid.thumbWidth-badgeWidth+1,cardY+grid.thumbHeight-10);
    }
    context.fillStyle=palette.text;context.font='bold 15px sans-serif';lines(context,card.version?.title||card.observed?.title||'Outro vídeo · cartão de contexto',textWidth,2).forEach((line,row)=>context.fillText(line,textX,textY+row*20));
    context.fillStyle=palette.muted;context.font='12px sans-serif';context.fillText((card.version?.channel||(card.observed?card.observed.channel||'Canal indisponível':'Canal ilustrativo')).slice(0,80),textX,textY+51,textWidth);
    context.fillText(card.version?(options.metadata?.views||'Visualizações de exemplo').slice(0,80):card.observed?(card.observed.views===undefined?'Views indisponíveis':`${new Intl.NumberFormat('pt-BR').format(card.observed.views)} visualizações · amostra`):'Metadados ilustrativos',textX,textY+70,textWidth);
    context.fillText(card.version?(options.metadata?.date||'Data de exemplo').slice(0,80):card.observed?`${card.observed.publishedAt?.slice(0,10)||'Data indisponível'} · ${card.observed.source||'amostra enviada'}`:'Sem dados de audiência',textX,textY+88,textWidth);
  });
  context.restore();return grid.height;
}

/** Own Home-like cards made from user files; no platform changes or audience experiment. */
export async function renderHomePreview(options:HomePreviewOptions):Promise<Blob>{
  const kind=options.context??'desktop',mode=options.mode??'gallery',theme=options.theme??'dark',position=options.position??'first';
  if(!['home','trending','subscriptions','channel','search'].includes(options.feed??'home'))throw new Error('Contexto de feed inválido.');
  if(!['desktop','mobile','list'].includes(kind)||!['side-by-side','original','candidate','gallery'].includes(mode)||!['dark','light'].includes(theme)||!['first','random'].includes(position))throw new Error('Contexto ou comparação de prévia inválidos.');
  const versions=options.candidates?.length?options.candidates:[options.candidate];
  if(versions.length>24)throw new Error('Use no máximo 24 combinações de imagem e título por prévia.');
  const deadline=now()+10000,cache=new Map<Blob,Decoded>();
  const decodePreview=async(blob:Blob,maxWidth=1280,maxHeight=720)=>{
    if(cache.has(blob))return;
    const source=await decode(blob,options.signal,deadline);
    try{const size=fitDimensions(source.width,source.height,maxWidth,maxHeight),target=canvasAt(size.width,size.height);target.context.drawImage(source.source,0,0,size.width,size.height);cache.set(blob,{source:target.canvas,...size,close:()=>{target.canvas.width=target.canvas.height=1;}});}finally{source.close();}
  };
  try{
    const needed=mode==='gallery'?versions:mode==='original'?[options.original]:mode==='candidate'?[options.candidate]:[options.original,options.candidate];
    for(const version of needed)await decodePreview(version.image);
    if(options.avatar)await decodePreview(options.avatar,96,96);
    check(options.signal,deadline);
    const seed=options.seed??17,panels=mode==='side-by-side'?[[options.original],[options.candidate]]:mode==='original'?[[options.original]]:mode==='candidate'?[[options.candidate]]:[versions];
    const panelWidth=kind==='mobile'?450:mode==='side-by-side'?604:1232,gap=24;
    const cards=panels.map(versions=>contextCards(versions,cache,position,seed,options.contextVideos));
    const height=Math.ceil(Math.max(...cards.map(items=>layout(panelWidth,items.length,kind).height))+136),width=1280;
    const {canvas,context}=canvasAt(width,height);context.fillStyle=theme==='dark'?'#090d15':'#e9edf5';context.fillRect(0,0,width,height);context.fillStyle=theme==='dark'?'#c7bfff':'#45368a';context.font='bold 21px sans-serif';context.fillText('Prevlev · prévia local de thumbnails e títulos',24,36);
    context.font='14px sans-serif';context.fillText('Composição ilustrativa. Sem teste A/B, CTR ou previsão de desempenho.',24,63);
    const totalWidth=panels.length*panelWidth+(panels.length-1)*gap,start=(width-totalWidth)/2;
    cards.forEach((items,index)=>viewport(context,items,options.avatar?cache.get(options.avatar):undefined,start+index*(panelWidth+gap),90,panelWidth,kind,mode==='side-by-side'?(index===0?'Original':'Candidata'):mode==='original'?'Original':mode==='candidate'?'Candidata':'Variações locais',options));
    context.font='12px sans-serif';context.fillText(options.contextVideos?.some(video=>video.source!=='youtube-data-api')?'Contexto: amostra carregada, sem buscar imagens; não comprova o feed selecionado. Candidatas: arquivos e metadados do usuário.':'Contexto ilustrativo · arquivos e metadados de exemplo do usuário · nenhum envio',24,height-16,width-48);
    return await controlled(encoded(canvas,'image/png'),options.signal,deadline);
  }finally{for(const image of cache.values())image.close();}
}
