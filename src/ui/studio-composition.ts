import { composeStudioCapture, STUDIO_COMPOSITION_LIMITS, studioCompositionSourceLabel, validateStudioCaptureReceipt, type StudioCaptureReceipt, type StudioCompositionInput, type StudioCompositionOptions } from '../core/studio-composition';
import { preflightImage } from '../core/image-preflight';
import { downloadBlob } from '../core/media';
import { prepareImagePreview, type ImagePreview } from './image-preview';

export interface StudioCompositionTools {
  wantsComposition(): boolean;
  /** Call only after the existing capture transaction and selected masks succeed. */
  setCapture(image: Blob, receipt: StudioCaptureReceipt): Promise<void>;
  invalidate(reason?: string): void;
  dispose(): void;
}
export function mountStudioComposition(host: HTMLElement, dependencies: { contextKey?: () => string; notice?: (message: string, error?: boolean) => void } = {}): StudioCompositionTools {
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
    <label>Período declarado (opcional)<input id="studio-compose-period" maxlength="120" placeholder="Somente o período que você consegue identificar"></label>
    <label id="studio-compose-note-label" hidden>Nota declarada (VideoInfo)<textarea id="studio-compose-note" maxlength="400" rows="3"></textarea></label>
    <p>Metadados são declarações suas, separados dos pixels. Não recuperam números ausentes e não transformam um recorte em relatório completo.</p>
    <div class="actions"><button type="button" id="studio-compose-render" disabled>Gerar composição PNG</button><button type="button" id="studio-compose-cancel">Cancelar / limpar composição</button><button type="button" id="studio-compose-download" disabled>Baixar composição PNG</button></div>
    <p id="studio-compose-status" role="status" aria-live="polite">Escolha um PNG local ou faça uma captura validada com a opção de composição ativa.</p><div id="studio-compose-output"></div>`;
  host.append(panel);
  const get = <T extends HTMLElement = HTMLElement>(id: string) => panel.querySelector<T>(`#studio-compose-${id}`)!;
  const file = get<HTMLInputElement>('file'), enabled = get<HTMLInputElement>('enabled'), render = get<HTMLButtonElement>('render'), download = get<HTMLButtonElement>('download'), status = get('status'), output = get('output');
  let input: StudioCompositionInput | undefined, result: Blob | undefined, owner: ImagePreview | undefined, controller: AbortController | undefined, epoch = 0, disposed = false;
  const message = (value: string, error = false) => { status.textContent = value; dependencies.notice?.(value, error); };
  const clearOutput = () => { epoch++; controller?.abort(); controller = undefined; result = undefined; owner?.release(); owner = undefined; output.replaceChildren(); download.disabled = true; render.disabled = !input || disposed; };
  const invalidate = (reason = 'Contexto alterado. Forneça uma nova captura validada ou escolha o PNG novamente.') => { if (disposed) return; clearOutput(); input = undefined; file.value = ''; get('source').textContent = 'Nenhuma imagem fornecida.'; render.disabled = true; message(reason); };
  const syncOptions = () => { get('note-label').hidden = get<HTMLSelectElement>('layout').value !== 'video-info'; get<HTMLInputElement>('color').disabled = get<HTMLSelectElement>('background').value !== 'custom'; };
  for (const id of ['layout', 'theme', 'background', 'color', 'scale', 'title', 'period', 'note']) for (const event of ['input', 'change']) get(id).addEventListener(event, () => { clearOutput(); syncOptions(); if (!input) file.value = ''; message(input ? 'Opções alteradas. Gere outra composição para estes mesmos pixels.' : 'Opções alteradas. Forneça uma captura validada ou escolha o PNG novamente.'); });
  enabled.addEventListener('change', () => invalidate('Destino da captura alterado. Uma próxima captura só ocorre por sua ação explícita.'));

  async function accept(next: StudioCompositionInput): Promise<void> {
    clearOutput(); input = undefined; render.disabled = true; const mine = epoch, current = new AbortController(); controller = current;
    get('source').textContent = 'Validando nova imagem fornecida…'; message('Validando o PNG fornecido localmente…');
    try {
      await preflightImage(next.image, { ...STUDIO_COMPOSITION_LIMITS, signal: current.signal, deadline: performance.now() + STUDIO_COMPOSITION_LIMITS.durationMs });
      if (mine !== epoch || current.signal.aborted || disposed) return;
      if (next.source.kind === 'validated-studio-capture' && dependencies.contextKey && dependencies.contextKey() !== next.source.receipt.contextKey) throw new Error('A aba ou o contexto da captura mudou. Capture novamente antes de compor.');
      input = next; get('source').textContent = studioCompositionSourceLabel(next.source); render.disabled = false;
      message('Pixels aceitos. Revise o layout e os metadados; clique em Gerar para compor.');
    } catch (error) { if (mine === epoch && !current.signal.aborted && !disposed) { get('source').textContent = 'Imagem recusada.'; message(error instanceof Error ? error.message : 'Não foi possível validar o PNG.', true); throw error; } }
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
    const contextCurrent = () => source.source.kind !== 'validated-studio-capture' || !dependencies.contextKey || dependencies.contextKey() === source.source.receipt.contextKey;
    message('Compondo os pixels fornecidos neste navegador…');
    void (async () => {
      try {
        if (!contextCurrent()) { invalidate(); return; }
        const deadline = performance.now() + STUDIO_COMPOSITION_LIMITS.durationMs;
        const blob = await composeStudioCapture(source, options, { signal: current.signal, deadline });
        if (mine !== epoch || current.signal.aborted || disposed) return;
        if (!contextCurrent()) { invalidate(); return; }
        const image = doc.createElement('img'); image.alt = 'Composição local com pixels fornecidos e metadados declarados'; image.style.cssText = 'max-width:100%;height:auto';
        const preview = await prepareImagePreview(image, blob, { signal: current.signal, deadline, maxBytes: STUDIO_COMPOSITION_LIMITS.maxBytes, maxPixels: 4_000_000, maxDimension: 2400 });
        if (mine !== epoch || current.signal.aborted || disposed) { preview.release(); return; }
        if (!contextCurrent()) { preview.release(); invalidate(); return; }
        owner = preview; result = blob; output.replaceChildren(image); download.disabled = false;
        message(`Composição local pronta · ${options.layout === 'analytics-only' ? 'AnalyticsOnly' : 'VideoInfo'} · ${options.scale}× · PNG. Revise os pixels antes de compartilhar.`);
      } catch (error) { if (mine === epoch && !current.signal.aborted && !disposed) { clearOutput(); message(error instanceof Error ? error.message : 'A composição local falhou.', true); } }
      finally { if (controller === current) controller = undefined; if (mine === epoch && !disposed) render.disabled = !input; }
    })();
  });
  get('cancel').addEventListener('click', () => invalidate('Composição cancelada e pixels descartados. Nenhuma captura ou arquivo novo foi enviado.'));
  download.addEventListener('click', () => { if (result) downloadBlob(result, 'prevlev-studio-composicao.png'); });
  syncOptions();
  return {
    wantsComposition: () => !disposed && enabled.checked,
    async setCapture(image, receipt) {
      if (disposed) return;
      invalidate('Recebendo nova captura; a prévia anterior foi descartada.');
      try { validateStudioCaptureReceipt(receipt); }
      catch (error) { message(error instanceof Error ? error.message : 'Recibo de captura inválido.', true); throw error; }
      const copy: StudioCaptureReceipt = { ...receipt, categories: [...receipt.categories] };
      await accept({ image, source: { kind: 'validated-studio-capture', receipt: copy } });
    },
    invalidate,
    dispose() { if (disposed) return; invalidate('Compositor encerrado.'); disposed = true; panel.remove(); },
  };
}
