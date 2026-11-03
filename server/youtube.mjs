/* global AbortSignal, TextDecoder */
// Optional official YouTube Data API source. No fetch, storage or key setup on import.
const SOURCE = 'youtube-data-api';
const BASE = 'https://www.googleapis.com/youtube/v3/';
const MAX_BYTES = 2 * 1024 * 1024;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
const control = value => [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
class YouTubeError extends Error { constructor(message, status = 'error') {super(message); this.status = status;} }
const cancelled = () => new YouTubeError('Consulta cancelada ou prazo total de 20 segundos excedido. Uma solicitação já aceita pelo Google pode ter consumido cota.');
function assertActive(signal) {if (signal.aborted) throw cancelled();}
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise((resolve,reject) => {const abort=()=>reject(cancelled());signal.addEventListener('abort',abort,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
}
function date(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/i.exec(value);
  if (!match) return null;
  const [year,month,day,hour,minute,second]=match.slice(1,7).map(Number), leap=year%4===0&&(year%100!==0||year%400===0), days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if (month<1||month>12||day<1||day>days[month-1]||hour>23||minute>59||second>59||Number(match[8]??0)>23||Number(match[9]??0)>59||!Number.isFinite(Date.parse(value))) return null;
  return value;
}
function queryInput(payload) {
  payload=object(payload);
  const allowed=new Set(['q','type','order','maxResults','channelId','pageToken','publishedAfter','publishedBefore','apiConsent']);
  if (Object.keys(payload).some(key=>!allowed.has(key))) throw new YouTubeError('Parâmetro de pesquisa não permitido.');
  if (typeof payload.q!=='string'||!payload.q.trim()||[...payload.q.trim()].length>200||control(payload.q)) throw new YouTubeError('Informe uma consulta de 1 a 200 caracteres, sem controles.');
  const type=payload.type??'video', order=payload.order??'relevance', maxResults=payload.maxResults??10;
  if (!['video','channel'].includes(type)) throw new YouTubeError('type deve ser video ou channel.');
  if (!['relevance','date','viewCount'].includes(order)) throw new YouTubeError('order deve ser relevance, date ou viewCount.');
  if (!Number.isInteger(maxResults)||maxResults<1||maxResults>25) throw new YouTubeError('maxResults deve ser um inteiro entre 1 e 25.');
  const result={q:payload.q.trim(),type,order,maxResults};
  if (payload.channelId!==undefined) {if (type!=='video'||typeof payload.channelId!=='string'||!CHANNEL_ID.test(payload.channelId)) throw new YouTubeError('channelId só pode filtrar vídeos e deve ser um ID UC válido.');result.channelId=payload.channelId;}
  if (payload.pageToken!==undefined) {if (typeof payload.pageToken!=='string'||!payload.pageToken||payload.pageToken.length>1000||control(payload.pageToken)) throw new YouTubeError('pageToken deve ser um token opaco de até 1000 caracteres.');result.pageToken=payload.pageToken;}
  for (const key of ['publishedAfter','publishedBefore']) if (payload[key]!==undefined) {if (!date(payload[key])) throw new YouTubeError(`${key} deve ser uma data RFC 3339 válida.`);result[key]=payload[key];}
  if (result.publishedAfter&&result.publishedBefore&&Date.parse(result.publishedAfter)>=Date.parse(result.publishedBefore)) throw new YouTubeError('publishedAfter deve ser anterior a publishedBefore.');
  return result;
}
function safeCancel(body) {if (body) void body.cancel().catch(()=>undefined);}
async function readJson(response,signal) {
  const declared=Number(response.headers.get('content-length'));
  if (Number.isFinite(declared)&&declared>MAX_BYTES) {safeCancel(response.body);throw new YouTubeError('Resposta da API acima do limite de 2 MiB.');}
  if (!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??'')) {safeCancel(response.body);throw new YouTubeError('A API não retornou JSON compatível.');}
  if (!response.body) throw new YouTubeError('A API retornou uma resposta vazia.');
  const reader=response.body.getReader(), chunks=[];let size=0;
  try {
    for (;;) {assertActive(signal);const {done,value}=await abortable(reader.read(),signal);if (done) break;size+=value.byteLength;if (size>MAX_BYTES) throw new YouTubeError('Resposta da API acima do limite de 2 MiB.');chunks.push(value);}
    try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));} catch {throw new YouTubeError('A API retornou JSON inválido.');}
  } finally {void reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
function literal(value,max=1000) {return typeof value==='string'&&value.length<=max ? value : null;}
function counter(value) {return typeof value==='string'&&/^\d{1,20}$/.test(value)&&BigInt(value)<=18446744073709551615n ? value : null;}
function thumbnail(snippet) {
  const images=object(snippet.thumbnails);
  for (const key of ['high','medium','default','standard','maxres']) {
    const value=object(images[key]).url;if (typeof value!=='string'||value.length>2000) continue;
    try {const url=new URL(value);if (url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&['i.ytimg.com','yt3.ggpht.com','yt3.googleusercontent.com'].includes(url.hostname)) return value;} catch {/* Do not expose or fetch unrecognized URLs. */}
  }
  return null;
}
function video(id,searchSnippet,metadata,fetchedAt) {
  const item=object(metadata), snippet={...object(searchSnippet),...object(item.snippet)}, stats=object(item.statistics), content=object(item.contentDetails);
  const duration=typeof content.duration==='string'&&/^P(?=.*\d)(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/.test(content.duration) ? content.duration : null;
  return {id,title:literal(snippet.title),url:`https://www.youtube.com/watch?v=${id}`,channelId:typeof snippet.channelId==='string'&&CHANNEL_ID.test(snippet.channelId)?snippet.channelId:null,channelTitle:literal(snippet.channelTitle),publishedAt:date(snippet.publishedAt),duration,viewCount:counter(stats.viewCount),likeCount:counter(stats.likeCount),commentCount:counter(stats.commentCount),thumbnail:thumbnail(snippet),source:SOURCE,fetchedAt};
}
function channel(id,searchSnippet,metadata,fetchedAt) {
  const item=object(metadata), snippet={...object(searchSnippet),...object(item.snippet)}, stats=object(item.statistics), hiddenSubscriberCount=typeof stats.hiddenSubscriberCount==='boolean'?stats.hiddenSubscriberCount:null;
  return {id,title:literal(snippet.title??snippet.channelTitle),url:`https://www.youtube.com/channel/${id}`,subscriberCount:hiddenSubscriberCount===true?null:counter(stats.subscriberCount),hiddenSubscriberCount,viewCount:counter(stats.viewCount),videoCount:counter(stats.videoCount),publishedAt:date(snippet.publishedAt),thumbnail:thumbnail(snippet),source:SOURCE,fetchedAt};
}
function itemList(response) {if (!Array.isArray(object(response).items)||response.items.length>1000) throw new YouTubeError('Lista da API incompatível ou acima do limite.');return response.items;}
function metadataMap(response,expected,pattern) {
  const result=new Map();
  for (const raw of itemList(response)) {const item=object(raw);if (typeof item.id==='string'&&pattern.test(item.id)&&expected.has(item.id)&&!result.has(item.id)) result.set(item.id,item);}
  return result;
}

export async function searchYouTube(payload,config={},fetcher=fetch,parentSignal) {
  let requestCount=0;
  try {
    if (config.youtubeEnabled!==true) throw new YouTubeError('A fonte oficial está desativada. Configure YOUTUBE_ENABLED=true no servidor para optar por ela.','not_configured');
    if (typeof config.youtubeApiKey!=='string'||!config.youtubeApiKey.trim()||control(config.youtubeApiKey)) throw new YouTubeError('Configure uma chave existente YOUTUBE_API_KEY apenas no servidor.','not_configured');
    if (object(payload).apiConsent!==true) throw new YouTubeError('Confirme o envio da consulta ao Google/YouTube e o uso de cota antes de pesquisar.','not_configured');
    const query=queryInput(payload), deadline=AbortSignal.timeout(20000), signal=parentSignal?AbortSignal.any([deadline,parentSignal]):deadline;
    const get=async(endpoint,parameters)=>{
      assertActive(signal);if (!['search','videos','channels'].includes(endpoint)||requestCount>=3) throw new YouTubeError('Limite de solicitações da pesquisa atingido.');
      const url=new URL(endpoint,BASE);for (const [key,value]of Object.entries(parameters)) url.searchParams.set(key,String(value));
      requestCount++;
      let response;
      try {response=await abortable(fetcher(url.href,{method:'GET',headers:{Accept:'application/json','x-goog-api-key':config.youtubeApiKey},credentials:'omit',redirect:'error',cache:'no-store',signal}),signal);}
      catch (error) {if (signal.aborted) throw cancelled();if (error instanceof YouTubeError) throw error;throw new YouTubeError('Não foi possível confirmar a resposta da API oficial. Nenhuma nova tentativa foi enviada.');}
      if (response.redirected) {safeCancel(response.body);throw new YouTubeError('Redirecionamento da API oficial recusado.');}
      if (!response.ok) {safeCancel(response.body);if (response.status===401) throw new YouTubeError('API oficial respondeu HTTP 401; confira a chave configurada no servidor.','not_configured');if (response.status===403) throw new YouTubeError('API oficial respondeu HTTP 403; verifique ativação, restrições da chave e cota no console do projeto.','not_configured');if (response.status===429) throw new YouTubeError('API oficial respondeu HTTP 429; limite de consultas atingido. Nenhuma nova tentativa foi enviada.');throw new YouTubeError(`API oficial respondeu HTTP ${response.status}; nenhuma nova tentativa foi enviada.`);}
      return readJson(response,signal);
    };
    const search=await get('search',{part:'snippet',...query}), entries=[], seen=new Set(), warnings=['Uma página explícita por ação; a pesquisa não representa todo o catálogo nem garante os uploads mais recentes.','Inscritos podem estar arredondados ou ocultos. Contagens ausentes permanecem desconhecidas.','requestCount conta solicitações enviadas, não unidades de cota nem saldo restante.'];
    for (const raw of itemList(search)) {
      const item=object(raw), identity=object(item.id), id=query.type==='video'?identity.videoId:identity.channelId, expectedKind=query.type==='video'?'youtube#video':'youtube#channel', pattern=query.type==='video'?VIDEO_ID:CHANNEL_ID;
      if (identity.kind!==expectedKind||typeof id!=='string'||!pattern.test(id)||seen.has(id)) continue;
      seen.add(id);entries.push({id,snippet:object(item.snippet)});if (entries.length>=query.maxResults) break;
    }
    if (query.order!=='relevance') warnings.push('A API alerta que ordenação diferente de relevância pode produzir resultados menores, incompletos ou de outros tipos; itens de outro tipo foram omitidos.');
    let videos=[], channels=[];
    if (query.type==='video'&&entries.length) {
      const expected=new Set(entries.map(item=>item.id)), metadata=metadataMap(await get('videos',{part:'snippet,contentDetails,statistics',id:[...expected].join(',')}),expected,VIDEO_ID);
      const fetchedAt=new Date().toISOString();videos=entries.map(item=>video(item.id,item.snippet,metadata.get(item.id),fetchedAt));
      if (metadata.size<entries.length) warnings.push('Alguns vídeos não retornaram metadados/estatísticas; campos ausentes permanecem desconhecidos.');
      const channelIds=new Set(videos.map(item=>item.channelId).filter(id=>id!==null));
      if (channelIds.size) {
        const channelMetadata=metadataMap(await get('channels',{part:'snippet,statistics',id:[...channelIds].join(',')}),channelIds,CHANNEL_ID);
        channels=[...channelIds].map(id=>{const fallback=videos.find(item=>item.channelId===id);return channel(id,{title:fallback?.channelTitle},channelMetadata.get(id),fetchedAt);});
        if (channelMetadata.size<channelIds.size) warnings.push('Alguns canais não retornaram estatísticas; campos ausentes permanecem desconhecidos.');
      }
    } else if (query.type==='channel'&&entries.length) {
      const expected=new Set(entries.map(item=>item.id)), metadata=metadataMap(await get('channels',{part:'snippet,statistics',id:[...expected].join(',')}),expected,CHANNEL_ID), fetchedAt=new Date().toISOString();
      channels=entries.map(item=>channel(item.id,item.snippet,metadata.get(item.id),fetchedAt));
      if (metadata.size<entries.length) warnings.push('Alguns canais não retornaram estatísticas; campos ausentes permanecem desconhecidos.');
    }
    assertActive(signal);
    const fetchedAt=new Date().toISOString(), nextPageToken=typeof search.nextPageToken==='string'&&search.nextPageToken.length<=1000&&!control(search.nextPageToken)?search.nextPageToken:undefined;
    return {status:'ok',source:SOURCE,data:{source:SOURCE,videos,channels,...(nextPageToken?{nextPageToken}:{}),query,fetchedAt,requestCount,warnings}};
  } catch (error) {
    return {status:error instanceof YouTubeError?error.status:'error',source:SOURCE,error:error instanceof YouTubeError?error.message:'A leitura da API oficial falhou. Nenhuma nova tentativa foi enviada.',data:{source:SOURCE,requestCount,fetchedAt:new Date().toISOString()}};
  }
}
