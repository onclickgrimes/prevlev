// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.youtube.com/"}
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createCollectionController,mountCollectionControls,type CollectionController} from '../src/content/collection';

let collector:CollectionController,scroll:ReturnType<typeof vi.fn>;
const video=(id:string,views?:number)=>`<ytd-video-renderer><a id="video-title" href="/watch?v=${id}">Vídeo ${id}</a>${views===undefined?'':`<div id="metadata-line"><span>${views} views</span></div>`}</ytd-video-renderer>`;
const comment=(id:string,text:string)=>`<ytd-comment-thread-renderer><ytd-comment-view-model data-comment-id="${id}"><span id="author-text">Pessoa</span><span id="content-text">${text}</span></ytd-comment-view-model></ytd-comment-thread-renderer>`;
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-03T00:00:00Z'));document.head.innerHTML='';document.body.innerHTML='';history.replaceState({},'','/');scroll=vi.fn();Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,writable:true,value:scroll});vi.spyOn(window,'scrollTo').mockImplementation(()=>{});collector=createCollectionController(document);});
afterEach(async()=>{collector.dispose();await vi.runOnlyPendingTimersAsync();vi.restoreAllMocks();vi.useRealTimers();});

describe('coleta local limitada por rolagem',()=>{
  it('não inicia ações ao construir e valida limites/layout antes de rolar',()=>{
    expect(scroll).not.toHaveBeenCalled();expect(()=>collector.start({kind:'videos',maxItems:501})).toThrow('500');expect(()=>collector.start({kind:'videos',maxSteps:31})).toThrow('30');expect(()=>collector.start({kind:'videos',timeoutMs:60001})).toThrow('60000');expect(()=>collector.start({kind:'videos'})).toThrow('reconhecido');expect(scroll).not.toHaveBeenCalled();
  });
  it('acumula IDs de cards virtualizados, preserva desconhecidos e retorna só ao terminar',async()=>{
    document.body.innerHTML=`<ytd-rich-grid-renderer>${video('abcdefghijk')}</ytd-rich-grid-renderer>`;const feed=document.querySelector('ytd-rich-grid-renderer')!;let step=0;scroll.mockImplementation(()=>{step++;feed.innerHTML=video(step===1?'lmnopqrstuv':'zzzzzzzzzzz',step===1?20:30);});
    const state=collector.start({kind:'videos',maxItems:3,maxSteps:5});expect(state.phase).toBe('running');expect(collector.snapshot(state.jobId)).toBeUndefined();await vi.advanceTimersByTimeAsync(1000);
    expect(collector.status(state.jobId)).toMatchObject({phase:'completed',collectedCount:3,steps:2});const result=collector.snapshot(state.jobId)!;expect(result.videos.map(v=>v.id)).toEqual(['abcdefghijk','lmnopqrstuv','zzzzzzzzzzz']);expect(result.videos[0].views).toBeUndefined();expect(result.videos[0]).toMatchObject({source:'youtube-dom',observedAt:'2026-11-03T00:00:00.000Z'});expect(result.comments).toEqual([]);expect(window.scrollTo).toHaveBeenCalledOnce();
  });
  it('preserva o primeiro instante observado em vez de tornar um contador antigo artificialmente recente',async()=>{
    document.body.innerHTML=`<ytd-rich-grid-renderer>${video('abcdefghijk',10)}</ytd-rich-grid-renderer>`;const state=collector.start({kind:'videos',maxItems:10});await vi.advanceTimersByTimeAsync(1500);const result=collector.snapshot(state.jobId)!;expect(result.videos).toHaveLength(1);expect(result.videos[0].observedAt).toBe('2026-11-03T00:00:00.000Z');expect(collector.status().reason).toContain('Três etapas');
  });
  it('lê somente comentários na seção reconhecida e deduplica IDs de DOM reciclado',async()=>{
    document.body.innerHTML=`${comment('outside','Fora da seção')}<ytd-comments><div id="contents">${comment('c1','Primeiro')}</div></ytd-comments>`;const feed=document.querySelector('ytd-comments #contents')!;let step=0;scroll.mockImplementation(()=>{step++;feed.innerHTML=comment('c1','Primeiro')+comment(`c${step+1}`,`Resposta carregada ${step}`);});
    const job=collector.start({kind:'comments',maxItems:3});await vi.advanceTimersByTimeAsync(1000);const result=collector.snapshot(job.jobId)!;expect(result.comments.map(c=>c.id)).toEqual(['c1','c2','c3']);expect(result.comments[0].likes).toBeUndefined();expect(result.comments.some(c=>c.text==='Fora da seção')).toBe(false);
  });
  it('bloqueia trabalhos concorrentes, cancela a espera e restaura a posição no mesmo contexto',async()=>{
    document.body.innerHTML=`<ytd-rich-grid-renderer>${video('abcdefghijk',10)}</ytd-rich-grid-renderer>`;const job=collector.start({kind:'videos'});expect(()=>collector.start({kind:'videos'})).toThrow('andamento');const before=scroll.mock.calls.length;expect(collector.cancel(job.jobId)).toMatchObject({phase:'cancelled',collectedCount:1});await vi.advanceTimersByTimeAsync(5000);expect(scroll).toHaveBeenCalledTimes(before);expect(window.scrollTo).toHaveBeenCalledOnce();expect(()=>collector.status('another-job')).toThrow('atual');
  });
  it('limita etapas e prazo sem declarar que a coleção está completa',async()=>{
    document.body.innerHTML=`<ytd-rich-grid-renderer>${video('abcdefghijk',10)}</ytd-rich-grid-renderer>`;let job=collector.start({kind:'videos',maxSteps:1});await vi.advanceTimersByTimeAsync(500);expect(collector.status(job.jobId)).toMatchObject({phase:'stopped',steps:1});expect(collector.status().reason).toContain('Limite de rolagens');
    job=collector.start({kind:'videos',maxSteps:30,timeoutMs:1000});await vi.advanceTimersByTimeAsync(1000);expect(collector.status(job.jobId).phase).toBe('stopped');expect(collector.status().reason).toContain('Tempo máximo');
  });
  it('interrompe SPA, URL ou identidade de vídeo alterada sem rolar/restaurar outro contexto',async()=>{
    history.replaceState({},'','/watch?v=abcdefghijk');document.body.innerHTML=`<ytd-watch-flexy video-id="abcdefghijk"></ytd-watch-flexy><ytd-rich-grid-renderer>${video('abcdefghijk',10)}</ytd-rich-grid-renderer>`;const job=collector.start({kind:'videos'});document.querySelector('ytd-watch-flexy')!.setAttribute('video-id','zzzzzzzzzzz');await vi.advanceTimersByTimeAsync(500);expect(collector.status(job.jobId).phase).toBe('cancelled');expect(window.scrollTo).not.toHaveBeenCalled();expect(collector.snapshot(job.jobId)?.url).toContain('abcdefghijk');
    document.querySelector('ytd-watch-flexy')!.setAttribute('video-id','abcdefghijk');const next=collector.start({kind:'videos'});document.dispatchEvent(new Event('yt-navigate-start'));const count=scroll.mock.calls.length;history.replaceState({},'','/feed/subscriptions');await vi.advanceTimersByTimeAsync(3000);expect(collector.status(next.jobId).phase).toBe('cancelled');expect(scroll).toHaveBeenCalledTimes(count);expect(window.scrollTo).not.toHaveBeenCalled();
  });
  it('remove listeners e timers ao suspender e exige ação explícita para usar o resultado',async()=>{
    document.body.innerHTML=`<ytd-rich-grid-renderer>${video('abcdefghijk',10)}</ytd-rich-grid-renderer><div id="tools"></div>`;const use=vi.fn(async()=>{}),cleanup=mountCollectionControls(document.getElementById('tools')!,collector,use);expect(scroll).not.toHaveBeenCalled();document.querySelector<HTMLButtonElement>('#prevlev-collection-start')!.click();window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));await vi.advanceTimersByTimeAsync(2000);expect(collector.status().phase).toBe('cancelled');expect(use).not.toHaveBeenCalled();document.querySelector<HTMLButtonElement>('#prevlev-collection-use')!.click();await Promise.resolve();expect(use).toHaveBeenCalledOnce();cleanup();expect(vi.getTimerCount()).toBe(0);
  });
});
