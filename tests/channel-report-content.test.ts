import { describe, expect, it } from "vitest";
import { buildChannelReport, type ReportVideo } from "../src/core/channel-report";
import {
  buildStructuredChannelReport, channelReportContext, channelReportTargets, channelReportCsv, channelReportJson,
  channelReportMarkdown, parseReportDraft, serializeReportDraft, validateReportAnnotation,
  MAX_REPORT_ANNOTATIONS, MAX_REPORT_DRAFT_BYTES, REPORT_GROUPS, type ReportAnnotation,
} from "../src/core/channel-report-content";

const channel = "UCaaaaaaaaaaaaaaaaaaaaaa", otherChannel = "UCbbbbbbbbbbbbbbbbbbbbbb";
const videos: ReportVideo[] = [
  { id: "abcdefghijk", title: "Título mecânico?", channelId: channel, source: "youtube-dom", isShort: false },
  { id: "bcdefghijkl", title: "Outro título", channelId: channel, source: "user-provided", isShort: true },
  { id: "cdefghijklm", title: "Canal diferente", channelId: otherChannel, source: "public-page" },
  { id: "officialAPI", title: "Oficial", channelId: channel, source: "youtube-data-api" },
];
const declared = (): ReportAnnotation => ({ id: "note-1", group: "strategy", target: { kind: "video", id: "abcdefghijk" }, statement: "Estratégia declarada pelo autor: publicar entrevistas.", coverage: "unknown", source: { kind: "declaration", origin: "user-provided", label: "Declaração própria" } });
const evidence = (): ReportAnnotation => ({ ...declared(), group: "topics", source: { kind: "transcript", origin: "user-provided", label: "Transcrição fornecida para abcdefghijk, 00:10", text: "Introdução. Falamos sobre jardinagem. Encerramento.", quote: "Falamos sobre jardinagem." }, coverage: "partial" });

describe("structured report with explicitly provided material", () => {
  it("keeps every missing group unknown and preserves the original mechanical report and WPM", () => {
    const manual = { videoId: "abcdefghijk", text: "um dois três", durationSeconds: 60, coverage: "partial" as const }, report = buildStructuredChannelReport(videos, [], manual);
    expect(report.structured.groups.map(group => group.id)).toEqual(REPORT_GROUPS.map(group => group.id));
    expect(report.structured.groups.every(group => group.status === "unknown" && group.entries.length === 0)).toBe(true);
    const { structured: _structured, limitations: _limits, ...mechanical } = report;
    const { limitations: _originalLimits, ...original } = buildChannelReport(videos, manual);
    expect(mechanical).toEqual(original); expect(report.transcript.wordsPerMinute).toBe(3); expect(report.scope.excludedApi).toBe(1);
    expect(report.limitations.join(" ")).toContain("Não houve IA");
  });
  it("organizes declared strategy without verifying or deriving it from title terms", () => {
    const report = buildStructuredChannelReport(videos, [declared()]), strategy = report.structured.groups.find(group => group.id === "strategy")!;
    expect(strategy).toMatchObject({ status: "available", coverage: { eligibleVideos: 3, referencedVideos: 1, unreferencedVideos: 2 } });
    expect(strategy.entries[0]).toMatchObject({ statement: declared().statement, basis: "user-declaration", verification: "not-verified", source: { label: "Declaração própria" } });
    expect(report.structured.groups.find(group => group.id === "topics")!.status).toBe("unknown");
  });
  it("validates literal evidence only against supplied text and exports the excerpt rather than complete material", () => {
    const report = buildStructuredChannelReport(videos, [evidence()]), topics = report.structured.groups.find(group => group.id === "topics")!;
    expect(topics.entries[0]).toMatchObject({ basis: "provided-excerpt", verification: "literal-match-only", source: { quote: "Falamos sobre jardinagem." } });
    expect(topics.entries[0].source).not.toHaveProperty("text");
    expect(channelReportJson(report)).not.toContain("Introdução.");
    const bad = evidence(); if (bad.source.kind !== "declaration") bad.source.quote = "Texto inventado";
    const rejected = buildStructuredChannelReport(videos, [bad]);
    expect(rejected.structured.rejected[0].reason).toContain("presente"); expect(rejected.structured.groups.every(group => group.status === "unknown")).toBe(true);
  });
  it("rejects targets absent from the eligible local sample and official API material", () => {
    for (const id of ["officialAPI", "invalid", "missingIDxx"]) expect(buildStructuredChannelReport(videos, [{ ...declared(), target: { kind: "video", id } }]).structured.rejected).toHaveLength(1);
    const value = { ...declared(), source: { ...declared().source, origin: "youtube-data-api" } };
    expect(buildStructuredChannelReport(videos, [value]).structured.rejected[0].reason).toContain("API oficial");
    expect(channelReportTargets(videos).videos.map(video => video.id)).not.toContain("officialAPI");
  });
  it("binds channel claims to explicit channel IDs and explicitly associated eligible videos", () => {
    const entry = { ...declared(), target: { kind: "channel" as const, id: channel, videoIds: ["abcdefghijk"] } };
    expect(buildStructuredChannelReport(videos, [entry]).structured.groups.find(group => group.id === "strategy")!.coverage.referencedVideos).toBe(1);
    for (const target of [{ kind: "channel", id: channel, videoIds: [] }, { kind: "channel", id: channel, videoIds: ["cdefghijklm"] }, { kind: "channel", id: channel, videoIds: ["officialAPI"] }, { kind: "channel", id: "Nome ou @handle", videoIds: ["abcdefghijk"] }]) expect(buildStructuredChannelReport(videos, [{ ...entry, target }]).structured.rejected).toHaveLength(1);
  });
  it("keeps first eligible rows independent of later duplicate metadata and excludes API before dedupe", () => {
    const input = [{ ...videos[0], source: "youtube-data-api" as const, channelId: otherChannel }, videos[0], { ...videos[0], channelId: otherChannel }];
    expect(channelReportTargets(input).channels).toEqual([{ id: channel, videoIds: ["abcdefghijk"] }]);
    expect(buildStructuredChannelReport(input, [declared()]).scope).toMatchObject({ included: 1, excludedApi: 1, excludedDuplicate: 1 });
  });
  it("bounds annotation, material, quote, IDs and count; duplicate annotation IDs are refused", () => {
    for (const changed of [{ statement: "x".repeat(2001) }, { id: "x".repeat(101) }, { group: "invented" }, { coverage: "" }, { source: { kind: "unknown", origin: "user-provided", label: "Origem" } }, { source: { kind: "material", origin: "user-provided", label: "Origem", text: "x".repeat(6001), quote: "x" } }, { source: { kind: "material", origin: "user-provided", label: "Origem", text: "x".repeat(1000), quote: "x".repeat(601) } }]) expect(() => validateReportAnnotation({ ...declared(), ...changed }, videos)).toThrow();
    expect(buildStructuredChannelReport(videos, [declared(), declared()]).structured.rejected[0].reason).toContain("repetido");
    const entries = Array.from({ length: MAX_REPORT_ANNOTATIONS + 4 }, (_, index) => ({ ...declared(), id: String(index) })), report = buildStructuredChannelReport(videos, entries);
    expect(report.structured.groups.flatMap(group => group.entries)).toHaveLength(MAX_REPORT_ANNOTATIONS);
    expect(report.structured.rejected).toHaveLength(1); expect(report.structured.rejected[0].reason).toContain("4 entradas extras");
  });
  it("exports missing groups, scope, provenance, coverage, WPM and restrictions in JSON, CSV and Markdown", () => {
    const entry = declared(); entry.statement = "=SUM(A1:A2)";
    const report = buildStructuredChannelReport(videos, [entry]), csv = channelReportCsv(report), markdown = channelReportMarkdown(report), json = channelReportJson(report);
    expect(csv).toContain("'=SUM(A1:A2)"); expect(csv).toContain("unknown"); expect(csv).toContain("Declaração própria"); expect(csv).toContain("excludedApi");
    expect(markdown).toContain("## Nicho\n\nDesconhecido"); expect(markdown).toContain("sem IA"); expect(markdown).toContain("IDs associados: 1/3");
    expect(JSON.parse(json).structured.method).toBe("manual-provided-material"); expect(json).not.toMatch(/"(?:rpm|profit|revenue)"/);
  });
  it("escapes supplied markup and links in Markdown instead of treating evidence as active content", () => {
    const entry = declared(); entry.statement = '<img src="x"> [Abrir](javascript:alert(1))';
    const markdown = channelReportMarkdown(buildStructuredChannelReport(videos, [entry]));
    expect(markdown).not.toContain("<img"); expect(markdown).not.toContain("[Abrir]("); expect(markdown).toContain("&lt;img");
  });
});

describe("explicit bounded annotation backups", () => {
  it("round trips complete supplied material under an exact sample binding", () => {
    const data = serializeReportDraft(videos, [evidence()]);
    expect(data).toContain("Introdução."); expect(parseReportDraft(data, videos)).toEqual([evidence()]);
    for (const input of [[...videos].reverse(), videos.map(video => ({ ...video, title: "Alterado" })), videos.map(video => ({ ...video, channelId: otherChannel }))]) expect(() => parseReportDraft(data, input)).toThrow("outra amostra");
    expect(channelReportContext([...videos, { ...videos[0], source: "youtube-data-api" }])).toBe(channelReportContext(videos));
  });
  it("rejects malformed, oversized, foreign-schema, duplicated or ineligible backup data atomically", () => {
    expect(() => parseReportDraft("invalid", videos)).toThrow("JSON inválido");
    expect(() => parseReportDraft(" ".repeat(MAX_REPORT_DRAFT_BYTES + 1), videos)).toThrow("256 KiB");
    expect(() => parseReportDraft('{"schema":"other"}', videos)).toThrow("Formato");
    const draft = JSON.parse(serializeReportDraft(videos, [declared()]));
    draft.entries.push(draft.entries[0]); expect(() => parseReportDraft(JSON.stringify(draft), videos)).toThrow("repetido");
    draft.entries = [{ ...declared(), target: { kind: "video", id: "officialAPI" } }]; expect(() => parseReportDraft(JSON.stringify(draft), videos)).toThrow("elegível");
    expect(() => serializeReportDraft(videos, [declared(), declared()])).toThrow("repetido");
  });
});
