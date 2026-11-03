import { getSettings } from '../shared/storage';
import { callBackendOperation } from '../shared/backend';
import type { OfficialVideo, OfficialChannel } from '../../server/youtube.mjs';

const SOURCE = 'youtube-data-api';
const TTL = 24 * 60 * 60 * 1000;
const MAX_ROWS = 75;
type Query = {q:string;type:'video'|'channel';order:'relevance'|'date'|'viewCount';maxResults:number;};
interface OfficialPage {videos:OfficialVideo[];channels:OfficialChannel[];nextPageToken?:string;fetchedAt:string;requestCount:number;warnings:string[];}
const record = (value:unknown):Record<string,unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
const invalid = () => new Error('O backend retornou dados oficiais incompatíveis. Nenhum resultado foi incorporado.');
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i;
function nullableText(value:unknown,max=1000):string|null {if (value===null) return null;if (typeof value!=='string'||value.length>max) throw invalid();return value;}
function timestamp(value:unknown):string {if (typeof value!=='string'||value.length>64||!RFC3339.test(value)||!Number.isFinite(Date.parse(value))||Date.now()-Date.parse(value)>TTL||Date.parse(value)-Date.now()>300000) throw invalid();return value;}
function nullableDate(value:unknown):string|null {const text=nullableText(value,64);if (text!==null&&(!RFC3339.test(text)||!Number.isFinite(Date.parse(text)))) throw invalid();return text;}
function counter(value:unknown):string|null {if (value===null) return null;if (typeof value!=='string'||!/^\d{1,20}$/.test(value)||BigInt(value)>18446744073709551615n) throw invalid();return value;}
function thumbnail(value:unknown):string|null {const text=nullableText(value,2000);if (text===null) return null;let url:URL;try{url=new URL(text);}catch{throw invalid();}if (url.protocol!=='https:'||url.username||url.password||url.hash||!['i.ytimg.com','yt3.ggpht.com','yt3.googleusercontent.com'].includes(url.hostname)) throw invalid();return text;}
function validateVideo(raw:unknown):OfficialVideo {
  const item=record(raw);if (typeof item.id!=='string'||!/^[A-Za-z0-9_-]{11}$/.test(item.id)||item.source!==SOURCE||item.url!==`https://www.youtube.com/watch?v=${item.id}`) throw invalid();
  if (item.channelId!==null&&(typeof item.channelId!=='string'||!/^UC[A-Za-z0-9_-]{22}$/.test(item.channelId))) throw invalid();
  const duration=nullableText(item.duration,100);if (duration!==null&&!/^P(?=.*\d)(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/.test(duration)) throw invalid();
  return {id:item.id,title:nullableText(item.title),url:item.url as string,channelId:item.channelId as string|null,channelTitle:nullableText(item.channelTitle),publishedAt:nullableDate(item.publishedAt),duration,viewCount:counter(item.viewCount),likeCount:counter(item.likeCount),commentCount:counter(item.commentCount),thumbnail:thumbnail(item.thumbnail),source:SOURCE,fetchedAt:timestamp(item.fetchedAt)};
}
function validateChannel(raw:unknown):OfficialChannel {
  const item=record(raw);if (typeof item.id!=='string'||!/^UC[A-Za-z0-9_-]{22}$/.test(item.id)||item.source!==SOURCE||item.url!==`https://www.youtube.com/channel/${item.id}`||![true,false,null].includes(item.hiddenSubscriberCount as boolean|null)) throw invalid();
  const subscribers=counter(item.subscriberCount);if (item.hiddenSubscriberCount===true&&subscribers!==null) throw invalid();
  return {id:item.id,title:nullableText(item.title),url:item.url as string,subscriberCount:subscribers,hiddenSubscriberCount:item.hiddenSubscriberCount as boolean|null,viewCount:counter(item.viewCount),videoCount:counter(item.videoCount),publishedAt:nullableDate(item.publishedAt),thumbnail:thumbnail(item.thumbnail),source:SOURCE,fetchedAt:timestamp(item.fetchedAt)};
}
function validatePage(value:unknown,query:Query,pageToken?:string):OfficialPage {
  const item=record(value), returnedQuery=record(item.query);
  if (item.source!==SOURCE||!Array.isArray(item.videos)||!Array.isArray(item.channels)||item.videos.length>query.maxResults||item.channels.length>query.maxResults||!Number.isInteger(item.requestCount)||Number(item.requestCount)<1||Number(item.requestCount)>3||!Array.isArray(item.warnings)||item.warnings.length>20||item.warnings.some(warning=>typeof warning!=='string'||warning.length>1000)) throw invalid();
  for (const key of ['q','type','order','maxResults'] as const) if (returnedQuery[key]!==query[key]) throw invalid();
  if (returnedQuery.pageToken!==pageToken||(query.type==='channel'&&item.videos.length)) throw invalid();
  const next=item.nextPageToken;if (next!==undefined&&(typeof next!=='string'||!next||next.length>1000||[...next].some(character=>character.charCodeAt(0)<32||character.charCodeAt(0)===127))) throw invalid();
  return {videos:item.videos.map(validateVideo),channels:item.channels.map(validateChannel),...(next?{nextPageToken:next as string}:{}),fetchedAt:timestamp(item.fetchedAt),requestCount:Number(item.requestCount),warnings:item.warnings as string[]};
}

export function initOfficialSearch():void {
  const section=document.getElementById('official-search');if (!section||section.dataset.initialized==='true') return;section.dataset.initialized='true';
  // Constant markup only. Every value returned by the backend is assigned with textContent.
  section.innerHTML=`<div class="hero"><div><span class="eyebrow">FONTE OPCIONAL</span><h1>Pesquisa oficial do YouTube</h1><p>Consulte uma página de vídeos ou canais por ação. Os valores oficiais ficam separados da coleta local e dos indicadores do Prevlev.</p></div></div>
  <div class="card"><form id="yt-form"><div class="form-grid"><label>Fonte<select id="yt-source" required><option value="">Selecione uma fonte</option><option value="youtube-data-api">YouTube Data API</option></select></label><label>Consulta<input id="yt-q" required maxlength="200" placeholder="Ex.: astronomia" autocomplete="off"></label><label>Tipo<select id="yt-type"><option value="video">Vídeos</option><option value="channel">Canais</option></select></label><label>Ordem da API<select id="yt-order"><option value="relevance">Relevância</option><option value="date">Data</option><option value="viewCount">Visualizações</option></select></label><label>Itens por página<input id="yt-max-results" type="number" min="1" max="25" step="1" value="10" required></label></div>
  <label class="check"><input id="yt-consent" type="checkbox" required>Confirmo o envio desta consulta ao Google/YouTube e o uso da cota do projeto configurado. Li os <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">Termos do YouTube</a>, a <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Privacidade do Google</a> e a <a href="https://github.com/onclickgrimes/prevlev/blob/main/docs/PRIVACY.md" target="_blank" rel="noopener noreferrer">Privacidade do Prevlev</a>.</label>
  <div class="row"><div><button id="yt-search" class="primary" type="submit">Pesquisar uma página</button> <button id="yt-cancel" type="button" disabled>Cancelar</button> <button id="yt-next" type="button" disabled>Próxima página</button> <button id="yt-clear" type="button">Descartar resultados</button></div></div></form>
  <p id="yt-status" role="status" aria-live="polite">Selecione a fonte e confirme o envio antes de pesquisar. Nenhuma consulta automática é realizada.</p><p class="muted">Máximo de três páginas manuais e 75 resultados nesta visualização. Inscritos públicos podem estar arredondados ou ocultos. Valores ausentes aparecem como —. Estatísticas dos canais estão na pesquisa do tipo Canais.</p></div>
  <div id="yt-results" class="card" hidden><h2>Dados oficiais do YouTube</h2><p id="yt-summary" class="muted"></p><p class="muted">Não representa todo o catálogo. Os dados ficam apenas nesta visualização, por até 24 horas, sem exportação, importação ou cálculos derivados.</p><ul id="yt-warnings"></ul>
  <div id="yt-videos" class="table-wrap"><table><thead><tr><th>Vídeo no YouTube</th><th>Canal</th><th>Publicado em</th><th>Duração original</th><th>Visualizações</th><th>Gostei</th><th>Comentários</th></tr></thead><tbody id="yt-video-rows"></tbody></table></div>
  <div id="yt-channels" class="table-wrap" hidden><table><thead><tr><th>Canal no YouTube</th><th>Inscritos oficiais</th><th>Visualizações</th><th>Vídeos</th><th>Criado em</th></tr></thead><tbody id="yt-channel-rows"></tbody></table></div></div>`;
  const element=<T extends HTMLElement=HTMLElement>(id:string)=>section.querySelector<T>(`#${id}`)!;
  const form=element<HTMLFormElement>('yt-form'), source=element<HTMLSelectElement>('yt-source'), consent=element<HTMLInputElement>('yt-consent'), q=element<HTMLInputElement>('yt-q'), type=element<HTMLSelectElement>('yt-type'), order=element<HTMLSelectElement>('yt-order'), max=element<HTMLInputElement>('yt-max-results'), search=element<HTMLButtonElement>('yt-search'), cancel=element<HTMLButtonElement>('yt-cancel'), next=element<HTMLButtonElement>('yt-next');
  let epoch=0, active:AbortController|undefined, frozen:Query|undefined, backendIdentity:string|undefined, nextToken:string|undefined, pages=0, requests=0, expiresAt=0, expiryTimer:ReturnType<typeof setTimeout>|undefined;
  let videos:OfficialVideo[]=[], channels:OfficialChannel[]=[], warnings:string[]=[];
  const status=(message:string,error=false)=>{element('yt-status').textContent=message;element('yt-status').classList.toggle('error',error);};
  const controls=(busy:boolean)=>{search.disabled=busy;cancel.disabled=!busy;next.disabled=busy||!nextToken||pages>=3||!frozen;for(const input of [source,consent,q,type,order,max])input.disabled=busy;};
  const clearRows=()=>{videos=[];channels=[];warnings=[];frozen=undefined;backendIdentity=undefined;nextToken=undefined;pages=0;requests=0;expiresAt=0;if(expiryTimer)clearTimeout(expiryTimer);expiryTimer=undefined;element('yt-video-rows').replaceChildren();element('yt-channel-rows').replaceChildren();element('yt-warnings').replaceChildren();element('yt-summary').textContent='';element('yt-results').hidden=true;};
  const discard=(message:string)=>{epoch++;active?.abort();active=undefined;clearRows();controls(false);status(message);};
  const expire=()=>{if(expiresAt&&Date.now()>=expiresAt){discard('Os dados oficiais expiraram após 24 horas e foram descartados. Pesquise novamente para atualizar.');return true;}return false;};
  const format=(value:string|null)=>value===null?'—':new Intl.NumberFormat('pt-BR').format(BigInt(value));
  const cell=(row:HTMLTableRowElement,value:string)=>{const td=document.createElement('td');td.textContent=value;row.append(td);return td;};
  const link=(cell:HTMLElement,url:string,title:string|null)=>{const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=title??'Título não disponível';cell.append(a);};
  const render=()=>{
    element('yt-results').hidden=false;element('yt-videos').hidden=frozen?.type!=='video';element('yt-channels').hidden=frozen?.type!=='channel';
    const videoRows=element('yt-video-rows'), channelRows=element('yt-channel-rows');videoRows.replaceChildren();channelRows.replaceChildren();
    for(const item of videos){const row=document.createElement('tr');link(cell(row,''),item.url,item.title);const channelCell=cell(row,'');if(item.channelId)link(channelCell,`https://www.youtube.com/channel/${item.channelId}`,item.channelTitle);else channelCell.textContent=item.channelTitle??'—';cell(row,item.publishedAt??'—');cell(row,item.duration??'—');cell(row,format(item.viewCount));cell(row,format(item.likeCount));cell(row,format(item.commentCount));videoRows.append(row);}
    for(const item of channels){const row=document.createElement('tr');link(cell(row,''),item.url,item.title);cell(row,item.hiddenSubscriberCount===true?'Oculto':format(item.subscriberCount));cell(row,format(item.viewCount));cell(row,format(item.videoCount));cell(row,item.publishedAt??'—');channelRows.append(row);}
    const list=element('yt-warnings');list.replaceChildren();for(const warning of [...new Set(warnings)].slice(0,20)){const li=document.createElement('li');li.textContent=warning;list.append(li);}
    element('yt-summary').textContent=`Fonte: YouTube Data API · Páginas manuais: ${pages}/3 · Solicitações HTTP: ${requests} · Descarte até: ${new Date(expiresAt).toISOString()}`;
    controls(false);
  };
  const currentQuery=():Query=>{
    if(source.value!==SOURCE||!consent.checked)throw new Error('Selecione YouTube Data API e confirme o envio ao Google/YouTube.');
    const query=q.value.trim(), count=Number(max.value);if(!query||[...query].length>200||!Number.isInteger(count)||count<1||count>25)throw new Error('Informe uma consulta de até 200 caracteres e de 1 a 25 itens por página.');
    if(!['video','channel'].includes(type.value)||!['relevance','date','viewCount'].includes(order.value))throw new Error('Tipo ou ordem da fonte inválida.');
    return {q:query,type:type.value as Query['type'],order:order.value as Query['order'],maxResults:count};
  };
  const run=async(append:boolean)=>{
    if(active)return;if(expire()&&append)return;
    let query:Query;try{query=currentQuery();}catch(error){status(error instanceof Error?error.message:'Consulta inválida.',true);return;}
    if(append&&(!frozen||!nextToken||pages>=3||JSON.stringify(query)!==JSON.stringify(frozen))){discard('A consulta mudou ou atingiu o limite. Inicie uma nova pesquisa.');return;}
    if(!append)clearRows();
    const controller=new AbortController(), requestEpoch=++epoch, token=append?nextToken:undefined;active=controller;controls(true);status('Consultando a fonte oficial. Você pode cancelar a espera; uma solicitação aceita pode consumir cota.');
    try{
      const settings=await getSettings();if(requestEpoch!==epoch||controller.signal.aborted)return;
      const identity=JSON.stringify([settings.backendUrl,settings.backendToken]);if(append&&identity!==backendIdentity)throw new Error('A conexão do backend mudou. Inicie uma nova pesquisa para manter a origem consistente.');
      const response=await callBackendOperation(settings,'/v1/youtube/search',{...query,...(token?{pageToken:token}:{}),apiConsent:true},controller.signal);
      if(requestEpoch!==epoch||controller.signal.aborted)return;
      if(response.status!=='ok')throw new Error(typeof response.error==='string'?response.error.slice(0,2000):'A fonte oficial não está disponível.');
      if(response.source!==SOURCE)throw invalid();const page=validatePage(response.data,query,token);
      const incoming=query.type==='video'?page.videos:page.channels, observedTimes=[page.fetchedAt,...incoming.map(item=>item.fetchedAt)].map(Date.parse), expiry=Math.min(...observedTimes)+TTL;
      expiresAt=append?Math.min(expiresAt,expiry):expiry;frozen=query;backendIdentity=identity;pages++;requests+=page.requestCount;warnings.push(...page.warnings);
      if(query.type==='video'){const map=new Map(videos.map(item=>[item.id,item]));for(const item of page.videos)map.set(item.id,item);videos=[...map.values()].slice(0,MAX_ROWS);channels=[];}else{const map=new Map(channels.map(item=>[item.id,item]));for(const item of page.channels)map.set(item.id,item);channels=[...map.values()].slice(0,MAX_ROWS);videos=[];}
      nextToken=pages<3?page.nextPageToken:undefined;if(expiryTimer)clearTimeout(expiryTimer);expiryTimer=setTimeout(expire,Math.max(1,expiresAt-Date.now()));
      render();status(incoming.length?`Página ${pages} concluída. ${pages>=3?'Limite de três páginas atingido.':nextToken?'A próxima página exige outro clique.':'A API não informou próxima página.'}`:'A API não retornou resultados nesta página.');
    }catch(error){if(requestEpoch===epoch&&!controller.signal.aborted){clearRows();status(error instanceof Error?error.message:'Não foi possível concluir a pesquisa oficial.',true);}}
    finally{if(requestEpoch===epoch){active=undefined;controls(false);}}
  };
  form.addEventListener('submit',event=>{event.preventDefault();void run(false);});
  next.addEventListener('click',()=>{void run(true);});
  cancel.addEventListener('click',()=>discard('Espera cancelada e resultados descartados. Uma solicitação já aceita pelo Google pode ter consumido cota.'));
  element('yt-clear').addEventListener('click',()=>discard('Resultados oficiais descartados desta visualização.'));
  for(const input of [source,q,type,order,max])input.addEventListener('input',()=>{if(input===source)consent.checked=false;if(frozen||active)discard('A consulta mudou. Inicie uma nova pesquisa; a próxima página foi invalidada.');});
  consent.addEventListener('change',()=>{if(!consent.checked&&(frozen||active))discard('Consentimento desmarcado; resultados descartados.');});
  window.addEventListener('focus',expire);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')expire();});
}
