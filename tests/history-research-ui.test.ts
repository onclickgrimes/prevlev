// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initHistoryTools } from "../src/ui/history";
import { selectResearchVideos, type ResearchFilter } from "../src/core/research";
import { buildAnalyticsReport } from "../src/core/analytics";
import { callBackendOperation } from "../src/shared/backend";
import type { PageSnapshot, VideoRecord } from "../src/shared/types";

vi.mock("../src/shared/storage", () => ({ getSettings: vi.fn(async () => ({ backendUrl: "http://127.0.0.1:8787", backendToken: "synthetic-token", aiModel: "", aiStreaming: false, aiOrigin: "http://127.0.0.1:7814", hideShorts: false, showMetrics: false })) }));
vi.mock("../src/shared/backend", () => ({ callBackendOperation: vi.fn(async () => ({ status: "ok", source: "prevlev:history", data: { records: [], recorded: 0 } })) }));

beforeEach(() => { document.body.innerHTML = '<section id="history"></section>'; vi.clearAllMocks(); });
describe("advanced research selection shared by report and explicit history record", () => {
  it("uses all advanced filters and sorting before the 100-row cap while preserving observed metadata", async () => {
    const videos: VideoRecord[] = Array.from({ length: 360 }, (_, index) => ({ id: `video-${index}`, title: `Row ${index}`, url: `https://www.youtube.com/watch?v=${String(index).padStart(11, "a")}`, views: 1000 + index, subscribers: index % 2 ? 1 : 10000, publishedAt: "2001-01-01T00:00:00Z", observedAt: "2002-01-01T00:00:00Z", source: "youtube-dom", channelId: "same", isShort: index % 3 === 0 }));
    videos.push({ id: "official", title: "Official", url: "https://www.youtube.com/watch?v=abcdefghijk", views: 1, subscribers: 1, source: "youtube-data-api", publishedAt: "2001-01-01T00:00:00Z", channelId: "same", isShort: false });
    const filter: ResearchFilter = { surface: "search", subscribersBelow: 10000, publishedBeforeExclusive: "2002-01-01T00:00:00Z", hideShortsOnSearch: true, comparisonMode: "sample-channel-reference", minOutlier: 0, priority: "views-per-subscriber", criteria: [{ key: "views", direction: "asc" }, { key: "title", direction: "asc" }] };
    const snapshot: PageSnapshot = { url: "https://www.youtube.com/results?search_query=fixture", title: "Fixture", videos, comments: [], transcript: [], warnings: [] };
    const expected = selectResearchVideos(videos, filter);
    expect(expected.length).toBeGreaterThan(100);
    expect(buildAnalyticsReport(videos, { filter }).videos.map(row => row.id)).toEqual(expected.map(row => row.id));
    initHistoryTools({ snapshot: () => snapshot, filter: () => filter });
    expect(callBackendOperation).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>("#history-record")!.click();
    await vi.waitFor(() => expect(callBackendOperation).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(callBackendOperation).mock.calls[0][2] as { action: string; videos: Partial<VideoRecord>[] };
    expect(payload.action).toBe("record");
    expect(payload.videos.map(video => video.id)).toEqual(expected.slice(0, 100).map(video => video.id));
    expect(payload.videos.every(video => video.observedAt === "2002-01-01T00:00:00Z" && video.source === "youtube-dom")).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("youtube-data-api");
    await vi.waitFor(() => expect(document.querySelector("#history-status")?.textContent).toContain("inscritos estritamente abaixo"));
    expect(document.querySelector("#history-status")?.textContent).toContain("prioridade por views");
    expect(document.querySelector("#history-status")?.textContent).toContain("referência média da amostra");
  });
});
