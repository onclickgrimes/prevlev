import { describe, expect, it } from "vitest";
import { analyzePcm, MIDROLL_INTERVAL_PRESETS, planAdvancedMidrolls } from "../src/core/midroll";

describe("independent midroll planning", () => {
  it("covers interval presets, start, endpoints and the stated playhead", () => {
    expect(MIDROLL_INTERVAL_PRESETS).toEqual([10, 20, 30, 60, 120, 180, 240, 300, 600, 900, 1200]);
    expect(planAdvancedMidrolls({ mode: "custom", durationSeconds: 480, intervalSeconds: 120, startSeconds: 30, includeStart: true, includeEnd: true, includePlayhead: true, playheadSeconds: 175 })).toEqual([1, 30, 150, 175, 270, 390, 479]);
    expect(planAdvancedMidrolls({ mode: "quantity", durationSeconds: 600, quantity: 2 })).toEqual([200, 400]);
    expect(planAdvancedMidrolls({ mode: "auto", durationSeconds: 600 })).toEqual([150, 300, 450]);
  });
  it("rejects excess and invalid positions without silently truncating", () => {
    expect(() => planAdvancedMidrolls({ mode: "custom", durationSeconds: 600, intervalSeconds: 10 })).toThrow(/Mais de 50/);
    expect(() => planAdvancedMidrolls({ mode: "quantity", durationSeconds: 600, quantity: 51 })).toThrow();
    expect(() => planAdvancedMidrolls({ mode: "custom", durationSeconds: 600, intervalSeconds: 60, includePlayhead: true, playheadSeconds: 600 })).toThrow();
    expect(() => planAdvancedMidrolls({ mode: "smart", durationSeconds: 600, intervalSeconds: 180 })).toThrow(/PCM/);
  });
  it("keeps rounded end, playhead and snapped positions inside fractional duration", () => {
    expect(planAdvancedMidrolls({ mode: "smart", durationSeconds: 480.9, intervalSeconds: 470, startSeconds: 470, silences: [{ start: 479.7, end: 479.9 }], includeEnd: true, includePlayhead: true, playheadSeconds: 479.8 })).toEqual([479]);
  });
  it("snaps to measured silence and keeps interval where none is nearby", () => {
    expect(planAdvancedMidrolls({ mode: "smart", durationSeconds: 600, intervalSeconds: 180, silences: [{ start: 184, end: 186 }, { start: 30, end: 31 }] })).toEqual([185, 360, 540]);
  });
});

describe("local PCM analysis", () => {
  it("measures RMS across all channels at the specified FPS", async () => {
    const left = Float32Array.from([1, 1, 0, 0, 0, 0, 1, 1]);
    const right = Float32Array.from([1, 1, 0, 0, 0.5, 0.5, 1, 1]);
    const progress: number[] = [];
    const result = await analyzePcm([left, right], 4, { thresholdPercent: 10, minDurationSeconds: 0.5, fps: 2, onProgress: x => progress.push(x) });
    expect(result.silences).toEqual([{ start: 0.5, end: 1 }]);
    expect(result.waveform).toEqual([1, 0, 0.5, 1]);
    expect(progress.at(-1)).toBe(1);
  });
  it("honors thresholds, minimum duration, cancellation and bounds", async () => {
    const samples = new Float32Array(1000).fill(0.05);
    expect((await analyzePcm([samples], 100, { thresholdPercent: 5.1, minDurationSeconds: 1, fps: 10 })).silences).toEqual([{ start: 0, end: 10 }]);
    expect((await analyzePcm([samples], 100, { thresholdPercent: 1, minDurationSeconds: 1, fps: 10 })).silences).toEqual([]);
    const controller = new AbortController();
    const scanning = analyzePcm([samples], 100, { thresholdPercent: 1, minDurationSeconds: 1, fps: 10, signal: controller.signal, onProgress: () => controller.abort() });
    await expect(scanning).rejects.toMatchObject({ name: "AbortError" });
    await expect(analyzePcm([samples], 100, { thresholdPercent: 1, minDurationSeconds: 1, fps: 0 })).rejects.toThrow();
  });
});
