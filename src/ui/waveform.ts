import { analyzeWaveformRaster, readWaveformCanvas, type RasterColor, type VisualWaveformAnalysis, type WaveformRasterOptions } from "../core/waveform";
import { decodeImageBitmap, withImageDecodeSlot } from '../core/image-preflight';

/** Local PNG only. No Studio canvas/geometry is discovered or assumed by this module. */
export function mountWaveformTools(doc: Document, onChange: () => void = () => {}) {
  const studio = doc.querySelector<HTMLElement>("#studio");
  if (!studio) throw new Error("Seção Studio ausente para a estimativa visual local.");
  const panel = doc.createElement("div");
  panel.id = "waveform-tools";
  panel.innerHTML = `<h3>Waveform: estimativa visual local</h3>
    <p>Analisa a altura de um desenho PNG escolhido por você. Não mede PCM, RMS ou volume real e não lê o canvas do Studio. Escala e posição temporal precisam ser informadas.</p>
    <label>PNG local (até 10 MB e 4 milhões de pixels) <input id="waveform-file" type="file" accept=".png,image/png"></label>
    <canvas id="waveform-preview" hidden style="max-width:100%;height:auto" role="img" aria-label="Imagem local de waveform escolhida"></canvas>
    <fieldset><legend>Geometria em pixels da imagem original (direita e base exclusivas)</legend>
      <label>Esquerda <input id="waveform-left" type="number" min="0" step="1"></label>
      <label>Direita <input id="waveform-right" type="number" min="1" step="1"></label>
      <label>Topo <input id="waveform-top" type="number" min="0" step="1"></label>
      <label>Base <input id="waveform-bottom" type="number" min="1" step="1"></label>
      <label>Linha central Y <input id="waveform-baseline" type="number" min="0" step="1"></label>
      <label>Altura da escala total a partir da linha central (pixels) <input id="waveform-scale" type="number" min="1" step="0.1"></label>
    </fieldset>
    <label>Início do trecho (segundos) <input id="waveform-start" type="number" min="0" step="0.001"></label>
    <label>Fim do trecho (segundos) <input id="waveform-end" type="number" min="0" max="7200" step="0.001"></label>
    <label>FPS declarado <input id="waveform-fps" type="number" min="1" max="120" step="1"></label>
    <label>Cor do traço <input id="waveform-foreground" type="color" value="#ffffff"></label>
    <label>Cor do fundo <input id="waveform-background" type="color" value="#000000"></label>
    <label>Tolerância RGB (distância de 0 a 100) <input id="waveform-tolerance" type="number" min="0" max="100" value="0"></label>
    <label>Altura máxima para trecho visual baixo (%) <input id="waveform-threshold" type="number" min="0" max="100" step="0.1" value="10"></label>
    <label>Duração mínima (ms) <input id="waveform-min-duration" type="number" min="1" value="500"></label>
    <label><input id="waveform-confirm-geometry" type="checkbox"> Conferi recorte, escala, cores e tempos desta imagem; são declarações minhas.</label>
    <button type="button" id="waveform-analyze" disabled>Analisar desenho local</button>
    <button type="button" id="waveform-cancel" disabled>Cancelar análise visual</button>
    <button type="button" id="waveform-export" disabled>Exportar estimativa JSON</button>
    <progress id="waveform-progress" max="1" value="0"></progress>
    <p id="waveform-status" role="status">Escolha uma imagem e informe a geometria; abrir esta tela não analisa nem altera anúncios.</p>
    <div id="waveform-result"></div>`;
  studio.append(panel);
  const input = (name: string) => panel.querySelector<HTMLInputElement>(`#waveform-${name}`)!;
  const button = (name: string) => panel.querySelector<HTMLButtonElement>(`#waveform-${name}`)!;
  const preview = panel.querySelector<HTMLCanvasElement>("#waveform-preview")!;
  const status = panel.querySelector<HTMLElement>("#waveform-status")!;
  const output = panel.querySelector<HTMLElement>("#waveform-result")!;
  const progress = panel.querySelector<HTMLProgressElement>("#waveform-progress")!;
  let analysis: VisualWaveformAnalysis | undefined;
  let controller: AbortController | undefined;
  let revision = 0;
  let loaded = false;
  let sourceName = "";
  let queuedImage: { file: File; revision: number } | undefined;
  let decoding = false;
  let imageController: AbortController | undefined;
  const invalidate = () => {
    revision++; controller?.abort(); imageController?.abort(); analysis = undefined; queuedImage = undefined;
    button("export").disabled = true; button("cancel").disabled = true;
    button("analyze").disabled = !loaded; button("analyze").textContent = "Analisar desenho local";
    output.replaceChildren(); progress.value = 0;
    status.textContent = "Estimativa anterior descartada. Revise os valores e analise novamente.";
    onChange();
  };
  panel.addEventListener("input", event => {
    if (event.target instanceof HTMLInputElement && event.target !== input("file")) {
      if (event.target !== input("confirm-geometry")) input("confirm-geometry").checked = false;
      invalidate();
    }
  });
  const loadQueuedImage = async () => {
    if (decoding) return;
    decoding = true;
    try {
      while (queuedImage) {
        const { file, revision: currentRevision } = queuedImage;
        queuedImage = undefined;
        if (currentRevision !== revision) continue;
        const imageWork = new AbortController(); imageController = imageWork;
        const imageOptions = { signal: imageWork.signal, deadline: performance.now() + 15_000, maxBytes: 10 * 1024 * 1024, maxPixels: 4_000_000 };
        let bitmap: ImageBitmap | undefined;
        try {
          if (file.size < 24 || file.size > 10 * 1024 * 1024) throw new Error("Escolha um PNG local de até 10 MB.");
          const header = new DataView(await withImageDecodeSlot(() => file.slice(0, 24).arrayBuffer(), imageOptions));
          const signature = [137, 80, 78, 71, 13, 10, 26, 10];
          const width = header.getUint32(16), height = header.getUint32(20);
          if (!signature.every((value, i) => header.getUint8(i) === value) || header.getUint32(8) !== 13 || header.getUint32(12) !== 0x49484452 || width < 1 || height < 1 || width * height > 4_000_000)
            throw new Error("PNG inválido ou maior que 4 milhões de pixels.");
          // Header reads and decoding are asynchronous; a newer selection may supersede either.
          if (currentRevision !== revision) continue;
          // The shared decoder validates the complete static PNG container and retains its
          // physical slot after cancellation until the native decode really finishes.
          bitmap = await decodeImageBitmap(file, imageOptions);
          if (currentRevision !== revision) continue;
          if (bitmap.width !== width || bitmap.height !== height) throw new Error("Dimensões decodificadas divergem do cabeçalho PNG.");
          const context = preview.getContext("2d");
          if (!context) throw new Error("Canvas local indisponível.");
          preview.width = width; preview.height = height; context.drawImage(bitmap, 0, 0);
          preview.hidden = false; loaded = true; sourceName = file.name;
          input("left").value = "0"; input("top").value = "0";
          input("right").value = String(width); input("bottom").value = String(height);
          // Never infer a waveform baseline, scale, timeline origin or FPS from an image.
          for (const name of ["baseline", "scale", "start", "end", "fps"]) input(name).value = "";
          button("analyze").disabled = false;
          status.textContent = `${width} × ${height} pixels locais. Informe linha central, escala, tempos e FPS; depois confira todos os campos.`;
        } catch (error) {
          if (currentRevision === revision) status.textContent = error instanceof Error ? error.message : "Falha na imagem local.";
        } finally { bitmap?.close(); if (imageController === imageWork) imageController = undefined; }
      }
    } finally { decoding = false; }
  };
  input("file").addEventListener("change", () => {
    loaded = false; invalidate(); preview.hidden = true; preview.width = preview.height = 1;
    input("confirm-geometry").checked = false;
    const file = input("file").files?.[0];
    if (!file) { status.textContent = "Nenhuma imagem selecionada."; return; }
    // One active decode and one replaceable latest selection bound aggregate work.
    queuedImage = { file, revision };
    status.textContent = "Imagem selecionada; aguardando leitura local.";
    void loadQueuedImage();
  });
  button("cancel").addEventListener("click", () => {
    invalidate(); status.textContent = "Análise visual cancelada; nenhum resultado foi mantido.";
  });
  const color = (name: string): RasterColor => {
    const hex = input(name).value;
    return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
  };
  const number = (name: string) => {
    if (!input(name).value.trim()) throw new Error("Preencha todos os parâmetros da estimativa visual, incluindo FPS.");
    return Number(input(name).value);
  };
  button("analyze").addEventListener("click", async () => {
    if (!loaded || controller) return;
    if (!input("confirm-geometry").checked) { status.textContent = "Confira e confirme recorte, escala, cores e tempos antes da análise."; return; }
    invalidate();
    const currentRevision = revision, current = new AbortController(); controller = current;
    button("analyze").disabled = true; button("cancel").disabled = false;
    status.textContent = "Analisando desenho local… Estimativa visual, sem PCM.";
    try {
      const options: WaveformRasterOptions = {
        geometry: { left: number("left"), right: number("right"), top: number("top"), bottom: number("bottom"), baselineY: number("baseline"), fullScalePixels: number("scale"), startSeconds: number("start"), endSeconds: number("end") },
        foreground: color("foreground"), background: color("background"), colorTolerance: number("tolerance"), thresholdPercent: number("threshold"), minDurationSeconds: number("min-duration") / 1000, fps: number("fps"),
        signal: current.signal, onProgress: fraction => { if (currentRevision === revision) progress.value = fraction; },
      };
      const result = await analyzeWaveformRaster(readWaveformCanvas(preview), options);
      if (currentRevision !== revision || current.signal.aborted) return;
      analysis = result;
      const details = doc.createElement("p");
      details.textContent = `${result.knownColumns} colunas reconhecidas; ${result.unknownColumns} desconhecidas. ${result.quietIntervals.length} trechos visuais baixos (não são silêncios PCM comprovados).`;
      const list = doc.createElement("ol");
      for (const interval of result.quietIntervals) {
        const item = doc.createElement("li");
        const position = result.candidatePositions.find(value => value > interval.start && value < interval.end);
        item.textContent = `${interval.start.toFixed(3)}–${interval.end.toFixed(3)} s; ${position === undefined ? "sem frame interior para sugerir posição" : `sugestão local ${position.toFixed(3)} s`}`;
        list.append(item);
      }
      output.replaceChildren(details, list);
      status.textContent = result.knownColumns ? "Estimativa visual concluída. Revise o desenho e os limites; nenhum anúncio foi alterado." : "Nenhum traço foi reconhecido com segurança; nenhuma posição foi sugerida.";
      button("export").disabled = false; button("analyze").textContent = "Analisar desenho novamente";
      onChange();
    } catch (error) {
      if (currentRevision === revision) status.textContent = error instanceof Error ? error.message : "Falha na estimativa visual.";
    } finally {
      if (controller === current) controller = undefined;
      if (currentRevision === revision) { button("analyze").disabled = !loaded; button("cancel").disabled = true; }
    }
  });
  button("export").addEventListener("click", () => {
    if (!analysis) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ source: { kind: "user-selected-local-png", name: sourceName }, ...analysis }, null, 2)], { type: "application/json" }));
    const anchor = doc.createElement("a"); anchor.href = url; anchor.download = "prevlev-waveform-visual.json"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return {
    getAnalysis: () => analysis ? structuredClone(analysis) : undefined,
    invalidate,
    destroy() { invalidate(); panel.remove(); },
  };
}
