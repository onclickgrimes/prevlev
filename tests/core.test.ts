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
