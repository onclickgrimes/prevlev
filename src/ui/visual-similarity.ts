import {compareLocalImages,visualReportCsv,visualReportJson,type VisualReport} from '../core/visual-similarity';
import {downloadBlob} from '../core/media';
import {prepareImagePreview,type ImagePreview} from './image-preview';

export function initVisualSimilarityTools():()=>void {
  const host=document.getElementById('visual-similarity');if(!host)return()=>{};
  host.innerHTML=`<div class="card"><h2>Similaridade visual local</h2><p>Compare uma imagem de referência com até 20 imagens locais. O dHash de 64 bits compara padrões de luminância, não cores ou significado; imagens diferentes podem ter o mesmo hash. A transparência é composta sobre branco. Use PNG, JPEG ou WebP estático. Limites: 10 MiB por arquivo, 50 MiB no total, 20 megapixels por imagem e 15 segundos.</p><label>Imagem de referência<input id="visual-reference" type="file" accept="image/png,image/jpeg,image/webp"></label><label>Imagens candidatas<input id="visual-candidates" type="file" accept="image/png,image/jpeg,image/webp" multiple></label><div class="actions"><button id="visual-compare" class="primary">Comparar imagens</button><button id="visual-cancel" disabled>Cancelar</button><button id="visual-csv" disabled>Exportar CSV</button><button id="visual-json" disabled>Exportar JSON</button></div><p id="visual-status" role="status" aria-live="polite"></p><div id="visual-results"></div></div>`;
  const get=<T extends HTMLElement=HTMLElement>(id:string)=>host.querySelector<T>(`#visual-${id}`)!;
  const reference=get<HTMLInputElement>('reference'),candidates=get<HTMLInputElement>('candidates'),compare=get<HTMLButtonElement>('compare'),cancel=get<HTMLButtonElement>('cancel'),csv=get<HTMLButtonElement>('csv'),json=get<HTMLButtonElement>('json'),status=get('status'),results=get('results');
  let controller:AbortController|undefined,previewController:AbortController|undefined,report:VisualReport|undefined,previews:ImagePreview[]=[],disposed=false;
  const clean=()=>{previewController?.abort();previewController=undefined;for(const preview of previews)preview.release();previews=[];results.replaceChildren();report=undefined;csv.disabled=true;json.disabled=true;};
  const changed=()=>{controller?.abort();clean();status.textContent='Seleção alterada. Compare novamente.';};
  const run=async()=>{
    if(controller)return;clean();const base=reference.files?.[0],files=Array.from(candidates.files??[]);if(!base){status.textContent='Selecione uma imagem de referência local.';return;}
    const active=new AbortController();controller=active;compare.disabled=true;cancel.disabled=false;status.textContent='Comparando imagens locais…';
    try{
      const next=await compareLocalImages(base,files,{signal:active.signal});if(active.signal.aborted||disposed)return;
      previewController=active;const fragment=document.createDocumentFragment(),previewOptions={signal:active.signal,maxBytes:10*1024*1024,maxPixels:20_000_000,maxDimension:16384};
      const ref=document.createElement('p');ref.textContent=`Referência: ${next.reference}`;fragment.append(ref);
      const refImage=document.createElement('img');refImage.alt='Imagem de referência';refImage.style.cssText='width:160px;max-height:100px;object-fit:contain';previews.push(await prepareImagePreview(refImage,base,previewOptions));fragment.append(refImage);
      const list=document.createElement('ol');
      for(const match of next.matches){const li=document.createElement('li'),img=document.createElement('img'),label=document.createElement('span');img.alt=`Prévia: ${match.name}`;img.style.cssText='width:120px;max-height:80px;object-fit:contain;vertical-align:middle;margin-right:8px';previews.push(await prepareImagePreview(img,files[match.index],previewOptions));label.textContent=`${match.name}: ${match.similarity.toFixed(2)}% · distância ${match.distance}/64${match.duplicateOf?` · bytes duplicados de ${match.duplicateOf}`:''}`;li.append(img,label);list.append(li);}
      fragment.append(list);
      if(next.invalid.length){const heading=document.createElement('p');heading.textContent='Arquivos ignorados:';fragment.append(heading);const errors=document.createElement('ul');for(const invalid of next.invalid){const li=document.createElement('li');li.textContent=`${invalid.name}: ${invalid.error}`;errors.append(li);}fragment.append(errors);}
      if(active.signal.aborted||disposed)return;results.replaceChildren(fragment);report=next;
      csv.disabled=false;json.disabled=false;status.textContent=`${next.matches.length} imagem(ns) comparada(s); ${next.invalid.length} inválida(s). Ordem por menor distância de Hamming.`;
    }catch(error){if(disposed)return;const aborted=active.signal.aborted;clean();status.textContent=aborted?'Comparação cancelada.':error instanceof Error?error.message:'Falha na comparação local.';}
    finally{if(controller===active)controller=undefined;if(!disposed){compare.disabled=false;cancel.disabled=true;}}
  };
  const onRun=()=>{void run();},onCancel=()=>controller?.abort(),onCsv=()=>{if(report)downloadBlob(new Blob([visualReportCsv(report)],{type:'text/csv;charset=utf-8'}),'prevlev-similaridade-visual.csv');},onJson=()=>{if(report)downloadBlob(new Blob([visualReportJson(report)],{type:'application/json;charset=utf-8'}),'prevlev-similaridade-visual.json');};
  reference.addEventListener('change',changed);candidates.addEventListener('change',changed);compare.addEventListener('click',onRun);cancel.addEventListener('click',onCancel);csv.addEventListener('click',onCsv);json.addEventListener('click',onJson);
  return()=>{disposed=true;controller?.abort();clean();reference.removeEventListener('change',changed);candidates.removeEventListener('change',changed);compare.removeEventListener('click',onRun);cancel.removeEventListener('click',onCancel);csv.removeEventListener('click',onCsv);json.removeEventListener('click',onJson);};
}
