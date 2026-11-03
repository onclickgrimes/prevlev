import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open,mkdir,rename,unlink,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';

const STORE='observations-v1.json';
const MAX_BYTES=10*1024*1024;
const MAX_RECORDS=5000;
const MAX_LEGACY_FILES=5000;
const sources=new Set(['youtube-dom','public-page','user-provided']);
const queues=new Map();
const source='prevlev:history';
const limitations=[
  'Somente observações registradas explicitamente nesta instalação; não recupera o passado nem consulta o YouTube.',
  'As contagens não são verificadas financeiramente. Não estima receita ou RPM.',
  'Dados marcados como youtube-data-api não são armazenados neste histórico.',
  'observedAt preserva o horário informado pela coleta. Quando ausente, usa a hora da gravação e não comprova que a contagem estava atualizada; recordedAt indica quando foi salva.',
  'O índice lista os registros novos. Arquivos antigos sem ID interno são preservados e consultáveis pelo ID do vídeo.',
];
class HistoryError extends Error {}
const response=(data,extra=[])=>({status:'ok',source,data,limitations:[...limitations,...extra]});
const failure=error=>({status:'error',source,error:error instanceof HistoryError?error.message:'Não foi possível acessar o histórico local. Nenhum caminho ou detalhe de arquivo é exposto.'});
const metric=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clean=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
function videoId(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value))throw new HistoryError('Informe videoId válido, sem caminhos.');return value;}
function timestamp(now){if(!Number.isFinite(now)||!Number.isFinite(new Date(now).getTime()))throw new HistoryError('Horário de observação inválido.');const result=new Date(now).toISOString();if(!validTime(result))throw new HistoryError('Horário de observação inválido.');return result;}
function validTime(value){if(typeof value!=='string')return false;const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);return !!match&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===`${match[1]}.${(match[2]??'').padEnd(3,'0')}Z`;}
function limit(value,defaultValue=100){if(value===undefined)return defaultValue;if(!Number.isInteger(value)||value<1||value>500)throw new HistoryError('O limite de leitura deve ser inteiro entre 1 e 500.');return value;}
function options(config){if(!config?.dataDir)return undefined;if(typeof config.dataDir!=='string')throw new HistoryError('Configure DATA_DIR para o histórico local.');const max=config.historyMaxRecords??MAX_RECORDS;if(!Number.isInteger(max)||max<1||max>MAX_RECORDS)throw new HistoryError('HISTORY_MAX_RECORDS deve ficar entre 1 e 5000.');return{directory:resolve(config.dataDir),max};}
function missing(){return{status:'not_configured',source,error:'Configure DATA_DIR para armazenar observações locais.'};}
async function queued(directory,work){const previous=queues.get(directory)??Promise.resolve();const task=previous.catch(()=>{}).then(work);queues.set(directory,task);try{return await task;}finally{if(queues.get(directory)===task)queues.delete(directory);}}
function publicUrl(raw,fallback){if(raw===undefined||raw==='')return fallback;if(typeof raw!=='string')throw new HistoryError('URL de vídeo ou canal inválida.');if(!raw.trim())return fallback;try{const url=new URL(raw);if(url.protocol!=='https:'||!['www.youtube.com','youtube.com','m.youtube.com','youtu.be'].includes(url.hostname)||url.username||url.password||url.port||raw.length>2000)throw new Error();return url.href;}catch{throw new HistoryError('URL de vídeo ou canal inválida; use somente uma URL pública do YouTube.');}}
function sample(raw,recordedAt){
  if(!plain(raw))throw new HistoryError('Cada observação precisa ser um vídeo válido.');
  if(raw.source==='youtube-data-api')return{kind:'api'};
  const provenance=raw.source??'user-provided';if(!sources.has(provenance))throw new HistoryError('Fonte de observação desconhecida.');
  const id=videoId(raw.id??raw.videoId);
  const observedAt=raw.observedAt??recordedAt;
  if(!validTime(observedAt)||Date.parse(observedAt)>Date.parse(recordedAt))throw new HistoryError('observedAt deve conter um instante UTC completo, válido e não futuro.');
  for(const key of ['views','subscribers'])if(raw[key]!==undefined&&!metric(raw[key]))throw new HistoryError('Views e inscritos devem ser números finitos não negativos quando conhecidos.');
  if(raw.views===undefined&&raw.subscribers===undefined)return{kind:'unknown'};
  const result={id:randomUUID(),videoId:id,title:clean(raw.title,500)||id,url:publicUrl(raw.url,`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`),observedAt,recordedAt,source:provenance};
  for(const key of ['channel','channelId']){const value=clean(raw[key],200);if(value)result[key]=value;}
  if(raw.channelUrl!==undefined&&raw.channelUrl!=='')result.channelUrl=publicUrl(raw.channelUrl);
  for(const key of ['views','subscribers'])if(raw[key]!==undefined)result[key]=raw[key];
  return{kind:'record',record:result};
}
function storedRecord(value){
  if(!plain(value)||typeof value.id!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value.id)||!validTime(value.observedAt)||!sources.has(value.source))throw new HistoryError('O arquivo de histórico possui registros inválidos; ele não foi sobrescrito.');
  videoId(value.videoId);
  if(typeof value.title!=='string'||value.title.length>500||typeof value.url!=='string')throw new HistoryError('O arquivo de histórico possui metadados inválidos; ele não foi sobrescrito.');
  publicUrl(value.url);
  if(value.recordedAt!==undefined&&(!validTime(value.recordedAt)||Date.parse(value.recordedAt)<Date.parse(value.observedAt)))throw new HistoryError('O histórico possui horário de gravação inválido; ele não foi sobrescrito.');
  if(value.views===undefined&&value.subscribers===undefined)throw new HistoryError('O arquivo de histórico contém uma observação sem contagens.');
  for(const key of ['views','subscribers'])if(value[key]!==undefined&&!metric(value[key]))throw new HistoryError('O arquivo de histórico possui contagens inválidas; ele não foi sobrescrito.');
  for(const key of ['channel','channelId'])if(value[key]!==undefined&&(typeof value[key]!=='string'||value[key].length>200))throw new HistoryError('O arquivo de histórico possui metadados inválidos; ele não foi sobrescrito.');
  if(value.channelUrl!==undefined)publicUrl(value.channelUrl);
  return{id:value.id,videoId:value.videoId,title:value.title,url:value.url,observedAt:value.observedAt,...(value.recordedAt===undefined?{}:{recordedAt:value.recordedAt}),source:value.source,...(value.views===undefined?{}:{views:value.views}),...(value.subscribers===undefined?{}:{subscribers:value.subscribers}),...(value.channel?{channel:value.channel}:{}),...(value.channelId?{channelId:value.channelId}:{}),...(value.channelUrl?{channelUrl:value.channelUrl}:{})};
}
async function readJson(filename){
  let file;
  try{file=await open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW??0));const stat=await file.stat();if(!stat.isFile()||stat.size>MAX_BYTES)throw new HistoryError('O arquivo de histórico é inválido ou excede 10 MiB; ele não foi alterado.');const raw=await file.readFile({encoding:'utf8'});if(Buffer.byteLength(raw)>MAX_BYTES)throw new HistoryError('O arquivo de histórico excede 10 MiB; ele não foi alterado.');try{return JSON.parse(raw);}catch{throw new HistoryError('O arquivo de histórico contém JSON inválido; ele não foi sobrescrito.');}}
  catch(error){if(error?.code==='ENOENT')return undefined;throw error;}
  finally{await file?.close();}
}
async function readStore(directory){const parsed=await readJson(join(directory,STORE));if(parsed===undefined)return{exists:false,records:[]};if(!plain(parsed)||parsed.version!==1||!Array.isArray(parsed.records)||parsed.records.length>MAX_RECORDS)throw new HistoryError('Formato ou versão do histórico inválido; o arquivo não foi sobrescrito.');const records=parsed.records.map(storedRecord),ids=new Set(records.map(record=>record.id));if(ids.size!==records.length)throw new HistoryError('O histórico possui identidades duplicadas; o arquivo não foi sobrescrito.');return{exists:true,records};}
const legacyName=id=>`${createHash('sha256').update(id).digest('hex')}.json`;
function legacyRows(parsed){if(parsed===undefined)return[];if(!Array.isArray(parsed)||parsed.length>10000)throw new HistoryError('O histórico antigo possui formato inválido; ele foi preservado.');return parsed.map(row=>{if(!plain(row)||!validTime(row.observedAt)||!metric(row.views)||row.source==='youtube-data-api')throw new HistoryError('O histórico antigo possui registros inválidos; ele foi preservado.');return{observedAt:row.observedAt,views:row.views,source:'user-provided-observation'};});}
async function readLegacy(directory,id){return legacyRows(await readJson(join(directory,legacyName(id))));}
const sampleKey=record=>JSON.stringify([record.videoId,Date.parse(record.observedAt),record.views??null,record.subscribers??null]);
function append(existing,incoming,max){const seen=new Set(existing.map(sampleKey));let duplicate=0;const additions=[];for(const record of incoming){const key=sampleKey(record);if(seen.has(key)){duplicate++;continue;}seen.add(key);additions.push(record);}const ordered=[...existing,...additions].sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));return{records:ordered.slice(-max),recorded:additions.length,addedKeys:new Set(additions.map(sampleKey)),duplicate,evicted:Math.max(0,ordered.length-max)};}
async function writeStore(directory,records){
  let retained=records,body=JSON.stringify({version:1,records:retained});let evicted=0;
  while(Buffer.byteLength(body)>MAX_BYTES&&retained.length){const remove=Math.max(1,Math.ceil(retained.length/10));retained=retained.slice(remove);evicted+=remove;body=JSON.stringify({version:1,records:retained});}
  await mkdir(directory,{recursive:true,mode:0o700});const temporary=join(directory,`.observations-v1-${randomUUID()}.tmp`);let file;
  try{file=await open(temporary,'wx',0o600);await file.writeFile(body,'utf8');await file.sync();await file.close();file=undefined;await rename(temporary,join(directory,STORE));return{records:retained,evicted};}
  finally{await file?.close();await unlink(temporary).catch(()=>{});}
}
function virtualLegacy(id,rows){return rows.map((row,index)=>({id:`legacy-${createHash('sha256').update(`${id}:${index}:${row.observedAt}:${row.views}`).digest('hex')}`,videoId:id,title:id,url:`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,observedAt:row.observedAt,views:row.views,source:'user-provided'}));}
function combined(current,legacy){const keys=new Set(current.map(sampleKey));return[...current,...legacy.filter(record=>!keys.has(sampleKey(record)))].sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt));}
async function historyRead(payload,config,exportAll=false){
  const id=payload.videoId===undefined?undefined:videoId(payload.videoId),count=exportAll?undefined:limit(payload.limit);
  const state=await readStore(config.directory),current=id?state.records.filter(record=>record.videoId===id):state.records;
  const records=id?combined(current,virtualLegacy(id,await readLegacy(config.directory,id))):[...current].sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt));
  return response({records:count===undefined?records:records.slice(0,count),total:records.length,...(exportAll?{format:'prevlev-observations-v1',version:1}:{})});
}

/** Read-only helper for local consumers/MCP. Never creates folders, records, or network requests. */
export async function readHistory(payload={},config={}){try{if(!plain(payload))throw new HistoryError('Parâmetros de leitura inválidos.');const selected=options(config);if(!selected)return missing();return await queued(selected.directory,()=>historyRead(payload,selected));}catch(error){return failure(error);}}

/** Explicit persistent actions; callers must authenticate and enforce origin/rate limits. */
export async function handleHistory(payload,config={},now=Date.now()){
  try{
    if(!plain(payload))throw new HistoryError('Envie uma ação de histórico válida.');const selected=options(config);if(!selected)return missing();
    const action=payload.action??'list';
    if(!['record','list','get','export','delete'].includes(action))throw new HistoryError('Ação de histórico desconhecida.');
    if(action==='get'&&payload.videoId===undefined)throw new HistoryError('Informe videoId para abrir um histórico.');
    if(action==='record'){
      if(!Array.isArray(payload.videos)||payload.videos.length===0||payload.videos.length>100)throw new HistoryError('Envie de 1 a 100 vídeos por registro.');
      const time=timestamp(now),candidates=payload.videos.map(video=>sample(video,time)),api=candidates.filter(item=>item.kind==='api').length,unknown=candidates.filter(item=>item.kind==='unknown').length,incoming=candidates.filter(item=>item.kind==='record').map(item=>item.record);
      if(api===candidates.length)return{status:'error',source,error:'Dados youtube-data-api não podem ser persistidos neste histórico. Nenhuma observação foi gravada.',data:{recorded:0,skippedApi:api}};
      if(!incoming.length)return response({recorded:0,skipped:api+unknown,skippedApi:api,skippedUnknown:unknown,records:[]},['Nenhuma contagem conhecida foi enviada; nenhum registro foi criado.']);
      return await queued(selected.directory,async()=>{const state=await readStore(selected.directory),result=append(state.records,incoming,selected.max);let written={records:result.records,evicted:0};if(result.recorded)written=await writeStore(selected.directory,result.records);return response({recorded:written.records.filter(record=>result.addedKeys.has(sampleKey(record))).length,accepted:result.recorded,duplicates:result.duplicate,skipped:api+unknown,skippedApi:api,skippedUnknown:unknown,evicted:result.evicted+written.evicted,records:written.records.filter(record=>incoming.some(item=>sampleKey(item)===sampleKey(record)))},api?['Observações youtube-data-api foram omitidas; somente as outras fontes aceitas foram registradas.']:[]);});
    }
    if(action==='delete'){
      if(payload.confirm!==true)throw new HistoryError('Confirme explicitamente com confirm:true para excluir o histórico.');const id=payload.videoId===undefined?undefined:videoId(payload.videoId);
      return await queued(selected.directory,async()=>{
        const state=await readStore(selected.directory),remaining=id?state.records.filter(record=>record.videoId!==id):[],deleted=state.records.length-remaining.length;let files=[],legacyCount=0,skippedLegacy=0;
        if(id){const parsed=await readJson(join(selected.directory,legacyName(id)));const rows=legacyRows(parsed);if(parsed!==undefined){files=[legacyName(id)];legacyCount=rows.length;}}
        else{let entries;try{entries=await readdir(selected.directory,{withFileTypes:true});}catch(error){if(error?.code!=='ENOENT')throw error;entries=[];}const candidates=entries.filter(entry=>entry.isFile()&&/^[a-f0-9]{64}\.json$/.test(entry.name));if(candidates.length>MAX_LEGACY_FILES)throw new HistoryError('Há arquivos antigos demais para exclusão segura nesta operação.');for(const entry of candidates)try{const parsed=await readJson(join(selected.directory,entry.name));const rows=legacyRows(parsed);if(Array.isArray(parsed)){files.push(entry.name);legacyCount+=rows.length;}}catch{skippedLegacy++;}}
        if(deleted||state.exists)await writeStore(selected.directory,remaining);let removedLegacy=0;for(const name of files)try{await unlink(join(selected.directory,name));removedLegacy++;}catch{skippedLegacy++;}
        return response({deleted,legacyObservations:legacyCount,legacyFilesDeleted:removedLegacy,legacyFilesSkipped:skippedLegacy},skippedLegacy?['Arquivos antigos não reconhecidos ou não removíveis foram preservados.']:[]);
      });
    }
    return await queued(selected.directory,()=>historyRead(payload,selected,action==='export'));
  }catch(error){return failure(error);}
}

/** Compatibility adapter for the original view-history analysis contract. */
export async function legacyHistory(payload,dataDir,now=Date.now()){
  const id=videoId(payload?.videoId);if(payload.views!==undefined&&!metric(payload.views))throw new HistoryError('views deve ser um número finito não negativo.');
  const selected=options({dataDir});if(!selected)return missing();if(payload.source==='youtube-data-api')return{status:'error',source,error:'Dados youtube-data-api não podem ser persistidos neste histórico.'};
  try{return await queued(selected.directory,async()=>{
    const state=await readStore(selected.directory),old=await readLegacy(selected.directory,id);let records=state.records;
    if(payload.views!==undefined){const candidate=sample({id,title:payload.title,url:payload.url,views:payload.views,observedAt:payload.observedAt,source:payload.source??'user-provided'},timestamp(now));const result=append(records,[candidate.record],selected.max);records=result.recorded?(await writeStore(selected.directory,result.records)).records:result.records;}
    const observations=combined(records.filter(record=>record.videoId===id&&record.views!==undefined),virtualLegacy(id,old)).reverse().map(record=>({observedAt:record.observedAt,views:record.views,source:record.source==='user-provided'?'user-provided-observation':record.source}));return response({videoId:id,observations});
  });}catch(error){return failure(error);}
}
