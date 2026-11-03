// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.youtube.com/results?search_query=teste"}
import { beforeEach, describe, expect, it } from "vitest";
import {
  readVideoCards,
  readYouTubeSnapshot,
  readComments,
  readVisibleTranscript,
  filterAndSortCards,
  normalizeCardFilter,
} from "../src/content/youtube";

beforeEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  window.history.replaceState({}, "", "/results?search_query=teste");
});

describe("coleta de dados visíveis do YouTube", () => {
  it("lê cards clássicos sem duplicar renderers aninhados", () => {
    document.body.innerHTML = `<ytd-rich-item-renderer><ytd-video-renderer><a id="video-title" href="/watch?v=abcdefghijk" title="Tutorial real">Tutorial real</a><ytd-channel-name><a href="/channel/UC123">Meu canal</a></ytd-channel-name><div id="metadata-line"><span>1,2 mil visualizações</span><span>há 2 dias</span></div><ytd-thumbnail-overlay-time-status-renderer>12:34</ytd-thumbnail-overlay-time-status-renderer><img src="https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg"></ytd-video-renderer></ytd-rich-item-renderer>`;
    const cards = readVideoCards(document, new Date("2026-11-03T12:00:00Z"));
    expect(cards).toHaveLength(1);
    expect(cards[0].video).toMatchObject({
      id: "abcdefghijk",
      title: "Tutorial real",
      channel: "Meu canal",
      channelId: "UC123",
      channelUrl: "https://www.youtube.com/channel/UC123",
      views: 1200,
      durationSeconds: 754,
      isShort: false,
      publishedAt: "2026-11-01T12:00:00.000Z",
    });
    expect(cards[0].video.subscribers).toBeUndefined();
  });

  it("lê cards modernos e preserva métricas ausentes como indisponíveis", () => {
    document.body.innerHTML = `<yt-lockup-view-model><a class="yt-lockup-metadata-view-model__title" href="/watch?v=12345678901">Live agendada</a><span class="yt-content-metadata-view-model__metadata-text">Scheduled for tomorrow</span></yt-lockup-view-model><ytm-shorts-lockup-view-model><a href="/shorts/abcdefghijk">Short de exemplo</a><span class="inline-metadata-item">5K views</span></ytm-shorts-lockup-view-model>`;
    const cards = readVideoCards(document);
    expect(cards).toHaveLength(2);
    expect(cards[0].video.views).toBeUndefined();
    expect(cards[0].video.publishedAt).toBeUndefined();
    expect(cards[1].video).toMatchObject({ isShort: true, views: 5000 });
  });

  it("ignora cards sem ID de vídeo válido", () => {
    document.body.innerHTML =
      '<ytd-video-renderer><a id="video-title" href="/channel/UC123">Canal</a></ytd-video-renderer><ytd-video-renderer><a id="video-title" href="/watch?v=bad">Inválido</a></ytd-video-renderer><ytd-video-renderer><a id="video-title" href="https://[invalid-url">Inválido</a></ytd-video-renderer>';
    expect(readVideoCards(document)).toHaveLength(0);
  });

  it("preserva handles para enriquecimento público e rejeita links de canais externos", () => {
    document.body.innerHTML =
      '<ytd-video-renderer><a id="video-title" href="/watch?v=abcdefghijk">Exemplo</a><ytd-channel-name><a href="/@criador?utm_source=fixture">Criador</a></ytd-channel-name></ytd-video-renderer><ytd-video-renderer><a id="video-title" href="/watch?v=12345678901">Outro</a><ytd-channel-name><a href="https://evil.example/@criador">Externo</a></ytd-channel-name></ytd-video-renderer>';
    const cards = readVideoCards(document);
    expect(cards[0].video.channelUrl).toBe("https://www.youtube.com/@criador");
    expect(cards[1].video.channelUrl).toBeUndefined();
  });

  it("inclui vídeo atual e nunca completa views ausentes com números inventados", () => {
    window.history.replaceState({}, "", "/watch?v=abcdefghijk");
    document.body.innerHTML =
      '<ytd-watch-metadata><h1>Título do vídeo</h1></ytd-watch-metadata><ytd-video-owner-renderer><ytd-channel-name><a href="/@canal">Canal do vídeo</a></ytd-channel-name></ytd-video-owner-renderer>';
    document.head.innerHTML =
      '<meta itemprop="interactionCount" content="4521"><meta itemprop="datePublished" content="2026-11-01">';
    const snapshot = readYouTubeSnapshot(document);
    expect(snapshot.videoId).toBe("abcdefghijk");
    expect(snapshot.title).toBe("Título do vídeo");
    expect(snapshot.videos[0].views).toBe(4521);
    expect(snapshot.videos[0].channelUrl).toBe(
      "https://www.youtube.com/@canal",
    );
    expect(snapshot.warnings.join(" ")).toContain("Somente itens");
    expect(snapshot.transcript).toEqual([]);
  });

  it("lê apenas comentários carregados e evita duplicar o componente interno", () => {
    document.body.innerHTML = `<ytd-comment-thread-renderer data-comment-id="c1"><ytd-comment-view-model><span id="content-text">Como fazer isto?</span><a id="author-text">Alice</a><span id="vote-count-middle">1,2 mil</span><span id="more-replies">3 respostas</span><ytd-creator-heart-renderer><button aria-pressed="true"></button></ytd-creator-heart-renderer></ytd-comment-view-model></ytd-comment-thread-renderer>`;
    expect(readComments(document)).toEqual([
      {
        id: "c1",
        text: "Como fazer isto?",
        author: "Alice",
        likes: 1200,
        replies: 3,
        hearted: true,
      },
    ]);
  });

  it("lê a transcrição aberta com timestamps e duração final desconhecida", () => {
    document.body.innerHTML = `<ytd-transcript-segment-renderer><span class="segment-timestamp">0:00</span><span class="segment-text">Olá</span></ytd-transcript-segment-renderer><ytd-transcript-segment-renderer><span class="segment-timestamp">0:05</span><span class="segment-text">Mundo</span></ytd-transcript-segment-renderer>`;
    expect(readVisibleTranscript(document)).toEqual([
      { start: 0, duration: 5, text: "Olá" },
      { start: 5, duration: 0, text: "Mundo" },
    ]);
  });

  it("filtra título/canal, formato e views, e ordena apenas dados disponíveis", () => {
    document.body.innerHTML = `<ytd-video-renderer><a id="video-title" href="/watch?v=abcdefghijk">Análise</a><ytd-channel-name><a href="/@Canal">Canal azul</a></ytd-channel-name><div id="metadata-line"><span>100 views</span></div></ytd-video-renderer><ytd-reel-item-renderer><a href="/shorts/12345678901">Análise curta</a><span class="inline-metadata-item">500 views</span></ytd-reel-item-renderer>`;
    const cards = readVideoCards(document);
    const result = filterAndSortCards(
      cards,
      { query: "azul", minimumViews: 50, shorts: "exclude", sort: "views" },
      () => undefined,
    );
    expect(result.map((c) => c.video.id)).toEqual(["abcdefghijk"]);
    expect(
      filterAndSortCards(
        cards,
        { query: "", minimumViews: 0, shorts: "all", sort: "views" },
        () => undefined,
      ).map((c) => c.video.views),
    ).toEqual([500, 100]);
  });
  it("combina todos os limites usando o dataset completo para outlier e ordenação", () => {
    const rows = [
      ["ccccccccccc", "Vídeo C", 200, 120, 2000, "2026-10-27"],
      ["aaaaaaaaaaa", "Alfa destaque", 1000, 600, 1000, "2026-11-01"],
      ["ddddddddddd", "Vídeo D", 300, 300, 3000, "2026-10-31"],
      ["bbbbbbbbbbb", "Vídeo B", 100, 60, 500, "2026-11-02"],
    ] as const;
    document.body.innerHTML = rows
      .map(
        ([id, title, views, duration, subs, date]) =>
          `<ytd-video-renderer><a id="video-title" href="/watch?v=${id}">${title}</a><ytd-channel-name><a href="/@CanalAzul">Canal azul</a></ytd-channel-name><div id="metadata-line"><span>${views} views</span><span>${date}</span></div><span data-subscribers>${subs} inscritos</span><span data-duration>PT${duration}S</span></ytd-video-renderer>`,
      )
      .join("");
    const now = Date.parse("2026-11-03T12:00:00Z"),
      cards = readVideoCards(document, new Date(now));
    const full = normalizeCardFilter({
      query: "Alfa",
      channel: "@CanalAzul",
      minViews: 200,
      maxViews: 1500,
      minSubscribers: 800,
      maxSubscribers: 2500,
      minDurationSeconds: 120,
      maxDurationSeconds: 700,
      minVph: 10,
      maxVph: 30,
      minOutlier: 4,
      maxOutlier: 6,
      publishedAfter: "2026-10-31",
      publishedBefore: "2026-11-02",
      shorts: "exclude",
      sort: "outlier",
    });
    expect(
      filterAndSortCards(cards, full, undefined, now).map(
        (card) => card.video.id,
      ),
    ).toEqual(["aaaaaaaaaaa"]);
    expect(
      filterAndSortCards(
        cards,
        { minViews: 200, sort: "outlier" },
        undefined,
        now,
      ).map((card) => card.video.id),
    ).toEqual(["aaaaaaaaaaa", "ddddddddddd", "ccccccccccc"]);
    expect(
      filterAndSortCards(cards, { sort: "duration" }, undefined, now).map(
        (card) => card.video.durationSeconds,
      ),
    ).toEqual([600, 300, 120, 60]);
    expect(
      filterAndSortCards(cards, { sort: "subscribers" }, undefined, now).map(
        (card) => card.video.subscribers,
      ),
    ).toEqual([3000, 2000, 1000, 500]);
    expect(
      filterAndSortCards(cards, { sort: "recent" }, undefined, now).map(
        (card) => card.video.id,
      ),
    ).toEqual(["bbbbbbbbbbb", "aaaaaaaaaaa", "ddddddddddd", "ccccccccccc"]);
  });
  it("recusa limites e mensagens inválidas antes de alterar o filtro", () => {
    expect(() => normalizeCardFilter({ minViews: 200, maxViews: 100 })).toThrow(
      "mínimo",
    );
    expect(() => normalizeCardFilter({ minVph: Infinity })).toThrow("finitos");
    expect(() => normalizeCardFilter({ minSubscribers: "1" })).toThrow(
      "números",
    );
    expect(() =>
      normalizeCardFilter({
        publishedAfter: "2026-11-03",
        publishedBefore: "2026-11-01",
      }),
    ).toThrow();
    expect(() => normalizeCardFilter({ sort: "unsafe" })).toThrow("Ordenação");
    expect(normalizeCardFilter({ minimumViews: 20 })).toMatchObject({
      minViews: 20,
      sort: "default",
    });
  });
});
