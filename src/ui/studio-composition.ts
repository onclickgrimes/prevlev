import { composeStudioCapture, STUDIO_COMPOSITION_LIMITS, studioCompositionSourceLabel, validateStudioCaptureReceipt, type StudioCaptureReceipt, type StudioCompositionInput, type StudioCompositionOptions } from '../core/studio-composition';
import { preflightImage } from '../core/image-preflight';
import { downloadBlob } from '../core/media';
import { prepareImagePreview, type ImagePreview } from './image-preview';
import type { SaveSwipeAssetMetadata } from './swipe-assets';

export interface StudioCompositionAssetReceipt extends StudioCaptureReceipt {sourceUrl?:string;videoId?:string;}

export interface StudioCompositionTools {
  wantsComposition(): boolean;
  /** Call only after the existing capture transaction and selected masks succeed. */
  setCapture(image: Blob, receipt: StudioCompositionAssetReceipt): Promise<void>;
  invalidate(reason?: string): void;
  dispose(): void;
}
export interface StudioCompositionDependencies {
  contextKey?: () => string;
  /** Root checks the actual tab URL/identity; never called for a user-selected local PNG. */
  validateContext?: (contextKey: string) => Promise<boolean>;
  notice?: (message: string, error?: boolean) => void;
  /** Explicit local-library action; the host must honor guard inside its write lock. */
  saveAsset?: (blob:Blob,metadata:SaveSwipeAssetMetadata,guard?:()=>boolean)=>Promise<string>;
}
export function mountStudioComposition(host: HTMLElement, dependencies: StudioCompositionDependencies = {}): StudioCompositionTools {
  const doc = host.ownerDocument, panel = doc.createElement('div'); panel.className = 'card'; panel.id = 'studio-composition';
  panel.innerHTML = `<h2>Compor captura do Studio</h2>
    <p>Crie uma moldura própria para um recorte validado ou PNG local. Nenhuma captura ou composição é iniciada ao abrir. O tema altera a moldura; os pixels da captura mantêm a aparência original.</p>
    <label><input id="studio-compose-enabled" type="checkbox"> Preparar composição nas próximas capturas, em vez de baixar somente o recorte</label>
    <p>As ocultações escolhidas devem ser verificadas pela transação de captura antes de os pixels chegarem aqui. Um arquivo local não comprova ocultação ou origem de analytics.</p>
    <label>PNG local opcional (até 10 MiB, 20 MP e 8192 por lado)<input id="studio-compose-file" type="file" accept="image/png,.png"></label>
    <p id="studio-compose-source">Nenhuma imagem fornecida.</p>
    <div class="form-grid"><label>Layout<select id="studio-compose-layout"><option value="analytics-only">AnalyticsOnly · recorte completo</option><option value="video-info">VideoInfo · recorte e contexto declarado</option></select></label>
    <label>Tema da moldura<select id="studio-compose-theme"><option value="dark">Escuro</option><option value="light">Claro</option></select></label>
    <label>Fundo externo<select id="studio-compose-background"><option value="theme">Usar tema</option><option value="custom">Cor personalizada</option><option value="transparent">Transparente</option></select></label>
    <label>Cor personalizada<input id="studio-compose-color" type="color" value="#314b62"></label><label>Escala PNG<select id="studio-compose-scale"><option value="1">1×</option><option value="2">2×</option></select></label></div>
    <label>Título / identificação declarados (opcional)<input id="studio-compose-title" maxlength="200"></label>
    <label id="studio-compose-asset-url-label">URL HTTPS declarada da origem do PNG local (exigida para salvar na biblioteca)<input id="studio-compose-asset-url" type="url" maxlength="4096" placeholder="https://..."></label>
    <label>Período declarado (opcional)<input id="studio-compose-period" maxlength="120" placeholder="Somente o período que você consegue identificar"></label>
    <label id="studio-compose-note-label" hidden>Nota declarada (VideoInfo)<textarea id="studio-compose-note" maxlength="400" rows="3"></textarea></label>
    <p>Metadados são declarações suas, separados dos pixels. Não recuperam números ausentes e não transformam um recorte em relatório completo.</p>
    <p>Salvar na biblioteca exige um título declarado e a URL da origem. Para PNG local, declare a URL antes de gerar; isso não comprova origem ou ocultação. Uma captura usa somente a URL preservada no recibo validado.</p>
    <div class="actions"><button type="button" id="studio-compose-render" disabled>Gerar composição PNG</button><button type="button" id="studio-compose-cancel">Cancelar / limpar composição</button><button type="button" id="studio-compose-download" disabled>Baixar composição PNG</button><button type="button" id="studio-compose-save" disabled>Salvar composição na biblioteca</button></div>
    <p id="studio-compose-status" role="status" aria-live="polite">Escolha um PNG local ou faça uma captura validada com a opção de composição ativa.</p><div id="studio-compose-output"></div>`;
  host.append(panel);
  const get = <T extends HTMLElement = HTMLElement>(id: string) => panel.querySelector<T>(`#studio-compose-${id}`)!;
  const file = get<HTMLInputElement>('file'), enabled = get<HTMLInputElement>('enabled'), render = get<HTMLButtonElement>('render'), download = get<HTMLButtonElement>('download'), save = get<HTMLButtonElement>('save'), status = get('status'), output = get('output');
  save.hidden=!dependencies.saveAsset;
  let input: StudioCompositionInput | undefined, result: Blob | undefined, owner: ImagePreview | undefined, controller: AbortController | undefined, epoch = 0, disposed = false;
  let downloading: object | undefined;
  let saving:object|undefined,receiptOrigin:{sourceUrl?:string;videoId?:string}|undefined,resultStamp:string|undefined,resultCreatedAt:string|undefined;
  const optionStamp=()=>JSON.stringify([enabled.checked,...['layout','theme','background','color','scale','title','period','note','asset-url'].map(id=>get<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>(id).value)]);
  const message = (value: string, error = false) => { status.textContent = value; dependencies.notice?.(value, error); };
  const clearOutput = () => { epoch++; controller?.abort(); controller = undefined; downloading = undefined; saving=undefined; result = undefined;resultStamp=undefined;resultCreatedAt=undefined; owner?.release(); owner = undefined; output.replaceChildren(); download.disabled = true;save.disabled=true; render.disabled = !input || disposed; };
  const invalidate = (reason = 'Contexto alterado. Forneça uma nova captura validada ou escolha o PNG novamente.') => { if (disposed) return; clearOutput(); input = undefined;receiptOrigin=undefined; file.value = ''; get('source').textContent = 'Nenhuma imagem fornecida.';get('asset-url-label').hidden=false; render.disabled = true; message(reason); };
  const syncOptions = () => { get('note-label').hidden = get<HTMLSelectElement>('layout').value !== 'video-info'; get<HTMLInputElement>('color').disabled = get<HTMLSelectElement>('background').value !== 'custom';get('asset-url-label').hidden=input?.source.kind==='validated-studio-capture'; };
  for (const id of ['layout', 'theme', 'background', 'color', 'scale', 'title', 'period', 'note','asset-url']) for (const event of ['input', 'change']) get(id).addEventListener(event, () => { clearOutput(); syncOptions(); if (!input) file.value = ''; message(input ? 'Opções alteradas. Gere outra composição para estes mesmos pixels.' : 'Opções alteradas. Forneça uma captura validada ou escolha o PNG novamente.'); });
  enabled.addEventListener('change', () => invalidate('Destino da captura alterado. Uma próxima captura só ocorre por sua ação explícita.'));

  const alive = (mine: number, operation: AbortController) => mine === epoch && !operation.signal.aborted && !disposed;
  const contextCurrent = (source: StudioCompositionInput) => source.source.kind !== 'validated-studio-capture' || !dependencies.contextKey || dependencies.contextKey() === source.source.receipt.contextKey;
  const changedContext = () => new Error('A aba ou o contexto real da captura mudou ou não pôde ser verificado. Capture novamente antes de compor ou baixar.');
  async function verifyContext(source: StudioCompositionInput, mine: number, operation: AbortController): Promise<boolean> {
    if (!alive(mine, operation)) return false;
    if (!contextCurrent(source)) throw changedContext();
    if (source.source.kind !== 'validated-studio-capture' || !dependencies.validateContext) return true;
    let valid: boolean;
    try { valid = await dependencies.validateContext(source.source.receipt.contextKey); }
    catch { if (!alive(mine, operation)) return false; throw changedContext(); }
    if (!alive(mine, operation)) return false;
    if (!contextCurrent(source) || valid !== true) throw changedContext();
    return true;
  }

  async function accept(next: StudioCompositionInput,origin?:{sourceUrl?:string;videoId?:string}): Promise<void> {
    clearOutput(); input = undefined;receiptOrigin=undefined; render.disabled = true; const mine = epoch, current = new AbortController(); controller = current;
    get('source').textContent = 'Validando nova imagem fornecida…'; message('Validando o PNG fornecido localmente…');
    try {
      if (!contextCurrent(next)) throw changedContext();
      await preflightImage(next.image, { ...STUDIO_COMPOSITION_LIMITS, signal: current.signal, deadline: performance.now() + STUDIO_COMPOSITION_LIMITS.durationMs });
      if (!alive(mine, current)) return;
      if (!contextCurrent(next)) throw changedContext();
      if (!await verifyContext(next, mine, current)) return;
      if (!alive(mine, current)) return;
      if (!contextCurrent(next)) throw changedContext();
      input = next;receiptOrigin=origin; get('source').textContent = studioCompositionSourceLabel(next.source); render.disabled = false;syncOptions();
      message('Pixels aceitos. Revise o layout e os metadados; clique em Gerar para compor.');
    } catch (error) { if (alive(mine, current)) { invalidate(error instanceof Error ? error.message : 'Não foi possível validar o PNG.'); dependencies.notice?.(status.textContent ?? '', true); throw error; } }
    finally { if (controller === current) controller = undefined; }
  }
  file.addEventListener('change', () => {
    const selected = file.files?.[0]; if (!selected) { invalidate('Nenhum PNG local selecionado.'); return; }
    if (selected.type !== 'image/png' || selected.name.length > 200) { invalidate('Use um PNG local com nome de até 200 caracteres.'); return; }
    void accept({ image: selected, source: { kind: 'user-local-png', name: selected.name } }).catch(() => {});
  });
  render.addEventListener('click', () => {
    if (!input || disposed) return;
    const source = input; clearOutput(); const mine = epoch, current = new AbortController(); controller = current; render.disabled = true;
    const value = (id: string) => get<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id).value;
    const options: StudioCompositionOptions = { layout: value('layout') as StudioCompositionOptions['layout'], theme: value('theme') as StudioCompositionOptions['theme'], background: value('background') as StudioCompositionOptions['background'], color: value('color'), scale: Number(value('scale')) as 1 | 2, metadata: { title: value('title'), period: value('period'), note: value('note') } };
    const stamp=optionStamp();
    message('Compondo os pixels fornecidos neste navegador…');
    void (async () => {
      try {
        if (!await verifyContext(source, mine, current)) return;
        if (!alive(mine, current)) return;
        if (!contextCurrent(source)) throw changedContext();
        const deadline = performance.now() + STUDIO_COMPOSITION_LIMITS.durationMs;
        const blob = await composeStudioCapture(source, options, { signal: current.signal, deadline });
        if (!alive(mine, current)) return;
        if (!contextCurrent(source)) throw changedContext();
        if (!await verifyContext(source, mine, current)) return;
        if (!alive(mine, current)) return;
        if (!contextCurrent(source)) throw changedContext();
        const image = doc.createElement('img'); image.alt = 'Composição local com pixels fornecidos e metadados declarados'; image.style.cssText = 'max-width:100%;height:auto';
        const preview = await prepareImagePreview(image, blob, { signal: current.signal, deadline, maxBytes: STUDIO_COMPOSITION_LIMITS.maxBytes, maxPixels: 4_000_000, maxDimension: 2400 });
        if (!alive(mine, current)) { preview.release(); return; }
        try {
          if (!contextCurrent(source)) throw changedContext();
          if (!await verifyContext(source, mine, current)) { preview.release(); return; }
          if (!alive(mine, current)) { preview.release(); return; }
          if (!contextCurrent(source)) throw changedContext();
        } catch (error) { preview.release(); throw error; }
        if(stamp!==optionStamp()){preview.release();clearOutput();message('Entradas alteradas durante a composição. Gere novamente.');return;}
        owner = preview; result = blob;resultStamp=stamp;resultCreatedAt=new Date().toISOString(); output.replaceChildren(image); download.disabled = false;save.disabled=!dependencies.saveAsset;
        message(`Composição local pronta · ${options.layout === 'analytics-only' ? 'AnalyticsOnly' : 'VideoInfo'} · ${options.scale}× · PNG. Revise os pixels antes de compartilhar.`);
      } catch (error) { if (alive(mine, current)) { invalidate(error instanceof Error ? error.message : 'A composição local falhou.'); dependencies.notice?.(status.textContent ?? '', true); } }
      finally { if (controller === current) controller = undefined; if (mine === epoch && !disposed) render.disabled = !input; }
    })();
  });
  get('cancel').addEventListener('click', () => invalidate('Composição cancelada e pixels descartados. Nenhuma captura ou arquivo novo foi enviado.'));
  download.addEventListener('click', () => {
    if (!result || !input || disposed || downloading||saving) return;
    const blob = result, source = input, mine = epoch, current = new AbortController(), token = {};
    downloading = token; controller = current; download.disabled = true;save.disabled=true;
    void (async () => {
      try {
        if (!await verifyContext(source, mine, current)) return;
        if (!alive(mine, current)) return;
        if (!contextCurrent(source)) throw changedContext();
        downloadBlob(blob, 'prevlev-studio-composicao.png');
      } catch (error) { if (alive(mine, current)) { invalidate(error instanceof Error ? error.message : 'Não foi possível validar o contexto antes de baixar.'); dependencies.notice?.(status.textContent ?? '', true); } }
      finally { if (downloading === token) { downloading = undefined; if (controller === current) controller = undefined; if (alive(mine, current) && result === blob && input === source){download.disabled = false;save.disabled=!dependencies.saveAsset;} } }
    })();
  });
  save.addEventListener('click',()=>{
    if(!dependencies.saveAsset||!result||!input||disposed||saving||downloading)return;
    const blob=result,source=input,mine=epoch,stamp=resultStamp,origin=receiptOrigin,selectedFile=file.files?.[0],current=new AbortController(),token={};
    const guard=()=>alive(mine,current)&&result===blob&&input===source&&receiptOrigin===origin&&stamp===optionStamp()&&file.files?.[0]===selectedFile&&contextCurrent(source);
    saving=token;controller=current;save.disabled=true;download.disabled=true;
    let confirmedId:string|undefined,contextInvalid=false;
    const verifyForSave=async()=>{try{return await verifyContext(source,mine,current);}catch(error){contextInvalid=true;throw error;}};
    void(async()=>{try{
      if(!guard())throw new Error('O resultado ou as entradas mudaram. Gere uma composição atual antes de salvar.');
      const title=get<HTMLInputElement>('title').value.trim();if(!title)throw new Error('Declare um título antes de gerar e salvar esta composição.');
      const rawUrl=source.source.kind==='validated-studio-capture'?origin?.sourceUrl:get<HTMLInputElement>('asset-url').value.trim();
      if(!rawUrl)throw new Error(source.source.kind==='validated-studio-capture'?'O recibo não preservou a URL real da captura. Capture novamente antes de salvar.':'Declare uma URL HTTPS para a origem do PNG local e gere novamente antes de salvar.');
      if(/\p{Cc}/u.test(rawUrl)||rawUrl.includes('\\'))throw new Error('Declare uma URL HTTPS sem caracteres de controle ou barras invertidas.');
      const url=new URL(rawUrl);if(url.protocol!=='https:'||url.username||url.password||rawUrl.length>4096)throw new Error('A origem para salvar exige URL HTTPS sem credenciais.');
      if(origin?.videoId&&!/^[A-Za-z0-9_-]{11}$/.test(origin.videoId))throw new Error('O recibo contém ID de vídeo inválido. Faça outra captura.');
      if(source.source.kind==='validated-studio-capture'&&(!dependencies.validateContext||!dependencies.contextKey))throw new Error('A captura não tem verificador do contexto real para salvar. Faça outra captura pelo host autorizado.');
      if(!await verifyForSave()||!guard())return;
      const metadata:SaveSwipeAssetMetadata={title,url:url.href,source:'user-provided',provenance:{kind:'composition',sourceUrl:url.href,...(source.source.kind==='validated-studio-capture'&&origin?.videoId?{videoId:origin.videoId}:{}),fileName:'prevlev-studio-composicao.png',createdAt:resultCreatedAt}};
      const savedId=await dependencies.saveAsset!(blob,metadata,guard);if(typeof savedId!=='string'||!savedId.trim()||savedId.length>120)throw new Error('A biblioteca não confirmou uma identidade de item. O resultado da gravação é incerto; confira antes de repetir.');confirmedId=savedId;
      if(!guard()){if(alive(mine,current))invalidate(`A biblioteca informou gravação (${confirmedId}), mas as entradas ou origem mudaram depois. Confira a biblioteca antes de outra ação.`);return;}
      if(!await verifyForSave()||!guard())return;
      message(`Composição salva explicitamente na biblioteca local · ${confirmedId}. Fonte e título declarados; confira os pixels.`);
    }catch(error){if(alive(mine,current)){if(confirmedId){invalidate(`A biblioteca informou gravação (${confirmedId}), mas o contexto mudou depois. Confira a biblioteca antes de outra ação.`);}else if(contextInvalid||!guard()){invalidate(error instanceof Error?error.message:'Contexto ou entradas alteradas antes de salvar.');}else message(error instanceof Error?error.message:'Não foi possível salvar a composição.',true);}}
    finally{if(saving===token){saving=undefined;if(controller===current)controller=undefined;if(guard()){download.disabled=false;save.disabled=!!confirmedId;}}}})();
  });
  syncOptions();
  return {
    wantsComposition: () => !disposed && enabled.checked,
    async setCapture(image, receipt) {
      if (disposed) return;
      invalidate('Recebendo nova captura; a prévia anterior foi descartada.');
      try { validateStudioCaptureReceipt(receipt); }
      catch (error) { message(error instanceof Error ? error.message : 'Recibo de captura inválido.', true); throw error; }
      const copy: StudioCaptureReceipt = { ...receipt, categories: [...receipt.categories] };
      await accept({ image, source: { kind: 'validated-studio-capture', receipt: copy } },{sourceUrl:receipt.sourceUrl,videoId:receipt.videoId});
    },
    invalidate,
    dispose() { if (disposed) return; invalidate('Compositor encerrado.'); disposed = true; panel.remove(); },
  };
}
