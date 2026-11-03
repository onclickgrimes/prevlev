import { describe, expect, it } from "vitest";
import { buildDailyReport, dailyReportCsv, dailyReportJson, dailyReportMarkdown, type DailyInput } from "../src/core/daily-observations";

const now = Date.parse("2026-11-03T12:00:00Z");
const base = (overrides: Partial<DailyInput> = {}): DailyInput => ({ channelId: "channel_1", date: "2026-11-01", timeZone: "America/Sao_Paulo", completion: "complete", videos: [], ...overrides });

describe("manual daily observations", () => {
  it("keeps absence distinct from zero and ranks only entered videos in the declared scope", () => {
    const report = buildDailyReport(base({ channelViews: 0, sourceDescription: "my notes", videos: [{ videoId: "b", views: 10 }, { videoId: "zero", views: 0 }, { videoId: "missing" }, { videoId: "a", views: 20 }] }), now);
    expect(report).toMatchObject({ channelId: "channel_1", date: "2026-11-01", timeZone: "America/Sao_Paulo", completion: "complete", source: "user-provided", sourceDescription: "my notes", channelViews: 0, coverage: { known: 3, unknown: 1, conflicts: 0, uniqueVideos: 4, inputRows: 4 } });
    expect(report.ranking.map(row => [row.videoId, row.views])).toEqual([["a", 20], ["b", 10], ["zero", 0]]);
    expect(buildDailyReport(base(), now).channelViews).toBeUndefined();
  });
  it("deduplicates identical values but does not select or add conflicting duplicates", () => {
    const report = buildDailyReport(base({ videos: [{ videoId: "same", views: 4 }, { videoId: "same", views: 4 }, { videoId: "conflict", views: 1 }, { videoId: "conflict", views: 2 }, { videoId: "mixed" }, { videoId: "mixed", views: 0 }] }), now);
    expect(report.ranking.map(row => [row.videoId, row.views, row.occurrences])).toEqual([["same", 4, 2]]);
    expect(report.coverage).toEqual({ known: 1, unknown: 0, conflicts: 2, inputRows: 6, uniqueVideos: 3 });
    expect(report.videos.find(row => row.videoId === "mixed")).toMatchObject({ conflict: true, views: undefined });
  });
  it("requires exact date, valid IANA timezone and a period that has finished", () => {
    expect(() => buildDailyReport(base({ date: "2026-02-30" }), now)).toThrow();
    expect(() => buildDailyReport(base({ timeZone: "PST" }), now)).toThrow();
    expect(() => buildDailyReport(base({ timeZone: "America/Invented" }), now)).toThrow();
    expect(() => buildDailyReport(base({ date: "2026-11-03" }), now)).toThrow();
    expect(() => buildDailyReport(base({ date: "2026-11-04" }), now)).toThrow();
    // UTC and Sao Paulo disagree at this instant: the selected day is still open in Sao Paulo.
    expect(() => buildDailyReport(base({ date: "2026-11-02" }), Date.parse("2026-11-03T01:00:00Z"))).toThrow();
  });
  it("does not treat a date as complete while it can recur in a backward transition", () => {
    const rollback = base({ date: "1988-10-29", timeZone: "America/St_Johns", completion: "complete" });
    // At this instant the local calendar has briefly reached Oct 30 before rolling back to Oct 29.
    expect(() => buildDailyReport(rollback, Date.parse("1988-10-30T01:30:30Z"))).toThrow(/aguarde/);
    expect(() => buildDailyReport(rollback, Date.parse("1988-10-30T03:00:00Z"))).toThrow();
    expect(buildDailyReport(rollback, Date.parse("1988-10-31T00:00:00Z")).date).toBe("1988-10-29");
    expect(() => buildDailyReport(base({ date: "2026-11-02", timeZone: "UTC" }), Date.parse("2026-11-02T23:59:59Z"))).toThrow();
    expect(buildDailyReport(base({ date: "2026-11-02", timeZone: "UTC" }), Date.parse("2026-11-03T00:00:00Z")).date).toBe("2026-11-02");
  });
  it("rejects a skipped civil date while accepting adjacent dates in the same timezone", () => {
    const apia = { timeZone: "Pacific/Apia", completion: "complete" as const };
    expect(() => buildDailyReport(base({ ...apia, date: "2011-12-30" }), now)).toThrow(/não existiu/);
    expect(buildDailyReport(base({ ...apia, date: "2011-12-29" }), now).date).toBe("2011-12-29");
    expect(buildDailyReport(base({ ...apia, date: "2011-12-31" }), now).date).toBe("2011-12-31");
  });
  it("accepts 23- and 25-hour days and both instances of a repeated local hour", () => {
    const zone = "America/New_York";
    for (const date of ["2024-03-10", "2024-11-03"]) expect(buildDailyReport(base({ date, timeZone: zone }), now).date).toBe(date);
    const spring = base({ date: "2024-03-10", timeZone: zone, completion: "partial", asOf: "2024-03-10T07:30:00Z" });
    expect(buildDailyReport(spring, now).asOf).toBe("2024-03-10T07:30:00.000Z");
    for (const asOf of ["2024-11-03T05:30:00Z", "2024-11-03T06:30:00Z"]) {
      const autumn = base({ date: "2024-11-03", timeZone: zone, completion: "partial", asOf });
      expect(buildDailyReport(autumn, now).asOf).toBe(asOf.replace("Z", ".000Z"));
    }
    expect(() => buildDailyReport(base({ date: "2011-12-30", timeZone: "Pacific/Apia", completion: "partial", asOf: "2011-12-30T12:00:00Z" }), now)).toThrow(/não existiu/);
  });
  it("requires a shared partial cutoff on the specified local date and never accepts a future instant", () => {
    const partial = base({ date: "2026-11-03", completion: "partial", asOf: "2026-11-03T11:00:00Z" });
    expect(buildDailyReport(partial, now).asOf).toBe("2026-11-03T11:00:00.000Z");
    expect(() => buildDailyReport({ ...partial, asOf: undefined }, now)).toThrow();
    expect(() => buildDailyReport({ ...partial, asOf: "2026-11-03T13:00:00Z" }, now)).toThrow();
    expect(() => buildDailyReport({ ...partial, asOf: "2026-11-03T01:00:00Z" }, now)).toThrow();
    expect(() => buildDailyReport({ ...partial, asOf: "2026-11-03T11:00:00-03:00" }, now)).toThrow();
  });
  it("rejects invalid numeric values, IDs and extraneous partial cutoffs on complete days", () => {
    for (const views of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => buildDailyReport(base({ videos: [{ videoId: "x", views }] }), now)).toThrow();
    expect(() => buildDailyReport(base({ videos: [{ videoId: "../x", views: 1 }] }), now)).toThrow();
    expect(() => buildDailyReport(base({ channelId: "" }), now)).toThrow();
    expect(() => buildDailyReport(base({ asOf: "2026-11-02T12:00:00Z" }), now)).toThrow();
  });
});


describe("manual daily report exports", () => {
  it("preserves scope, provenance, zero, unknowns, duplicates and conflict in a versioned JSON envelope", () => {
    const report = buildDailyReport(base({ date: "2026-11-03", completion: "partial", asOf: "2026-11-03T11:00:00Z", sourceDescription: "Anotação privada", channelViews: 0, videos: [{ videoId: "a", views: 0 }, { videoId: "a", views: 0 }, { videoId: "missing" }, { videoId: "bad", views: 3 }, { videoId: "bad", views: 4 }] }), now);
    const data = JSON.parse(dailyReportJson(report));
    expect(data).toMatchObject({ format: "prevlev-manual-daily-report", version: 1, channelId: "channel_1", date: "2026-11-03", timeZone: "America/Sao_Paulo", completion: "partial", asOf: "2026-11-03T11:00:00.000Z", source: "user-provided", sourceDescription: "Anotação privada", channelViews: 0, channelViewsStatus: "known", coverage: { known: 1, unknown: 1, conflicts: 1, inputRows: 5, uniqueVideos: 3 }, ranking: ["a"] });
    expect(data.videos).toEqual(expect.arrayContaining([{ videoId: "a", views: 0, status: "known", occurrences: 2 }, { videoId: "missing", views: null, status: "unknown", occurrences: 1 }, { videoId: "bad", views: null, status: "conflict", occurrences: 2 }]));
    expect(data.limitations[0]).toContain("conflitantes");
  });
  it("includes summary and status columns for empty, missing, zero and conflict in CSV", () => {
    const empty = buildDailyReport(base(), now), json = JSON.parse(dailyReportJson(empty));
    expect(json).toMatchObject({ completion: "complete", asOf: null, channelViews: null, channelViewsStatus: "unknown", sourceDescription: null, videos: [] });
    const csv = dailyReportCsv(empty);
    expect(csv.split("\r\n")).toHaveLength(2);
    expect(csv).toContain('"summary","channel_1","2026-11-01","America/Sao_Paulo","complete","","user-provided"');
    expect(csv).toContain('"channel_views_status"');
    const report = buildDailyReport(base({ channelViews: 0, videos: [{ videoId: "zero", views: 0 }, { videoId: "missing" }, { videoId: "bad", views: 3 }, { videoId: "bad", views: 4 }] }), now);
    const rows = dailyReportCsv(report).split("\r\n");
    expect(rows).toHaveLength(5);
    expect(rows.find(row => row.includes('"zero"'))).toContain('"zero","0","known","1","1"');
    expect(rows.find(row => row.includes('"missing"'))).toContain('"missing","","unknown","1"');
    expect(rows.find(row => row.includes('"bad"'))).toContain('"bad","","conflict","2",""');
    expect(dailyReportMarkdown(report)).toContain("| zero | 0 | conhecido | 1 | 1 |");
  });
  it("keeps GFM strikethrough, bare URLs and emails as literal source text", () => {
    const report = buildDailyReport(base({ sourceDescription: "~~private~~ https://example.org/path www.example.org mail@example.org <img src=x>|ok" }), now);
    const markdown = dailyReportMarkdown(report);
    expect(markdown).toContain("\\~\\~private\\~\\~");
    expect(markdown).toContain("https&#58;//example&#46;org/path");
    expect(markdown).toContain("www&#46;example&#46;org");
    expect(markdown).toContain("mail&#64;example&#46;org");
    expect(markdown).toContain("&lt;img src=x&gt;\\|ok");
    expect(markdown).not.toContain("https://example.org");
    expect(markdown).not.toContain("<img src=x>");
  });
  it("neutralizes CSV formulas and Markdown/HTML syntax in supplied descriptions", () => {
    for (const prefix of ["=", "+", "-", "@"]) {
      const report = buildDailyReport(base({ sourceDescription: `${prefix}SUM(1), "quote"\n<script>|[click](https://example.invalid)` }), now);
      const csv = dailyReportCsv(report), md = dailyReportMarkdown(report);
      expect(csv).toContain(`"'${prefix}SUM(1), ""quote""\n<script>|[click](https://example.invalid)"`);
      expect(md).toContain("&lt;script&gt;");
      expect(md).not.toContain("<script>");
      expect(md).toContain("\\|\\[click\\]\\(https&#58;//example&#46;invalid\\)");
      expect(md).toContain("sem verificação");
    }
  });
});
