// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { describeResearchComparison, researchComparison, researchMarkdown, researchRows, selectResearchVideos } from "../src/core/research";
import { toCsv } from "../src/core/export";
import { downloadBlob } from "../src/core/media";
import { createCollectionController } from "../src/content/collection";
import { mountResearchOverlay } from "../src/content/research-overlay";
import type { CardFilter } from "../src/content/youtube";
import type { VideoRecord } from "../src/shared/types";

vi.mock("../src/core/media", () => ({ downloadBlob: vi.fn() }));
const video = (id: string, views: number, extra: Partial<VideoRecord> = {}): VideoRecord => ({ id, title: id, url: `https://www.youtube.com/watch?v=${id}`, channelId: "channel", isShort: false, views, ...extra });
const target = video("target", 1000, { title: "keep" });
const peers = [100, 100, 1000].map((views, i) => video(`peer${i}`, views));
const blobText = (blob: Blob): Promise<string> => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob); });

describe("research comparison provenance", () => {
  it("exports the resolved mode and baseline metadata while keeping legacy fields", () => {
    const baseline = [target, ...peers, video("api", 1, { source: "youtube-data-api" })];
    const filter = { query: "keep", comparisonMode: "sample-channel-reference" as const, minOutlier: 2 };
    const selected = selectResearchVideos(baseline, filter);
    const row = researchRows(selected, baseline, filter)[0];
    expect(row).toMatchObject({ sampleOutlier: 2.5, outlierReference: 400, outlierReferenceCount: 3, outlierPositiveReferenceCount: 3, outlierMethod: "sample-channel-mean", outlierComparisonMode: "sample-channel-reference", outlierProvenance: "loaded-observations", outlierScope: "eligible-input-before-filters", outlierTargetExclusion: "same-video-id", outlierCountUnit: "observations", outlierReferenceStatus: "available", outlierScoreStatus: "available" });
    expect(toCsv([row])).toContain('"outlierReference"');
    const markdown = researchMarkdown(selected, baseline, filter);
    expect(markdown).toContain("sample-channel-reference");
    expect(markdown).toContain("| 2.5 | 400 | 3 | 3 | sample-channel-mean |");
    expect(markdown).toContain("outras observações repetidas podem ser contadas");
    expect(researchRows([target], baseline, {})[0]).toMatchObject({ sampleOutlier: 10, outlierComparisonMode: "sample-median" });
    expect(researchRows([target], [target, peers[0]], {})[0]).toMatchObject({ outlierReference: null, outlierReferenceStatus: "unknown", outlierScoreStatus: "unknown" });
    expect(researchRows([target], [target, ...peers.map(peer => ({ ...peer, views: 0 }))], {})[0]).toMatchObject({ outlierReference: 0, outlierReferenceStatus: "zero", outlierScoreStatus: "unknown" });
  });
  it("counts positive Shorts observations at the ten-positive threshold and excludes the target and API", () => {
    const short = video("short", 55, { isShort: true });
    const positive = [1, 2, 3, 4, 5, 6, 7, 8, 9, 1000].map((views, i) => video(`s${i}`, views, { isShort: true }));
    const zero = video("zero", 0, { isShort: true });
    const api = video("api", 1, { isShort: true, source: "youtube-data-api" });
    expect(researchComparison(short, [short, ...positive.slice(0, 9), zero, api], "sample-channel-reference")).toMatchObject({ reference: 4.5, referenceCount: 10, positiveReferenceCount: 9, method: "sample-channel-mean" });
    expect(researchComparison(short, [short, ...positive, zero, api], "sample-channel-reference")).toMatchObject({ reference: 5.5, referenceCount: 11, positiveReferenceCount: 10, method: "sample-shorts-median" });
    expect(researchComparison(short, [short, ...positive, positive[0]], "sample-channel-reference").referenceCount).toBe(11);
  });
  it("groups unknown formats only with unknown formats and describes that scope", () => {
    const unknown = video("unknown", 1000, { isShort: undefined });
    const baseline = [unknown, ...peers.map(peer => ({ ...peer, isShort: undefined })), video("known", 1)];
    const comparison = researchComparison(unknown, baseline);
    expect(comparison).toMatchObject({ reference: 100, referenceCount: 3, score: 10 });
    expect(describeResearchComparison(comparison)).toContain("formato desconhecido em ambos");
    expect(researchMarkdown([unknown], baseline, {})).toContain("formato desconhecido em ambos");
  });
});

describe("native research overlay", () => {
  beforeEach(() => { document.body.innerHTML = ""; vi.mocked(downloadBlob).mockClear(); });
  it("keeps the comparison mode on a preset and includes metadata in JSON, CSV and Markdown exports", async () => {
    const container = document.createElement("div"); document.body.append(container);
    let filter: CardFilter = { sort: "default", comparisonMode: "sample-channel-reference" };
    const overlay = mountResearchOverlay(container, { getVideos: () => [target, ...peers], getFilter: () => filter, setFilter: next => { filter = next; }, getUrl: () => "https://www.youtube.com/@channel", collector: createCollectionController(document) });
    const preset = container.querySelector<HTMLSelectElement>("#prevlev-research-preset")!;
    preset.value = "sample-outlier"; preset.dispatchEvent(new Event("change"));
    expect(filter.comparisonMode).toBe("sample-channel-reference");
    expect(container.querySelector("#prevlev-research-results article")).toBeNull();
    preset.value = "lifetime-vph"; preset.dispatchEvent(new Event("change"));
    expect(container.querySelector("#prevlev-research-results small")?.getAttribute("title")).toContain("referência: 400");
    for (const format of ["json", "csv", "md"]) container.querySelector<HTMLButtonElement>(`#prevlev-research-${format}`)!.click();
    const calls = vi.mocked(downloadBlob).mock.calls;
    const json = JSON.parse(await blobText(calls[0][0]));
    expect(json.videos[0]).toMatchObject({ id: "target" });
    expect(json.comparisons[0]).toMatchObject({ outlierComparisonMode: "sample-channel-reference", outlierReference: 400, outlierReferenceCount: 3 });
    expect(await blobText(calls[1][0])).toContain('"outlierPositiveReferenceCount"');
    expect(await blobText(calls[2][0])).toContain("sample-channel-reference");
    overlay.dispose();
  });
});
