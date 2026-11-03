import { describe, expect, it } from "vitest";
import { analyzeWaveformRaster, readWaveformCanvas, type WaveformRaster, type WaveformRasterOptions } from "../src/core/waveform";

function raster(levels: readonly (number | null)[]): WaveformRaster {
  const width = levels.length, height = 21;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (let x = 0; x < width; x++) {
    if (levels[x] === null) continue;
    for (let y = 10 - levels[x]!; y <= 10 + levels[x]!; y++) {
      const offset = (y * width + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = 255;
    }
  }
  return { width, height, data };
}
const options = (width: number): WaveformRasterOptions => ({
  geometry: { left: 0, right: width, top: 0, bottom: 21, baselineY: 10, fullScalePixels: 10, startSeconds: 10, endSeconds: 10 + width },
  foreground: [255, 255, 255], background: [0, 0, 0], colorTolerance: 0,
  thresholdPercent: 10, minDurationSeconds: 2, fps: 30,
});

describe("visual waveform raster estimation", () => {
  it("preserves supplied temporal origin/scale and differs explicitly from PCM", async () => {
    const result = await analyzeWaveformRaster(raster([0, 1, 8, 0, 0]), options(5));
    expect(result).toMatchObject({ method: "visual-raster-estimate", knownColumns: 5, unknownColumns: 0, levels: [0, 0.1, 0.8, 0, 0], quietIntervals: [{ start: 10, end: 12 }, { start: 13, end: 15 }], candidatePositions: [11, 14], fps: 30 });
    expect(result.limitations.join(" ")).toContain("sem amostras PCM");
  });

  it("does not bridge missing, transparent, unexpected or non-byte pixels", async () => {
    const image = raster([0, 0, null, 0, 0, 0, 0, 0, 0]);
    const data = Array.from(image.data);
    data[(10 * image.width + 5) * 4 + 3] = 100;
    data[(10 * image.width + 6) * 4] = 128;
    data[(10 * image.width + 7) * 4] = Number.NaN;
    const result = await analyzeWaveformRaster({ ...image, data }, options(image.width));
    expect(result.quietIntervals).toEqual([{ start: 10, end: 12 }, { start: 13, end: 15 }]);
    expect(result.unknownColumns).toBe(4);
    expect(result.levels.slice(5, 8)).toEqual([null, null, null]);
  });

  it("rounds inward to declared FPS and never extends the observed crop", async () => {
    const opt = options(3);
    opt.geometry.startSeconds = 0.03; opt.geometry.endSeconds = 1.07;
    opt.fps = 10; opt.minDurationSeconds = 0.1;
    const result = await analyzeWaveformRaster(raster([0, 0, 0]), opt);
    expect(result.quietIntervals).toEqual([{ start: 0.1, end: 1 }]);
    expect(result.candidatePositions).toEqual([0.6]);
  });

  it("does not classify an absent trace or pixels beyond the declared full scale as quiet", async () => {
    const opt = options(3); opt.geometry.fullScalePixels = 5;
    const result = await analyzeWaveformRaster(raster([null, 10, null]), opt);
    expect(result.knownColumns).toBe(0);
    expect(result.quietIntervals).toEqual([]);
    expect(result.candidatePositions).toEqual([]);
  });

  it("never suggests a boundary when a quiet interval has no interior frame", async () => {
    const opt = options(1);
    opt.geometry.startSeconds = 0; opt.geometry.endSeconds = 1 / 30;
    opt.minDurationSeconds = 1 / 30;
    const result = await analyzeWaveformRaster(raster([0]), opt);
    expect(result.quietIntervals).toEqual([{ start: 0, end: 1 / 30 }]);
    expect(result.candidatePositions).toEqual([]);
  });

  it("rejects absent FPS, invalid geometry/time/color overlap and resource limits", async () => {
    const image = raster([0, 0]);
    for (const opt of [
      { ...options(2), fps: Number.NaN },
      { ...options(2), geometry: { ...options(2).geometry, right: 3 } },
      { ...options(2), geometry: { ...options(2).geometry, startSeconds: -1 } },
      { ...options(2), colorTolerance: 100, foreground: [80, 80, 80] as const },
      { ...options(2), minDurationSeconds: 0 },
    ]) await expect(analyzeWaveformRaster(image, opt)).rejects.toThrow();
    await expect(analyzeWaveformRaster({ width: 4001, height: 1000, data: [] }, options(2))).rejects.toThrow("4 milhões");
  });

  it("cancels asynchronously and never reports a partial result as successful", async () => {
    const controller = new AbortController(), progress: number[] = [];
    await expect(analyzeWaveformRaster(raster(Array(300).fill(0)), { ...options(300), signal: controller.signal, onProgress: value => { progress.push(value); controller.abort(); } })).rejects.toThrow("cancelada");
    expect(progress).toEqual([0]);
  });

  it("fails safely for protected canvas without retrying or fabricating pixels", () => {
    let reads = 0;
    const canvas = { width: 20, height: 20, getContext: () => ({ getImageData: () => { reads++; throw new DOMException("Tainted", "SecurityError"); } }) } as unknown as HTMLCanvasElement;
    expect(() => readWaveformCanvas(canvas)).toThrow("Canvas protegido ou indisponível");
    expect(reads).toBe(1);
    expect(() => readWaveformCanvas({ width: 0, height: 0 } as HTMLCanvasElement)).toThrow("Canvas vazio");
  });
});
