import { composeCard, type CardCompositionMetadata, type CardCompositionOptions } from '../core/card-composition';
import { downloadBlob } from '../core/media';
import { preflightImage } from '../core/image-preflight';
import { prepareImagePreview, type ImagePreview } from './image-preview';
import type { PageSnapshot, VideoRecord } from '../shared/types';

/** Mount in #card-composition. The snapshot is read only after the user asks to list it. */
export interface CardCompositionTools { invalidateSnapshot(): void; dispose(): void }
export interface CardCompositionAssetMetadata {
  title: string;
  url: string;
  source?: Exclude<VideoRecord['source'], 'youtube-data-api'>;
  provenance: { kind: 'composition'; sourceUrl: string; videoId?: string; fileName?: string };
}
export interface CardCompositionDependencies {
  snapshot: () => PageSnapshot;
  /** The implementation must check guard immediately before persisting, including
   * after any asynchronous validation/encoding. A false guard means no write.
   */
  saveAsset?: (blob: Blob, metadata: CardCompositionAssetMetadata, guard: () => boolean) => unknown | Promise<unknown>;
}
export function initCardCompositionTools(deps: CardCompositionDependencies): CardCompositionTools {
  const host = document.getElementById('card-composition');
  if (!host) return { invalidateSnapshot: () => {}, dispose: () => {} };
  host.innerHTML = `<div class="card"><h2>Compor card ou Short</h2>
    <p>Crie uma ilustração com sua imagem local e metadados fornecidos ou escolhidos da coleta. É uma composição, não uma captura da página ou comprovação de analytics. Use PNG, JPEG ou WebP estáticos de até 10 MiB.</p>
    <label>Imagem local <input id="card-compose-file" type="file" accept="image/png,image/jpeg,image/webp"></label>
    <label>Origem dos metadados <select id="card-compose-source"><option value="manual">Informados por você</option><option value="snapshot">Vídeo da coleta carregada</option></select></label>
    <div id="card-compose-snapshot" hidden><button type="button" id="card-compose-load">Listar vídeos da coleta</button><label>Vídeo <select id="card-compose-video"><option value="">Selecione um vídeo</option></select></label><p id="card-compose-provenance"></p></div>
    <div id="card-compose-manual"><label>Título <input id="card-compose-title" maxlength="500"></label><label>Canal (opcional) <input id="card-compose-channel" maxlength="120"></label><label>URL HTTPS de referência declarada (necessária para salvar no Swipe File; opcional para baixar PNG)<input id="card-compose-url" type="url" maxlength="2048" placeholder="https://..."></label></div>
    <div class="row"><label>Formato <select id="card-compose-format"><option value="card">Card</option><option value="short">Short</option></select></label><label>Fundo <select id="card-compose-background"><option value="dark">Escuro</option><option value="light">Claro</option><option value="custom">Cor personalizada</option><option value="transparent">Transparente</option></select></label><label>Cor personalizada <input type="color" id="card-compose-color" value="#654d8c"></label><label>Escala <select id="card-compose-scale"><option value="1">1×</option><option value="2">2×</option></select></label></div>
    <div class="actions"><button type="button" id="card-compose-render" class="primary">Gerar composição</button><button type="button" id="card-compose-download" disabled>Baixar PNG</button><button type="button" id="card-compose-save" disabled hidden>Salvar composição no Swipe File</button><button type="button" id="card-compose-save-cancel" disabled hidden>Cancelar salvamento</button></div><p id="card-compose-status" role="status" aria-live="polite"></p><img id="card-compose-output" alt="Composição local de card ou Short" hidden style="max-width:100%;height:auto"></div>`;
  const get = <T extends HTMLElement = HTMLElement>(id: string) => host.querySelector<T>(`#card-compose-${id}`)!;
  const file = get<HTMLInputElement>('file'), source = get<HTMLSelectElement>('source'), video = get<HTMLSelectElement>('video'), snapshotArea = get('snapshot'), manualArea = get('manual'), status = get('status'), download = get<HTMLButtonElement>('download');
  let output = get<HTMLImageElement>('output');
  const renderButton = get<HTMLButtonElement>('render');
  const saveButton = get<HTMLButtonElement>('save'), saveCancel = get<HTMLButtonElement>('save-cancel');
  saveButton.hidden = saveCancel.hidden = !deps.saveAsset;
  let videos: VideoRecord[] = [], listedStamp = '', serial = 0, saveSequence = 0, saving = false, result: Blob | undefined, resultMetadata: CardCompositionAssetMetadata | undefined, preview: ImagePreview | undefined, controller: AbortController | undefined, disposed = false, inFlight = false;
  let resultCurrent: (() => boolean) | undefined;
  const clear = () => { serial++; saveSequence++; controller?.abort(); controller=undefined; result = undefined; resultMetadata = undefined; resultCurrent = undefined; download.disabled = saveButton.disabled = saveCancel.disabled = true; output.hidden = true; output.removeAttribute('src'); preview?.release(); preview = undefined; };
  const httpsReference = (raw: string) => {
    if (raw.length > 2048) throw new Error('A referência HTTPS deve ter até 2048 caracteres.');
    const value = raw.trim(); let url: URL;
    try { url = new URL(value); } catch { throw new Error('Declare uma URL HTTPS válida para salvar a composição.'); }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error('Declare uma URL HTTPS sem usuário ou senha para salvar a composição.');
    return value;
  };
  const inputsStamp = () => JSON.stringify([...host.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select')].map(control => [control.id, control.value]));
  const sourceLabel: Record<CardCompositionMetadata['source'], string> = { 'youtube-dom': 'página YouTube observada', 'public-page': 'página pública', 'user-provided': 'informado pelo usuário', unspecified: 'origem não declarada' };
  const selected = () => videos[Number(video.value)] && video.value !== '' ? videos[Number(video.value)] : undefined;
  const updateProvenance = () => { const item = selected(); const origin = item?.source ?? 'unspecified'; get('provenance').textContent = item ? `ID ${item.id} · ${sourceLabel[origin as CardCompositionMetadata['source']]} · ${item.observedAt ? `observado em ${item.observedAt}` : 'data da observação desconhecida'}. Dados preservados da seleção; a imagem é fornecida por você.` : 'Nenhum vídeo selecionado.'; };
  const changed = () => { clear(); snapshotArea.hidden = source.value !== 'snapshot'; manualArea.hidden = source.value !== 'manual'; updateProvenance(); status.textContent = 'Seleção alterada. Gere novamente.'; };
  host.addEventListener('input', changed); host.addEventListener('change', changed);
  get('load').addEventListener('click', () => {
    clear(); const snapshot = deps.snapshot(); listedStamp = JSON.stringify(snapshot); videos = snapshot.videos.filter(item => item.source !== 'youtube-data-api' && /^[A-Za-z0-9_-]{11}$/.test(item.id) && typeof item.title === 'string' && !!item.title.trim()).slice(0, 500).map(item => ({ ...item }));
    video.replaceChildren(new Option('Selecione um vídeo', ''), ...videos.map((item, index) => new Option(`${item.title} · ${item.id}`, String(index))));
    updateProvenance(); status.textContent = `${videos.length} vídeo(s) elegíveis listados (limite 500); selecione um. Dados da API oficial são excluídos.`;
  });
  renderButton.addEventListener('click', () => { if (inFlight || disposed) return; void (async () => {
    clear(); const mine = serial, image = file.files?.[0], item = selected();
    if (!image) { status.textContent = 'Escolha uma imagem local.'; return; }
    if (source.value === 'snapshot' && !item) { status.textContent = 'Liste e selecione um vídeo da coleta.'; return; }
    if (source.value === 'snapshot' && JSON.stringify(deps.snapshot()) !== listedStamp) { status.textContent = 'A coleta mudou. Liste e selecione um vídeo novamente.'; return; }
    if (item?.source === 'youtube-data-api') { status.textContent = 'Dados da API oficial não são aceitos nesta composição.'; return; }
    const metadata: CardCompositionMetadata = source.value === 'snapshot' && item ? { id: item.id, title: item.title, channel: item.channel, views: item.views, source: item.source ?? 'unspecified' } : { title: get<HTMLInputElement>('title').value, channel: get<HTMLInputElement>('channel').value, source: 'user-provided' };
    const options: CardCompositionOptions = { metadata, format: get<HTMLSelectElement>('format').value as CardCompositionOptions['format'], background: get<HTMLSelectElement>('background').value as CardCompositionOptions['background'], color: get<HTMLInputElement>('color').value, scale: Number(get<HTMLSelectElement>('scale').value) as 1 | 2 };
    const isSnapshot = source.value === 'snapshot', fields = inputsStamp(), snapshotStamp = listedStamp;
    const current = () => {
      try { return !disposed && mine === serial && file.files?.[0] === image && fields === inputsStamp() && (!isSnapshot || snapshotStamp === JSON.stringify(deps.snapshot())); } catch { return false; }
    };
    let assetMetadata: CardCompositionAssetMetadata | undefined, saveIssue = '';
    if (deps.saveAsset) try {
      const url = httpsReference(isSnapshot ? item!.url : get<HTMLInputElement>('url').value);
      assetMetadata = { title: metadata.title.trim(), url, ...(isSnapshot ? item?.source ? { source: item.source } : {} : { source: 'user-provided' }),
        provenance: { kind: 'composition', sourceUrl: url, ...(isSnapshot ? { videoId: item!.id } : {}), ...(image.name && image.name.length <= 200 ? { fileName: image.name } : {}) } };
    } catch (error) { saveIssue = error instanceof Error ? error.message : 'Referência de origem indisponível para salvar.'; }
    inFlight = true; renderButton.disabled = true;
    const active = new AbortController(); controller = active;
    status.textContent = 'Gerando composição local…';
    try { await preflightImage(image,{maxBytes:10*1024*1024,maxPixels:20_000_000,maxDimension:8192,signal:active.signal}); if(!current())return; const blob = await composeCard(image, options); if (!current()) return; const nextOutput=output.cloneNode(false) as HTMLImageElement;nextOutput.removeAttribute('src');nextOutput.hidden=true;const owner=await prepareImagePreview(nextOutput,blob,{signal:active.signal}); if(!current()){owner.release();return;} output.replaceWith(nextOutput);output=nextOutput;result = blob; resultMetadata = assetMetadata; resultCurrent = current; preview=owner; output.hidden = false; download.disabled = false; saveButton.disabled = !deps.saveAsset || !assetMetadata || saving; status.textContent = `Composição local pronta · ${metadata.id ? `ID ${metadata.id} · ` : ''}metadados: ${sourceLabel[metadata.source]} · imagem local fornecida.${saveIssue ? ` ${saveIssue} O PNG continua disponível para baixar.` : ''}`; }
    catch (error) { if (mine === serial && !disposed) status.textContent = error instanceof Error ? error.message : 'Não foi possível compor a imagem.'; }
    finally { inFlight = false; if (!disposed) renderButton.disabled = false; }
  })(); });
  download.addEventListener('click', () => { if (result) downloadBlob(result, 'prevlev-composicao-local.png'); });
  saveButton.addEventListener('click', () => {
    const callback = deps.saveAsset, blob = result, metadata = resultMetadata, current = resultCurrent;
    if (saving || disposed || !callback || !blob || !metadata || !current) return;
    if (!current()) { clear(); status.textContent = 'O contexto da composição mudou. Gere novamente antes de salvar.'; return; }
    const generation = ++saveSequence; saving = true; saveButton.disabled = true; saveCancel.disabled = false;
    const guard = () => generation === saveSequence && result === blob && deps.saveAsset === callback && current();
    status.textContent = 'Salvando composição local por sua ação…';
    void Promise.resolve().then(() => { if (!guard()) return; return callback(blob, { ...metadata, provenance: { ...metadata.provenance } }, guard); }).then(outcome => {
      if (guard()) status.textContent = outcome === false ? 'Salvamento não concluído. Revise o Swipe File antes de tentar novamente.' : 'Composição salva no Swipe File com origem e metadados declarados.';
    }).catch(error => { if (guard()) status.textContent = error instanceof Error ? error.message : 'Não foi possível salvar a composição; nenhuma nova tentativa foi iniciada.'; }).finally(() => {
      saving = false; saveCancel.disabled = true;
      if (!disposed && generation === saveSequence && result === blob && !guard()) { clear(); status.textContent = 'O contexto mudou durante o salvamento. A solicitação anterior foi descartada; gere novamente.'; }
      if (!disposed) saveButton.disabled = !deps.saveAsset || !result || !resultMetadata || !resultCurrent?.();
    });
  });
  saveCancel.addEventListener('click', () => { if (!saving) return; saveSequence++; saveCancel.disabled = true; status.textContent = 'Cancelamento solicitado. Uma gravação já concluída não é desfeita; nenhuma nova tentativa será iniciada.'; });
  return {
    invalidateSnapshot() { if (disposed) return; clear(); listedStamp = ''; videos = []; video.replaceChildren(new Option('Selecione um vídeo', '')); updateProvenance(); status.textContent = 'Coleta alterada. Liste e selecione um vídeo novamente.'; },
    dispose() { if (disposed) return; disposed = true; clear(); videos = []; host.removeEventListener('input', changed); host.removeEventListener('change', changed); host.replaceChildren(); },
  };
}
