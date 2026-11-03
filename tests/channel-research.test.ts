import { describe, expect, it, vi } from "vitest";
import {
  parseChannelVideos,
  readInitialData,
  researchChannel,
  sampleMonetization,
} from "../src/core/channel-research";

const channelUrl = "https://www.youtube.com/@canal-fixture";
const now = Date.parse("2026-11-03T12:00:00Z");
const ids = ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"];
function page() {
  return `<html><script>var ytInitialData = ${JSON.stringify({ metadata: { channelMetadataRenderer: { title: "Canal fixture" } }, header: { subscriberCountText: { simpleText: "12,3 mil inscritos" } }, contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: false, content: { videoRenderer: { videoId: "xxxxxxxxxxx", title: { simpleText: "Fora da aba" } } } } }, { tabRenderer: { selected: true, content: { richGridRenderer: { contents: [{ richItemRenderer: { content: { videoRenderer: { videoId: ids[0], title: { runs: [{ text: 'Título com } e "aspas"' }] }, viewCountText: { simpleText: "1.2K views" }, publishedTimeText: { simpleText: "1 day ago" }, lengthText: { simpleText: "12:34" } } } } }, { gridVideoRenderer: { videoId: ids[1], title: { simpleText: "Mais popular" }, viewCountText: { simpleText: "10 mil visualizações" }, publishedTimeText: { simpleText: "há 3 dias" }, thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { text: { simpleText: "2:01" } } }] } }, { lockupViewModel: { contentId: ids[2], contentType: "LOCKUP_CONTENT_TYPE_VIDEO", metadata: { lockupMetadataViewModel: { title: { content: "Vídeo moderno" }, metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: "3.5K views" } }, { text: { content: "2 days ago" } }] }] } } } }, contentImage: { thumbnailViewModel: { overlays: [{ thumbnailOverlayBadgeViewModel: { text: "8:03" } }] } } } }, { videoRenderer: { videoId: ids[0], title: { simpleText: "Duplicado" } } }, { videoRenderer: { videoId: "invalid", title: { simpleText: "ID inválido" } } }, { promotedVideoRenderer: { videoRenderer: { videoId: "zzzzzzzzzzz", title: { simpleText: "Publicidade" } } } }] } } } }] } } })};</script></html>`;
}

describe("coleta pública de canal sem executar scripts", () => {
  it("lê JSON balanceado com aspas e chaves literais sem avaliar JavaScript", () => {
    const value = { title: '} " quotation', nested: { ok: true } };
    expect(
      readInitialData(
        `window["ytInitialData"] = ${JSON.stringify(value)};dangerous();`,
      ),
    ).toEqual(value);
    expect(
      readInitialData(
        'ytInitialData = (() => { throw new Error("não executar") })();',
      ),
    ).toBeUndefined();
    expect(
      readInitialData(
        'var ytInitialData = {bad}; var ytInitialData = {"ok":true};',
      ),
    ).toEqual({ ok: true });
  });
  it("extrai renderers antigos e modernos, elimina duplicatas e limita a aba selecionada", () => {
    const result = parseChannelVideos(page(), channelUrl, now);
    expect(result).toMatchObject({
      channelName: "Canal fixture",
      subscribers: 12300,
      coverage: "initial-public-page",
    });
    expect(result.videos).toHaveLength(3);
    expect(result.recent.map((v) => v.id)).toEqual([ids[0], ids[2], ids[1]]);
    expect(result.popular.map((v) => v.id)).toEqual([ids[1], ids[2], ids[0]]);
    expect(result.videos.find((v) => v.id === ids[0])).toMatchObject({
      title: 'Título com } e "aspas"',
      views: 1200,
      publishedAt: "2026-11-02T12:00:00.000Z",
      durationSeconds: 754,
    });
    expect(result.videos.find((v) => v.id === ids[2])).toMatchObject({
      views: 3500,
      durationSeconds: 483,
      channelUrl,
    });
    expect(result.warnings.join(" ")).toContain("sem paginação");
  });
  it("mantém views ausentes desconhecidas e retorna limitação quando não há JSON", () => {
    const result = parseChannelVideos(
      "<html>Consentimento necessário</html>",
      channelUrl,
      now,
    );
    expect(result.videos).toEqual([]);
    expect(result.warnings.join(" ")).toContain("consentimento");
    const missing = parseChannelVideos(
      `var ytInitialData = ${JSON.stringify({ videoRenderer: { videoId: ids[0], title: { simpleText: "Título" } } })}`,
      channelUrl,
      now,
    );
    expect(missing.videos[0].views).toBeUndefined();
    expect(missing.videos[0].publishedAt).toBeUndefined();
  });
  it("valida URL antes da rede e busca somente /videos com sessão omitida", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(page(), { headers: { "Content-Type": "text/html" } }),
      );
    for (const url of [
      "https://evil.example/@a",
      "https://www.youtube.com/@ok?token=bad",
      "https://www.youtube.com/channel/not-UC",
      "https://www.youtube.com/@a/videos",
    ])
      await expect(researchChannel(url, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    const result = await researchChannel(channelUrl, fetcher, "popular");
    expect(result.videos[0].id).toBe(ids[1]);
    expect(fetcher).toHaveBeenCalledWith(
      `${channelUrl}/videos`,
      expect.objectContaining({
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it("recusa tamanho declarado, corpo grande, conteúdo não HTML e redirecionamento", async () => {
    const declared = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("x", {
          headers: {
            "Content-Length": String(4 * 1024 * 1024),
            "Content-Type": "text/html",
          },
        }),
      );
    await expect(researchChannel(channelUrl, declared)).rejects.toThrow(
      "3 MiB",
    );
    const stream = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("x".repeat(3 * 1024 * 1024 + 1), {
          headers: { "Content-Type": "text/html" },
        }),
      );
    await expect(researchChannel(channelUrl, stream)).rejects.toThrow("3 MiB");
    const json = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("{}", { headers: { "Content-Type": "application/json" } }),
      );
    await expect(researchChannel(channelUrl, json)).rejects.toThrow("HTML");
    const response = new Response("x");
    Object.defineProperty(response, "redirected", { value: true });
    const redirect = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(researchChannel(channelUrl, redirect)).rejects.toThrow(
      "Redirecionamento",
    );
  });
  it("mede limite em bytes UTF-8 na entrada do parser", () => {
    expect(() => readInitialData("á".repeat(2 * 1024 * 1024))).toThrow("3 MiB");
  });
});

describe("amostra anônima de marcadores de monetização", () => {
  it("consulta no máximo cinco IDs únicos e mantém inferência baixa sem veredito de canal", async () => {
    const videos = Array.from({ length: 7 }, (_, index) => ({
      id: `video${String(index).padStart(6, "0")}`,
    }));
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () =>
          new Response('{"adPlacements":[{"ad":true}]}', {
            headers: { "Content-Type": "text/html" },
          }),
      );
    const result = await sampleMonetization([videos[0], ...videos], fetcher);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(result.assessments).toHaveLength(5);
    expect(result.assessments[0]).toMatchObject({
      videoId: videos[0].id,
      status: "markers-present",
      confidence: "low",
      markers: ["adPlacements"],
      source: "public-youtube",
    });
    for (const [url, options] of fetcher.mock.calls) {
      expect(String(url)).toMatch(
        /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/,
      );
      expect(options).toMatchObject({ credentials: "omit", redirect: "error" });
    }
    expect(result.limitations.join(" ")).toContain("não confirmam");
  });
  it("ausência de marcadores e falha de página permanecem desconhecidas", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("<html>Sem marcador</html>", {
          headers: { "Content-Type": "text/html" },
        }),
      )
      .mockResolvedValueOnce(new Response("bad", { status: 403 }));
    const result = await sampleMonetization(
      ids.slice(0, 2).map((id) => ({ id })),
      fetcher,
      2,
    );
    expect(result.assessments.every((item) => item.status === "unknown")).toBe(
      true,
    );
    expect(result.assessments[0].error).toBeUndefined();
    expect(result.assessments[1].error).toContain("403");
  });
  it("rejeita IDs e limites inválidos sem buscar URLs do payload", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      sampleMonetization([{ id: "../../secret" }], fetcher),
    ).rejects.toThrow("IDs");
    await expect(
      sampleMonetization([{ id: ids[0] }], fetcher, 6),
    ).rejects.toThrow("1 e 5");
    await expect(sampleMonetization([], fetcher)).rejects.toThrow("1 a 2000");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
