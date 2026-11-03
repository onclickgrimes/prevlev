// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { researchSurface, researchPresets, researchPreset, selectResearchVideos, sortResearchVideos, researchComparison, viewsPerSubscriber, validateResearchFilter } from "../src/core/research";
import { normalizeCardFilter, filterAndSortCards, type VideoCard } from "../src/content/youtube";
import type { VideoRecord } from "../src/shared/types";
const now = Date.parse("2026-11-03T12:00:00Z");
const video = (id: string, extra: Partial<VideoRecord> = {}): VideoRecord => ({ id, title: id, url: `https://www.youtube.com/watch?v=${id}`, ...extra });

describe("contextual research presets", () => {
  it("detects the real public page surface without treating foreign hosts/watch pages as channels", () => {
    expect(researchSurface("https://www.youtube.com/results?search_query=x")).toBe("search");
    expect(researchSurface("https://www.youtube.com/feed/subscriptions")).toBe("subscriptions");
    expect(researchSurface("https://www.youtube.com/@canal/videos")).toBe("channel");
    expect(researchSurface("https://www.youtube.com/")).toBe("home");
    expect(researchSurface("https://evil.test/@canal")).toBe("other");
    expect(researchSurface("https://user:secret@www.youtube.com/@canal")).toBe("other");
    expect(researchSurface("https://www.youtube.com/watch?v=abcdefghijk")).toBe("other");
  });
  it("publishes exactly eleven own labels and restricts search-only/deep-dive shortcuts to their contexts", () => {
    expect(researchPresets("search", now)).toHaveLength(11);
    expect(researchPresets("search", now).every(preset => preset.available)).toBe(true);
    expect(researchPresets("home", now).filter(preset => !preset.available).map(preset => preset.id)).toEqual(["search-shorts", "deep-dives"]);
    expect(() => researchPreset("search-shorts", "channel", now)).toThrow();
    expect(researchPreset("deep-dives", "channel", now).filter).toMatchObject({ minDurationSeconds: 1200 });
    expect(researchPreset("deep-dives", "search", now).filter).toMatchObject({ shorts: "exclude" });
  });
  it("uses exact rolling UTC windows and exclusive old-video bounds instead of rounding to full days", () => {
    const day = researchPreset("day-views", "search", now).filter;
    expect(day.publishedAfter).toBe("2026-11-02T12:00:00.000Z");
    expect(selectResearchVideos([video("before", { views: 100, publishedAt: "2026-11-02T11:59:59.999Z" }), video("boundary", { views: 10, publishedAt: "2026-11-02T12:00:00Z" })], day, now).map(video => video.id)).toEqual(["boundary"]);
    const old = researchPreset("evergreen-vph", "channel", now).filter;
    const boundary = old.publishedBeforeExclusive!;
    expect(selectResearchVideos([video("equal", { views: 10, publishedAt: boundary }), video("older", { views: 10, publishedAt: new Date(Date.parse(boundary) - 1).toISOString() })], old, now).map(video => video.id)).toEqual(["older"]);
  });
  it("enforces exact subscriber thresholds and known metadata without converting missing counts into zero", () => {
    const small = researchPreset("small-channel-50k", "search", now).filter;
    const rows = [video("under", { views: 50000, subscribers: 9999 }), video("equal", { views: 50000, subscribers: 10000 }), video("unknown", { views: 50000 })];
    expect(selectResearchVideos(rows, small, now).map(video => video.id)).toEqual(["under"]);
    const growing = researchPreset("growing-channel", "channel", now).filter;
    expect(selectResearchVideos([video("min", { views: 100000, subscribers: 10000 }), video("max", { views: 100000, subscribers: 100000 }), video("above", { views: 100000, subscribers: 100001 })], growing, now).map(video => video.id)).toEqual(["min", "max"]);
    expect(researchPreset("sample-outlier", "channel", now).filter.subscribersBelow).toBeUndefined();
    expect(researchPreset("sample-outlier", "home", now).filter.subscribersBelow).toBe(50000);
  });
  it("keeps Shorts hiding separate for feeds and search and applies it only in the selected surface", () => {
    const rows = [video("short", { isShort: true }), video("long", { isShort: false })];
    expect(selectResearchVideos(rows, { surface: "home", hideShortsOnFeed: true }).map(video => video.id)).toEqual(["long"]);
    expect(selectResearchVideos(rows, { surface: "search", hideShortsOnFeed: true }).map(video => video.id)).toEqual(["short", "long"]);
    expect(selectResearchVideos(rows, { surface: "search", hideShortsOnSearch: true }).map(video => video.id)).toEqual(["long"]);
    expect(selectResearchVideos(rows, { surface: "channel", hideShortsOnFeed: true, hideShortsOnSearch: true }).map(video => video.id)).toEqual(["short", "long"]);
  });
});

describe("two explicit sort criteria and ratio priority", () => {
  it("applies lexicographic direction, stable ties and unknown-last semantics in both directions", () => {
    const rows = [video("a", { views: 100, subscribers: 5 }), video("b", { views: 100, subscribers: 2 }), video("c", { views: 100 }), video("d", { views: 10, subscribers: 1 }), video("unknown", { subscribers: 0 }), video("tie", { views: 100, subscribers: 2 })];
    expect(sortResearchVideos(rows, { criteria: [{ key: "views", direction: "desc" }, { key: "subscribers", direction: "asc" }] }).map(video => video.id)).toEqual(["b", "tie", "a", "c", "d", "unknown"]);
    expect(sortResearchVideos(rows, { criteria: [{ key: "views", direction: "asc" }] }).map(video => video.id)).toEqual(["d", "a", "b", "c", "tie", "unknown"]);
    expect(rows[0].id).toBe("a");
  });
  it("prioritizes actual views/subscriber ratios only with known positive denominators outside channels", () => {
    const rows = [video("large", { views: 1000, subscribers: 1000 }), video("small", { views: 100, subscribers: 10 }), video("zero-views", { views: 0, subscribers: 10 }), video("zero-subs", { views: 2000, subscribers: 0 }), video("unknown", { views: 3000 })];
    expect(selectResearchVideos(rows, { surface: "search", priority: "views-per-subscriber", criteria: [{ key: "views", direction: "desc" }] }).map(video => video.id)).toEqual(["small", "large", "zero-views", "unknown", "zero-subs"]);
    expect(viewsPerSubscriber(rows[2])).toBe(0); expect(viewsPerSubscriber(rows[3])).toBeUndefined();
    expect(() => validateResearchFilter({ surface: "channel", priority: "views-per-subscriber" })).toThrow();
  });
  it("rejects malformed message criteria and preserves legacy single-sort compatibility", () => {
    for (const criteria of [[{ key: "views", direction: "sideways" }], [{ key: "unknown", direction: "asc" }], [{ key: "views", direction: "asc" }, { key: "views", direction: "desc" }], [{ key: "views", direction: "asc" }, { key: "title", direction: "asc" }, { key: "vph", direction: "asc" }]]) expect(() => normalizeCardFilter({ criteria })).toThrow();
    expect(sortResearchVideos([video("b", { views: 2 }), video("a", { views: 1 })], { sort: "views" }).map(video => video.id)).toEqual(["b", "a"]);
    expect(() => normalizeCardFilter({ hideShortsOnFeed: "yes" })).toThrow();
    expect(() => normalizeCardFilter({ subscribersBelow: 0 })).toThrow();
  });
  it("keeps workspace-style and native card ordering identical for combined filters and multiple sorting", () => {
    const rows = [video("a", { views: 100, subscribers: 5 }), video("b", { views: 100, subscribers: 2 }), video("c", { views: 20, subscribers: 2 })];
    const cards: VideoCard[] = rows.map(video => ({ element: document.createElement("article"), video }));
    const filter = normalizeCardFilter({ minViews: 50, criteria: [{ key: "views", direction: "desc" }, { key: "subscribers", direction: "asc" }], priority: "none" });
    expect(filterAndSortCards(cards, filter).map(card => card.video.id)).toEqual(selectResearchVideos(rows, filter).map(video => video.id));
  });
});

describe("explicit sample comparison modes and provenance", () => {
  const target = video("target", { title: "keep", channelId: "same", views: 1000, isShort: false });
  const peers = [100, 100, 1000].map((views, index) => video(`peer-${index}`, { views, channelId: "same", isShort: false }));
  it("preserves the default median/minimum-three score and full unfiltered baseline", () => {
    expect(researchComparison(target, peers).score).toBe(10);
    expect(selectResearchVideos([target, ...peers], { query: "keep", minOutlier: 10, criteria: [{ key: "outlier", direction: "desc" }] }, now)).toEqual([target]);
    expect(researchComparison(target, peers.slice(0, 2)).score).toBeUndefined();
  });
  it("offers a separately labeled sample channel reference without claiming the complete channel average", () => {
    const comparison = researchComparison(target, peers, "sample-channel-reference");
    expect(comparison).toMatchObject({ score: 2.5, reference: 400, referenceCount: 3, method: "sample-channel-mean", provenance: "loaded-observations" });
    expect(comparison.limitation).toContain("não equivale");
    expect(selectResearchVideos([target, ...peers], { query: "keep", minOutlier: 5, comparisonMode: "sample-channel-reference" }, now)).toEqual([]);
    expect(researchComparison(video("no-channel", { views: 1000, isShort: false }), peers, "sample-channel-reference").score).toBeUndefined();
  });
  it("uses Shorts median only with at least ten positive comparable references, otherwise the sample mean", () => {
    const short = video("short", { views: 55, channelUrl: "https://www.youtube.com/@same", isShort: true });
    const shortPeers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 1000].map((views, index) => video(`short-${index}`, { views, channelUrl: "https://www.youtube.com/@SAME", isShort: true }));
    expect(researchComparison(short, shortPeers, "sample-channel-reference")).toMatchObject({ score: 10, reference: 5.5, method: "sample-shorts-median", positiveReferenceCount: 10 });
    expect(researchComparison(short, shortPeers.slice(0, 9), "sample-channel-reference")).toMatchObject({ score: 11, reference: 5, method: "sample-channel-mean" });
  });
  it("excludes official API records before sorting, scoring, ratios and reference counts", () => {
    const api = video("api", { source: "youtube-data-api", views: 1, subscribers: 1, channelId: "same", isShort: false });
    expect(selectResearchVideos([target, api], { criteria: [{ key: "views", direction: "asc" }] })).toEqual([target]);
    expect(researchComparison(target, [peers[0], peers[1], api]).score).toBeUndefined();
    expect(researchComparison(api, peers).score).toBeUndefined();
    expect(viewsPerSubscriber(api)).toBeUndefined();
  });
});
