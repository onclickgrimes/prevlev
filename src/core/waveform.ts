import type { Silence } from "./midroll";

export type RasterColor = readonly [number, number, number];
export interface WaveformRaster { width: number; height: number; data: ArrayLike<number>; }
/** Coordinates are raster pixels; right/bottom are exclusive. Times describe only this crop. */
export interface WaveformGeometry {
  left: number; right: number; top: number; bottom: number;
  baselineY: number; fullScalePixels: number; startSeconds: number; endSeconds: number;
}
export interface WaveformRasterOptions {
  geometry: WaveformGeometry;
  foreground: RasterColor;
  background: RasterColor;
  colorTolerance: number;
  thresholdPercent: number;
  minDurationSeconds: number;
  fps: number;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}
export interface VisualWaveformAnalysis {
  method: "visual-raster-estimate";
  quietIntervals: Silence[];
  candidatePositions: number[];
  levels: (number | null)[];
  knownColumns: number;
  unknownColumns: number;
  geometry: WaveformGeometry;
  fps: number;
  parameters: { foreground: RasterColor; background: RasterColor; colorTolerance: number; thresholdPercent: number; minDurationSeconds: number };
  limitations: readonly string[];
}

export const VISUAL_WAVEFORM_LIMITATIONS = [
  "Estimativa visual da altura do desenho, sem amostras PCM ou medição de volume RMS.",
  "Escala, cores, recorte e posição temporal foram declarados pelo usuário e não foram verificados no Studio.",
  "Colunas sem traço reconhecido, transparentes ou com cores ambíguas permanecem desconhecidas.",
  "Pixels limitam a resolução temporal; FPS declarado apenas restringe os limites e posições à grade de frames.",
  "Posições são sugestões locais. Nenhum anúncio foi inserido, removido ou salvo.",
] as const;

function distance(a: RasterColor, b: RasterColor): number {
  return Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0));
}

function validate(raster: WaveformRaster, options: WaveformRasterOptions): void {
  const { width, height, data } = raster;
  const { geometry: g, foreground, background, colorTolerance, thresholdPercent, minDurationSeconds, fps } = options;
  if (![width, height].every(Number.isInteger) || width < 1 || height < 1 || width * height > 4_000_000 || data.length !== width * height * 4)
    throw new Error("Raster inválido; limite de 4 milhões de pixels RGBA.");
  if (![g.left, g.right, g.top, g.bottom, g.baselineY].every(Number.isInteger) || g.left < 0 || g.top < 0 || g.right > width || g.bottom > height || g.right <= g.left || g.bottom <= g.top || g.baselineY < g.top || g.baselineY >= g.bottom || !Number.isFinite(g.fullScalePixels) || g.fullScalePixels <= 0 || g.fullScalePixels > Math.max(g.bottom - 1 - g.baselineY, g.baselineY - g.top))
    throw new Error("Informe recorte, linha central e escala em pixels dentro da imagem.");
  if (!Number.isFinite(g.startSeconds) || !Number.isFinite(g.endSeconds) || g.startSeconds < 0 || g.endSeconds <= g.startSeconds || g.endSeconds > 7200 || !Number.isInteger(fps) || fps < 1 || fps > 120)
    throw new Error("Declare início/fim entre 0 e 7200 segundos e FPS inteiro entre 1 e 120.");
  if (!Number.isFinite(thresholdPercent) || thresholdPercent < 0 || thresholdPercent > 100 || !Number.isFinite(minDurationSeconds) || minDurationSeconds <= 0 || minDurationSeconds > g.endSeconds - g.startSeconds)
    throw new Error("Limite visual deve estar entre 0 e 100%; duração mínima deve caber no trecho.");
  if (![foreground, background].every(color => color.length === 3 && color.every(c => Number.isInteger(c) && c >= 0 && c <= 255)) || !Number.isFinite(colorTolerance) || colorTolerance < 0 || colorTolerance > 100 || distance(foreground, background) <= 2 * colorTolerance)
    throw new Error("Declare cores distintas de traço/fundo e tolerância sem sobreposição (0 a 100).");
}

/** Read pixels once. A protected/unreadable canvas fails without a network or decoding fallback. */
export function readWaveformCanvas(canvas: HTMLCanvasElement): WaveformRaster {
  if (canvas.width < 1 || canvas.height < 1 || canvas.width * canvas.height > 4_000_000)
    throw new Error("Canvas vazio ou maior que 4 milhões de pixels.");
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Contexto indisponível.");
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return { width: pixels.width, height: pixels.height, data: pixels.data };
  } catch {
    throw new Error("Canvas protegido ou indisponível; nenhuma estimativa visual foi produzida.");
  }
}

/** Classifies only explicitly supplied colors. Missing pixels never count as quiet audio. */
export async function analyzeWaveformRaster(raster: WaveformRaster, options: WaveformRasterOptions): Promise<VisualWaveformAnalysis> {
  validate(raster, options);
  const { geometry: g, foreground, background, colorTolerance, thresholdPercent, minDurationSeconds, fps, signal, onProgress } = options;
  const levels: (number | null)[] = [];
  const quietIntervals: Silence[] = [];
  const columns = g.right - g.left;
  const secondsPerColumn = (g.endSeconds - g.startSeconds) / columns;
  let quietStart: number | undefined;
  let knownColumns = 0;
  const finish = (column: number) => {
    if (quietStart !== undefined) {
      // Round inward, so the declared FPS never extends evidence into adjacent pixels.
      const start = Math.max(0, Math.ceil((g.startSeconds + quietStart * secondsPerColumn) * fps - 1e-9) / fps);
      const end = Math.floor((g.startSeconds + column * secondsPerColumn) * fps + 1e-9) / fps;
      if (end > start && end - start + 1e-9 >= minDurationSeconds) quietIntervals.push({ start, end });
    }
    quietStart = undefined;
  };
  for (let column = 0; column < columns; column++) {
    if (signal?.aborted) throw new DOMException("Análise visual cancelada.", "AbortError");
    let peak = 0, found = false, unknown = false;
    for (let y = g.top; y < g.bottom; y++) {
      const offset = (y * raster.width + g.left + column) * 4;
      const values = Array.from({ length: 4 }, (_, i) => raster.data[offset + i]);
      if (!values.every(v => Number.isInteger(v) && v >= 0 && v <= 255) || values[3] !== 255) { unknown = true; break; }
      const color: RasterColor = [values[0], values[1], values[2]];
      if (distance(color, foreground) <= colorTolerance) {
        const amplitude = Math.abs(y - g.baselineY) / g.fullScalePixels;
        if (amplitude > 1) { unknown = true; break; }
        peak = Math.max(peak, amplitude); found = true;
      } else if (distance(color, background) > colorTolerance) { unknown = true; break; }
    }
    const level = !unknown && found ? peak : null;
    levels.push(level);
    if (level !== null) knownColumns++;
    if (level !== null && level <= thresholdPercent / 100) quietStart ??= column;
    else finish(column);
    if (column % 128 === 0) {
      onProgress?.(column / columns);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }
  if (signal?.aborted) throw new DOMException("Análise visual cancelada.", "AbortError");
  finish(columns);
  onProgress?.(1);
  return {
    method: "visual-raster-estimate", quietIntervals,
    candidatePositions: quietIntervals.flatMap(interval => {
      const position = Math.round((interval.start + interval.end) * fps / 2) / fps;
      // A one-frame interval may contain no interior frame; do not suggest its boundary.
      return position > interval.start && position < interval.end ? [position] : [];
    }),
    levels, knownColumns, unknownColumns: columns - knownColumns, geometry: { ...g }, fps,
    parameters: { foreground: [...foreground], background: [...background], colorTolerance, thresholdPercent, minDurationSeconds },
    limitations: [...VISUAL_WAVEFORM_LIMITATIONS],
  };
}
