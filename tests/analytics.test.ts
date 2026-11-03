import { describe, expect, it } from "vitest";
import { buildAnalyticsReport, deriveHistoryTrend, reportMarkdown, reportRows, type VideoSource } from "../src/core/analytics";
import { toCsv } from "../src/core/export";
import type { VideoRecord } from "../src/shared/types";

const now = Date.parse("2026-11-03T00:00:00Z");
const video = (id: string, extra: Partial<VideoRecord> & { source?: VideoSource; observedAt?: string } = {}): VideoRecord & { source?: VideoSource; observedAt?: string } => ({ id, title: id, url: `https://www.youtube.com/watch?v=${id}`, ...extra });

describe("local observation analytics", () => {
  it("keeps an empty sample unknown instead of inventing zero totals or cadence", () => {
    const report = buildAnalyticsReport([], { now });
    expect(report.scope).toMatchObject({ inputCount: 0, includedCount: 0, excludedApiCount: 0 });
    expect(report.coverage.views).toEqual({ known: 0, missing: 0 });
    expect(report.totals.knownViews).toBeUndefined();
    expect(report.totals.meanViews).toBeUndefined();
    expect(report.medianPublishGapDays).toBeUndefined();
    expect(report.publicationMonths).toEqual([]);
    expect(report.topVideos).toEqual([]);
  });
  it("distinguishes observed zero, missing fields and unknown video formats", () => {
    const report = buildAnalyticsReport([
      video("zero", { views: 0, durationSeconds: 0, isShort: false, publishedAt: "2026-11-01", source: "youtube-dom" }),
      video("missing"),
      video("invalid", { views: NaN, durationSeconds: -1 }),
      video("short", { views: 100, durationSeconds: 30, isShort: true, channel: "Canal", source: "user-provided" }),
    ], { now });
    expect(report.coverage).toEqual({ views: { known: 2, missing: 2 }, publicationDate: { known: 1, missing: 3 }, duration: { known: 2, missing: 2 }, channel: { known: 1, missing: 3 } });
    expect(report.totals).toMatchObject({ knownViews: 100, meanViews: 50, medianViews: 50, knownDurationSeconds: 30, meanLifetimeVph: 0 });
    expect(report.formats).toEqual({ short: 1, long: 1, unknown: 2 });
    expect(report.topVideos.map(row => row.id)).toEqual(["short", "zero", "missing", "invalid"]);
    expect(report.provenance.unspecified).toBe(2);
    expect(report.limitations.join(" ")).toContain("não declaram origem");
  });
  it("excludes explicitly marked official API data before every derived metric and grouping", () => {
    const report = buildAnalyticsReport([
      video("api", { source: "youtube-data-api", views: 999999, channel: "API only", isShort: true, publishedAt: "2026-10-01", durationSeconds: 50 }),
      video("local", { views: 10, source: "youtube-dom" }),
      video("unspecified", { views: 20 }),
    ], { now });
    expect(report.scope.excludedApiCount).toBe(1);
    expect(report.scope.includedCount).toBe(2);
    expect(report.totals.knownViews).toBe(30);
    expect(report.channels).toEqual([]);
    expect(report.publicationMonths).toEqual([]);
    expect(report.videos.map(row => row.id)).toEqual(["local", "unspecified"]);
    expect(report.provenance["youtube-data-api"]).toBe(0);
    expect(report.limitations.join(" ")).toContain("API oficial");
  });
  it("groups known channel IDs/handle aliases without combining unrelated channels with the same name", () => {
    const report = buildAnalyticsReport([
      video("a", { channelId: "UCAlpha", channelUrl: "https://www.youtube.com/@Alpha", channel: "Shared", views: 10 }),
      video("b", { channelUrl: "https://www.youtube.com/channel/UCAlpha", views: 20 }),
      video("c", { channelUrl: "https://www.youtube.com/@ALPHA/", views: 30 }),
      video("d", { channelId: "UCBeta", channel: "Shared", views: 100 }),
      video("e", { channel: "Shared", views: 1000 }),
      video("f", { channelId: "same", channelUrl: "https://www.youtube.com/channel/different", views: 5 }),
    ], { now });
    expect(report.channels.find(group => group.key === "id:UCAlpha")).toMatchObject({ videoCount: 3, totalViews: 60 });
    expect(report.channels.find(group => group.key === "id:UCBeta")).toMatchObject({ videoCount: 1, totalViews: 100 });
    expect(report.channels.find(group => group.key === "name:shared")).toMatchObject({ videoCount: 1, totalViews: 1000 });
    expect(report.coverage.channel).toEqual({ known: 5, missing: 1 });
  });
  it("deduplicates the same video before counting, filtering or forming an outlier reference", () => {
    const row = video("same", { views: 100, source: "youtube-dom" });
    const report = buildAnalyticsReport([row, row], { now });
    expect(report.scope).toMatchObject({ inputCount: 2, includedCount: 1, excludedDuplicateCount: 1 });
    expect(report.totals.knownViews).toBe(100);
    expect(report.coverage.views).toEqual({ known: 1, missing: 0 });
    expect(report.limitations.join(" ")).toContain("repetidos por ID");
    const target = video("target", { views: 1000, channelId: "same", isShort: false });
    const peer = video("peer", { views: 100, channelId: "same", isShort: false });
    expect(buildAnalyticsReport([target, peer, peer, peer], { now }).topVideos[0].outlierScore).toBeUndefined();
  });
  it("chooses the complete latest observed version without merging missing counters", () => {
    const latest = video("same", { views: 0, source: "user-provided", observedAt: "2026-11-02T00:00:00Z" });
    const earlier = video("same", { views: 100, durationSeconds: 60, source: "youtube-dom", observedAt: "2026-11-01T00:00:00Z" });
    const report = buildAnalyticsReport([latest, earlier], { now });
    expect(report.totals.knownViews).toBe(0);
    expect(report.totals.knownDurationSeconds).toBeUndefined();
    expect(report.provenance["user-provided"]).toBe(1);
    expect(report.provenance["youtube-dom"]).toBe(0);
    expect(report.limitations.join(" ")).toContain("conflitantes");
  });
  it("keeps the first whole record when duplicate timestamps are absent, future or tied", () => {
    const original = video("same", { views: 100 });
    expect(buildAnalyticsReport([original, video("same", { views: 900 })], { now }).totals.knownViews).toBe(100);
    expect(buildAnalyticsReport([original, video("same", { views: 900, observedAt: "2026-11-04T00:00:00Z" })], { now }).totals.knownViews).toBe(100);
    const at = "2026-11-01T00:00:00Z";
    expect(buildAnalyticsReport([video("same", { views: 100, observedAt: at }), video("same", { views: 900, observedAt: at })], { now }).totals.knownViews).toBe(100);
  });
  it("does not guess a unique channel ID when the same handle has conflicting ID evidence", () => {
    const report = buildAnalyticsReport([
      video("a", { channelId: "A", channelUrl: "https://www.youtube.com/@shared" }),
      video("b", { channelId: "B", channelUrl: "https://www.youtube.com/@shared" }),
      video("c", { channelUrl: "https://www.youtube.com/@shared" }),
    ], { now });
    expect(report.channels.map(group => group.key).sort()).toEqual(["handle:shared", "id:A", "id:B"]);
  });
  it("uses only real valid past publication dates for months and observed gap medians", () => {
    const report = buildAnalyticsReport([
      video("a", { publishedAt: "2026-10-01", views: 0, durationSeconds: 0 }),
      video("b", { publishedAt: "2026-10-01", views: 10 }),
      video("c", { publishedAt: "2026-10-03", views: 20, durationSeconds: 30 }),
      video("d", { publishedAt: "2026-10-07", views: 30 }),
      video("future", { publishedAt: "2026-11-04", views: 40 }),
      video("invalid", { publishedAt: "2026-02-31", views: 50 }),
      video("ambiguous", { publishedAt: "2026-10-01T12:00:00", views: 60 }),
    ], { now });
    expect(report.publicationMonths).toEqual([{ month: "2026-10", videoCount: 4, knownViews: 4, missingViews: 0, totalViews: 60, knownDurationCount: 2, missingDurationCount: 2, totalDurationSeconds: 30 }]);
    expect(report.medianPublishGapDays).toBe(3);
    expect(report.coverage.publicationDate).toEqual({ known: 4, missing: 3 });
    expect(report.videos.find(row => row.id === "future")?.lifetimeVph).toBeUndefined();
  });
  it("applies inclusive publication bounds and reports sample exclusions rather than period traffic", () => {
    const report = buildAnalyticsReport([
      video("a", { publishedAt: "2026-10-01T00:00:00Z", views: 10 }),
      video("b", { publishedAt: "2026-10-01T23:59:59.999Z", views: 20 }),
      video("c", { publishedAt: "2026-10-02", views: 30 }),
      video("missing", { views: 100 }),
    ], { now, publishedAfter: "2026-10-01", publishedBefore: "2026-10-01" });
    expect(report.scope).toMatchObject({ includedCount: 2, excludedByDateCount: 2 });
    expect(report.totals.knownViews).toBe(30);
    expect(report.limitations.join(" ")).toContain("não visualizações recebidas no período");
  });
  it("uses the entire eligible unfiltered baseline when full research filters restrict the report", () => {
    const target = video("target", { title: "keep", views: 1000, channelId: "same", isShort: false, publishedAt: "2026-11-01" });
    const report = buildAnalyticsReport([target, ...[100, 200, 300].map((views, index) => video(`peer-${index}`, { views, channelId: "same", isShort: false, publishedAt: "2026-10-01" })), video("api-peer", { views: 1, channelId: "same", isShort: false, source: "youtube-data-api" })], { now, filter: { query: "keep", minOutlier: 5, maxOutlier: 5, publishedAfter: "2026-11-01", minViews: 1000 } });
    expect(report.videos).toHaveLength(1);
    expect(report.topVideos[0].outlierScore).toBe(5);
    expect(report.scope).toMatchObject({ excludedApiCount: 1, excludedByFilterCount: 3, excludedByDateCount: 3 });
    expect(buildAnalyticsReport([target], { now, filter: { publishedAfter: "2026-11-02" }, publishedAfter: "2026-11-01" }).videos).toHaveLength(1);
  });
  it("requires valid now/ranges and preserves inputs and unknown finance provenance", () => {
    expect(() => buildAnalyticsReport([], { now: Infinity })).toThrow();
    expect(() => buildAnalyticsReport([], { now, publishedAfter: "2026-02-31" })).toThrow();
    expect(() => buildAnalyticsReport([], { now, publishedAfter: "2026-11-02", publishedBefore: "2026-11-01" })).toThrow();
    expect(() => buildAnalyticsReport([], { now, filter: { minViews: 2, maxViews: 1 } })).toThrow();
    const input = [video("a", { views: -1 })];
    const report = buildAnalyticsReport(input, { now });
    expect(input[0].views).toBe(-1);
    expect(report.totals.knownViews).toBeUndefined();
    expect(report).not.toHaveProperty("revenue");
    expect(report.limitations.join(" ")).toContain("não são estimados");
  });
  it("exports escaped Markdown and all included rows without treating missing values as zero", () => {
    const report = buildAnalyticsReport([video("a", { title: "=SUM(1)|[x]<script>\nnext", channel: "A|B" }), video("b", { views: 0 })], { now });
    expect(reportMarkdown(report)).toContain("\\|\\[x\\]\\<script\\> next");
    expect(reportMarkdown(report)).toContain("desconhecido");
    const rows = reportRows(report);
    expect(rows).toHaveLength(2);
    expect(rows[0].observed_views).toBeUndefined();
    expect(rows[1].observed_views).toBe(0);
    expect(toCsv(rows)).toContain("'=SUM(1)");
  });
  it("keeps every derived value finite or unknown even when finite input counters overflow sums or ratios", () => {
    const report = buildAnalyticsReport([video("large-a", { views: 1e308, durationSeconds: 1e308, channel: "large", publishedAt: "2026-01-01" }), video("large-b", { views: 1e308, durationSeconds: 1e308, channel: "large", publishedAt: "2026-01-01" })], { now });
    expect(report.totals.knownViews).toBeUndefined();
    expect(report.totals.knownDurationSeconds).toBeUndefined();
    expect(report.totals.meanViews).toBe(1e308);
    expect(report.totals.medianViews).toBe(1e308);
    expect(report.channels[0].medianViews).toBe(1e308);
    expect(report.limitations.join(" ")).toContain("intervalo numérico");
    const ratio = buildAnalyticsReport([video("large", { views: 1e308, channelId: "same", isShort: false }), ...[1, 2, 3].map(index => video(`tiny-${index}`, { views: 1e-308, channelId: "same", isShort: false }))], { now });
    expect(ratio.topVideos[0].outlierScore).toBeUndefined();
  });
});

describe("actual observation history trends", () => {
  it("keeps empty/single observations without fabricated deltas", () => {
    expect(deriveHistoryTrend([], now).changes).toEqual([]);
    expect(deriveHistoryTrend([{ videoId: "a", observedAt: "2026-11-01T00:00:00Z", views: 0 }], now).changes).toEqual([]);
  });
  it("uses the actual irregular elapsed interval and preserves negative revisions", () => {
    const result = deriveHistoryTrend([
      { videoId: "a", observedAt: "2026-11-01T02:00:00Z", views: 160, subscribers: 9 },
      { videoId: "a", observedAt: "2026-11-01T00:00:00Z", views: 100, subscribers: 10 },
      { videoId: "a", observedAt: "2026-11-01T08:00:00Z", views: 130, subscribers: 0 },
    ], now);
    expect(result.changes).toEqual([
      { videoId: "a", from: "2026-11-01T00:00:00.000Z", to: "2026-11-01T02:00:00.000Z", elapsedHours: 2, viewsDelta: 60, viewsPerHour: 30, subscribersDelta: -1, subscribersPerHour: -0.5 },
      { videoId: "a", from: "2026-11-01T02:00:00.000Z", to: "2026-11-01T08:00:00.000Z", elapsedHours: 6, viewsDelta: -30, viewsPerHour: -5, subscribersDelta: -9, subscribersPerHour: -1.5 },
    ]);
    expect(result.warnings.join(" ")).toContain("possível revisão");
    expect(result.observations).toHaveLength(3);
  });
  it("compares only actual known endpoints per metric without filling missing counters or dates", () => {
    const result = deriveHistoryTrend([
      { videoId: "a", observedAt: "2026-11-01T00:00:00Z", views: 0 },
      { videoId: "a", observedAt: "2026-11-01T01:00:00Z", subscribers: 5 },
      { videoId: "a", observedAt: "2026-11-01T04:00:00Z", views: 40, subscribers: 8 },
      { videoId: "another", observedAt: "2026-11-01T04:00:00Z", views: 500 },
    ], now);
    expect(result.changes).toHaveLength(2);
    expect(result.changes[0]).toMatchObject({ elapsedHours: 4, viewsDelta: 40, viewsPerHour: 10 });
    expect(result.changes[0].subscribersDelta).toBeUndefined();
    expect(result.changes[1]).toMatchObject({ elapsedHours: 3, subscribersDelta: 3, subscribersPerHour: 1 });
    expect(result.changes[1].viewsDelta).toBeUndefined();
    expect(result.observations[1].views).toBeUndefined();
  });
  it("does not choose an arbitrary counter from contradictory duplicate timestamps", () => {
    const result = deriveHistoryTrend([
      { videoId: "a", observedAt: "2026-11-01T00:00:00Z", views: 10 },
      { videoId: "a", observedAt: "2026-11-01T00:00:00Z", views: 20 },
      { videoId: "a", observedAt: "2026-11-01T01:00:00Z", views: 30 },
    ], now);
    expect(result.observations).toHaveLength(2);
    expect(result.observations[0].views).toBeUndefined();
    expect(result.changes).toEqual([]);
    expect(result.warnings.join(" ")).toContain("conflitantes");
  });
  it("excludes official API/future observations and leaves invalid counts unknown", () => {
    const result = deriveHistoryTrend([
      { videoId: "a", observedAt: "2026-11-01T00:00:00Z", views: 10, source: "youtube-data-api" },
      { videoId: "a", observedAt: "2026-11-04T00:00:00Z", views: 30 },
      { videoId: "a", observedAt: "2026-11-02T00:00:00Z", views: NaN, subscribers: -1 },
      { videoId: "a", observedAt: "invalid", views: 30 },
    ], now);
    expect(result.excludedApiCount).toBe(1);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].views).toBeUndefined();
    expect(result.changes).toEqual([]);
    expect(result.warnings.join(" ")).toContain("não foi convertido em zero");
  });
  it("does not invent midnight observation times from date-only history", () => {
    const result = deriveHistoryTrend([{ videoId: "a", observedAt: "2026-11-01", views: 10 }, { videoId: "a", observedAt: "2026-11-02", views: 30 }], now);
    expect(result.observations).toEqual([]);
    expect(result.changes).toEqual([]);
    expect(result.warnings.join(" ")).toContain("timestamp completo");
  });
  it("preserves a real delta while keeping an unrepresentable time rate unknown", () => {
    const result = deriveHistoryTrend([{ videoId: "a", observedAt: "2026-11-01T00:00:00.000Z", views: 0 }, { videoId: "a", observedAt: "2026-11-01T00:00:00.001Z", views: 1e308 }], now);
    expect(result.changes[0].viewsDelta).toBe(1e308);
    expect(result.changes[0].viewsPerHour).toBeUndefined();
    expect(result.warnings.join(" ")).toContain("precisão numérica");
  });
});
