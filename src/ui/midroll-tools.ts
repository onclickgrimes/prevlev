import { analyzePcm, MIDROLL_INTERVAL_PRESETS, planAdvancedMidrolls, type AdvancedMidrollMode, type PcmAnalysis } from "../core/midroll";

const MAX_PCM_SAMPLES = 16_000_000;
const WAV_ERROR = "Use um arquivo WAV local PCM ou IEEE float válido; formatos comprimidos não são aceitos.";

/** Read only small headers before deciding whether a WAV can safely be decoded. */
export async function preflightWav(file: File): Promise<{ frames: number; channels: number; sampleRate: number }> {
  const read = async (offset: number, length: number) => {
    if (offset < 0 || length < 0 || offset + length > file.size) throw new Error(WAV_ERROR);
    return new DataView(await file.slice(offset, offset + length).arrayBuffer());
  };
  const text = (view: DataView, start: number, length: number) => Array.from({ length }, (_, i) => String.fromCharCode(view.getUint8(start + i))).join("");
  if (file.size < 44 || file.size > 50 * 1024 * 1024) throw new Error(WAV_ERROR);
  const header = await read(0, 12);
  const end = header.getUint32(4, true) + 8;
  if (text(header, 0, 4) !== "RIFF" || text(header, 8, 4) !== "WAVE" || end !== file.size || end < 44) throw new Error(WAV_ERROR);
  let format: { channels: number; sampleRate: number; blockAlign: number } | undefined;
  let dataBytes: number | undefined;
  let offset = 12;
  for (let chunks = 0; offset + 8 <= end && chunks < 1024; chunks++) {
    const chunk = await read(offset, 8);
    const id = text(chunk, 0, 4), size = chunk.getUint32(4, true), start = offset + 8;
    if (start + size > end || start + size + (size % 2) > end) throw new Error(WAV_ERROR);
    if (id === "fmt ") {
      if (format || size < 16) throw new Error(WAV_ERROR);
      const fmt = await read(start, 16);
      const encoding = fmt.getUint16(0, true), channels = fmt.getUint16(2, true), sampleRate = fmt.getUint32(4, true), byteRate = fmt.getUint32(8, true), blockAlign = fmt.getUint16(12, true), bits = fmt.getUint16(14, true);
      if (!((encoding === 1 && [8, 16, 24, 32].includes(bits)) || (encoding === 3 && [32, 64].includes(bits))) || channels < 1 || channels > 8 || sampleRate < 1 || sampleRate > 192000 || blockAlign !== channels * bits / 8 || byteRate !== sampleRate * blockAlign) throw new Error(WAV_ERROR);
      format = { channels, sampleRate, blockAlign };
    } else if (id === "data") {
      if (dataBytes !== undefined) throw new Error(WAV_ERROR);
      dataBytes = size;
    }
    offset = start + size + (size % 2);
  }
  if (offset !== end || !format || !dataBytes || dataBytes % format.blockAlign !== 0) throw new Error(WAV_ERROR);
  const frames = dataBytes / format.blockAlign;
  if (frames * format.channels > MAX_PCM_SAMPLES || frames / format.sampleRate > 7200) throw new Error("WAV excede o limite de 2 horas ou 16 milhões de amostras; escolha um arquivo menor.");
  return { frames, channels: format.channels, sampleRate: format.sampleRate };
}

/** Augments #studio. The host must use getPlan() for previews and invalidate previews on change. */
export function mountMidrollTools(doc: Document, onChange: () => void) {
  const studio = doc.querySelector<HTMLElement>("#studio");
  const audioButton = doc.querySelector<HTMLButtonElement>("#audio-analyze");
  const audioFile = doc.querySelector<HTMLInputElement>("#midroll-audio");
  const duration = doc.querySelector<HTMLInputElement>("#duration");
  const interval = doc.querySelector<HTMLInputElement>("#interval");
  const info = doc.querySelector<HTMLElement>("#audio-info");
  if (!studio || !audioButton || !audioFile || !duration || !interval || !info) throw new Error("Controles de mid-roll ausentes.");
  const panel = doc.createElement("div");
  panel.id = "midroll-tools";
  panel.innerHTML = `<h3>Planejamento local de mid-roll</h3>
    <label>Modo <select id="midroll-mode"><option value="auto">Auto</option><option value="quantity">Quantidade</option><option value="custom" selected>Custom</option><option value="smart">Smart (PCM local)</option></select></label>
    <label>Quantidade <input id="midroll-quantity" type="number" min="1" max="50" value="3"></label>
    <label>Intervalo predefinido <select id="midroll-preset">${MIDROLL_INTERVAL_PRESETS.map(v => `<option value="${v}"${v === 180 ? " selected" : ""}>${v < 60 ? `${v} s` : `${v / 60} min`}</option>`).join("")}</select></label>
    <label>Início personalizado em segundos (vazio usa intervalo) <input id="midroll-start" type="number" min="1" step="1"></label>
    <label><input id="midroll-include-start" type="checkbox"> Incluir início (1 s)</label>
    <label><input id="midroll-include-end" type="checkbox"> Incluir fim (duração − 1 s)</label>
    <label><input id="midroll-include-playhead" type="checkbox"> Incluir playhead informado</label>
    <label>Playhead em segundos <input id="midroll-playhead" type="number" min="1" step="0.01"></label>
    <label>Limite de silêncio (% amplitude RMS) <input id="midroll-threshold" type="number" min="0" max="100" step="0.1" value="1"></label>
    <label>Silêncio mínimo (ms) <input id="midroll-min-silence" type="number" min="1" value="500"></label>
    <label>FPS da análise PCM <input id="midroll-analysis-fps" type="number" min="1" max="120" value="30"></label>
    <progress id="midroll-progress" max="1" value="0"></progress><button type="button" id="midroll-cancel" disabled>Cancelar análise</button>
    <div id="midroll-waveform" role="img" aria-label="Nível RMS por trecho do arquivo local"></div>
    <p class="muted">O Smart usa somente o arquivo local escolhido. Sem silêncio próximo, mantém a posição por intervalo; não lê o waveform do Studio.</p>`;
  audioFile.accept = ".wav,audio/wav,audio/wave,audio/x-wav";
  audioFile.parentElement!.before(panel);
  const input = (id: string) => panel.querySelector<HTMLInputElement>(`#${id}`)!;
  const mode = panel.querySelector<HTMLSelectElement>("#midroll-mode")!;
  const preset = panel.querySelector<HTMLSelectElement>("#midroll-preset")!;
  const progress = panel.querySelector<HTMLProgressElement>("#midroll-progress")!;
  const cancel = panel.querySelector<HTMLButtonElement>("#midroll-cancel")!;
  const wave = panel.querySelector<HTMLElement>("#midroll-waveform")!;
  let analysis: PcmAnalysis | undefined;
  let controller: AbortController | undefined;
  const invalidateAudio = () => { controller?.abort(); analysis = undefined; wave.replaceChildren(); progress.value = 0; info.textContent = "Análise PCM anterior descartada; analise o arquivo novamente."; onChange(); };
  panel.addEventListener("change", event => {
    if (event.target === preset) interval.value = preset.value;
    if ([input("midroll-threshold"), input("midroll-min-silence"), input("midroll-analysis-fps")].includes(event.target as HTMLInputElement)) invalidateAudio();
    else onChange();
  });
  audioFile.addEventListener("change", invalidateAudio);
  duration.addEventListener("change", onChange);
  interval.addEventListener("change", onChange);
  cancel.addEventListener("click", () => controller?.abort());
  audioButton.addEventListener("click", async () => {
    if (controller) return;
    const file = audioFile.files?.[0];
    if (!file || file.size > 50 * 1024 * 1024) { info.textContent = "Escolha um arquivo de áudio local de até 50 MB."; return; }
    invalidateAudio();
    const current = new AbortController(); controller = current;
    cancel.disabled = false; audioButton.disabled = true; info.textContent = "Decodificando arquivo local…";
    let audio: AudioContext | undefined;
    try {
      const header = await preflightWav(file);
      if (current.signal.aborted) throw new DOMException("Análise cancelada.", "AbortError");
      audio = new AudioContext();
      const expectedFrames = Math.ceil(header.frames * audio.sampleRate / header.sampleRate);
      if (expectedFrames * header.channels > MAX_PCM_SAMPLES) throw new Error("O WAV excede 16 milhões de amostras após conversão da taxa de áudio; escolha um arquivo menor.");
      const bytes = await file.arrayBuffer();
      if (current.signal.aborted) throw new DOMException("Análise cancelada.", "AbortError");
      const buffer = await audio.decodeAudioData(bytes);
      if (current.signal.aborted) throw new DOMException("Análise cancelada.", "AbortError");
      if (buffer.numberOfChannels !== header.channels || buffer.length * buffer.numberOfChannels > MAX_PCM_SAMPLES || buffer.sampleRate !== audio.sampleRate || Math.abs(buffer.length / buffer.sampleRate - header.frames / header.sampleRate) > 2 / buffer.sampleRate) throw new Error("Áudio decodificado diverge do cabeçalho WAV; análise cancelada.");
      info.textContent = "Analisando PCM local…";
      const result = await analyzePcm(Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)), buffer.sampleRate, {
        thresholdPercent: Number(input("midroll-threshold").value), minDurationSeconds: Number(input("midroll-min-silence").value) / 1000,
        fps: Number(input("midroll-analysis-fps").value), signal: current.signal, onProgress: fraction => { progress.value = fraction; },
      });
      if (current.signal.aborted) throw new DOMException("Análise cancelada.", "AbortError");
      analysis = result; duration.value = String(result.durationSeconds); onChange();
      const bars = result.waveform.map(level => { const bar = doc.createElement("span"); bar.style.cssText = `display:inline-block;width:2px;height:${Math.max(1, Math.round(level * 40))}px;background:currentColor;vertical-align:bottom`; return bar; });
      wave.replaceChildren(...bars);
      info.textContent = `PCM local: ${result.silences.length} silêncios em ${result.durationSeconds.toFixed(2)} s. Arquivo não enviado; silêncio é estimado por RMS.`;
    } catch (error) {
      info.textContent = error instanceof Error ? error.message : "Falha na análise PCM local.";
    } finally {
      if (audio) await audio.close();
      if (controller === current) controller = undefined;
      cancel.disabled = true; audioButton.disabled = false;
    }
  });
  return {
    getPlan() {
      const videoDuration = Number(duration.value);
      const selectedMode = mode.value as AdvancedMidrollMode;
      const matching = analysis && Math.abs(analysis.durationSeconds - videoDuration) < 0.01 ? analysis : undefined;
      const positions = planAdvancedMidrolls({ mode: selectedMode, durationSeconds: videoDuration, intervalSeconds: Number(interval.value), quantity: Number(input("midroll-quantity").value), ...(input("midroll-start").value ? { startSeconds: Number(input("midroll-start").value) } : {}), includeStart: input("midroll-include-start").checked, includeEnd: input("midroll-include-end").checked, includePlayhead: input("midroll-include-playhead").checked, ...(input("midroll-playhead").value ? { playheadSeconds: Number(input("midroll-playhead").value) } : {}), silences: matching?.silences });
      return { positions, mode: selectedMode, durationSeconds: videoDuration, source: selectedMode === "smart" ? `PCM local: ${audioFile.files?.[0]?.name ?? "arquivo selecionado"}; ${matching!.silences.length} silêncios; limite ${input("midroll-threshold").value}% RMS, mínimo ${input("midroll-min-silence").value} ms; posições sem silêncio próximo mantêm intervalo` : "duração e parâmetros informados", targets: positions.length, playheadSource: input("midroll-include-playhead").checked ? "posição informada manualmente" : "não incluído", analysisFps: selectedMode === "smart" ? Number(input("midroll-analysis-fps").value) : undefined };
    },
  };
}
