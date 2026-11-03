import {normalizeSwipeLibrary,parseSwipeImport,ensureSwipeBudget} from '../src/core/swipe.ts';
import {open,mkdir,rename,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';import {join,resolve} from 'node:path';import {createHash,randomUUID} from 'node:crypto';
class LibraryError extends Error {}
const queues=new Map(),source='prevlev:library',MAX_BYTES=4*1024*1024+4096;
const revision=items=>createHash('sha256').update(JSON.stringify(items)).digest('hex');
const ok=(items,extra={})=>({status:'ok',source,data:{items,revision:revision(items),assetSchemaVersion:1,folderIdentityVersion:1,...extra},limitations:['Biblioteca pessoal deste backend; sincronização manual, sem contas ou isolamento multiusuário.','Dados locais de referências, sem consulta ao YouTube/Omni e sem sincronização automática.']});
const failure=message=>({status:'error',source,error:message});
function config(options){if(!options?.dataDir)throw new LibraryError('Configure DATA_DIR para a biblioteca pessoal.');return resolve(options.dataDir);}
async function serialized(directory,work){const previous=queues.get(directory)??Promise.resolve(),next=previous.catch(()=>{}).then(work);queues.set(directory,next);try{return await next;}finally{if(queues.get(directory)===next)queues.delete(directory);}}
async function read(directory){let file;try{file=await open(join(directory,'library-v1.json'),constants.O_RDONLY|(constants.O_NOFOLLOW??0));const stat=await file.stat();if(!stat.isFile()||stat.size>MAX_BYTES)throw new Error();const text=await file.readFile('utf8');if(Buffer.byteLength(text)>MAX_BYTES)throw new Error();const envelope=JSON.parse(text);if(envelope.version!==1||!Array.isArray(envelope.items))throw new Error();const items=normalizeSwipeLibrary(envelope.items);if(envelope.revision!==revision(items))throw new Error();return items;}catch(error){if(error?.code==='ENOENT')return[];throw new LibraryError('Arquivo de biblioteca inválido ou inacessível; ele foi preservado.');}finally{await file?.close();}}
async function write(directory,items){ensureSwipeBudget(items);await mkdir(directory,{recursive:true,mode:0o700});const target=join(directory,'library-v1.json'),temp=join(directory,`.library-${randomUUID()}.tmp`);let file;try{file=await open(temp,'wx',0o600);await file.writeFile(JSON.stringify({version:1,revision:revision(items),items}),'utf8');await file.sync();await file.close();file=undefined;await rename(temp,target);}finally{await file?.close();await unlink(temp).catch(()=>{});}}
export async function handleLibrary(payload,options={}){
 try{if(!payload||typeof payload!=='object'||Array.isArray(payload))return failure('Envie uma ação de biblioteca válida.');if(payload.source==='youtube-data-api')return failure('Dados da API oficial não podem alimentar esta biblioteca pessoal.');const directory=config(options);
  if(payload.action==='read')return await serialized(directory,async()=>ok(await read(directory)));
  if(payload.action!=='commit')return failure('Ação de biblioteca desconhecida.');
  if(typeof payload.baseRevision!=='string'||!/^[a-f0-9]{64}$/.test(payload.baseRevision))return failure('Consulte a biblioteca e informe a revisão exata antes de substituir dados.');
  if(!Array.isArray(payload.items))return failure('Envie uma lista explícita de referências, inclusive para esvaziar a biblioteca.');
  let items;try{items=parseSwipeImport(payload.items);ensureSwipeBudget(items);}catch{return failure('Biblioteca inválida: use referências locais válidas, até 5000 itens e 4 MiB, sem origem youtube-data-api.');}
  return await serialized(directory,async()=>{const current=await read(directory);if(payload.baseRevision!==revision(current))return{status:'error',source,error:'A biblioteca do backend mudou. Consulte e revise novamente; nenhum dado foi sobrescrito.',data:{conflict:true,revision:revision(current)}};await write(directory,items);return ok(items,{saved:items.length});});
 }catch(error){return failure(error instanceof LibraryError?error.message:'Não foi possível acessar a biblioteca pessoal. Nenhum caminho ou conteúdo privado é exposto.');}
}
