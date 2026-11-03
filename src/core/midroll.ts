export interface Silence {
  start: number;
  end: number;
}
export interface MidrollOptions {
  durationSeconds: number;
  intervalSeconds: number;
  edgeSeconds?: number;
  silences?: readonly Silence[];
  snapWindowSeconds?: number;
}

/** Planning only: does not perform any action on a channel. */
export function planMidrolls(options: MidrollOptions): number[] {
  const {
    durationSeconds,
    intervalSeconds,
    silences = [],
    edgeSeconds = 60,
    snapWindowSeconds = 20,
  } = options;
  if (
    ![durationSeconds, intervalSeconds, edgeSeconds, snapWindowSeconds].every(
      Number.isFinite,
    ) ||
    durationSeconds <= 0 ||
    intervalSeconds < 60 ||
    edgeSeconds < 0 ||
    snapWindowSeconds < 0
  )
    throw new Error(
      "Duração válida e intervalo mínimo de 60 segundos são necessários.",
    );
  if (durationSeconds < 480) return [];
  const result: number[] = [];
  for (
    let position = Math.max(intervalSeconds, edgeSeconds);
    position < durationSeconds - edgeSeconds;
    position += intervalSeconds
  ) {
    const candidates = silences
      .filter(
        (silence) =>
          Number.isFinite(silence.start) &&
          Number.isFinite(silence.end) &&
          silence.end > silence.start,
      )
      .map((silence) => (silence.start + silence.end) / 2)
      .filter(
        (midpoint) =>
          Math.abs(midpoint - position) <= snapWindowSeconds &&
          midpoint >= edgeSeconds &&
          midpoint < durationSeconds - edgeSeconds,
      )
      .sort((a, b) => Math.abs(a - position) - Math.abs(b - position));
    const selected = Math.round(candidates[0] ?? position);
    if (!result.length || selected - result[result.length - 1] >= 60)
      result.push(selected);
  }
  return result;
}

/** Uses real mono PCM samples, not a canvas drawing or inferred audio. */
export function detectSilences(
  samples: ArrayLike<number>,
  sampleRate: number,
  thresholdDb = -40,
  minDurationSeconds = 0.5,
): Silence[] {
  if (
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    !Number.isFinite(thresholdDb) ||
    thresholdDb > 0 ||
    !Number.isFinite(minDurationSeconds) ||
    minDurationSeconds <= 0
  )
    throw new Error("Parâmetros inválidos para análise de silêncio.");
  const threshold = Math.pow(10, thresholdDb / 20);
  const windowSize = Math.max(1, Math.round(sampleRate * 0.02));
  const silences: Silence[] = [];
  let start: number | undefined;
  const finish = (end: number) => {
    if (start !== undefined && (end - start) / sampleRate >= minDurationSeconds)
      silences.push({ start: start / sampleRate, end: end / sampleRate });
    start = undefined;
  };
  for (let offset = 0; offset < samples.length; offset += windowSize) {
    const end = Math.min(samples.length, offset + windowSize);
    let squareSum = 0;
    for (let i = offset; i < end; i++) {
      const value = samples[i];
      squareSum += Number.isFinite(value) ? value * value : Infinity;
    }
    if (Math.sqrt(squareSum / (end - offset)) <= threshold) start ??= offset;
    else finish(offset);
  }
  finish(samples.length);
  return silences;
}

export type AdvancedMidrollMode = "auto" | "quantity" | "custom" | "smart";
export const MIDROLL_INTERVAL_PRESETS = [10, 20, 30, 60, 120, 180, 240, 300, 600, 900, 1200] as const;
export const MIDROLL_POSITION_FPS = [24, 25, 30, 48, 50, 60] as const;
export type MidrollPositionPrecision = 'seconds' | 'frames';
export interface MidrollPositionGrid { precision: MidrollPositionPrecision; fps?: number; ticksPerSecond: number; }
/** Planning precision is explicit and separate from the FPS used to scan a PCM file. */
export function midrollPositionGrid(precision?: MidrollPositionPrecision, fps?: number): MidrollPositionGrid {
  const selected = precision ?? (fps === undefined ? 'seconds' : 'frames');
  if (selected !== 'seconds' && selected !== 'frames') throw new Error('Precisão do plano inválida.');
  if (selected === 'seconds') {
    if (fps !== undefined) throw new Error('FPS exige precisão em frames; não será ignorado no modo de segundos inteiros.');
    return { precision: selected, ticksPerSecond: 1 };
  }
  if (fps === undefined || !MIDROLL_POSITION_FPS.includes(fps as typeof MIDROLL_POSITION_FPS[number])) throw new Error('Frames exigem FPS declarado: 24, 25, 30, 48, 50 ou 60.');
  return { precision: selected, fps, ticksPerSecond: fps };
}
function onGrid(value: number, grid: MidrollPositionGrid): boolean {
  return Math.abs(value * grid.ticksPerSecond - Math.round(value * grid.ticksPerSecond)) < 1e-7;
}
export interface AdvancedMidrollOptions {
  mode: AdvancedMidrollMode;
  durationSeconds: number;
  intervalSeconds?: number;
  quantity?: number;
  startSeconds?: number;
  includeStart?: boolean;
  includeEnd?: boolean;
  includePlayhead?: boolean;
  playheadSeconds?: number;
  silences?: readonly Silence[];
  snapWindowSeconds?: number;
  precision?: MidrollPositionPrecision;
  fps?: number;
}

/** Independent proposal. Start/end mean one second inside the video, as Studio requires positive positions. */
export function planAdvancedMidrolls(options: AdvancedMidrollOptions): number[] {
  const { durationSeconds: duration, mode } = options;
  if (!Number.isFinite(duration) || duration < 480 || duration > 7200)
    throw new Error("Informe uma duração entre 480 e 7200 segundos.");
  if (!["auto", "quantity", "custom", "smart"].includes(mode))
    throw new Error("Modo de planejamento inválido.");
  const grid = midrollPositionGrid(options.precision, options.fps);
  const positions: number[] = [];
  const add = (position: number, manual = false) => {
    if (!Number.isFinite(position) || position < 1 || position > duration - 1)
      throw new Error("Posição fora dos limites do vídeo (1 segundo até duração − 1 segundo).");
    if (manual && !onGrid(position, grid)) throw new Error(grid.precision === 'seconds' ? 'Posição manual fracionária exige precisão em frames e FPS declarado; segundos inteiros não arredondam o playhead informado.' : 'Posição manual não está na grade do FPS declarado.');
    const lastTick = Math.floor((duration - 1) * grid.ticksPerSecond + 1e-7);
    const tick = Math.min(lastTick, Math.max(grid.ticksPerSecond, Math.round(position * grid.ticksPerSecond)));
    positions.push(Number((tick / grid.ticksPerSecond).toFixed(12)));
    if (positions.length > 100) throw new Error("Mais de 50 posições solicitadas; aumente o intervalo ou reduza a quantidade.");
  };
  if (mode === "auto" || mode === "quantity") {
    const quantity = mode === "auto" ? Math.max(1, Math.floor(duration / 180)) : options.quantity;
    if (!Number.isInteger(quantity) || quantity! < 1 || quantity! > 50)
      throw new Error("Informe uma quantidade inteira entre 1 e 50.");
    for (let i = 1; i <= quantity!; i++) add(duration * i / (quantity! + 1));
  } else {
    const interval = options.intervalSeconds;
    const start = options.startSeconds ?? interval;
    if (!Number.isFinite(interval) || interval! < 10 || !Number.isFinite(start) || start! < 1 || start! > duration - 1)
      throw new Error("Informe intervalo de pelo menos 10 segundos e início dentro do vídeo.");
    if (!onGrid(interval!, grid) || !onGrid(start!, grid)) throw new Error('Intervalo e início devem respeitar a precisão declarada; frações exigem frames e FPS compatível.');
    const snapWindow = options.snapWindowSeconds ?? 20;
    if (!Number.isFinite(snapWindow) || snapWindow < 0) throw new Error("Janela de silêncio inválida.");
    if (mode === "smart" && !options.silences)
      throw new Error("Smart exige análise PCM local concluída para esta duração.");
    const midpoints = (options.silences ?? []).filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end <= duration && s.end > s.start).map(s => (s.start + s.end) / 2);
    for (let position = start!; position <= duration - 1; position += interval!) {
      const nearest = mode === "smart" ? midpoints.filter(x => Math.abs(x - position) <= snapWindow && x >= 1 && x <= duration - 1).sort((a, b) => Math.abs(a - position) - Math.abs(b - position))[0] : undefined;
      add(nearest ?? position);
    }
  }
  if (options.includeStart) add(1);
  if (options.includeEnd) add(duration - 1);
  if (options.includePlayhead) {
    if (options.playheadSeconds === undefined) throw new Error("Informe a posição do playhead em segundos.");
    add(options.playheadSeconds, true);
  }
  const result = [...new Set(positions)].sort((a, b) => a - b);
  if (result.length > 50) throw new Error("Mais de 50 posições solicitadas; aumente o intervalo ou reduza a quantidade.");
  return result;
}

export interface PcmAnalysisOptions {
  thresholdPercent: number;
  minDurationSeconds: number;
  fps: number;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}
export interface PcmAnalysis { silences: Silence[]; waveform: number[]; durationSeconds: number; }

/** Scans decoded local PCM in frame-sized windows; all channels must be quiet. */
export async function analyzePcm(channels: readonly Float32Array[], sampleRate: number, options: PcmAnalysisOptions): Promise<PcmAnalysis> {
  const { thresholdPercent, minDurationSeconds, fps, signal, onProgress } = options;
  const length = channels[0]?.length ?? 0;
  if (!Number.isFinite(sampleRate) || sampleRate < 1 || sampleRate > 192000 || !length || !channels.length || channels.length > 8 || channels.some(c => c.length !== length) || length * channels.length > 16_000_000 || length / sampleRate > 7200 || !Number.isFinite(thresholdPercent) || thresholdPercent < 0 || thresholdPercent > 100 || !Number.isFinite(minDurationSeconds) || minDurationSeconds <= 0 || !Number.isInteger(fps) || fps < 1 || fps > 120)
    throw new Error("PCM ou parâmetros inválidos; limite de 2 horas, 8 canais e 16 milhões de amostras.");
  const frameSize = Math.max(1, Math.round(sampleRate / fps));
  const waveform = Array<number>(Math.min(600, Math.ceil(length / frameSize))).fill(0);
  const silences: Silence[] = [];
  let start: number | undefined;
  const finish = (end: number) => {
    if (start !== undefined && (end - start) / sampleRate >= minDurationSeconds) silences.push({ start: start / sampleRate, end: end / sampleRate });
    start = undefined;
  };
  for (let offset = 0, frame = 0; offset < length; offset += frameSize, frame++) {
    if (signal?.aborted) throw new DOMException("Análise cancelada.", "AbortError");
    const end = Math.min(length, offset + frameSize);
    let peakRms = 0;
    for (const channel of channels) {
      let sum = 0;
      for (let i = offset; i < end; i++) {
        const sample = channel[i];
        sum += Number.isFinite(sample) ? sample * sample : Infinity;
      }
      peakRms = Math.max(peakRms, Math.sqrt(sum / (end - offset)));
    }
    const bin = Math.min(waveform.length - 1, Math.floor(offset / length * waveform.length));
    waveform[bin] = Math.max(waveform[bin], Math.min(1, peakRms));
    if (peakRms <= thresholdPercent / 100) start ??= offset; else finish(offset);
    if (frame % 128 === 0) {
      onProgress?.(offset / length);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }
  if (signal?.aborted) throw new DOMException("Análise cancelada.", "AbortError");
  finish(length);
  onProgress?.(1);
  return { silences, waveform, durationSeconds: length / sampleRate };
}
