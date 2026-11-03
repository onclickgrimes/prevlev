import { describe, expect, it } from "vitest";
import { buildNicheReport, nicheMarkdown, nicheRows, NICHE_EXPORT_COLUMNS } from "../src/core/niche";
import { toCsv } from "../src/core/export";
import type { VideoRecord } from "../src/shared/types";
import type { ResearchComparisonMode } from "../src/core/research";

const now = Date.parse("2026-11-03T12:00:00Z");
const video = (id: string, views: number, extra: Partial<VideoRecord> = {}): VideoRecord => ({ id, title: id, url: `https://www.youtube.com/watch?v=${id}`, channelId: "same", isShort: false, source: "user-provided", views, ...extra });
const target = video("target", 1000, { publishedAt: "2026-11-03", durationSeconds: 60 });
const peers = [video("dom", 100, { source: "youtube-dom", durationSeconds: 1000, publishedAt: "2020-01-01" }), video("public", 100, { source: "public-page" }), video("unspecified", 1000, { source: undefined })];
const baseline = [target, ...peers];

describe("niche comparison mode and complete eligible baseline", () => {
  it("uses the explicitly selected reference and changes the >=5 preset without falling back", () => {
    const median = buildNicheReport(baseline, { now, comparisonMode: "sample-median" });
    const mean = buildNicheReport(baseline, { now, comparisonMode: "sample-channel-reference" });
    expect(median.videos[0]).toMatchObject({ outlier: 10, outlierReference: 100, outlierMethod: "sample-median", outlierComparisonMode: "sample-median" });
    expect(mean.videos[0]).toMatchObject({ outlier: 2.5, outlierReference: 400, outlierMethod: "sample-channel-mean", outlierComparisonMode: "sample-channel-reference", outlierReferences: 3, outlierPositiveReferences: 3, outlierProvenance: "loaded-observations", outlierReferenceStatus: "available", outlierScoreStatus: "available" });
    expect(buildNicheReport(baseline, { now, preset: "high-outlier", comparisonMode: "sample-median" }).videos.some(row => row.id === "target")).toBe(true);
    expect(buildNicheReport(baseline, { now, preset: "high-outlier", comparisonMode: "sample-channel-reference" }).videos).toEqual([]);
    expect(buildNicheReport(baseline, { now }).options.comparisonMode).toBe("sample-median");
  });
  it.each(["sample-median", "sample-channel-reference"] as const)("computes %s against the deduplicated API-free baseline before period/duration/channel/preset filters", comparisonMode => {
    const input = [video("api-before", 1, { source: "youtube-data-api" }), ...baseline, video("api-after", 1_000_000_000, { source: "youtube-data-api" }), video("dom", 9999)];
    const report = buildNicheReport(input, { now, comparisonMode, period: "week", duration: "1to4", channels: ["id:same"] });
    expect(report.scope).toMatchObject({ excludedApi: 2, duplicates: 1, included: 1 });
    expect(report.videos[0]).toMatchObject({ id: "target", outlier: comparisonMode === "sample-median" ? 10 : 2.5, outlierReferences: 3, outlierScope: "eligible-input-before-filters", outlierTargetExclusion: "same-video-id" });
    expect(report.options.comparisonMode).toBe(comparisonMode);
    expect(report.videos.some(row => row.source === "youtube-data-api")).toBe(false);
    const unfiltered = buildNicheReport(input, { now, comparisonMode });
    expect(unfiltered.videos.map(row => row.source)).toEqual(["user-provided", "youtube-dom", "public-page", undefined]);
  });
  it("uses Shorts positive median at ten positives and the declared channel mean below that boundary", () => {
    const short = video("short", 55, { isShort: true, channelId: undefined, channelUrl: "https://www.youtube.com/@Known" });
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 1000].map((views, index) => video(`short-${index}`, views, { isShort: true, channelId: undefined, channelUrl: "https://www.youtube.com/@known" }));
    const options = { now, comparisonMode: "sample-channel-reference" as const };
    expect(buildNicheReport([short, ...ten], options).videos[0]).toMatchObject({ outlier: 10, outlierReference: 5.5, outlierMethod: "sample-shorts-median", outlierPositiveReferences: 10 });
    expect(buildNicheReport([short, ...ten.slice(0, 9)], options).videos[0]).toMatchObject({ outlier: 11, outlierReference: 5, outlierMethod: "sample-channel-mean", outlierPositiveReferences: 9 });
  });
  it("keeps no-channel, ambiguous identity and display-name collisions unknown in channel mode, with no median fallback", () => {
    const options = { now, comparisonMode: "sample-channel-reference" as const };
    for (const identity of [
      { channelId: undefined, channel: undefined },
      { channelId: undefined, channel: "Shared display name" },
      { channelId: "same", channelUrl: "https://www.youtube.com/channel/different" },
    ]) {
      const input = baseline.map(row => ({ ...row, ...identity }));
      const report = buildNicheReport(input, options);
      expect(report.videos[0]).toMatchObject({ outlierReference: null, outlierScoreStatus: "unknown", outlierReferenceStatus: "unknown", outlierReferences: 0, outlierPositiveReferences: 0 });
      expect(report.videos[0].outlier).toBeUndefined();
      expect(report.videos[0].outlierLimitation).toContain("nome isolado não basta");
      expect(report.distribution).toEqual({ atLeast2: 0, atLeast5: 0, known: 0, unknown: 4 });
    }
    const names = baseline.map(row => ({ ...row, channelId: undefined, channel: "Shared display name" }));
    expect(buildNicheReport(names, { now, comparisonMode: "sample-median" }).videos[0].outlier).toBe(10);
    expect(buildNicheReport(names, { ...options, preset: "high-outlier" }).videos).toEqual([]);
  });
  it("distinguishes a zero denominator from insufficient references and a known zero score", () => {
    const mode = { now, comparisonMode: "sample-channel-reference" as const };
    const zeroPeers = [1, 2, 3].map(id => video(`zero-${id}`, 0));
    expect(buildNicheReport([target, ...zeroPeers], mode).videos[0]).toMatchObject({ outlierReference: 0, outlierReferenceStatus: "zero", outlierScoreStatus: "unknown", outlierReferences: 3, outlierPositiveReferences: 0 });
    expect(buildNicheReport([target, peers[0]], mode).videos[0]).toMatchObject({ outlierReference: null, outlierReferenceStatus: "unknown", outlierScoreStatus: "unknown", outlierReferences: 1 });
    expect(buildNicheReport([video("zero-target", 0), ...peers], mode).videos[0]).toMatchObject({ outlier: 0, outlierReference: 400, outlierReferenceStatus: "available", outlierScoreStatus: "available" });
  });
  it("exports the actual mode, method, denominator, counts, provenance and explicit unknown statuses in all formats", () => {
    const report = buildNicheReport([...baseline, video("unknown", 10, { channelId: undefined })], { now, comparisonMode: "sample-channel-reference" });
    const rows = nicheRows(report), csv = toCsv(rows, [...NICHE_EXPORT_COLUMNS]), markdown = nicheMarkdown(report);
    expect(rows[0]).toMatchObject({ sample_outlier: 2.5, outlier_comparison_mode: "sample-channel-reference", outlier_method: "sample-channel-mean", outlier_reference: 400, outlier_references: 3, outlier_positive_references: 3, outlier_provenance: "loaded-observations", outlier_scope: "eligible-input-before-filters", outlier_target_exclusion: "same-video-id", outlier_count_unit: "observations" });
    expect(rows.at(-1)).toMatchObject({ sample_outlier: null, outlier_reference: null, outlier_reference_status: "unknown", outlier_score_status: "unknown" });
    const json = JSON.parse(JSON.stringify(report));
    expect(json.options.comparisonMode).toBe("sample-channel-reference");
    expect(json.videos.at(-1).outlierReference).toBeNull();
    expect(json.videos.at(-1).outlierScoreStatus).toBe("unknown");
    expect(csv).toContain('"outlier_reference_status"'); expect(csv).toContain('"sample-channel-reference"'); expect(csv).toContain('"unknown"');
    expect(markdown).toContain("sample-channel-mean | 400 | 3 | 3 | loaded-observations");
    expect(markdown).toContain("unknown / unknown"); expect(markdown).toContain("nome isolado não basta");
  });
  it("rejects an invalid mode instead of quietly selecting the default", () => {
    for (const mode of ["unknown", "", null, 0, false, {}, []]) expect(() => buildNicheReport(baseline, { now, comparisonMode: mode as ResearchComparisonMode })).toThrow("Modo de comparação");
  });
});
