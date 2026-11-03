import type {VideoRecord} from '../shared/types';
import {videoIdFromUrl} from '../core/parse';
import {downloadBlob,fetchThumbnail,loadImage} from '../core/media';
import {decodeImageBitmap,preflightImage} from '../core/image-preflight';

export interface VideoActionsOptions {
  video:VideoRecord;
  /** Must bind the item to the host dataset/revision, not only to a reused row node. */
  isCurrent:(captured:Readonly<VideoRecord>)=>boolean;
  notice?:(message:string,error?:boolean)=>void;
  /** Optional authorized thumbnail transport. No call occurs until an asset button is clicked. */
  thumbnail?:(id:string,signal:AbortSignal)=>Promise<Blob>;
}
export interface VideoActions {close():void;dispose():void;}
const inputLimits={maxBytes:5*1024*1024,maxPixels:32_000_000,maxDimension:16384};
const outputLimits={...inputLimits,maxBytes:16*1024*1024};
const fingerprint=(video:Readonly<VideoRecord>)=>JSON.stringify([video.id,video.url,video.title,video.source,video.thumbnail]);
function identityProblem(video:Readonly<VideoRecord>):string|undefined {
  if(!/^[A-Za-z0-9_-]{11}$/.test(video.id))return 'ID de vídeo inválido. Atualize a amostra antes de usar estas ações.';
  try {
    const url=new URL(video.url),pathId=url.hostname==='youtu.be'?url.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/)?.[1]:url.pathname==='/watch'&&url.searchParams.getAll('v').length===1?url.searchParams.get('v'):url.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})\/?$/)?.[1];
    if(url.protocol==='https:'&&!url.port&&!url.username&&!url.password&&pathId===video.id&&videoIdFromUrl(url.href)===video.id)return;
  }catch{/* Invalid record identity is refused without consulting any source. */}
  return 'O ID e a URL deste item não identificam o mesmo vídeo HTTPS do YouTube. Atualize a amostra.';
}
const aborted=()=>new DOMException('Ação do item cancelada.','AbortError');
function bounded<T>(work:Promise<T>,signal:AbortSignal,deadline:number):Promise<T> {
  return new Promise((resolve,reject)=>{
    let settled=false;
    const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);};
    const fail=(error:unknown)=>{if(settled)return;settled=true;cleanup();reject(error);};
    const cancel=()=>fail(aborted());
    const timer=setTimeout(()=>fail(new Error('Tempo limite da ação de imagem. Nenhum resultado tardio será usado.')),Math.max(0,deadline-performance.now()));
    signal.addEventListener('abort',cancel,{once:true});
    work.then(value=>{if(settled)return;if(signal.aborted)return fail(aborted());if(performance.now()>=deadline)return fail(new Error('Tempo limite da ação de imagem.'));settled=true;cleanup();resolve(value);},fail);
    if(signal.aborted)cancel();
  });
}
/** Normalize only validated, bounded static pixels. No provider URL reaches an image decoder. */
async function thumbnailPng(blob:Blob,doc:Document,signal:AbortSignal,deadline:number,check:()=>void):Promise<Blob> {
  await preflightImage(blob,{...inputLimits,signal,deadline});check();
  let source:CanvasImageSource,width:number,height:number,release:()=>void;
  if(typeof createImageBitmap==='function'){
    const bitmap=await decodeImageBitmap(blob,{...inputLimits,signal,deadline});source=bitmap;width=bitmap.width;height=bitmap.height;release=()=>bitmap.close();
  }else{
    const image=await loadImage(blob,{...inputLimits,signal,deadline});source=image;width=image.naturalWidth;height=image.naturalHeight;release=()=>image.removeAttribute('src');
  }
  const canvas=doc.createElement('canvas');
  try {
    check();canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');if(!context)throw new Error('Canvas 2D indisponível para preparar o PNG local.');context.drawImage(source,0,0);
    const png=await bounded(new Promise<Blob>((resolve,reject)=>{try{canvas.toBlob(value=>value?.type==='image/png'?resolve(value):reject(new Error('O navegador não retornou PNG compatível.')),'image/png');}catch{reject(new Error('Não foi possível preparar o PNG local.'));}}),signal,deadline);
    check();await preflightImage(png,{...outputLimits,signal,deadline});check();return png;
  }finally{release();canvas.width=canvas.height=1;}
}

/** Explicit per-item actions for a local/public sample. Mount/open/hover never fetch media. */
export function mountVideoActions(host:HTMLElement,options:VideoActionsOptions):VideoActions {
  const doc=host.ownerDocument,original=options.video,video=Object.freeze({...original}),signature=fingerprint(video),problem=identityProblem(video);
  const blockedAssets=video.source==='youtube-data-api'?'Ativos e busca visual indisponíveis para itens da YouTube Data API. Use uma amostra local separada.':![undefined,'youtube-dom','public-page','user-provided'].includes(video.source)?'Origem deste item não reconhecida para ações de imagem.':undefined;
  const root=doc.createElement('div');root.dataset.videoActions='';
  root.innerHTML='<button type="button" data-video-actions-trigger aria-expanded="false">Ações do vídeo</button><div data-video-actions-menu hidden role="group"><p data-video-actions-title></p><div data-video-actions-buttons></div><p data-video-actions-hint></p><p data-video-actions-status role="status" aria-live="polite"></p><button type="button" data-video-actions-close>Fechar ações</button></div>';
  host.append(root);
  const trigger=root.querySelector<HTMLButtonElement>('[data-video-actions-trigger]')!,menu=root.querySelector<HTMLElement>('[data-video-actions-menu]')!,buttons=root.querySelector<HTMLElement>('[data-video-actions-buttons]')!,output=root.querySelector<HTMLElement>('[data-video-actions-status]')!;
  root.querySelector<HTMLElement>('[data-video-actions-title]')!.textContent=video.title;
  menu.setAttribute('aria-label',`Ações de ${video.title}`);
  root.querySelector<HTMLElement>('[data-video-actions-hint]')!.textContent=problem??blockedAssets??'Imagens só são obtidas ao clicar em baixar/copiar. A URL usa o CDN público padrão deste ID. A busca visual abre outro serviço somente pelo link explícito.';
  const thumbnailUrl=`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
  let disposed=false,epoch=0,controller:AbortController|undefined,busy=false;
  const actions:{button:HTMLButtonElement;asset:boolean}[]=[];
  const update=()=>{for(const action of actions)action.button.disabled=busy||!!problem||action.asset&&!!blockedAssets;};
  const current=()=>{
    if(disposed||!host.isConnected||!root.isConnected||fingerprint(original)!==signature)return false;
    try{return options.isCurrent(video);}catch{return false;}
  };
  const status=(message:string,error=false)=>{output.textContent=message;options.notice?.(message,error);};
  function close(){epoch++;controller?.abort();controller=undefined;busy=false;menu.hidden=true;trigger.setAttribute('aria-expanded','false');update();}
  function requireCurrent(mine:number,signal:AbortSignal){
    if(signal.aborted||disposed||mine!==epoch||menu.hidden)throw aborted();
    if(!current()){close();status('O item ou a amostra mudou; nenhum resultado tardio foi usado. Abra as ações do item atual.',true);throw aborted();}
  }
  function action(label:string,key:string,asset:boolean,task:(signal:AbortSignal,check:()=>void,deadline:number)=>Promise<void>){
    const button=doc.createElement('button');button.type='button';button.textContent=label;button.dataset.videoAction=key;buttons.append(button);actions.push({button,asset});
    button.addEventListener('click',()=>{
      if(busy||disposed)return;
      if(problem||asset&&blockedAssets){status(problem??blockedAssets!,true);return;}
      if(!current()){close();status('O item ou a amostra mudou. Abra as ações do item atual.',true);return;}
      const mine=epoch,active=new AbortController(),deadline=performance.now()+15_000;controller=active;busy=true;update();
      const check=()=>requireCurrent(mine,active.signal);
      void Promise.resolve().then(async()=>{check();await task(active.signal,check,deadline);check();status(`${label}: ação concluída para ${video.id}.`);}).catch(error=>{
        if(disposed||mine!==epoch||active.signal.aborted)return;
        status(error instanceof Error?error.message:'Não foi possível concluir a ação deste item.',true);
      }).finally(()=>{if(controller===active){controller=undefined;busy=false;update();}});
    });
  }
  const text=async(value:string,check:()=>void)=>{const clipboard=doc.defaultView?.navigator.clipboard;if(!clipboard?.writeText)throw new Error('Área de transferência indisponível neste navegador.');check();await clipboard.writeText(value);};
  action('Copiar título','copy-title',false,async(_signal,check)=>text(video.title,check));
  action('Copiar ID','copy-id',false,async(_signal,check)=>text(video.id,check));
  action('Copiar URL da thumbnail','copy-thumbnail-url',true,async(_signal,check)=>text(thumbnailUrl,check));
  const image=async(signal:AbortSignal,check:()=>void,deadline:number)=>{check();const blob=await bounded((options.thumbnail??fetchThumbnail)(video.id,signal),signal,deadline);check();return thumbnailPng(blob,doc,signal,deadline,check);};
  action('Baixar thumbnail PNG','download-png',true,async(signal,check,deadline)=>{const png=await image(signal,check,deadline);check();downloadBlob(png,`prevlev-${video.id}.png`);});
  action('Copiar thumbnail PNG','copy-png',true,async(signal,check,deadline)=>{const clipboard=doc.defaultView?.navigator.clipboard,Item=doc.defaultView?.ClipboardItem;if(!clipboard?.write||typeof Item!=='function')throw new Error('Cópia de PNG indisponível. Use Baixar thumbnail PNG.');const png=await image(signal,check,deadline);check();await clipboard.write([new Item({'image/png':png})]);});
  if(!problem&&!blockedAssets){
    const lens=doc.createElement('a');lens.dataset.videoActionsLens='';lens.textContent='Busca visual no Google Lens ↗';lens.href=`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(thumbnailUrl)}`;lens.target='_blank';lens.rel='noopener noreferrer';lens.referrerPolicy='no-referrer';
    lens.addEventListener('click',event=>{const stale=!current();if(busy||menu.hidden||stale){event.preventDefault();if(stale){close();status('O item ou a amostra mudou. O link externo foi recusado.',true);}}});buttons.append(lens);
  }
  trigger.addEventListener('click',()=>{if(!menu.hidden){close();return;}if(!current()){close();status('O item ou a amostra mudou. Abra as ações do item atual.',true);return;}menu.hidden=false;trigger.setAttribute('aria-expanded','true');output.textContent='';update();});
  root.querySelector('[data-video-actions-close]')!.addEventListener('click',()=>{close();if(trigger.isConnected)trigger.focus();});
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!menu.hidden){event.preventDefault();close();trigger.focus();}};root.addEventListener('keydown',escape);update();
  return{close,dispose(){if(disposed)return;close();disposed=true;root.removeEventListener('keydown',escape);root.remove();}};
}
