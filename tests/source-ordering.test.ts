// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { filterVideos, lifetimeVph, outlierScore, sortVideos, summarizeVideos } from "../src/core/metrics";
import { describeResearchComparison, researchComparison, researchRows, selectResearchVideos, sortResearchVideos, viewsPerSubscriber, type ResearchSortCriterion } from "../src/core/research";
import { observedLifetimeVph } from "../src/core/observations";
import { filterAndSortCards, normalizeCardFilter } from "../src/content/youtube";
import type { VideoRecord } from "../src/shared/types";

const now = Date.parse("2026-11-03T12:00:00Z");
const video = (id: string, extra: Partial<VideoRecord> = {}): VideoRecord => ({ id, title: id, url: `https://www.youtube.com/watch?v=${id}`, channelId: "same", isShort: false, ...extra });
const local = [
  video("dom", { source: "youtube-dom", views: 100, subscribers: 10, durationSeconds: 100, publishedAt: "2026-11-03T11:00:00Z" }),
  video("public", { source: "public-page", views: 200, subscribers: 10, durationSeconds: 200, publishedAt: "2026-11-03T10:00:00Z" }),
  video("manual", { source: "user-provided", views: 300, subscribers: 10, durationSeconds: 300, publishedAt: "2026-11-03T09:00:00Z" }),
  video("unspecified", { views: 400, subscribers: 10, durationSeconds: 400, publishedAt: "2026-11-03T08:00:00Z" }),
];
const official = video("api", { source: "youtube-data-api", title: "AAA official", views: 1_000_000_000, subscribers: 1, durationSeconds: 1_000_000, publishedAt: "2026-11-03T11:59:59Z", isShort: true });
const mixed = [official, local[0], local[1], { ...official, id: "api-peer", views: 1, isShort: false }, local[2], local[3]];
const ids = (rows: readonly VideoRecord[]) => rows.map(row => row.id);

describe("official source isolation in generic metric entry points", () => {
  it("never derives VPH/outlier for an official target or lets official peers complete a reference", () => {
    expect(lifetimeVph(official, now)).toBeUndefined();
    expect(observedLifetimeVph(official, now)).toBeUndefined();
    expect(outlierScore(official, mixed)).toBeUndefined();
    expect(outlierScore(local[0], mixed)).toBe(outlierScore(local[0], local));
    expect(outlierScore(local[0], [local[0], local[1], local[2], { ...official, isShort: false }])).toBeUndefined();
    for (const row of local) {
      expect(lifetimeVph(row, now)).toBe(100);
      expect(observedLifetimeVph(row, now)).toBe(100);
    }
  });
  it("excludes official rows from summary counts, formats, totals, means and rates", () => {
    expect(summarizeVideos(mixed, now)).toEqual(summarizeVideos(local, now));
    expect(summarizeVideos(mixed, now)).toMatchObject({ count: 4, knownViews: 4, totalViews: 1000, meanViews: 250, medianViews: 250, medianVph: 100, shorts: 0 });
    expect(summarizeVideos([official], now)).toMatchObject({ count: 0, knownViews: 0, totalViews: 0, meanViews: undefined, medianViews: undefined, medianVph: undefined, shorts: 0 });
  });
  it("excludes official rows even with an empty/raw-only filter and keeps the eligible full baseline", () => {
    for (const filter of [{}, { minViews: 0 }, { query: "official" }, { minVph: 100 }, { minOutlier: 0.5, maxOutlier: 2 }]) {
      expect(filterVideos(mixed, filter, now)).toEqual(filterVideos(local, filter, now));
    }
    expect(filterVideos([official], {}, now)).toEqual([]);
    expect(filterVideos(mixed, { query: "dom", minOutlier: 0.3, maxOutlier: 0.4 }, now)).toEqual([local[0]]);
  });
  it.each(["title", "views", "recent", "duration", "subscribers", "vph", "outlier"] as const)("excludes official records before generic %s fallback sorting", by => {
    expect(sortVideos(mixed, by, now, mixed)).toEqual(sortVideos(local, by, now, local));
    expect(sortVideos([official], by, now)).toEqual([]);
    expect(mixed[0]).toBe(official);
  });
});

describe("mixed eligible origins preserve stable research ordering", () => {
  it("treats DOM, public, manual and unspecified origins equally and keeps identity/provenance intact", () => {
    const ordered = selectResearchVideos(mixed, { criteria: [{ key: "views", direction: "desc" }] }, now);
    expect(ids(ordered)).toEqual(["unspecified", "manual", "public", "dom"]);
    expect(ordered[0]).toBe(local[3]);
    expect(ordered[0].source).toBeUndefined();
    expect(ordered[1].source).toBe("user-provided");
    expect(researchRows(mixed, mixed, {}, now).map(row => row.source)).toEqual(["youtube-dom", "public-page", "user-provided", undefined]);
    expect(researchComparison(local[0], mixed)).toMatchObject({ reference: 300, referenceCount: 3 });
    expect(researchComparison(official, mixed)).toMatchObject({ referenceCount: 0, positiveReferenceCount: 0, method: "not-applicable", provenance: "excluded-api" });
    expect(researchComparison(official, mixed).score).toBeUndefined();
    expect(describeResearchComparison(researchComparison(official, mixed))).toContain("Nenhum método, referência ou métrica derivada foi aplicado");
    expect(describeResearchComparison(researchComparison(official, mixed))).not.toContain("Fonte: observações carregadas");
    expect(viewsPerSubscriber(official)).toBeUndefined();
  });
  it.each(["asc", "desc"] as const)("places unknown/invalid primary values last in %s order and applies secondary criteria before original index", direction => {
    const rows = [
      video("unknown-first", { source: "youtube-dom", subscribers: 5 }),
      video("ten-unknown", { source: "public-page", views: 10 }),
      video("ten-two", { source: "user-provided", views: 10, subscribers: 2 }),
      official,
      video("nan", { views: NaN, subscribers: 1 }),
      video("ten-two-tie", { views: 10, subscribers: 2 }),
      video("zero", { source: "youtube-dom", views: 0, subscribers: 8 }),
      video("negative", { source: "public-page", views: -1, subscribers: 3 }),
      video("ten-one", { views: 10, subscribers: 1 }),
      video("infinite", { source: "user-provided", views: Infinity }),
    ];
    const criteria: ResearchSortCriterion[] = [{ key: "views", direction }, { key: "subscribers", direction: "asc" }];
    const ten = ["ten-one", "ten-two", "ten-two-tie", "ten-unknown"];
    const known = direction === "asc" ? ["zero", ...ten] : [...ten, "zero"];
    expect(ids(sortResearchVideos(rows, { criteria }, now))).toEqual([...known, "nan", "negative", "unknown-first", "infinite"]);
    expect(rows[0].id).toBe("unknown-first");
    const filter = normalizeCardFilter({ criteria });
    const cards = rows.map(row => ({ element: document.createElement("article"), video: row }));
    expect(filterAndSortCards(cards, filter, undefined, now).map(card => card.video)).toEqual(selectResearchVideos(rows, filter, now));
  });
  it("uses secondary values for two unknown primary values and preserves exact ties in either direction", () => {
    const rows = [video("first", { source: "public-page", views: NaN }), official, video("last", { source: "youtube-dom" }), video("zero", { source: "user-provided", views: 0 }), video("second", { views: Infinity })];
    for (const direction of ["asc", "desc"] as const) {
      expect(ids(sortResearchVideos(rows, { criteria: [{ key: "views", direction }] }, now))).toEqual(["zero", "first", "last", "second"]);
      expect(ids(sortResearchVideos(rows, { criteria: [] }, now))).toEqual(["first", "last", "zero", "second"]);
    }
  });
  it("excludes official data before default, legacy, unknown-key fallback and ratio-priority ordering", () => {
    for (const filter of [{}, { sort: "default" }, { sort: "unrecognized" }, { sort: "views" }, { priority: "views-per-subscriber" as const, surface: "search" as const, criteria: [{ key: "views" as const, direction: "desc" as const }] }]) {
      expect(sortResearchVideos(mixed, filter, now, mixed)).toEqual(sortResearchVideos(local, filter, now, local));
    }
  });
  it("keeps invalid/future dates unknown under either direction instead of filling them from another origin", () => {
    const rows = [video("invalid", { source: "youtube-dom", publishedAt: "2026-02-30" }), video("future", { source: "public-page", publishedAt: "2026-11-04" }), video("known", { source: "user-provided", publishedAt: "2026-11-03" }), video("missing"), official];
    for (const direction of ["asc", "desc"] as const) expect(ids(sortResearchVideos(rows, { criteria: [{ key: "recent", direction }] }, now))).toEqual(["known", "invalid", "future", "missing"]);
  });
});
