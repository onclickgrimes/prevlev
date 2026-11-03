import type {CommentRecord,PageSnapshot,VideoRecord} from '../shared/types';
import {videoIdFromUrl} from '../core/parse';
import {readComments,readVideoCards} from './youtube';

export type CollectionKind='videos'|'comments';
export type CollectionPhase='idle'|'running'|'completed'|'stopped'|'cancelled'|'error';
export interface CollectionOptions {kind:CollectionKind;maxItems?:number;maxSteps?:number;timeoutMs?:number;}
export interface CollectionState {jobId?:string;kind?:CollectionKind;phase:CollectionPhase;collectedCount:number;steps:number;maxItems:number;maxSteps:number;timeoutMs:number;url:string;videoId?:string;startedAt?:string;finishedAt?:string;reason:string;limitations:string[];}
export interface CollectionController {start(options:CollectionOptions):CollectionState;status(jobId?:string):CollectionState;cancel(jobId?:string):CollectionState;snapshot(jobId?:string):PageSnapshot|undefined;subscribe(listener:(state:CollectionState)=>void):()=>void;dispose():void;}
interface Job {state:CollectionState;title:string;videoIdentity:string;region:HTMLElement;abort:AbortController;timer?:ReturnType<typeof setTimeout>;promise?:Promise<void>;records:Map<string,VideoRecord|CommentRecord>;original:{x:number;y:number;top:number;left:number};internalScroll:boolean;invalidContext:boolean;cleanup:()=>void;}
const limitations=[
  'Coleta parcial dos itens reconhecidos pelo DOM; não garante o catálogo completo nem todos os comentários.',
  'Rola somente o feed ou a seção de comentários reconhecida. Não clica em botões, recomendações ou expansão de respostas.',
  'A página do YouTube pode carregar itens pela sua sessão normal ao rolar; o Prevlev não chama APIs privadas nem serviços de IA nesta coleta.',
  'Limites máximos: 500 itens, 30 rolagens e 60 segundos. Três etapas sem novos IDs encerram a coleta.',
];
const controllers=new WeakMap<Document,CollectionController>();
function bounded(value:unknown,fallback:number,min:number,max:number,name:string):number {if(value===undefined)return fallback;if(typeof value!=='number'||!Number.isInteger(value)||value<min||value>max)throw new Error(`${name} deve ser um inteiro entre ${min} e ${max}.`);return value;}
function normalize(input:CollectionOptions):Required<CollectionOptions>{if(!input||!['videos','comments'].includes(input.kind))throw new Error('Escolha vídeos ou comentários para coletar.');return{kind:input.kind,maxItems:bounded(input.maxItems,200,1,500,'Quantidade'),maxSteps:bounded(input.maxSteps,10,1,30,'Etapas'),timeoutMs:bounded(input.timeoutMs,30000,1000,60000,'Tempo em milissegundos')};}
function videoIdentity(doc:Document):string {const route=videoIdFromUrl(doc.location.href);if(!route)return '';const raw=doc.querySelector('ytd-watch-flexy[video-id]')?.getAttribute('video-id')??doc.querySelector<HTMLMetaElement>('meta[itemprop="videoId"]')?.content;const displayed=raw&&/^[\w-]{11}$/.test(raw)?raw:route;return `${route}:${displayed}`;}
function regionFor(doc:Document,kind:CollectionKind):HTMLElement {
  if(doc.location?.hostname!=='www.youtube.com')throw new Error('Esta coleta exige uma página pública do YouTube aberta.');
  const selectors=kind==='comments'?'ytd-comments ytd-item-section-renderer #contents,ytd-comments #contents,ytd-comments':'ytd-rich-grid-renderer,ytd-grid-renderer,ytd-search ytd-item-section-renderer,ytd-browse ytd-section-list-renderer,ytd-search ytd-section-list-renderer';
  const regions=Array.from(doc.querySelectorAll<HTMLElement>(selectors));
  const found=kind==='videos'?regions.find(region=>readVideoCards(doc).some(card=>region.contains(card.element))):regions.find(region=>readComments(region).length>0)??regions[0];
  if(!found)throw new Error(kind==='comments'?'Abra a seção de comentários do YouTube. O feed não foi reconhecido.':'Abra uma grade ou feed de vídeos do YouTube reconhecido para coletar.');return found;
}
function pause(milliseconds:number,signal:AbortSignal):Promise<void>{return new Promise((resolve,reject)=>{if(signal.aborted){reject(new Error('cancelled'));return;}const abort=()=>{clearTimeout(timer);reject(new Error('cancelled'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},milliseconds);signal.addEventListener('abort',abort,{once:true});});}

/** A document-local, explicitly started collector. Constructing it performs no read, scroll or network work. */
export function createCollectionController(doc:Document=document):CollectionController {
  const existing=controllers.get(doc);if(existing)return existing;
  let current:Job|undefined;const subscribers=new Set<(state:CollectionState)=>void>();
  const contextMatches=(job:Job)=>!job.invalidContext&&doc.location.href===job.state.url&&videoIdentity(doc)===job.videoIdentity;
  const getState=():CollectionState=>current?{...current.state,limitations:[...current.state.limitations]}:{phase:'idle',collectedCount:0,steps:0,maxItems:0,maxSteps:0,timeoutMs:0,url:doc.location?.href??'',reason:'Nenhuma coleta iniciada.',limitations:[...limitations]};
  const emit=()=>{const state=getState();for(const listener of subscribers)try{listener(state);}catch{/* UI listeners cannot extend the job. */}};
  function selected(jobId?:string):Job|undefined{if(jobId!==undefined&&(!current||current.state.jobId!==jobId))throw new Error('Esta coleta não é mais a coleta atual da aba.');return current;}
  function finish(job:Job,phase:CollectionPhase,reason:string,restore=true):void {
    if(job.state.phase!=='running')return;job.state.phase=phase;job.state.reason=reason;job.state.finishedAt=new Date().toISOString();job.abort.abort();if(job.timer)clearTimeout(job.timer);job.timer=undefined;job.cleanup();
    if(restore&&contextMatches(job)&&job.region.isConnected){try{if(job.internalScroll){job.region.scrollTop=job.original.top;job.region.scrollLeft=job.original.left;}else doc.defaultView?.scrollTo({left:job.original.x,top:job.original.y,behavior:'instant'});}catch{/* The browser may be closing the document. */}}
    emit();
  }
  function scan(job:Job):number {
    if(!contextMatches(job)||!job.region.isConnected){finish(job,'cancelled','A página, o vídeo ou o feed mudou; a coleta foi interrompida.',false);return 0;}
    const at=new Date().toISOString();
    const entries:(VideoRecord|CommentRecord)[]=job.state.kind==='videos'?readVideoCards(doc).filter(card=>job.region.contains(card.element)).map(card=>({...card.video,source:'youtube-dom' as const,observedAt:at})):readComments(job.region);
    let added=0;for(const record of entries){if(!record.id||job.records.has(record.id))continue;job.records.set(record.id,{...record});added++;if(job.records.size>=job.state.maxItems)break;}
    job.state.collectedCount=job.records.size;emit();return added;
  }
  async function run(job:Job):Promise<void> {
    try {
      scan(job);if(job.state.phase!=='running')return;if(job.records.size>=job.state.maxItems){finish(job,'completed','Limite de itens atingido; o resultado continua sendo uma amostra parcial.');return;}
      let stalls=0;
      while(job.state.phase==='running'&&job.state.steps<job.state.maxSteps){
        if(!contextMatches(job)||!job.region.isConnected){finish(job,'cancelled','O contexto da página mudou; nenhuma nova rolagem foi feita.',false);return;}
        job.state.steps++;if(job.internalScroll)job.region.scrollTop=Math.max(job.region.scrollHeight-job.region.clientHeight,0);else {if(typeof job.region.scrollIntoView!=='function')throw new Error('unsupported-scroll');job.region.scrollIntoView({block:'end',behavior:'instant'});}emit();
        await pause(500,job.abort.signal);if(job.state.phase!=='running')return;
        const added=scan(job);if(job.state.phase!=='running')return;
        if(job.records.size>=job.state.maxItems){finish(job,'completed','Limite de itens atingido; o resultado continua sendo uma amostra parcial.');return;}
        stalls=added?0:stalls+1;if(stalls>=3){finish(job,'stopped','Três etapas sem novos IDs reconhecidos. Isso não comprova que todos os itens foram carregados.');return;}
      }
      if(job.state.phase==='running')finish(job,'stopped','Limite de rolagens atingido; a coleta é parcial.');
    }catch{if(job.state.phase==='running')finish(job,'error','Não foi possível continuar a leitura ou rolagem neste layout. Os itens já observados foram preservados.');}
  }
  const controller:CollectionController={
    start(input){if(current?.state.phase==='running')throw new Error('Uma coleta já está em andamento nesta aba. Cancele-a ou aguarde.');const options=normalize(input),region=regionFor(doc,options.kind),identity=videoIdentity(doc);if(identity&&new Set(identity.split(':')).size!==1)throw new Error('A identidade do vídeo ainda está mudando. Aguarde o YouTube terminar a navegação.');const job:Job={state:{jobId:crypto.randomUUID(),...options,phase:'running',collectedCount:0,steps:0,url:doc.location.href,videoId:videoIdFromUrl(doc.location.href),startedAt:new Date().toISOString(),reason:'Lendo os itens carregados e rolando somente o feed reconhecido.',limitations:[...limitations]},title:doc.title.replace(/\s*- YouTube$/,''),videoIdentity:identity,region,abort:new AbortController(),records:new Map(),original:{x:doc.defaultView?.scrollX??0,y:doc.defaultView?.scrollY??0,top:region.scrollTop,left:region.scrollLeft},internalScroll:region.scrollHeight>region.clientHeight&&/auto|scroll/.test(doc.defaultView?.getComputedStyle(region).overflowY??''),invalidContext:false,cleanup:()=>{}};
      const onNavigate=()=>{job.invalidContext=true;finish(job,'cancelled','Navegação detectada. Os resultados pertencem à página anterior e não foram mesclados.',false);};const onHide=()=>{job.invalidContext=true;finish(job,'cancelled','A página foi fechada ou suspensa; a coleta foi encerrada.',false);};doc.addEventListener('yt-navigate-start',onNavigate);doc.addEventListener('yt-navigate-finish',onNavigate);doc.defaultView?.addEventListener('pagehide',onHide);job.cleanup=()=>{doc.removeEventListener('yt-navigate-start',onNavigate);doc.removeEventListener('yt-navigate-finish',onNavigate);doc.defaultView?.removeEventListener('pagehide',onHide);};current=job;job.timer=setTimeout(()=>finish(job,'stopped','Tempo máximo atingido; a coleta é parcial.'),options.timeoutMs);emit();job.promise=run(job);return getState();},
    status(jobId){selected(jobId);return getState();},
    cancel(jobId){const job=selected(jobId);if(job?.state.phase==='running')finish(job,'cancelled','Coleta cancelada pelo usuário; itens já observados foram preservados.');return getState();},
    snapshot(jobId){const job=selected(jobId);if(!job||job.state.phase==='running')return undefined;return{url:job.state.url,title:job.title,videoId:job.state.videoId,videos:job.state.kind==='videos'?Array.from(job.records.values(),record=>({...record} as VideoRecord)):[],comments:job.state.kind==='comments'?Array.from(job.records.values(),record=>({...record} as CommentRecord)):[],transcript:[],warnings:[...limitations,job.state.reason,`Foram observados ${job.records.size} IDs em ${job.state.steps} rolagens. Nenhum dado foi preenchido para itens ausentes.`]};},
    subscribe(listener){subscribers.add(listener);listener(getState());return()=>subscribers.delete(listener);},
    dispose(){const job=current;if(job?.state.phase==='running'){job.invalidContext=true;finish(job,'cancelled','A página foi suspensa ou substituída; a coleta foi encerrada.',false);}job?.cleanup();},
  };controllers.set(doc,controller);return controller;
}

/** Compact user controls; progress subscriptions contain counts only, not the collected dataset. */
export function mountCollectionControls(container:HTMLElement,collector:CollectionController,onUse:(snapshot:PageSnapshot)=>Promise<void>):()=>void {
  container.innerHTML='<fieldset><legend>Coleta assistida, por rolagem</legend><label>Itens<select id="prevlev-collection-kind"><option value="videos">Vídeos do feed/grade</option><option value="comments">Comentários abertos</option></select></label><label>Máximo de itens<input id="prevlev-collection-limit" type="number" min="1" max="500" value="200"></label><div class="row"><button id="prevlev-collection-start">Iniciar coleta</button><button id="prevlev-collection-cancel" disabled>Cancelar</button><button id="prevlev-collection-use" disabled>Abrir coleta no painel</button></div><p id="prevlev-collection-status" role="status"></p><p>Até 30 rolagens e 60 s; não expande respostas. O resultado é parcial. A posição é restaurada quando o contexto permanece igual.</p></fieldset>';
  const field=<T extends HTMLElement=HTMLElement>(id:string)=>container.querySelector<T>(`#prevlev-collection-${id}`)!;let using=false;
  const unsubscribe=collector.subscribe(state=>{const running=state.phase==='running';field<HTMLButtonElement>('start').disabled=running;field<HTMLButtonElement>('cancel').disabled=!running;field<HTMLButtonElement>('use').disabled=running||!state.collectedCount||using;field('status').textContent=`${state.collectedCount} itens · ${state.steps} rolagens · ${state.reason}`;});
  field('start').addEventListener('click',()=>{try{collector.start({kind:field<HTMLSelectElement>('kind').value as CollectionKind,maxItems:Number(field<HTMLInputElement>('limit').value),maxSteps:30,timeoutMs:60000});}catch(error){field('status').textContent=error instanceof Error?error.message:String(error);}});
  field('cancel').addEventListener('click',()=>{collector.cancel();});
  field('use').addEventListener('click',()=>{const snapshot=collector.snapshot();if(!snapshot||using)return;using=true;field<HTMLButtonElement>('use').disabled=true;void onUse(snapshot).catch((error:unknown)=>{field('status').textContent=error instanceof Error?error.message:String(error);}).finally(()=>{using=false;field<HTMLButtonElement>('use').disabled=false;});});
  return unsubscribe;
}
