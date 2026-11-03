import { describe, expect, it, vi } from "vitest";
import { extractSponsorships, prepareSponsorshipTranscript, sponsorshipMarkdown, sponsorshipRows, SPONSORSHIP_TIMING_LIMITS, type SponsorshipTranscript } from "../src/core/sponsorships";
import { analyzeSponsorships } from "../server/sponsorships.mjs";
import { analyzeDataset } from "../server/analysis.mjs";
import { toCsv } from "../src/core/export";

const transcript = (): SponsorshipTranscript => ({ videoId: "abcdefghijk", source: "user-provided", coverage: "partial", segments: [
  { start: 0, duration: 5, text: "🪐 Abertura.\r\nTexto real." },
  { start: 12.5, duration: 3, text: "Patrocinado por Acme. Use cupom ACME20." },
  { start: 40, text: "Affiliate link https://shop.example/?ref=creator" },
] });
function report(value = transcript()) { const prepared = prepareSponsorshipTranscript(value); return extractSponsorships({ ...prepared, source: "user-provided" }); }

describe("sponsorship timing only from explicitly supplied segments", () => {
  it("keeps literal timestamps and URL times unknown without a supplied segment association", () => {
    const value = extractSponsorships({ text: "00:12 Sponsored by Acme. https://www.youtube.com/watch?v=abcdefghijk&t=12" });
    expect(value.evidence.every(proof => proof.timing.status === "unknown")).toBe(true);
    expect(JSON.stringify(value)).not.toContain('"startSeconds"');
  });
  it("preserves UTF16 text positions, declared video, coverage and exact enclosing segment timing", () => {
    const supplied = transcript(), prepared = prepareSponsorshipTranscript(supplied), value = report(supplied);
    expect(prepared.text).toBe(supplied.segments.map(segment => segment.text).join("\n"));
    for (const proof of value.evidence) {
      expect(prepared.text.slice(proof.start, proof.end)).toBe(proof.quote); expect(proof.timing.status).toBe("provided-segments");
      if (proof.timing.status === "provided-segments") {
        expect(proof.timing).toMatchObject({ videoId: "abcdefghijk", coverage: "partial", source: "user-provided", omittedSegments: 0 });
        for (const span of proof.timing.segments) expect(prepared.text.slice(span.textStart, span.textEnd)).toBe(supplied.segments[span.index - 1].text);
      }
    }
    const brand = value.evidence.find(proof => proof.kind === "brand")!;
    expect(brand.timing).toMatchObject({ segments: [{ index: 2, startSeconds: 12.5, endSeconds: 15.5 }] });
    expect(brand.method).toBe("literal-name-after-marker"); expect(brand.limitations.join(" ")).toContain("não foi verificada");
  });
  it("does not invent word timing or an end for missing and zero durations", () => {
    for (const duration of [undefined, 0]) {
      const supplied: SponsorshipTranscript = { ...transcript(), segments: [{ start: 0, ...(duration !== undefined ? { duration } : {}), text: "Sponsored by Acme. Use code ACME20." }] }, value = report(supplied);
      expect(value.evidence.every(proof => proof.timing.status === "provided-segments" && proof.timing.segments[0].startSeconds === 0 && proof.timing.segments[0].endSeconds === null)).toBe(true);
      expect(sponsorshipMarkdown(value)).toContain("fim desconhecido");
    }
  });
  it("maps repeated text and cross-segment markers by character overlap rather than first text match", () => {
    const supplied: SponsorshipTranscript = { ...transcript(), segments: [
      { start: 1, duration: 1, text: "Sponsored" }, { start: 3, duration: 1, text: "" }, { start: 5, duration: 2, text: "by Acme." },
      { start: 30, duration: 2, text: "Sponsored by Acme." },
    ] }, value = report(supplied), markers = value.evidence.filter(proof => proof.kind === "sponsor-marker");
    expect(markers[0].timing).toMatchObject({ segments: [{ index: 1, startSeconds: 1 }, { index: 3, startSeconds: 5 }] });
    expect(markers[1].timing).toMatchObject({ segments: [{ index: 4, startSeconds: 30 }] });
    expect(JSON.stringify(value)).not.toContain('"confidence"');
  });
  it("rejects stale text, invalid identity, absent coverage and invalid numeric timings without a partial result", () => {
    const prepared = prepareSponsorshipTranscript(transcript());
    expect(() => extractSponsorships({ ...prepared, text: `${prepared.text} changed` })).toThrow("exatamente");
    for (const changes of [{ videoId: "bad" }, { coverage: "" }, { segments: [] }, { segments: [{ text: "Sponsored by Acme" }] }, { segments: [{ start: -1, text: "Sponsored by Acme" }] }, { segments: [{ start: NaN, text: "Sponsored by Acme" }] }, { segments: [{ start: 1, duration: -1, text: "Sponsored by Acme" }] }, { segments: [{ start: 604800, duration: 1, text: "Sponsored by Acme" }] }]) expect(() => prepareSponsorshipTranscript({ ...transcript(), ...changes })).toThrow();
  });
  it("rejects official API origins even when nested inside supplied segment metadata", async () => {
    const supplied = { ...transcript(), segments: [{ start: 1, text: "Sponsored by Acme", metadata: { source: "youtube-data-api" } }] };
    expect(() => prepareSponsorshipTranscript(supplied)).toThrow("youtube-data-api");
    const input = { text: "Sponsored by Acme", transcript: supplied };
    expect(() => extractSponsorships(input)).toThrow("youtube-data-api"); await expect(analyzeDataset("sponsorships", input)).rejects.toThrow("youtube-data-api");
  });
  it("bounds all supplied segments and text without truncation, and reports omitted temporal references", () => {
    expect(() => prepareSponsorshipTranscript({ ...transcript(), segments: Array.from({ length: SPONSORSHIP_TIMING_LIMITS.segments + 1 }, () => ({ start: 0, text: "x" })) })).toThrow("1000");
    expect(() => prepareSponsorshipTranscript({ ...transcript(), segments: [{ start: 0, text: "x".repeat(100001) }] })).toThrow("nada foi truncado");
    const supplied = { ...transcript(), segments: [{ start: 0, text: "Sponsored" }, ...Array.from({ length: 25 }, (_, index) => ({ start: index + 1, text: " " })), { start: 50, text: "by Acme" }] }, value = report(supplied), marker = value.evidence.find(proof => proof.kind === "sponsor-marker")!;
    expect(marker.timing).toMatchObject({ omittedSegments: 7 }); if (marker.timing.status === "provided-segments") expect(marker.timing.segments).toHaveLength(20);
    expect(value.warnings.join(" ")).toContain("20 referências");
  });
  it("shares timed evidence in the backend and exports method, limits, unknowns and supplied times without remote calls", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch"), prepared = prepareSponsorshipTranscript(transcript()), input = { ...prepared, source: "user-provided" }, value = extractSponsorships(input);
    expect(analyzeSponsorships(input).data).toEqual(value); expect((await analyzeDataset("sponsorships", input)).data).toEqual(value);
    const rows = sponsorshipRows(value), csv = toCsv(rows), markdown = sponsorshipMarkdown(value);
    expect(rows[0]).toHaveProperty("method"); expect(rows[0]).toHaveProperty("limitations"); expect(csv).toContain("startSeconds"); expect(csv).toContain("12.5"); expect(markdown).toContain("Vídeo declarado: abcdefghijk"); expect(markdown).toContain("não localizam palavras");
    expect(fetcher).not.toHaveBeenCalled(); fetcher.mockRestore();
  });
});
