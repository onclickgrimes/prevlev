import {buildCyclicVersions,compressToTarget,renderHomePreview,type HomePreviewOptions,type PreviewVersion,type TargetCompressionResult,type ImageFormat} from '../core/image-workflows';
import {copyImage,downloadBlob,fetchThumbnail} from '../core/media';
import {preflightImage} from '../core/image-preflight';
import {prepareImagePreview,type ImagePreview} from './image-preview';
import {videoIdFromUrl} from '../core/parse';
import type {VideoRecord} from '../shared/types';
import {bindImageContext,ConfirmedImageMetadata,IMAGE_CONTEXT_SURFACES,type BoundImageContext,type ImageContextCapture,type ImageContextSource,type ImagePreviewMetadata} from '../core/image-context';

export interface ImageTools {():void;invalidateContext():void;cleanup():void;}
export interface ImageToolsOptions {
  notice?:(message:string,error?:boolean)=>void;
  /** Legacy pure frozen-collection getter, read only on an explicit sample load. */
  contextVideos?:()=>readonly VideoRecord[];
  contextIdentity?:(source:ImageContextSource)=>string|undefined;
  captureContext?:(request:{source:ImageContextSource;expectedIdentity:string;signal:AbortSignal})=>Promise<ImageContextCapture>;
}
export function initImageTools(options:ImageToolsOptions={}):ImageTools {
  const host=document.getElementById('images');if(!host){const empty=()=>{};return Object.assign(empty,{invalidateContext:empty,cleanup:empty});}
  host.innerHTML=`<div class="card"><h2>Imagens e títulos no contexto da página inicial</h2><p class="muted">Use somente seus arquivos locais. A composição é ilustrativa: não altera o YouTube, não testa audiência e não prevê CTR.</p><div class="grid two"><div><label>Imagem original (ou use as candidatas)<input id="image-file" type="file" accept="image/png,image/jpeg,image/webp"></label><label>Título original<input id="original-title" type="text" maxlength="500" value="Título original do vídeo"></label><label>Imagens candidatas (até 6; opcional para mudar só o título)<input id="candidate-file" type="file" accept="image/png,image/jpeg,image/webp" multiple></label><label>Título candidato<input id="preview-title" type="text" maxlength="500" value="Título da candidata"></label><label>Outros títulos (um por linha; até 6 títulos no total)<textarea id="preview-titles" rows="3" maxlength="3000" placeholder="Segunda opção de título&#10;Terceira opção de título"></textarea></label><label>Nome do canal<input id="preview-channel" type="text" maxlength="80" value="Seu canal"></label><label>Avatar local opcional<input id="preview-avatar" type="file" accept="image/png,image/jpeg,image/webp"></label></div><div><div class="form-grid"><label>Layout<select id="preview-context"><option value="desktop">Desktop</option><option value="mobile">Celular</option><option value="list">Lista</option></select></label><label>Tema<select id="preview-theme"><option value="dark">Escuro</option><option value="light">Claro</option></select></label><label>Posição das variações<select id="preview-position"><option value="first">Primeira posição</option><option value="random">Posição aleatória</option></select></label><label>Comparação<select id="preview-mode"><option value="gallery">Home com variações</option><option value="side-by-side">Original e candidata lado a lado</option><option value="original">Somente original</option><option value="candidate">Somente candidata</option></select></label><label>Fonte do contexto<select id="preview-source"><option value="illustrative" selected>Ilustrativo, sem coleta</option><option value="loaded">Coleção local congelada</option><option value="selected-tab">Aba YouTube selecionada</option></select></label><label>Contexto visual<select id="preview-feed"><option value="home">Página inicial</option><option value="trending">Em alta</option><option value="subscriptions">Inscrições</option><option value="channel">Canal</option><option value="search">Busca por termo</option><option value="other">Coleção / outro contexto</option></select></label></div><div class="actions"><button type="button" id="preview-load-context">Usar amostra da fonte escolhida</button><button type="button" id="preview-cancel-context" disabled>Cancelar captura da amostra</button></div><p id="preview-source-info" role="status">Contexto ilustrativo. Nenhuma coleta foi iniciada.</p><label>Canal ou termo do contexto (texto fornecido por você)<input id="preview-feed-label" type="text" maxlength="120" placeholder="Canal ou termo de exemplo"></label><details id="preview-metadata" open><summary>Editar metadados ilustrativos</summary><label>Visualizações de exemplo (texto editável)<input id="preview-views" type="text" maxlength="80" value="12 mil visualizações · exemplo"></label><label>Data de exemplo<input id="preview-date" type="text" maxlength="80" value="há 2 dias · exemplo"></label><label>Duração exibida<input id="preview-duration" type="text" maxlength="20" value="10:00"></label><div class="actions"><button id="metadata-reset">Redefinir metadados</button><button id="metadata-done">Concluir metadados</button></div></details><div class="actions"><button id="image-preview" class="primary">Gerar prévia</button><button id="preview-restore">Ver original</button><button id="preview-shuffle">Embaralhar posição</button><button id="preview-download" disabled>Baixar prévia</button></div><p id="preview-status" class="muted" role="status"></p><div id="image-variants" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px"></div></div></div><div id="image-preview-empty" class="empty">Envie uma imagem original e gere a composição local.</div><img id="image-output" alt="Composição local de imagens e títulos; metadados ilustrativos" hidden style="width:100%;height:auto;margin-top:16px"></div>
  <div class="card"><h2>Comprimir até uma meta de tamanho</h2><p class="muted">A busca tem limite de tempo e de tentativas. Uma meta muito pequena pode ser impossível; o resultado informa os bytes reais, sem garantia de atingir a meta. Use PNG, JPEG ou WebP estático; GIF, AVIF e imagens animadas não são suportados. Limites: 10 MiB por arquivo, 50 MiB por seleção e 32 megapixels.</p><div class="form-grid"><label>Arquivo<select id="compression-source"><option value="original">Imagem original</option><option value="candidate">Imagem da candidata selecionada</option></select></label><label>Meta (KiB = 1024 bytes)<input id="compression-target-kb" type="number" min="0.001" max="51200" step="0.001" value="2048"></label><label>Largura máxima<input id="image-width" type="number" min="1" max="16384" value="1280"></label><label>Altura máxima<input id="image-height" type="number" min="1" max="16384" value="720"></label><label>Qualidade inicial (%)<input id="image-quality" type="number" min="10" max="100" value="85"></label><label>Formato<select id="compression-format"><option value="image/jpeg">JPEG</option><option value="image/webp">WebP</option><option value="image/png">PNG</option></select></label></div><label class="toggle"><input id="flatten-alpha" type="checkbox"> Autorizar achatar transparência ao gerar JPEG</label><label>Cor de fundo para achatar<input id="flatten-color" type="color" value="#ffffff"></label><div class="actions"><button id="compress" class="primary">Comprimir e baixar se atingir a meta</button><button id="compression-cancel" disabled>Cancelar</button><button id="compression-download" disabled>Baixar resultado</button></div><p id="image-info" role="status" class="muted"></p><pre id="compression-result" aria-live="polite"></pre></div>
  <div class="card"><h2>Thumbnail pública de um vídeo</h2><p class="muted">Consulta somente o CDN público do YouTube quando você clicar.</p><label>ID ou URL YouTube<input id="thumbnail-id" type="text"></label><div class="actions"><button id="download-thumbnail">Baixar thumbnail</button><button id="copy-thumbnail">Copiar imagem</button></div></div>`;
  const $=<T extends HTMLElement=HTMLElement>(id:string)=>host.querySelector<T>(`#${id}`)!;
  const value=(id:string)=>$<HTMLInputElement>(id).value;
  const number=(id:string)=>Number(value(id));
  const show=(message:string,error=false)=>{if(disposed)return;$('image-info').textContent=message;options.notice?.(message,error);};
  const fail=(error:unknown)=>{if(error instanceof DOMException&&error.name==='AbortError')return;show(error instanceof Error?error.message:'Falha no processamento local.',true);};
  const events:Array<()=>void>=[];
  const listen=(id:string,event:string,callback:()=>void)=>{const element=$(id);element.addEventListener(event,callback);events.push(()=>element.removeEventListener(event,callback));};
  const click=(id:string,task:()=>unknown)=>listen(id,'click',()=>{void Promise.resolve().then(task).catch(fail);});
  const limits={maxBytes:10*1024*1024,maxPixels:32_000_000,maxDimension:16384};
  let disposed=false,selectionValid=false,selectionPending=false;
  let original:File|undefined,candidates:File[]=[],avatar:File|undefined,variants:PreviewVersion[]=[],selected=0,seed=17;
  let previousOriginalInput:File|undefined,previousCandidateInputs:File[]=[];
  let boundContext:BoundImageContext|undefined,contextAbort:AbortController|undefined,contextEpoch=0;
  let previewAbort:AbortController|undefined,galleryAbort:AbortController|undefined,selectionAbort:AbortController|undefined,compressionAbort:AbortController|undefined;
  let previewOwner:ImagePreview|undefined,previewBlob:Blob|undefined,last:TargetCompressionResult|undefined,galleryOwners:ImagePreview[]=[];
  let validationTail:Promise<void>=Promise.resolve(),selectionReady:Promise<void>=Promise.resolve();
  const validated=new WeakSet<Blob>();
  const metadata=()=>({channel:value('preview-channel'),views:value('preview-views'),date:value('preview-date'),duration:value('preview-duration'),avatar:$<HTMLInputElement>('preview-avatar').files?.[0]});
  const confirmedMetadata=new ConfirmedImageMetadata(metadata());
  const metadataUnchanged=(a:ImagePreviewMetadata,b:ImagePreviewMetadata)=>a.channel===b.channel&&a.views===b.views&&a.date===b.date&&a.duration===b.duration&&a.avatar===b.avatar;
  const source=():ImageContextSource|undefined=>value('preview-source')==='loaded'?'collection':value('preview-source')==='selected-tab'?'selected-tab':undefined;
  const identity=(which:ImageContextSource)=>options.contextIdentity?.(which)??(which==='collection'&&options.contextVideos?'local-frozen-collection':undefined);
  const sourceControls=()=>{const which=source();$<HTMLButtonElement>('preview-load-context').disabled=!which||!!contextAbort||!(options.captureContext||(which==='collection'&&options.contextVideos));$<HTMLButtonElement>('preview-cancel-context').disabled=!contextAbort;$<HTMLSelectElement>('preview-feed').disabled=!!boundContext;$<HTMLInputElement>('preview-feed-label').disabled=!!boundContext;};
  const syncButtons=()=>{if(disposed)return;for(const id of ['image-preview','preview-shuffle','preview-restore'])$<HTMLButtonElement>(id).disabled=selectionPending;$<HTMLButtonElement>('compress').disabled=selectionPending||!!compressionAbort;};
  const clearGallery=()=>{galleryAbort?.abort();galleryAbort=undefined;for(const owner of galleryOwners)owner.release();galleryOwners=[];$('image-variants').replaceChildren();variants=[];};
  function clearPreview(){previewAbort?.abort();previewAbort=undefined;previewOwner?.release();previewOwner=undefined;previewBlob=undefined;$<HTMLImageElement>('image-output').removeAttribute('src');$('image-output').hidden=true;$('image-preview-empty').hidden=false;$<HTMLButtonElement>('preview-download').disabled=true;}
  const clearCompression=()=>{compressionAbort?.abort();last=undefined;$<HTMLButtonElement>('compression-download').disabled=true;$('compression-result').textContent='';};
  function createVariants(){
    const titleOptions=[value('preview-title'),...value('preview-titles').split('\n')].map(title=>title.trim()).filter(Boolean);
    if(titleOptions.length>6)throw new Error('Use até 6 títulos no total.');
    variants=buildCyclicVersions(candidates.length?candidates:original?[original]:[],titleOptions.length?titleOptions:['Título do vídeo'],value('preview-channel'));
    selected=Math.min(selected,Math.max(0,variants.length-1));
  }
  async function buildVariants(parentSignal?:AbortSignal){
    clearGallery();createVariants();const next=[...variants],controller=new AbortController();galleryAbort=controller;
    const signal=parentSignal?AbortSignal.any([parentSignal,controller.signal]):controller.signal,fragment=document.createDocumentFragment(),owners:ImagePreview[]=[];
    try{
      for(let index=0;index<next.length;index++){
        const variant=next[index],button=document.createElement('button'),image=document.createElement('img');
        button.type='button';button.setAttribute('aria-pressed',String(index===selected));button.style.cssText='text-align:left;min-width:0';
        image.alt=`Variação ${index+1}`;image.style.cssText='width:100%;height:70px;object-fit:cover';
        owners.push(await prepareImagePreview(image,variant.image,{...limits,signal,deadline:performance.now()+15000}));
        if(signal.aborted||disposed)throw new DOMException('Prévia cancelada.','AbortError');
        const title=document.createElement('span');title.textContent=`${index+1}. ${variant.title}`;button.append(image,title);
        button.addEventListener('click',()=>{const hadPreview=!!previewBlob;selected=index;clearPreview();$('image-variants').querySelectorAll('button').forEach((item,i)=>item.setAttribute('aria-pressed',String(i===index)));clearCompression();if(hadPreview)void render(false).catch(fail);});fragment.append(button);
      }
      if(signal.aborted||disposed)throw new DOMException('Prévia cancelada.','AbortError');
      galleryOwners=owners;$('image-variants').replaceChildren(fragment);
    }catch(error){for(const owner of owners)owner.release();if(galleryAbort===controller){galleryAbort=undefined;$('image-variants').replaceChildren();}throw error;}
  }
  function validateSelection(){
    const proposedOriginal=$<HTMLInputElement>('image-file').files?.[0],proposedCandidates=Array.from($<HTMLInputElement>('candidate-file').files??[]),proposedAvatar=$<HTMLInputElement>('preview-avatar').files?.[0];
    const variantFilesChanged=proposedOriginal!==previousOriginalInput||proposedCandidates.length!==previousCandidateInputs.length||proposedCandidates.some((file,index)=>file!==previousCandidateInputs[index]);
    previousOriginalInput=proposedOriginal;previousCandidateInputs=proposedCandidates;if(variantFilesChanged)selected=0;
    clearPreview();clearGallery();clearCompression();selectionAbort?.abort();
    original=undefined;candidates=[];avatar=undefined;selectionValid=false;
    const controller=new AbortController();selectionAbort=controller;selectionPending=true;syncButtons();$('preview-status').textContent='Validando cabeçalhos e dimensões antes de exibir imagens…';
    const task=async()=>{
      if(controller.signal.aborted||disposed)return;
      let headersReady=false;
      try{
        if(proposedCandidates.length>6)throw new Error('Selecione no máximo 6 imagens candidatas.');
        const all=[...(proposedOriginal?[proposedOriginal]:[]),...proposedCandidates,...(proposedAvatar?[proposedAvatar]:[])];
        if(all.reduce((total,file)=>total+file.size,0)>50*1024*1024)throw new Error('A seleção de arquivos excede 50 MiB.');
        for(const file of new Set(all)){if(controller.signal.aborted)throw new DOMException('Seleção cancelada.','AbortError');if(!validated.has(file)){await preflightImage(file,{...limits,signal:controller.signal,deadline:performance.now()+15000});validated.add(file);}}
        if(controller.signal.aborted||disposed)return;
        original=proposedOriginal;candidates=proposedCandidates;avatar=proposedAvatar;selectionValid=!!(original||candidates.length);headersReady=true;
        await buildVariants(controller.signal);if(controller.signal.aborted||disposed)return;
        $('preview-status').textContent='Seleção local validada. Gere a composição quando desejar.';show(original?`${original.name} · ${(original.size/1024).toFixed(1)} KiB`:'Escolha pelo menos uma imagem local.');
      }catch(error){if(controller.signal.aborted||disposed)return;if(headersReady&&error instanceof DOMException&&error.name==='AbortError'){$('preview-status').textContent='Arquivos validados; galeria descartada por alteração do contexto. Gere novamente.';return;}original=undefined;candidates=[];avatar=undefined;selectionValid=false;clearGallery();$('preview-status').textContent='Seleção inválida. A prévia anterior foi descartada.';fail(error);}
      finally{if(selectionAbort===controller){selectionPending=false;syncButtons();}}
    };
    selectionReady=validationTail.then(task,task);validationTail=selectionReady.catch(()=>{});
  }
  function resetContext(message:string){contextEpoch++;contextAbort?.abort();contextAbort=undefined;boundContext=undefined;clearPreview();clearGallery();sourceControls();$('preview-source-info').textContent=message;}
  async function captureContext(){
    if(contextAbort||disposed)return;const which=source();if(!which)throw new Error('Escolha a coleção local ou uma aba YouTube autorizada para carregar uma amostra.');
    resetContext('Preparando uma captura explícita da fonte escolhida…');const expectedIdentity=identity(which);if(!expectedIdentity)throw new Error('Selecione uma fonte autorizada antes de carregar a amostra.');
    const active=new AbortController(),epoch=contextEpoch;contextAbort=active;sourceControls();
    try{
      const capture=options.captureContext?await options.captureContext({source:which,expectedIdentity,signal:active.signal}):{source:which,identity:expectedIdentity,url:'',videos:options.contextVideos?.()??[]};
      if(active.signal.aborted||disposed||epoch!==contextEpoch)return;
      if(source()!==which||identity(which)!==expectedIdentity)throw new Error('A fonte selecionada mudou durante a captura. A resposta foi descartada; carregue novamente.');
      const next=bindImageContext(capture,{source:which,identity:expectedIdentity});boundContext=next;
      const requested=value('preview-feed'),actual=next.source==='selected-tab'?next.surface:'other';$<HTMLSelectElement>('preview-feed').value=actual;
      $('preview-source-info').textContent=`${next.label}${next.title?` · título: ${next.title}`:''}${next.observedAt?` · observado em ${next.observedAt}`:' · horário de observação não informado'}. ${next.videos.length} de ${next.inputCount} linhas elegíveis preservadas (limite 500); a composição mostra até 8 cards e não busca suas imagens.${requested!==actual?` O contexto visual solicitado era ${IMAGE_CONTEXT_SURFACES[requested as keyof typeof IMAGE_CONTEXT_SURFACES]??requested}; usaremos ${IMAGE_CONTEXT_SURFACES[actual]}.`:''}`;
    }catch(error){if(active.signal.aborted||disposed||epoch!==contextEpoch)return;boundContext=undefined;$('preview-source-info').textContent=error instanceof Error?error.message:'Falha ao carregar a amostra.';throw error;}
    finally{if(contextAbort===active){contextAbort=undefined;sourceControls();}}
  }
  async function render(newSeed=true){
    clearPreview();const controller=new AbortController();previewAbort=controller;
    await selectionReady;if(controller.signal.aborted||disposed)return;
    if(!selectionValid)throw new Error('Escolha uma seleção válida de imagens locais PNG, JPEG ou WebP estático.');
    const originalImage=original??candidates[0];if(!originalImage)throw new Error('Escolha pelo menos uma imagem local.');
    const which=source(),sample=which?boundContext:undefined;
    if(which&&(!sample||sample.source!==which))throw new Error('Carregue explicitamente uma amostra da fonte escolhida antes de gerar a prévia.');
    if(sample&&identity(sample.source)!==sample.identity){resetContext('A identidade da fonte mudou. Carregue novamente a amostra.');throw new Error('A identidade da fonte mudou. A prévia anterior foi descartada.');}
    if(newSeed){const next=crypto.getRandomValues(new Uint32Array(1))[0];seed=next%3===seed%3?(next+1)>>>0:next;}
    $('preview-status').textContent='Compondo a prévia neste navegador…';
    try{
      await buildVariants(controller.signal);if(controller.signal.aborted||disposed)return;
      const settings:HomePreviewOptions={original:{image:originalImage,title:value('original-title'),channel:value('preview-channel')},candidate:variants[selected],candidates:variants,context:value('preview-context') as HomePreviewOptions['context'],theme:value('preview-theme') as HomePreviewOptions['theme'],position:value('preview-position') as HomePreviewOptions['position'],mode:value('preview-mode') as HomePreviewOptions['mode'],seed,feed:sample?(sample.source==='selected-tab'?sample.surface:'other'):value('preview-feed') as HomePreviewOptions['feed'],feedLabel:sample?undefined:value('preview-feed-label'),contextVideos:sample?.videos??[],contextLabel:sample?.label,metadata:{views:value('preview-views'),date:value('preview-date'),duration:value('preview-duration')},avatar,signal:controller.signal};
      const blob=await renderHomePreview(settings);if(controller.signal.aborted||disposed)return;
      const nextOutput=$<HTMLImageElement>('image-output').cloneNode(false) as HTMLImageElement;nextOutput.removeAttribute('src');nextOutput.hidden=true;
      const owner=await prepareImagePreview(nextOutput,blob,{signal:controller.signal,deadline:performance.now()+15000});
      if(controller.signal.aborted||disposed){owner.release();return;}
      if(sample&&(sample!==boundContext||identity(sample.source)!==sample.identity)){owner.release();resetContext('Fonte alterada durante a composição. Resultado descartado; carregue novamente a amostra.');return;}
      $('image-output').replaceWith(nextOutput);previewOwner=owner;previewBlob=blob;nextOutput.hidden=false;$('image-preview-empty').hidden=true;$<HTMLButtonElement>('preview-download').disabled=false;$('preview-status').textContent=`${variants.length} variações locais · ${value('preview-context')} · ${value('preview-theme')} · candidata ${selected+1}. Fonte do contexto: ${sample?sample.label:'ilustrativo, sem amostra carregada'}. Sem teste de audiência.`;
    }catch(error){if(controller.signal.aborted||disposed)return;clearPreview();throw error;}
  }
  for(const id of ['image-file','candidate-file','preview-avatar'])listen(id,'change',validateSelection);
  click('image-preview',()=>render());
  const autoRender=()=>{const had=!!previewBlob||!!previewAbort;clearPreview();if(had)void render(false).catch(fail);};
  listen('preview-source','change',()=>resetContext(source()?'Clique em Usar amostra da fonte escolhida para iniciar uma captura explícita.':'Contexto ilustrativo. Nenhuma coleta foi iniciada.'));
  click('preview-load-context',captureContext);listen('preview-cancel-context','click',()=>resetContext('Captura cancelada. Uma resposta tardia será descartada.'));
  for(const id of ['preview-context','preview-theme','preview-position','preview-mode','preview-feed'])listen(id,'change',autoRender);
  for(const id of ['original-title','preview-title','preview-titles','preview-channel','preview-feed-label','preview-views','preview-date','preview-duration'])listen(id,'input',()=>{const had=!!previewBlob||!!previewAbort;clearPreview();clearGallery();clearCompression();if(had)void render(false).catch(fail);else $('preview-status').textContent='Entradas alteradas. Gere uma nova prévia.';});
  for(const id of ['compression-source','compression-target-kb','image-width','image-height','image-quality','compression-format','flatten-alpha','flatten-color'])listen(id,'input',clearCompression);
  click('preview-shuffle',async()=>{$<HTMLSelectElement>('preview-position').value='random';await render(true);});
  click('metadata-reset',async()=>{const had=!!previewBlob||!!previewAbort,restored=confirmedMetadata.restore();for(const [id,text] of [['preview-channel',restored.channel],['preview-views',restored.views],['preview-date',restored.date],['preview-duration',restored.duration]])$<HTMLInputElement>(id).value=text;const transfer=new DataTransfer();if(restored.avatar)transfer.items.add(restored.avatar);$<HTMLInputElement>('preview-avatar').files=transfer.files;validateSelection();await selectionReady;if(disposed)return;$('preview-status').textContent='Metadados e avatar restaurados para a última confirmação local (ou valores iniciais).';if(had&&selectionValid)await render(false);});
  click('metadata-done',async()=>{const draft=metadata();await selectionReady;if(disposed)return;if(!metadataUnchanged(draft,metadata()))throw new Error('Os metadados mudaram durante a confirmação; revise e confirme novamente.');if(draft.avatar&&avatar!==draft.avatar)throw new Error('Valide um avatar local aceito antes de confirmar os metadados.');confirmedMetadata.confirm(draft);$<HTMLDetailsElement>('preview-metadata').open=false;$('preview-status').textContent='Metadados e avatar confirmados somente para a prévia local.';if(previewBlob||previewAbort)await render(false);});
  click('preview-restore',async()=>{$<HTMLSelectElement>('preview-mode').value='original';await render(false);});
  click('preview-download',()=>{if(previewBlob)downloadBlob(previewBlob,'prevlev-previa-local.png');});
  click('compress',async()=>{
    if(selectionPending)await selectionReady;if(disposed)return;if(compressionAbort)throw new Error('Cancele ou aguarde a compressão atual.');
    if(!selectionValid)throw new Error('Escolha uma seleção válida de imagens locais.');createVariants();
    const input=value('compression-source')==='candidate'?variants[selected]?.image:original??candidates[0];if(!input)throw new Error('Escolha uma imagem local para comprimir.');
    const controller=new AbortController();compressionAbort=controller;last=undefined;$<HTMLButtonElement>('compression-download').disabled=true;$<HTMLButtonElement>('compression-cancel').disabled=false;syncButtons();$('compression-result').textContent='Processando localmente…';
    try{
      const result=await compressToTarget(input,{targetBytes:Math.floor(number('compression-target-kb')*1024),maxWidth:number('image-width'),maxHeight:number('image-height'),quality:number('image-quality')/100,type:value('compression-format') as ImageFormat,...($<HTMLInputElement>('flatten-alpha').checked?{flattenBackground:value('flatten-color')}:{}),signal:controller.signal});
      if(controller.signal.aborted||disposed)return;last=result;$<HTMLButtonElement>('compression-download').disabled=false;
      const quality=result.reason==='original-preserved'?'arquivo original preservado':result.quality===undefined?'PNG: qualidade não aplicável; confira a resolução':`${Math.round(result.quality*100)}%`;
      $('compression-result').textContent=`${result.targetMet?'Meta atingida':'Meta não atingida; melhor resultado encontrado'}\nSaída: ${result.bytes} bytes (${(result.bytes/1024).toFixed(2)} KiB) · meta ${result.targetBytes} bytes\n${result.width} × ${result.height} px · ${result.type} · ${quality}\n${result.iterations} tentativas · ${result.elapsedMs} ms · limite: ${result.reason}\nTransparência: ${result.flattened?'achatada por autorização':result.alphaPreserved?'preservada no formato de saída':'imagem opaca'}`;
      show(`Original: ${(result.originalBytes/1024).toFixed(1)} KiB · Saída: ${(result.bytes/1024).toFixed(2)} KiB. ${result.targetMet?'Meta atingida.':'Meta não atingida; você pode baixar o resultado informado.'}`);
      if(result.targetMet)downloadBlob(result.blob,filename(result.type));
    }catch(error){if(disposed)return;if(controller.signal.aborted){$('compression-result').textContent='Processamento cancelado. Nenhum resultado novo foi baixado.';show('Compressão cancelada.');}else{$('compression-result').textContent=error instanceof Error?error.message:'Falha na compressão.';throw error;}}
    finally{if(compressionAbort===controller)compressionAbort=undefined;if(!disposed){$<HTMLButtonElement>('compression-cancel').disabled=true;syncButtons();}}
  });
  listen('compression-cancel','click',()=>{compressionAbort?.abort();last=undefined;$<HTMLButtonElement>('compression-download').disabled=true;});
  click('compression-download',()=>{if(last)downloadBlob(last.blob,filename(last.type));});
  function filename(type:ImageFormat){return `prevlev-thumbnail.${type==='image/jpeg'?'jpg':type==='image/webp'?'webp':'png'}`;}
  function videoId(){const input=value('thumbnail-id').trim(),id=videoIdFromUrl(input)??(/^[\w-]{11}$/.test(input)?input:undefined);if(!id)throw new Error('Informe um ID ou URL YouTube válido.');return id;}
  click('download-thumbnail',async()=>{const id=videoId();downloadBlob(await fetchThumbnail(id),`prevlev-${id}.jpg`);});
  click('copy-thumbnail',async()=>{await copyImage(await fetchThumbnail(videoId()));show('Thumbnail copiada.');});
  const invalidateContext=()=>{if(disposed)return;selectionAbort?.abort();selectionPending=false;resetContext('Fonte ou coleta alterada. Carregue uma nova amostra explicitamente, se desejar.');clearCompression();syncButtons();$('preview-status').textContent='Coleta alterada. Prévia e galeria descartadas; gere uma nova composição.';};
  const cleanup=()=>{if(disposed)return;invalidateContext();disposed=true;for(const remove of events)remove();};
  const tabOption=$<HTMLSelectElement>('preview-source').querySelector<HTMLOptionElement>('[value="selected-tab"]')!;tabOption.disabled=!options.captureContext||!options.contextIdentity;sourceControls();
  return Object.assign(cleanup,{invalidateContext,cleanup});
}
