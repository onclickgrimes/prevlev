// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  filterComments,
  filterVideos,
  inferMonetization,
  lifetimeVph,
  median,
  netProfit,
  outlierScore,
  sortVideos,
  summarizeVideos,
  validateVideoFilter,
} from "../src/core/metrics";
import {
  parseCount,
  parseDuration,
  parsePublishedAt,
  videoIdFromUrl,
} from "../src/core/parse";
import {
  parseTranscript,
  transcriptMarkdown,
  transcriptText,
  transcriptVtt,
} from "../src/core/transcript";
import { detectSilences, planMidrolls } from "../src/core/midroll";
import { toCsv } from "../src/core/export";
import type { VideoRecord } from "../src/shared/types";

const now = Date.parse("2026-11-03T00:00:00Z");
const video = (
  id: string,
  views?: number,
  extra: Partial<VideoRecord> = {},
): VideoRecord => ({
  id,
  title: id,
  url: `https://www.youtube.com/watch?v=${id}`,
  views,
  isShort: false,
  ...extra,
});

describe("visible YouTube parsers", () => {
  it.each([
    ["1,2 mil inscritos", 1200],
    ["1.2K views", 1200],
    ["2,5 milhões de visualizações", 2500000],
    ["1 milhão", 1000000],
    ["1.234.567 visualizações", 1234567],
    ["1,234,567 views", 1234567],
    ["1.3B", 1300000000],
    ["0 views", 0],
    ["No views", undefined],
    ["Inscritos ocultos", undefined],
  ])("parses %s", (text, expected) => expect(parseCount(text)).toBe(expected));
  it("parses valid durations and rejects live labels/malformed times", () => {
    expect(parseDuration("1:02:03")).toBe(3723);
    expect(parseDuration("PT2M5S")).toBe(125);
    expect(parseDuration("1:99")).toBeUndefined();
    expect(parseDuration("AO VIVO")).toBeUndefined();
  });
  it("derives explicitly approximate publication dates from ages", () => {
    expect(parsePublishedAt("há 2 horas", now)).toBe(
      "2026-11-02T22:00:00.000Z",
    );
    expect(parsePublishedAt("3 days ago", now)).toBe(
      "2026-10-31T00:00:00.000Z",
    );
    expect(parsePublishedAt("2 meses atrás", now)).toBeDefined();
    expect(parsePublishedAt("2026-10-01")).toBe("2026-10-01T00:00:00.000Z");
    expect(parsePublishedAt("97")).toBeUndefined();
  });
  it("extracts IDs only from recognized YouTube hosts", () => {
    expect(videoIdFromUrl("/watch?v=abcdefghijk")).toBe("abcdefghijk");
    expect(videoIdFromUrl("https://youtu.be/abcdefghijk?t=2")).toBe(
      "abcdefghijk",
    );
    expect(videoIdFromUrl("https://www.youtube.com/shorts/abcdefghijk")).toBe(
      "abcdefghijk",
    );
    expect(
      videoIdFromUrl("https://youtube.com.evil.test/watch?v=abcdefghijk"),
    ).toBeUndefined();
    expect(videoIdFromUrl("/watch?v=x")).toBeUndefined();
  });
});

describe("honest local metrics", () => {
  it("calculates a lifetime VPH and keeps missing/future dates unknown", () => {
    expect(
      lifetimeVph(
        video("a", 100, { publishedAt: "2026-11-02T20:00:00Z" }),
        now,
      ),
    ).toBe(25);
    expect(lifetimeVph(video("a", 100), now)).toBeUndefined();
    expect(
      lifetimeVph(video("a", 100, { publishedAt: "2026-11-04" }), now),
    ).toBeUndefined();
    expect(
      lifetimeVph(video("a", NaN, { publishedAt: "2026-11-02" }), now),
    ).toBeUndefined();
  });
  it("uses the peer median without counting the target or another channel", () => {
    const target = video("a", 1000, { channelId: "same" });
    const baseline = [
      target,
      video("b", 100, { channelId: "same" }),
      video("c", 200, { channelId: "same" }),
      video("d", 300, { channelId: "same" }),
      video("e", 100000, { channelId: "another" }),
    ];
    expect(outlierScore(target, baseline)).toBe(5);
    expect(outlierScore(target, baseline.slice(0, 3))).toBeUndefined();
    expect(
      outlierScore(target, [video("b", 0), video("c", 0), video("d", 0)]),
    ).toBeUndefined();
  });
  it("never changes an input array and reports known coverage", () => {
    const list = [
      video("unknown"),
      video("b", 2),
      video("c", 100),
      video("a", 1),
    ];
    expect(sortVideos(list, "views").map((item) => item.id)).toEqual([
      "c",
      "b",
      "a",
      "unknown",
    ]);
    expect(list[0].id).toBe("unknown");
    expect(summarizeVideos(list)).toMatchObject({
      count: 4,
      knownViews: 3,
      totalViews: 103,
      medianViews: 2,
      coverage: "loaded-videos",
    });
    expect(median([NaN, 4, 2])).toBe(3);
  });
  it("keeps different handles and unknown-channel peers out of a known handle baseline", () => {
    const target = video("target", 1000, {
      channel: "Shared display name",
      channelUrl: "https://www.youtube.com/@CanalAzul",
    });
    const same = [100, 200, 300].map((views, index) =>
      video(`same-${index}`, views, {
        channelUrl: "https://www.youtube.com/@canalazul/",
      }),
    );
    const different = [1, 1, 1].map((views, index) =>
      video(`other-${index}`, views, {
        channel: "Shared display name",
        channelUrl: "https://www.youtube.com/@OutroCanal",
      }),
    );
    const unknown = [1, 1, 1].map((views, index) =>
      video(`unknown-${index}`, views),
    );
    expect(
      outlierScore(target, [target, ...same, ...different, ...unknown]),
    ).toBe(5);
    expect(
      outlierScore(target, [...same.slice(0, 2), ...different, ...unknown]),
    ).toBeUndefined();
  });
  it("matches channel URL IDs with explicit IDs while keeping case-sensitive IDs distinct", () => {
    const target = video("target", 1000, { channelId: "UCAbc123" });
    const peers = [100, 200, 300].map((views, index) =>
      video(`same-${index}`, views, {
        channelUrl: "https://www.youtube.com/channel/UCAbc123",
      }),
    );
    const different = [1, 1, 1].map((views, index) =>
      video(`other-${index}`, views, { channelId: "UCabc123" }),
    );
    expect(outlierScore(target, [...peers, ...different])).toBe(5);
    expect(
      outlierScore(
        video("url-target", 1000, {
          channelUrl: "https://www.youtube.com/channel/UCAbc123",
        }),
        peers.map((item) => ({
          ...item,
          channelUrl: undefined,
          channelId: "UCAbc123",
        })),
      ),
    ).toBe(5);
  });
  it("uses names only for two name-only identities and retains the documented identity-free fallback", () => {
    const target = video("target", 1000, { channel: "Música Azul" });
    const named = [100, 200, 300].map((views, index) =>
      video(`named-${index}`, views, { channel: "  musica AZUL  " }),
    );
    const linked = [1, 1, 1].map((views, index) =>
      video(`linked-${index}`, views, {
        channel: "Música Azul",
        channelUrl: "https://www.youtube.com/@outro",
      }),
    );
    expect(
      outlierScore(target, [...named, ...linked, video("unknown", 1)]),
    ).toBe(5);
    expect(
      outlierScore(target, [...named.slice(0, 2), ...linked]),
    ).toBeUndefined();
    expect(
      outlierScore(video("identity-free", 1000), [
        video("a", 100, { channelId: "a" }),
        video("b", 200, { channelUrl: "https://www.youtube.com/@b" }),
        video("c", 300),
      ]),
    ).toBe(5);
  });
  it("uses definitive matching IDs over renamed handles and rejects contradictory ID metadata", () => {
    const target = video("target", 1000, {
      channelId: "same",
      channelUrl: "https://www.youtube.com/@newhandle",
    });
    const renamed = [100, 200, 300].map((views, index) =>
      video(`same-${index}`, views, {
        channelId: "same",
        channelUrl: "https://www.youtube.com/@oldhandle",
      }),
    );
    expect(outlierScore(target, renamed)).toBe(5);
    const conflict = video("conflict", 1000, {
      channelId: "same",
      channelUrl: "https://www.youtube.com/channel/different",
    });
    expect(outlierScore(conflict, renamed)).toBeUndefined();
  });
  it("filters missing metrics as unknown and folds accents in search", () => {
    const list = [
      video("a", 100, { title: "Criação", subscribers: 20 }),
      video("b", 100, { title: "Criacao" }),
      video("c", 500, { title: "Outro", subscribers: 100 }),
    ];
    expect(
      filterVideos(list, { query: "criacao", minSubscribers: 10 }).map(
        (item) => item.id,
      ),
    ).toEqual(["a"]);
    expect(filterVideos(list, { minVph: 1 })).toEqual([]);
  });
  it("calculates cost, profit and validates input", () => {
    expect(netProfit(1000, 30, 10)).toEqual({
      revenue: 1000,
      cost: 300,
      profit: 700,
      margin: 70,
    });
    expect(netProfit(0, 30, 1).margin).toBeUndefined();
    expect(() => netProfit(1000, 1, 0.5)).toThrow();
    expect(() => netProfit(1000, -1, 1)).toThrow();
  });
  it("filters comment rules without interpreting text as HTML", () => {
    const comments = [
      {
        id: "a",
        text: "<b>Como criar?</b>",
        author: "João",
        likes: 10,
        replies: 2,
      },
      { id: "b", text: "ótimo vídeo", author: "Ana", likes: 1, replies: 0 },
    ];
    expect(
      filterComments(comments, {
        questionsOnly: true,
        author: "joao",
        minLikes: 5,
      }),
    ).toEqual([comments[0]]);
  });
  it("does not claim confirmed monetization from ad markers or their absence", () => {
    expect(inferMonetization('{"adPlacements":[{"ad":true}]}')).toMatchObject({
      status: "markers-present",
      confidence: "low",
      markers: ["adPlacements"],
    });
    expect(inferMonetization('{"adPlacements":[]}').status).toBe("unknown");
    expect(inferMonetization("adPlacements").status).toBe("unknown");
  });
});

describe("complete video filters and stable ordering", () => {
  it("treats zero as an active inclusive threshold and excludes missing or invalid metrics", () => {
    const list = [
      video("zero", 0, { durationSeconds: 0, subscribers: 0 }),
      video("unknown"),
      video("invalid", NaN, { durationSeconds: -1, subscribers: Infinity }),
      video("positive", 5, { durationSeconds: 60, subscribers: 5 }),
    ];
    expect(
      filterVideos(list, { minViews: 0, maxViews: 0 }).map((item) => item.id),
    ).toEqual(["zero"]);
    expect(
      filterVideos(list, { minDurationSeconds: 0, maxDurationSeconds: 0 }).map(
        (item) => item.id,
      ),
    ).toEqual(["zero"]);
    expect(
      filterVideos(list, { minSubscribers: 0, maxSubscribers: 0 }).map(
        (item) => item.id,
      ),
    ).toEqual(["zero"]);
    expect(
      filterVideos(list, {
        minDurationSeconds: 60,
        maxDurationSeconds: 60,
      }).map((item) => item.id),
    ).toEqual(["positive"]);
  });
  it("applies min and max VPH using known publication times, including a real zero rate", () => {
    const list = [
      video("zero", 0, { publishedAt: "2026-11-02T20:00:00Z" }),
      video("twenty-five", 100, { publishedAt: "2026-11-02T20:00:00Z" }),
      video("fifty", 200, { publishedAt: "2026-11-02T20:00:00Z" }),
      video("unknown", 100),
      video("future", 100, { publishedAt: "2026-11-04" }),
    ];
    expect(
      filterVideos(list, { minVph: 25, maxVph: 25 }, now).map(
        (item) => item.id,
      ),
    ).toEqual(["twenty-five"]);
    expect(
      filterVideos(list, { maxVph: 0 }, now).map((item) => item.id),
    ).toEqual(["zero"]);
  });
  it("matches a channel name, ID or handle URL without requiring all three fields", () => {
    const named = video("named", 1, { channel: "Música Azul" });
    const identified = video("identified", 1, { channelId: "UCCanalAzul" });
    const handled = video("handled", 1, {
      channelUrl: "https://www.youtube.com/@CanalAzul",
    });
    const list = [named, identified, handled, video("unknown", 1)];
    expect(filterVideos(list, { channel: "musica azul" })).toEqual([named]);
    expect(filterVideos(list, { channel: "UCCanalAzul" })).toEqual([
      identified,
    ]);
    expect(filterVideos(list, { channel: "@canalazul" })).toEqual([handled]);
  });
  it("includes whole UTC boundary days and exact timezone-qualified instants", () => {
    const list = [
      video("start", 1, { publishedAt: "2026-11-01T00:00:00Z" }),
      video("end", 1, { publishedAt: "2026-11-01T23:59:59.999Z" }),
      video("next", 1, { publishedAt: "2026-11-02T00:00:00Z" }),
      video("unknown", 1),
    ];
    expect(
      filterVideos(
        list,
        { publishedAfter: "2026-11-01", publishedBefore: "2026-11-01" },
        now,
      ).map((item) => item.id),
    ).toEqual(["start", "end"]);
    expect(
      filterVideos(
        list,
        {
          publishedAfter: "2026-11-01T21:59:59.999-02:00",
          publishedBefore: "2026-11-01T23:59:59.999Z",
        },
        now,
      ).map((item) => item.id),
    ).toEqual(["end"]);
  });
  it("keeps invalid and future metadata unknown in date filters and recent/VPH ordering", () => {
    const invalid = [
      video("future", 10, { publishedAt: "2026-11-04" }),
      video("rollover", 10, { publishedAt: "2026-02-31" }),
      video("ambiguous-zone", 10, { publishedAt: "2026-11-01T12:00:00" }),
      video("garbage", 10, { publishedAt: "invalid" }),
    ];
    const known = video("known", 10, { publishedAt: "2026-11-01T12:00:00Z" });
    expect(
      filterVideos(
        [...invalid, known],
        { publishedAfter: "2026-01-01" },
        now,
      ).map((item) => item.id),
    ).toEqual(["known"]);
    expect(
      sortVideos([...invalid, known], "recent", now).map((item) => item.id),
    ).toEqual(["known", ...invalid.map((item) => item.id)]);
    for (const item of invalid) expect(lifetimeVph(item, now)).toBeUndefined();
  });
  it("rejects nonfinite, negative, impossible and invalid-date ranges before examining videos", () => {
    for (const filter of [
      { minViews: -1 },
      { maxVph: Infinity },
      { minOutlier: NaN },
      { minViews: 2, maxViews: 1 },
      { minSubscribers: 2, maxSubscribers: 1 },
      { minVph: 2, maxVph: 1 },
      { minOutlier: 2, maxOutlier: 1 },
      { minDurationSeconds: 61, maxDurationSeconds: 60 },
      { publishedAfter: "2026-11-02", publishedBefore: "2026-11-01" },
      { publishedBefore: "2026-02-29" },
      { publishedAfter: "2026-13-01" },
      { publishedAfter: "2026-11-01T25:00:00Z" },
      { publishedAfter: "2026-11-01T00:00:00+25:00" },
      { publishedAfter: "2026-11-01T00:00:00" },
    ])
      expect(() => filterVideos([], filter, now)).toThrow();
    expect(() =>
      validateVideoFilter({
        minViews: 0,
        maxViews: 0,
        publishedAfter: "2024-02-29",
        publishedBefore: "2024-02-29",
      }),
    ).not.toThrow();
  });
  it("keeps the complete channel baseline after text filters for both scores and sorting", () => {
    const a = video("a", 1000, { title: "keep a", channelId: "channel-a" });
    const b = video("b", 2000, { title: "keep b", channelId: "channel-b" });
    const all = [
      b,
      a,
      ...[1, 2, 3].map((index) =>
        video(`a${index}`, 100, { channelId: "channel-a" }),
      ),
      ...[1, 2, 3].map((index) =>
        video(`b${index}`, 1000, { channelId: "channel-b" }),
      ),
    ];
    const filtered = filterVideos(
      all,
      { query: "keep", minOutlier: 2, maxOutlier: 10 },
      now,
    );
    expect(filtered).toEqual([b, a]);
    expect(sortVideos(filtered, "outlier", now, all)).toEqual([a, b]);
    expect(outlierScore(a, all)).toBe(10);
    expect(outlierScore(b, all)).toBe(2);
    expect(filterVideos(all, { query: "keep", maxOutlier: 2 }, now)).toEqual([
      b,
    ]);
  });
  it("distinguishes a zero outlier from an unknown reference and supports duration/subscriber sorting", () => {
    const list = [
      video("zero", 0),
      video("one", 100),
      video("two", 200),
      video("three", 300),
    ];
    expect(filterVideos(list, { minOutlier: 0, maxOutlier: 0 }, now)).toEqual([
      list[0],
    ]);
    expect(filterVideos(list.slice(0, 3), { maxOutlier: 0 }, now)).toEqual([]);
    const sortable = [
      video("unknown"),
      video("short", 1, { durationSeconds: 30, subscribers: 300 }),
      video("long", 1, { durationSeconds: 300, subscribers: 30 }),
      video("zero", 1, { durationSeconds: 0, subscribers: 0 }),
    ];
    expect(sortVideos(sortable, "duration").map((item) => item.id)).toEqual([
      "long",
      "short",
      "zero",
      "unknown",
    ]);
    expect(sortVideos(sortable, "subscribers").map((item) => item.id)).toEqual([
      "short",
      "long",
      "zero",
      "unknown",
    ]);
    expect(sortable[0].id).toBe("unknown");
  });
});

describe("transcript parsing and exports", () => {
  it("parses json3 without treating metadata-only events as speech", () => {
    const segments = parseTranscript({
      events: [
        {
          tStartMs: 500,
          dDurationMs: 1200,
          segs: [{ utf8: "Olá " }, { utf8: "mundo" }],
        },
        { tStartMs: 0, wpWinPosId: 1 },
      ],
    });
    expect(segments).toEqual([
      { start: 0.5, duration: 1.2, text: "Olá mundo" },
    ]);
    expect(transcriptVtt(segments)).toContain("00:00:00.500 --> 00:00:01.700");
    expect(transcriptText(segments, true)).toBe("[00:00:00] Olá mundo");
  });
  it("parses XML and visible transcript DOM safely", () => {
    expect(
      parseTranscript(
        '<transcript><text start="1.2" dur="2">Fish &amp; chips</text></transcript>',
      ),
    ).toEqual([{ start: 1.2, duration: 2, text: "Fish & chips" }]);
    const doc = new DOMParser().parseFromString(
      '<ytd-transcript-segment-renderer><span class="segment-timestamp">1:02</span><span class="segment-text">Olá &lt;script&gt;</span></ytd-transcript-segment-renderer>',
      "text/html",
    );
    expect(parseTranscript(doc)).toEqual([
      { start: 62, duration: 0, text: "Olá <script>" },
    ]);
  });
  it("escapes markdown syntax and keeps invalid segments out", () => {
    const segments = parseTranscript([
      { start: -1, text: "bad" },
      { start: 1, text: "[link](x)" },
    ]);
    expect(segments).toHaveLength(1);
    expect(transcriptMarkdown(segments)).toContain("\\[link\\](x)");
    expect(parseTranscript("{invalid")).toEqual([]);
  });
});

describe("mid-roll plans", () => {
  it("respects minimum eligibility and edge spacing, preferring genuine silence candidates", () => {
    expect(
      planMidrolls({ durationSeconds: 400, intervalSeconds: 120 }),
    ).toEqual([]);
    expect(
      planMidrolls({
        durationSeconds: 600,
        intervalSeconds: 120,
        silences: [{ start: 115, end: 119 }],
      }),
    ).toEqual([117, 240, 360, 480]);
    expect(() =>
      planMidrolls({ durationSeconds: 600, intervalSeconds: 10 }),
    ).toThrow();
  });
  it("finds an actual PCM quiet interval and does not label loud samples silent", () => {
    const samples = Float32Array.from({ length: 300 }, (_, index) =>
      index >= 100 && index < 200 ? 0 : 0.8,
    );
    expect(detectSilences(samples, 100, -40, 0.5)).toEqual([
      { start: 1, end: 2 },
    ]);
    expect(detectSilences(new Float32Array(100).fill(0.8), 100)).toEqual([]);
  });
});

describe("CSV export", () => {
  it("quotes text, escapes newlines and neutralizes spreadsheet expressions", () => {
    const csv = toCsv([
      { title: '=WEBSERVICE("bad")', views: 42, extra: "a,b\nline" },
    ]);
    expect(csv).toContain('"\'=WEBSERVICE(""bad"")"');
    expect(csv).toContain('"42"');
    expect(csv).toContain('"a,b\nline"');
  });
});
