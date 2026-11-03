// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initAnalyticsTools } from "../src/ui/analytics";
import { downloadBlob } from "../src/core/media";
import type { PageSnapshot } from "../src/shared/types";
import type { ResearchFilter } from "../src/core/research";
vi.mock("../src/core/media", () => ({ downloadBlob: vi.fn() }));

let snapshot: PageSnapshot, filter: ResearchFilter;
const click = (id: string) => document.getElementById(`analytics-${id}`)!.click();
const button = (id: string) => document.getElementById(`analytics-${id}`) as HTMLButtonElement;
const result = () => document.getElementById("analytics-result")!;
const status = () => document.getElementById("analytics-status")!.textContent;
function setup(getSnapshot = () => snapshot, getFilter = () => filter) { return initAnalyticsTools({ snapshot: getSnapshot, filter: getFilter }); }
function filtered() { const source = document.getElementById("analytics-source") as HTMLSelectElement; source.value = "filtered"; source.dispatchEvent(new Event("change")); }
beforeEach(() => {
  vi.clearAllMocks(); document.body.innerHTML = '<section id="research"><input id="fixture-filter"></section><section id="analytics"></section>';
  snapshot = { url: "https://www.youtube.com/results?search_query=fixture", title: "Amostra original", videos: [{ id: "abcdefghijk", title: "Vídeo original", url: "https://www.youtube.com/watch?v=abcdefghijk", views: 100, source: "youtube-dom", observedAt: "2026-01-01T00:00:00Z" }], comments: [], transcript: [], warnings: [] };
  filter = { minViews: 0 };
});

describe("analytics collection and filter binding", () => {
  it("mounts once without calculating, and explicit invalidation preserves the source collection", () => {
    const controller = setup(), before = JSON.stringify(snapshot);
    expect(setup()).toBe(controller); expect(document.querySelectorAll("#analytics-refresh")).toHaveLength(1); expect(result().hidden).toBe(true);
    click("refresh"); expect(result().hidden).toBe(false); expect(button("export-json").disabled).toBe(false);
    controller.invalidate(); expect(result().hidden).toBe(true); expect(result().textContent).not.toContain("Vídeo original"); expect(button("export-json").disabled).toBe(true);
    expect(status()).toContain("coleção original foi preservada"); expect(JSON.stringify(snapshot)).toBe(before); expect(downloadBlob).not.toHaveBeenCalled();
  });
  it("refuses stale JSON/CSV/Markdown after a collection change even without a host invalidation event", () => {
    setup();
    for (const format of ["json", "csv", "markdown"]) {
      click("refresh"); snapshot.videos = snapshot.videos.map(video => ({ ...video, views: (video.views ?? 0) + 1 })); click(`export-${format}`);
      expect(downloadBlob).not.toHaveBeenCalled(); expect(result().hidden).toBe(true); expect(button("export-json").disabled).toBe(true);
    }
    expect(snapshot.videos[0].views).toBe(103);
  });
  it("binds provenance, warnings and context as well as counts", () => {
    setup();
    for (const mutate of [() => { snapshot.url = "https://www.youtube.com/@other/videos"; }, () => { snapshot.warnings.push("Nova coleta parcial"); }, () => { snapshot.videos[0].source = "youtube-data-api"; }, () => { snapshot.videos = []; }]) {
      click("refresh"); mutate(); click("export-json"); expect(result().hidden).toBe(true); expect(downloadBlob).not.toHaveBeenCalled();
    }
  });
  it("invalidates a filtered report immediately on research filter events and also catches changes without events", () => {
    setup(); filtered(); click("refresh"); filter = { minViews: 200 };
    document.getElementById("fixture-filter")!.dispatchEvent(new Event("input", { bubbles: true })); expect(result().hidden).toBe(true);
    filter = { minViews: 0 }; click("refresh"); filter = { maxViews: 1 }; click("export-json"); expect(result().hidden).toBe(true); expect(downloadBlob).not.toHaveBeenCalled();
  });
  it("keeps whole-collection reports independent of inactive research filters", () => {
    setup(); click("refresh"); filter = { minViews: 9999 };
    document.getElementById("fixture-filter")!.dispatchEvent(new Event("change", { bubbles: true })); expect(result().hidden).toBe(false);
    click("export-json"); expect(downloadBlob).toHaveBeenCalledOnce(); expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "prevlev-analytics.json");
  });
  it("drops a previous report on refresh failure and never exports it under invalid filters", () => {
    setup(); filtered(); click("refresh"); filter = { minViews: 200, maxViews: 100 }; const before = JSON.stringify(snapshot); click("refresh");
    expect(result().hidden).toBe(true); expect(button("export-json").disabled).toBe(true); expect(status()).toContain("mínimo não pode superar"); expect(JSON.stringify(snapshot)).toBe(before);
  });
  it("discards a calculation if the source changes between input capture and publication", () => {
    let reads = 0; const previous = structuredClone(snapshot), next = { ...snapshot, videos: [] };
    setup(() => ++reads === 1 ? previous : next); click("refresh");
    expect(result().hidden).toBe(true); expect(button("export-json").disabled).toBe(true); expect(status()).toContain("durante o cálculo"); expect(downloadBlob).not.toHaveBeenCalled();
  });
  it("checks context again before downloading and handles a failing source getter safely", () => {
    let reads = 0, phase = "stable"; const stable = structuredClone(snapshot);
    setup(() => { if (phase === "error") throw new Error("Fonte indisponível"); if (phase === "changing" && ++reads > 1) return { ...stable, videos: [] }; return stable; });
    click("refresh"); phase = "changing"; click("export-json"); expect(result().hidden).toBe(true); expect(downloadBlob).not.toHaveBeenCalled();
    phase = "stable"; click("refresh"); phase = "error"; click("export-json"); expect(result().hidden).toBe(true); expect(status()).toContain("Fonte indisponível"); expect(downloadBlob).not.toHaveBeenCalled();
  });
});
