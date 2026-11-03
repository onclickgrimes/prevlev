import {createSwipeAsset,type SwipeAssetProvenance} from '../core/swipe-assets';
import {createSwipeReference,normalizeSwipeItem,swipeIdentity} from '../core/swipe';
import {imageBlobFromDataUrl} from '../core/image-preflight';
import {downloadBlob} from '../core/media';
import type {SwipeItem} from '../shared/storage';
import type {VideoRecord} from '../shared/types';

export interface SaveSwipeAssetMetadata {title:string;url:string;folder?:string;source?:VideoRecord['source'];provenance:SwipeAssetProvenance;}
export function initSwipeAssetActions(deps:{update:(change:(items:SwipeItem[])=>SwipeItem[])=>Promise<SwipeItem[]>;render:()=>Promise<void>;status:(message:string,error?:boolean)=>void}){
 let active:AbortController|undefined;
 const invalidate=()=>{active?.abort();active=undefined;};
 const begin=()=>{invalidate();const controller=new AbortController();active=controller;return controller;};
 const fail=(error:unknown)=>{if(error instanceof DOMException&&error.name==='AbortError')return;deps.status(error instanceof Error?error.message:'Não foi possível atualizar o ativo local.',true);};
 async function saveAsset(blob:Blob,metadata:SaveSwipeAssetMetadata,guard?:()=>boolean):Promise<string>{
  if(metadata.source==='youtube-data-api')throw new Error('Dados da API oficial não podem alimentar ativos locais.');
  const controller=begin(),current=()=>{controller.signal.throwIfAborted();if(guard&&!guard())throw new DOMException('A origem ou resultado mudou. Ativo pendente descartado.','AbortError');};current();
  const reference=createSwipeReference({title:metadata.title,url:metadata.url,folder:metadata.folder,source:metadata.source??'user-provided'}),asset=await createSwipeAsset(blob,metadata.provenance,{signal:controller.signal});current();let savedId=reference.id;
  await deps.update(items=>{current();const existing=items.find(item=>swipeIdentity(item)===swipeIdentity(reference));if(existing?.image)throw new Error('Essa referência já tem uma imagem. Revise e use Anexar imagem local no item para substituí-la explicitamente.');if(existing){savedId=existing.id;return items.map(item=>item.id===existing.id?normalizeSwipeItem({...item,...asset,updatedAt:new Date().toISOString()}):item);}return [...items,normalizeSwipeItem({...reference,...asset})];});
  current();if(active===controller)active=undefined;await deps.render();if(guard&&!guard())throw new DOMException('A origem ou resultado mudou após a gravação local.','AbortError');deps.status('Imagem salva explicitamente na biblioteca local com bytes e procedência.');return savedId;
 }
 function mount(parent:HTMLElement,item:SwipeItem){
  const doc=parent.ownerDocument,controls=doc.createElement('div');controls.className='row swipe-asset-actions';
  const label=doc.createElement('label');label.textContent='Arquivo PNG/JPEG/WebP local (até 3 MiB, dentro dos 4 MiB totais)';const file=doc.createElement('input');file.type='file';file.accept='image/png,image/jpeg,image/webp';file.setAttribute('aria-label',`Imagem local para ${item.title}`);label.append(file);
  const attach=doc.createElement('button');attach.type='button';attach.textContent=item.image?'Substituir imagem local':'Anexar imagem local';const cancel=doc.createElement('button');cancel.type='button';cancel.textContent='Cancelar anexo';cancel.disabled=true;
  const stamp=JSON.stringify(normalizeSwipeItem(item));
  attach.addEventListener('click',()=>{const selected=file.files?.[0];if(!selected){deps.status('Escolha um arquivo local antes de anexar.',true);return;}const controller=begin();attach.disabled=true;cancel.disabled=false;deps.status('Validando bytes e dimensões locais antes de salvar…');void(async()=>{
   const asset=await createSwipeAsset(selected,{kind:'file',sourceUrl:item.url,fileName:selected.name},{signal:controller.signal});
   await deps.update(items=>{controller.signal.throwIfAborted();const latest=items.find(entry=>entry.id===item.id);if(!latest||JSON.stringify(normalizeSwipeItem(latest))!==stamp)throw new Error('A referência mudou durante o anexo. Reabra o item e revise antes de salvar.');return items.map(entry=>entry.id===item.id?normalizeSwipeItem({...entry,...asset,updatedAt:new Date().toISOString()}):entry);});
   await deps.render();deps.status('Imagem local anexada; referência e data de criação preservadas.');
  })().catch(fail).finally(()=>{attach.disabled=false;cancel.disabled=true;file.value='';});});
  cancel.addEventListener('click',()=>{invalidate();deps.status('Anexo pendente cancelado; nenhum novo ativo foi confirmado.');});
  file.addEventListener('change',()=>{invalidate();deps.status('Arquivo selecionado somente localmente. Clique em Anexar/Substituir para salvar.');});
  controls.append(label,attach,cancel);
  if(item.image?.startsWith('data:')){
   const download=doc.createElement('button');download.type='button';download.textContent='Baixar imagem local';download.addEventListener('click',()=>{void imageBlobFromDataUrl(item.image!,{maxBytes:3*1024*1024}).then(blob=>downloadBlob(blob,`prevlev-biblioteca-${item.id}.${blob.type==='image/jpeg'?'jpg':blob.type==='image/webp'?'webp':'png'}`)).catch(fail);});
   const remove=doc.createElement('button');remove.type='button';remove.textContent='Remover imagem local';remove.addEventListener('click',()=>{invalidate();void deps.update(items=>items.map(entry=>{if(entry.id!==item.id)return entry;const latest=normalizeSwipeItem(entry);if(JSON.stringify(latest)!==stamp)throw new Error('A referência mudou; atualize antes de remover sua imagem.');delete latest.image;delete latest.asset;return {...latest,updatedAt:new Date().toISOString()};})).then(async()=>{await deps.render();deps.status('Imagem local removida; referência e metadados preservados.');}).catch(fail);});controls.append(download,remove);
  }
  if(item.asset){const provenance=doc.createElement('p');provenance.textContent=`Ativo local ${item.asset.id} · ${item.asset.kind} · ${item.asset.width} × ${item.asset.height} · ${item.asset.bytes} bytes · origem declarada ${item.asset.sourceUrl} · ${item.asset.createdAt}`;parent.append(provenance);}
  parent.append(controls);
 }
 return {mount,saveAsset,invalidate};
}
