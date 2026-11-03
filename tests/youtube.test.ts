import {describe,expect,it,vi} from 'vitest';
import {searchYouTube,type OfficialVideo,type OfficialChannel} from '../server/youtube.mjs';

// Official API transport fixtures only. No real key, account, API request or quota use.
const key='server-only-youtube-test-key';
const config={youtubeEnabled:true,youtubeApiKey:key};
const query={q:'astronomia',apiConsent:true};
const videoId='aaaaaaaaaaa', otherVideoId='bbbbbbbbbbb', channelId=`UC${'a'.repeat(22)}`;
const snippet={title:'Vídeo 🪐 fixture',channelId,channelTitle:'Canal fixture',publishedAt:'2026-10-01T00:00:00Z',thumbnails:{default:{url:`https://i.ytimg.com/vi/${videoId}/default.jpg`}}};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const searchResponse=(items:unknown[]=[{id:{kind:'youtube#video',videoId},snippet}])=>json({items,nextPageToken:'opaque-next+/='});
const videosResponse=(items:unknown[]=[{id:videoId,snippet,contentDetails:{duration:'PT60S'},statistics:{viewCount:'9007199254740993',likeCount:'0'}}])=>json({items});
const channelsResponse=(items:unknown[]=[{id:channelId,snippet:{title:'Canal fixture',publishedAt:'2020-01-01T00:00:00Z'},statistics:{subscriberCount:'12300',hiddenSubscriberCount:false,viewCount:'18446744073709551615',videoCount:'25'}}])=>json({items});
function transport(...responses:Response[]){const fetcher=vi.fn<typeof fetch>();for(const response of responses)fetcher.mockResolvedValueOnce(response);return fetcher;}

describe('opt-in explícito antes de qualquer uso da API oficial',()=>{
 it('não consulta sem ativação, chave existente e consentimento verdadeiro',async()=>{
   const fetcher=vi.fn<typeof fetch>();
   for(const [input,settings]of [[query,{}],[query,{youtubeApiKey:key}],[query,{youtubeEnabled:true}], [{q:'fixture'},config],[{...query,apiConsent:'true'},config]] as [Record<string,unknown>,typeof config|object][]){
     expect(await searchYouTube(input,settings,fetcher)).toMatchObject({status:'not_configured',source:'youtube-data-api',data:{requestCount:0}});
   }
   expect(fetcher).not.toHaveBeenCalled();
 });
 it('valida consulta, limites, datas, tipos e parâmetros antes da rede',async()=>{
   const fetcher=vi.fn<typeof fetch>();
   const invalid=[{q:''},{q:'x'.repeat(201)},{q:'line\nbreak'},{type:'playlist'},{order:'rating'},{maxResults:0},{maxResults:26},{maxResults:1.5},{channelId:'https://evil.example'},{type:'channel',channelId},{publishedAfter:'2026-02-30T00:00:00Z'},{publishedBefore:'yesterday'},{publishedAfter:'2026-11-02T00:00:00Z',publishedBefore:'2026-11-01T00:00:00Z'},{pageToken:'x'.repeat(1001)},{url:'https://evil.example'},{key:'injected'}];
   for(const item of invalid)expect(await searchYouTube({...query,...item},config,fetcher)).toMatchObject({status:'error',data:{requestCount:0}});
   expect(fetcher).not.toHaveBeenCalled();
 });
 it('não usa uma chave inválida com controles nem consulta se já estiver cancelado',async()=>{
   const fetcher=vi.fn<typeof fetch>();expect(await searchYouTube(query,{...config,youtubeApiKey:'secret\nheader'},fetcher)).toMatchObject({status:'not_configured',data:{requestCount:0}});
   const controller=new AbortController();controller.abort();expect(await searchYouTube(query,config,fetcher,controller.signal)).toMatchObject({status:'error',error:expect.stringContaining('cancelada'),data:{requestCount:0}});expect(fetcher).not.toHaveBeenCalled();
 });
});

describe('uma página oficial e metadados brutos em lotes',()=>{
 it('consulta somente os três endpoints fixos, com chave no header e sem cookies ou redirects',async()=>{
   const fetcher=transport(searchResponse(),videosResponse(),channelsResponse());const result=await searchYouTube(query,config,fetcher);
   expect(result).toMatchObject({status:'ok',source:'youtube-data-api',data:{source:'youtube-data-api',query:{q:'astronomia',type:'video',order:'relevance',maxResults:10},requestCount:3,nextPageToken:'opaque-next+/='}});
   expect(fetcher.mock.calls.map(call=>new URL(String(call[0])).pathname)).toEqual(['/youtube/v3/search','/youtube/v3/videos','/youtube/v3/channels']);
   for(const [url,options]of fetcher.mock.calls){expect(new URL(String(url)).origin).toBe('https://www.googleapis.com');expect(String(url)).not.toContain(key);expect(new URL(String(url)).searchParams.has('key')).toBe(false);expect(options).toMatchObject({method:'GET',credentials:'omit',redirect:'error',cache:'no-store',headers:{'x-goog-api-key':key}});expect(options?.headers).not.toHaveProperty('Authorization');}
   const searchUrl=new URL(String(fetcher.mock.calls[0][0]));expect([...searchUrl.searchParams.keys()].sort()).toEqual(['part','q','type','order','maxResults'].sort());expect(searchUrl.searchParams.get('part')).toBe('snippet');
   expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get('part')).toBe('snippet,contentDetails,statistics');expect(new URL(String(fetcher.mock.calls[2][0])).searchParams.get('part')).toBe('snippet,statistics');
   expect(JSON.stringify(result)).not.toContain(key);
 });
 it('conserva precisão dos contadores, zero oficial e duração sem calcular Shorts ou indicadores',async()=>{
   const result=await searchYouTube(query,config,transport(searchResponse(),videosResponse(),channelsResponse()));const data=result.data as {videos:OfficialVideo[];channels:OfficialChannel[]};
   expect(data.videos[0]).toMatchObject({id:videoId,title:snippet.title,viewCount:'9007199254740993',likeCount:'0',commentCount:null,duration:'PT60S',source:'youtube-data-api'});
   expect(data.channels[0]).toMatchObject({subscriberCount:'12300',hiddenSubscriberCount:false,viewCount:'18446744073709551615',videoCount:'25'});
   for(const forbidden of ['views','subscribers','durationSeconds','isShort','vph','outlier','rpm','revenue','meanViews','totalViews']){expect(data.videos[0]).not.toHaveProperty(forbidden);expect(data.channels[0]).not.toHaveProperty(forbidden);}
   expect(Date.parse(data.videos[0].fetchedAt)).toBeGreaterThan(0);
 });
 it('mantém a ordem retornada pela pesquisa, elimina IDs repetidos/inválidos e agrupa um canal por lote',async()=>{
   const items=[{id:{kind:'youtube#video',videoId},snippet},{id:{kind:'youtube#video',videoId:otherVideoId},snippet:{...snippet,title:'Segundo'}},{id:{kind:'youtube#video',videoId},snippet},{id:{kind:'youtube#playlist',playlistId:'PLfake'},snippet},{id:{kind:'youtube#video',videoId:'../../bad'},snippet}];
   const stats=[{id:otherVideoId,snippet:{...snippet,title:'Segundo'},statistics:{viewCount:'1000'}},{id:videoId,snippet,statistics:{viewCount:'1'}},{id:'zzzzzzzzzzz',snippet,statistics:{viewCount:'999999'}}];
   const fetcher=transport(searchResponse(items),videosResponse(stats),channelsResponse());const result=await searchYouTube({...query,order:'date'},config,fetcher);const data=result.data as {videos:OfficialVideo[];channels:OfficialChannel[]};
   expect(data.videos.map(item=>item.id)).toEqual([videoId,otherVideoId]);expect(data.channels).toHaveLength(1);expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get('id')).toBe(`${videoId},${otherVideoId}`);expect(new URL(String(fetcher.mock.calls[2][0])).searchParams.get('id')).toBe(channelId);
 });
 it('não preenche estatísticas ausentes com zero nem busca metadados não solicitados',async()=>{
   const fetcher=transport(searchResponse(),videosResponse([]),channelsResponse([]));const result=await searchYouTube(query,config,fetcher);expect(result).toMatchObject({status:'ok',data:{videos:[{id:videoId,title:snippet.title,duration:null,viewCount:null,likeCount:null,commentCount:null}],channels:[{id:channelId,subscriberCount:null,hiddenSubscriberCount:null,viewCount:null,videoCount:null}],warnings:expect.arrayContaining([expect.stringContaining('não retornaram')])}});
   expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it('consulta canais em duas chamadas e respeita inscritos ocultos',async()=>{
   const search=json({items:[{id:{kind:'youtube#channel',channelId},snippet:{title:'Canal fixture'}}]});const hidden=channelsResponse([{id:channelId,snippet:{title:'Canal fixture'},statistics:{hiddenSubscriberCount:true,subscriberCount:'50000'}}]);const fetcher=transport(search,hidden);
   expect(await searchYouTube({...query,type:'channel'},config,fetcher)).toMatchObject({status:'ok',data:{videos:[],channels:[{id:channelId,subscriberCount:null,hiddenSubscriberCount:true,viewCount:null}],requestCount:2}});
   expect(fetcher.mock.calls.map(call=>new URL(String(call[0])).pathname)).toEqual(['/youtube/v3/search','/youtube/v3/channels']);
 });
 it('não pagina automaticamente e encaminha token e filtros somente em outra ação explícita',async()=>{
   const fetcher=transport(searchResponse([]));const input={...query,pageToken:'opaque+/= token',channelId,maxResults:25,publishedAfter:'2026-01-01T00:00:00+02:00',publishedBefore:'2026-11-01T00:00:00Z',q:'x&key=not-a-parameter|space'};
   const result=await searchYouTube(input,config,fetcher);expect(result).toMatchObject({status:'ok',data:{videos:[],channels:[],requestCount:1,nextPageToken:'opaque-next+/='}});expect(fetcher).toHaveBeenCalledOnce();
   const url=new URL(String(fetcher.mock.calls[0][0]));for(const field of ['q','pageToken','channelId','publishedAfter','publishedBefore'])expect(url.searchParams.get(field)).toBe(input[field as keyof typeof input]);expect(url.searchParams.has('key')).toBe(false);
 });
 it('limita saída ao pedido e não transforma contagens inválidas em números',async()=>{
   const search=searchResponse([{id:{kind:'youtube#video',videoId},snippet},{id:{kind:'youtube#video',videoId:otherVideoId},snippet}]);const metadata=videosResponse([{id:videoId,snippet,statistics:{viewCount:'18446744073709551616',likeCount:12,commentCount:'-1'}}]);
   expect(await searchYouTube({...query,maxResults:1},config,transport(search,metadata,channelsResponse()))).toMatchObject({status:'ok',data:{videos:[{id:videoId,viewCount:null,likeCount:null,commentCount:null}]}});
 });
});

describe('erros, limites e cancelamento da consulta oficial',()=>{
 it.each([401,403,429,503])('sanitiza HTTP %s sem expor chave, corpo, URL ou repetir consulta',async(status)=>{
   const fetcher=transport(new Response(`PRIVATE_SECRET key=${key} https://www.googleapis.com/authenticated`,{status}));const result=await searchYouTube(query,config,fetcher);expect(result.status).toBe(status===401||status===403?'not_configured':'error');expect(result.error).toContain(String(status));expect(result).toMatchObject({data:{requestCount:1}});expect(JSON.stringify(result)).not.toMatch(/PRIVATE_SECRET|server-only-youtube-test-key|authenticated/);expect(fetcher).toHaveBeenCalledOnce();
 });
 it('sanitiza falhas de transporte e metadados sem devolver resultado parcial como sucesso',async()=>{
   const offline=vi.fn<typeof fetch>().mockRejectedValue(new Error(`URL?key=${key}`));const result=await searchYouTube(query,config,offline);expect(result).toMatchObject({status:'error',data:{requestCount:1}});expect(JSON.stringify(result)).not.toContain(key);
   const metadata=transport(searchResponse(),new Response('PRIVATE_SECRET',{status:403}));expect(await searchYouTube(query,config,metadata)).toMatchObject({status:'not_configured',data:{requestCount:2}});expect(metadata).toHaveBeenCalledTimes(2);
 });
 it('recusa redirecionamento, resposta não JSON, corpo grande e JSON inválido',async()=>{
   const redirected=json({items:[]});Object.defineProperty(redirected,'redirected',{value:true});
   const cases=[redirected,new Response('html',{headers:{'Content-Type':'text/html'}}),new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':String(2*1024*1024+1)}}),new Response('x'.repeat(2*1024*1024+1),{headers:{'Content-Type':'application/json'}}),new Response('PRIVATE_SECRET',{headers:{'Content-Type':'application/json'}})];
   for(const response of cases){const fetcher=transport(response);const result=await searchYouTube(query,config,fetcher);expect(result).toMatchObject({status:'error',data:{requestCount:1}});expect(JSON.stringify(result)).not.toContain('PRIVATE_SECRET');expect(fetcher).toHaveBeenCalledOnce();}
 });
 it('interrompe antes de lotes seguintes quando o cliente cancela após a primeira chamada',async()=>{
   const controller=new AbortController();const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>{controller.abort();return searchResponse();});
   expect(await searchYouTube(query,config,fetcher,controller.signal)).toMatchObject({status:'error',error:expect.stringContaining('cancelada'),data:{requestCount:1}});expect(fetcher).toHaveBeenCalledOnce();
 });
 it('interrompe lote de canais quando o cliente cancela durante metadados dos vídeos',async()=>{
   const controller=new AbortController();const fetcher=transport(searchResponse());fetcher.mockImplementationOnce(async()=>{controller.abort();return videosResponse();});
   expect(await searchYouTube(query,config,fetcher,controller.signal)).toMatchObject({status:'error',data:{requestCount:2}});expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('aplica prazo total compartilhado de20s e descarta resposta tardia sem repetir ou consultar canais',async()=>{
   vi.useFakeTimers();const timeoutSpy=vi.spyOn(AbortSignal,'timeout').mockImplementation(milliseconds=>{const controller=new AbortController();setTimeout(()=>controller.abort(),milliseconds);return controller.signal;});
   try {
     const fetcher=vi.fn<typeof fetch>().mockImplementationOnce(()=>new Promise(resolve=>setTimeout(()=>resolve(searchResponse()),12000))).mockImplementationOnce(()=>new Promise(resolve=>setTimeout(()=>resolve(videosResponse()),12000)));
     let result:Awaited<ReturnType<typeof searchYouTube>>|undefined;const operation=searchYouTube(query,config,fetcher).then(value=>{result=value;});await vi.advanceTimersByTimeAsync(21000);
     expect(result).toMatchObject({status:'error',error:expect.stringContaining('20 segundos'),data:{requestCount:2}});expect(result).not.toHaveProperty('data.videos');expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls[1][1]?.signal?.aborted).toBe(true);
     await vi.advanceTimersByTimeAsync(5000);await operation;expect(result?.status).toBe('error');expect(fetcher).toHaveBeenCalledTimes(2);
   } finally {timeoutSpy.mockRestore();vi.useRealTimers();}
 });
 it('não segue URL de thumbnail desconhecida nem repassa metadados não solicitados',async()=>{
   const malicious={...snippet,thumbnails:{default:{url:'https://evil.example/track?key=PRIVATE_SECRET'}}};const fetcher=transport(searchResponse([{id:{kind:'youtube#video',videoId},snippet:malicious}]),videosResponse([{id:videoId,snippet:malicious,contentDetails:{duration:'P_BAD'},statistics:{viewCount:'10'},privateData:'PRIVATE_SECRET'}]),channelsResponse());
   const result=await searchYouTube(query,config,fetcher);expect(result).toMatchObject({status:'ok',data:{videos:[{thumbnail:null,duration:null,viewCount:'10'}]}});expect(JSON.stringify(result)).not.toContain('PRIVATE_SECRET');expect(fetcher).toHaveBeenCalledTimes(3);
 });
});
