import { describe, expect, it } from "vitest";
import { buildChannelReport, type ReportVideo } from "../src/core/channel-report";

const videos: ReportVideo[] = [
  { id: "abcdefghijk", title: "Olá mundo? Olá!", isShort: true, durationSeconds: 120, source: "youtube-dom" },
  { id: "bcdefghijkl", title: "Mundo real", isShort: false, source: "user-provided" },
  { id: "bcdefghijkl", title: "Duplicate", durationSeconds: 99 },
  { id: "abcdefghijA", title: "Official", isShort: true, source: "youtube-data-api" },
  { id: "", title: "Invalid" },
];
const manual = { videoId: "abcdefghijk", text: "Um dois três quatro", durationSeconds: 120, coverage: "partial" as const };
describe("local channel report", () => {
  it("counts first eligible videos, title terms and coverage with source and exclusions", () => {
    const r = buildChannelReport(videos, manual);
    expect(r.scope).toMatchObject({ input: 5, included: 2, excludedApi: 1, excludedDuplicate: 1, excludedInvalidId: 1, sources: { "youtube-dom": 1, "user-provided": 1 } });
    expect(r.content).toEqual({ shorts: 1, nonShorts: 1, unknownFormats: 0, knownDuration: 1, unknownDuration: 1 });
    expect(r.titles).toMatchObject({ known: 2, missing: 0, questionMarks: 1, exclamationMarks: 1 });
    expect(r.titles.terms[0]).toEqual({ term: "mundo", titles: 2 });
    expect(r.transcript).toMatchObject({ status: "available", source: "user-provided", coverage: "partial", words: 4, durationSeconds: 120, wordsPerMinute: 2 });
    expect(r.limitations.join(" ")).toContain("não representa o ritmo");
  });
  it("never derives WPM from absent, invalid, mismatched or official-only inputs", () => {
    expect(buildChannelReport(videos).transcript.status).toBe("unknown");
    for (const changed of [{ text: " " }, { text: "!!!" }, { durationSeconds: 0 }, { durationSeconds: Infinity }, { videoId: "abcdefghijA" }, { videoId: "other" }, { coverage: "invented" as "partial" }, { coverage: "" as "partial" }, { videoId: "bad" }]) {
      expect(buildChannelReport(videos, { ...manual, ...changed }).transcript).not.toHaveProperty("wordsPerMinute");
    }
  });
  it("excludes API rows before choosing the first eligible duplicate and never combines fields", () => {
    const r = buildChannelReport([{ id: "XXXXXXXXXXX", title: "API", isShort: true, durationSeconds: 100, source: "youtube-data-api" }, { id: "XXXXXXXXXXX", title: "local" }, { id: "XXXXXXXXXXX", title: "later", isShort: false, durationSeconds: 100 }]);
    expect(r.scope).toMatchObject({ included: 1, excludedApi: 1, excludedDuplicate: 1 });
    expect(r.content).toMatchObject({ unknownFormats: 1, unknownDuration: 1 });
    expect(r.titles.terms).toEqual([{ term: "local", titles: 1 }]);
  });
  it("requires eleven valid YouTube ID characters for the sample and transcript association", () => {
    const r = buildChannelReport([
      { id: "ab_cd-12345", title: "accepted" },
      { id: "abcdefghij", title: "short" },
      { id: "abcdefghijkl", title: "long" },
      { id: "abc defghij", title: "space" },
    ], { ...manual, videoId: "ab_cd-12345", coverage: "unknown" });
    expect(r.scope).toMatchObject({ included: 1, excludedInvalidId: 3 });
    expect(r.transcript).toMatchObject({ status: "available", coverage: "unknown" });
    expect(buildChannelReport(videos, { ...manual, coverage: "" as "partial" }).transcript.reason).toContain("cobertura");
  });
  it("keeps empty statistics unknown and tokenizes accented and apostrophe words", () => {
    const empty = buildChannelReport([]); expect(empty.titles.meanCharacters).toBeUndefined(); expect(empty.transcript.status).toBe("unknown");
    const r = buildChannelReport(videos, { ...manual, text: "Olá d’água 123!" }); expect(r.transcript.words).toBe(3); expect(r.transcript.wordsPerMinute).toBe(1.5);
    expect(JSON.stringify(r)).not.toMatch(/"(?:revenue|rpm|profit|strategy|topics)"/i);
  });
});
