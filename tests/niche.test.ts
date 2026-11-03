import { describe, expect, it } from "vitest";
import { buildNicheReport, DEFAULT_NICHE_THRESHOLDS, nicheMarkdown, nicheRows, type NichePreset } from "../src/core/niche";
import type { VideoRecord } from "../src/shared/types";

const now = Date.parse("2026-01-01T00:00:00Z");
const record = (id: string, fields: Partial<VideoRecord> = {}): VideoRecord => ({ id, title: id, url: `https://example.com/${id}`, source: "user-provided", ...fields });
const ago = (days: number) => new Date(now - days * 86400000).toISOString();

describe.each(["sample-median", "sample-channel-reference"] as const)("local niche explorer (%s)", comparisonMode => {
  it("excludes API before deduplication, reference, and channel metrics; retains unknowns", () => {
    const videos = [record("target", { channelId: "a", isShort: false, views: 500, subscribers: 0, publishedAt: ago(1) }), ...[100, 100, 100].map((views, i) => record(`p${i}`, { channelId: "a", isShort: false, views, subscribers: 10, publishedAt: ago(i + 2) })), record("api", { channelId: "a", isShort: false, views: 1000000, source: "youtube-data-api" }), record("target", { channelId: "a", views: 9 }), record("unknown", { views: -1, subscribers: NaN, publishedAt: "2026-02-30", durationSeconds: -5 })];
    const report = buildNicheReport(videos, { now, comparisonMode });
    expect(report.scope).toEqual({ input: 7, excludedApi: 1, duplicates: 1, eligible: 5, included: 5 });
    expect(report.videos[0].outlier).toBe(5);
    expect(report.videos[0].viewsPerSubscriber).toBeUndefined();
    expect(report.coverage.views).toEqual({ known: 4, unknown: 1 });
    expect(report.coverage.viewsPerSubscriber).toEqual({ known: 3, unknown: 2 });
    expect(report.distribution).toEqual({ atLeast2: 1, atLeast5: 1, known: 4, unknown: 1 });
    expect(buildNicheReport(videos, { now, comparisonMode, preset: "high-outlier" }).videos.map(video => video.id)).toEqual(["target"]);
    expect(buildNicheReport(videos, { now, comparisonMode, preset: "high-outlier", thresholds: { ...DEFAULT_NICHE_THRESHOLDS, outlier: 5.01 } }).videos).toEqual([]);
    expect(report.channels[0]).toMatchObject({ uploads30: 4, uploads90: 4, uploads365: 4, unknownDates: 0 });
    expect(report.channels[0].months).toEqual([{ month: "2025-12", count: 4 }]);
  });
  it("covers presets, boundaries, adjustable thresholds, and channel group completeness", () => {
    const sample = [record("a", { channelId: "a", views: 100000, subscribers: 10000, publishedAt: ago(7) }), record("b", { channelId: "b", views: 500000, subscribers: 10001, publishedAt: ago(90) }), record("c", { channelId: "c", views: 1000000, subscribers: 100000, publishedAt: ago(91) }), record("d", { channelId: "d", views: 999999, subscribers: 100001 }), record("e", { channelId: "e", views: 1000000, publishedAt: ago(1) }), record("missing", { channelId: "e" })];
    const ids = (preset: NichePreset) => buildNicheReport(sample, { now, comparisonMode, preset }).videos.map(v => v.id);
    expect(ids("all")).toHaveLength(6);
    expect(ids("viral-small")).toEqual(["a"]);
    expect(ids("medium")).toEqual(["b", "c"]);
    expect(ids("new")).toEqual(["a", "b", "e"]);
    expect(ids("recent")).toEqual(["a", "e"]);
    expect(ids("500k")).toEqual(["b", "c", "d", "e"]);
    expect(ids("1m")).toEqual(["c", "e"]);
    expect(ids("manyviews-fewvideos")).toEqual(["c"]);
    expect(buildNicheReport(sample, { now, comparisonMode, preset: "high-vph", thresholds: { ...DEFAULT_NICHE_THRESHOLDS, vph: 1000000 / 24 } }).videos.map(v => v.id)).toEqual(["e"]);
    expect(buildNicheReport(sample, { now, comparisonMode, preset: "viral-small", thresholds: { ...DEFAULT_NICHE_THRESHOLDS, viralViews: 100001 } }).videos).toEqual([]);
    expect(() => buildNicheReport(sample, { now, comparisonMode, thresholds: { ...DEFAULT_NICHE_THRESHOLDS, mediumSubs: 1 } })).toThrow();
  });
  it("includes exact time and duration boundaries and honors multichannel filters", () => {
    const durations = [0, 59, 60, 239, 240, 599, 600, 1199, 1200, 3599, 3600];
    const sample = durations.map((durationSeconds, i) => record(`v${i}`, { channelId: i % 2 ? "b" : "a", durationSeconds, publishedAt: ago([7, 30, 90, 365, 366][i % 5]) }));
    for (const [duration, count] of [["under1", 2], ["1to4", 2], ["4to10", 2], ["10to20", 2], ["20to60", 2], ["over60", 1]] as const) expect(buildNicheReport(sample, { now, comparisonMode, duration }).videos).toHaveLength(count);
    for (const [period, count] of [["week", 3], ["month", 5], ["3m", 7], ["year", 9]] as const) expect(buildNicheReport(sample, { now, comparisonMode, period }).videos).toHaveLength(count);
    expect(buildNicheReport(sample, { now, comparisonMode, channels: ["id:a", "id:b"] }).videos).toHaveLength(11);
    expect(buildNicheReport(sample, { now, comparisonMode, channels: ["id:a"] }).videos).toHaveLength(6);
  });
  it("exports coverage, safe markdown and filtered rows", () => {
    const report = buildNicheReport([record("x", { title: "A | <b>", views: 0, subscribers: 1 })], { now, comparisonMode });
    expect(nicheRows(report)[0].views_per_subscriber).toBe(0);
    expect(nicheMarkdown(report)).toContain("A \\| \\<b\\>");
    expect(nicheMarkdown(report)).toContain("viewsPerSubscriber: 1 conhecidos, 0 desconhecidos");
  });
});
