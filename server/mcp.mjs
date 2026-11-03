// Optional local stdio interface. Importing this module performs no application IO.
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzeDataset } from './analysis.mjs';
import { readHistory } from './history.mjs';

const FEATURES = ['similar-videos','similar-channels','niche','search-analysis','channel-analytics','channel-report','combined-analytics','sponsorships'];
const TOOL_NAMES = ['prevlev_capabilities','analyze_dataset','history_list','history_get','history_export'];
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const READ_ONLY = {readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const SOURCES = ['youtube-dom','public-page','user-provided','youtube-data-api'];
const LIMIT = z.number().int().min(1).max(500).optional();
const VIDEO_ID = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const NONNEGATIVE = z.number().finite().nonnegative();
const videoSchema = z.object({
  id:z.string().trim().min(1).max(100),title:z.string().max(500),
  url:z.string().max(2048).optional(),channel:z.string().max(200).optional(),channelId:z.string().max(100).optional(),channelUrl:z.string().max(2048).optional(),
  views:NONNEGATIVE.optional(),durationSeconds:NONNEGATIVE.optional(),subscribers:NONNEGATIVE.optional(),isShort:z.boolean().optional(),publishedAt:z.string().max(50).optional(),
  thumbnail:z.string().max(2048).optional(),source:z.enum(SOURCES).optional(),observedAt:z.string().max(50).optional(),
}).strict();
const analyzeSchema = z.object({
  feature:z.enum(FEATURES),videos:z.array(videoSchema).min(1).max(500).optional(),text:z.string().max(100000).optional(),query:z.string().max(100000).optional(),targetId:z.string().max(100).optional(),source:z.enum(SOURCES).optional(),
}).strict();
const listSchema = z.object({limit:LIMIT}).strict();
const getSchema = z.object({videoId:VIDEO_ID,limit:LIMIT}).strict();
const exportSchema = z.object({videoId:VIDEO_ID.optional(),limit:LIMIT}).strict();

function result(value,isError=false) {
  const text=JSON.stringify(value);
  if(Buffer.byteLength(text,'utf8')>MAX_OUTPUT_BYTES) return result({status:'error',source:'prevlev:mcp',error:'Resultado local acima de 2 MiB. Reduza o limite ou filtre por vídeo.'},true);
  return {content:[{type:'text',text}],structuredContent:value,...(isError?{isError:true}:{})};
}
const failed = message => result({status:'error',source:'prevlev:mcp',error:message},true);

/** No service, provider, key or browser settings are read here. */
export function mcpConfigFromEnv(env=process.env) {
  return {enabled:env.MCP_ENABLED==='true',dataDir:resolve(env.DATA_DIR??'data/history'),historyMaxRecords:Number(env.HISTORY_MAX_RECORDS??5000)};
}

/** Factory only: the caller must explicitly enable and connect a transport. */
export function createPrevlevMcpServer(config={},dependencies={}) {
  if(config.enabled!==true) throw new Error('Prevlev MCP desativado. Ative MCP_ENABLED=true somente no processo local escolhido.');
  const dataDir=resolve(config.dataDir??'data/history');
  const historyMaxRecords=config.historyMaxRecords??5000;
  if(!Number.isInteger(historyMaxRecords)||historyMaxRecords<1||historyMaxRecords>5000) throw new Error('HISTORY_MAX_RECORDS deve ficar entre 1 e 5000.');
  const analyze=dependencies.analyzeDataset??analyzeDataset;
  const read=dependencies.readHistory??readHistory;
  const server=new McpServer({name:'prevlev-local',version:'0.6.0'},{capabilities:{tools:{}},maxToolInputElements:15000});
  server.registerTool('prevlev_capabilities',{
    title:'Escopo local do Prevlev',description:'Lista as ferramentas locais disponíveis e seus limites. Não testa serviços nem inicia consultas externas.',inputSchema:z.object({}).strict(),annotations:READ_ONLY,
  },async()=>result({status:'ok',source:'prevlev:mcp',data:{transport:'stdio',readOnly:true,network:false,ai:false,channelMutations:false,tools:TOOL_NAMES,features:FEATURES,limits:{videos:500,textCharacters:100000,historyRecords:500,outputBytes:MAX_OUTPUT_BYTES},excludedSources:['youtube-data-api']},limitations:['Análises usam somente os dados locais enviados; não representam o catálogo inteiro do YouTube.','Histórico depende de observações locais já existentes; este servidor não cria nem altera registros.','Dados identificados como YouTube Data API não são usados em métricas derivadas.']}));
  server.registerTool('analyze_dataset',{
    title:'Analisar dados locais',description:'Analisa somente vídeos/texto fornecidos na chamada. Aceita dados próprios ou observados no navegador; rejeita YouTube Data API. Não consulta YouTube, Nexlev ou provedores de IA.',inputSchema:analyzeSchema,annotations:READ_ONLY,
  },async input=>{
    if(input.source==='youtube-data-api'||input.videos?.some(video=>video.source==='youtube-data-api')) return failed('Dados marcados como youtube-data-api não podem ser usados nesta análise derivada local.');
    if(input.feature==='sponsorships'?!input.text?.trim():!input.videos?.length) return failed(input.feature==='sponsorships'?'Forneça texto real para examinar possíveis divulgações comerciais.':'Forneça de 1 a 500 vídeos observados para a análise.');
    try {const value=await analyze(input.feature,{videos:input.videos,text:input.text,query:input.query,targetId:input.targetId});return result(value,value.status!=='ok');}
    catch {return failed('Não foi possível analisar os dados locais. Confira os campos e limites; nenhuma consulta externa foi feita.');}
  });
  const history=async(input,exporting=false)=>{
    try {
      const limit=input.limit??100;
      const value=await read({...(input.videoId?{videoId:input.videoId}:{}),limit},{dataDir,historyMaxRecords});
      if(value.status!=='ok') return failed('Não foi possível ler o histórico local. Confira a configuração e o arquivo de observações.');
      return result(exporting?{...value,data:{...value.data,format:'json',bounded:true,limit},limitations:[...(value.limitations??[]),'Exportação MCP limitada ao filtro e ao limite solicitado, no máximo 500 registros. Nenhum arquivo foi gravado.']}:value);
    } catch {return failed('Não foi possível ler o histórico local. Nenhum registro foi criado ou alterado.');}
  };
  server.registerTool('history_list',{title:'Listar histórico local',description:'Lê observações locais existentes, das mais recentes às antigas. Não descobre os arquivos legados sem ID no índice nem grava registros.',inputSchema:listSchema,annotations:READ_ONLY},input=>history(input));
  server.registerTool('history_get',{title:'Ler histórico de um vídeo',description:'Lê observações locais existentes para o ID exato de vídeo, incluindo legado reconhecido quando disponível. Não consulta YouTube.',inputSchema:getSchema,annotations:READ_ONLY},input=>history(input));
  server.registerTool('history_export',{title:'Exportar histórico local limitado',description:'Retorna JSON de até 500 observações locais existentes. Não grava arquivo nem recebe caminhos de arquivo.',inputSchema:exportSchema,annotations:READ_ONLY},input=>history(input,true));
  return server;
}

export const serverMcp=createPrevlevMcpServer;

// A client must start this process explicitly; no HTTP route or registration exists.
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if(process.env.MCP_ENABLED!=='true') {
    process.stderr.write('Prevlev MCP desativado. Inicie explicitamente com MCP_ENABLED=true.\n');process.exitCode=1;
  } else {
    try {
      const config=mcpConfigFromEnv();
      // Validate the local configuration before attaching stdin/stdout.
      createPrevlevMcpServer(config);
      const handle=serveStdio(()=>createPrevlevMcpServer(config),{
        transport:new StdioServerTransport(process.stdin,process.stdout,{maxBufferSize:2*1024*1024}),
        onerror:()=>process.stderr.write('Prevlev MCP: mensagem ou transporte incompatível.\n'),
      });
      const close=()=>{void handle.close().catch(()=>{process.exitCode=1;});};
      process.once('SIGINT',close);process.once('SIGTERM',close);
    } catch {process.stderr.write('Prevlev MCP não pôde iniciar. Confira MCP_ENABLED, DATA_DIR e HISTORY_MAX_RECORDS.\n');process.exitCode=1;}
  }
}
