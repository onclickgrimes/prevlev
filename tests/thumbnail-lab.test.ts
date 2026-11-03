import { describe, expect, it } from "vitest";
import { ThumbnailLabHistory, THUMBNAIL_LAB_LIMITS, thumbnailPayload, thumbnailPrompt, thumbnailReferenceUrl, type ThumbnailReference, type ThumbnailSelection } from "../src/core/thumbnail-lab";
import type { RemoteResponse } from "../src/shared/types";

const brief = { title: "Vídeo fornecido", newTitle: "Uma ideia visual", script: "Contexto real fornecido", instructions: "Fundo azul" };
const selection: ThumbnailSelection = { origin: "http://127.0.0.1:7814", backendOrigin: "http://127.0.0.1:8787", model: { id: "fixture:exact-image", provider: "fixture", label: "Fixture", operations: ["images.generate"], inputModalities: ["text", "image"], outputModalities: ["image"], imageSupported: true, textSupported: false, streaming: false } };
const reference: ThumbnailReference = { id: "1", kind: "url", group: "style", label: "local-only.example", location: "https://local-only.example/ref.png", note: "SEGREDO DE REFERÊNCIA" };
const response = (): RemoteResponse => ({ status: "ok", source: "prevlev:omni:fixture", data: { model: selection.model!.id, generated: true, images: [{ base64: "fixture", mime: "image/png" }] } });

describe("Thumbnail Lab session journal", () => {
  it("pins exact advertised image model/origin and only sends structured text through current contract", () => {
    const journal = new ThumbnailLabHistory(), { job, payload } = journal.begin(brief, [reference], selection, "2026-11-03T00:00:00Z");
    expect(payload).toEqual({ model: "fixture:exact-image", expectedOrigin: "http://127.0.0.1:7814", stream: false, prompt: thumbnailPrompt(brief) });
    expect(JSON.stringify(payload)).not.toMatch(/SEGREDO|local-only|reference|resolution|aspect|size/);
    expect(payload.prompt).toContain("Novo título proposto:\nUma ideia visual");
    brief.title = "Editado após envio"; reference.note = "Editada após envio";
    expect(job.brief.title).toBe("Vídeo fornecido"); expect(job.references[0].note).toBe("SEGREDO DE REFERÊNCIA");
    brief.title = "Vídeo fornecido"; reference.note = "SEGREDO DE REFERÊNCIA";
  });
  it("requires capabilities rather than a model name and never truncates an oversized briefing", () => {
    for (const model of [undefined, { ...selection.model!, imageSupported: false }, { ...selection.model!, operations: [] }, { ...selection.model!, inputModalities: ["image"] }, { ...selection.model!, outputModalities: ["text"] }]) expect(() => thumbnailPayload(brief, { ...selection, model })).toThrow(/modelo/);
    expect(() => thumbnailPayload(brief, { ...selection, origin: "" })).toThrow(/origem/);
    expect(() => thumbnailPrompt({ title: "", newTitle: "", script: " ", instructions: "" })).toThrow(/ao menos/);
    expect(() => thumbnailPrompt({ ...brief, script: "a".repeat(2500), instructions: "b".repeat(2000) })).toThrow(/4000/);
    expect(() => thumbnailPrompt({ ...brief, title: "c".repeat(301) })).toThrow(/limite/);
  });
  it("marks local stop as uncertain, prevents duplicate sends and reconciles a later real response", () => {
    const journal = new ThumbnailLabHistory(), { job } = journal.begin(brief, [], selection);
    journal.stopFollowing(job.id); expect(job.state).toBe("uncertain"); expect(job.message).toContain("cancelamento remoto não é suportado");
    expect(() => journal.begin(brief, [], selection)).toThrow(/Aguarde/); expect(() => journal.clear()).toThrow(/Aguarde/);
    journal.complete(job.id, response()); expect(job.state).toBe("succeeded"); expect(job.message).toContain("após interromper"); expect(job.source).toBe("prevlev:omni:fixture");
    expect(job.result).toEqual(response()); expect(job.imageCount).toBe(1);
    journal.clear(); expect(journal.jobs).toHaveLength(0);
  });
  it("preserves explicit backend states and treats lost or mismatched replies as uncertain without retry", () => {
    const journal = new ThumbnailLabHistory();
    for (const state of ["error", "unsupported", "not_configured"] as const) {
      const { job } = journal.begin(brief, [], selection); journal.complete(job.id, { status: state, source: "prevlev:client", error: "Explicação real" }); expect(job.state).toBe(state);
    }
    const timeout = journal.begin(brief, [], selection).job; journal.complete(timeout.id, { status: "error", source: "prevlev:omni", error: "Tempo limite do OmniProviders" }); expect(timeout.state).toBe("uncertain"); expect(timeout.responseStatus).toBe("error");
    const missing = journal.begin(brief, [], selection).job; journal.fail(missing.id, "Conexão interrompida"); expect(missing.state).toBe("uncertain"); expect(missing.message).toContain("Nenhuma repetição automática");
    const mismatch = journal.begin(brief, [], selection).job; journal.complete(mismatch.id, { ...response(), data: { model: "fixture:other", generated: true, images: [{}] } }); expect(mismatch.state).toBe("uncertain"); expect(mismatch.result).toBeUndefined();
    const emptyImage = journal.begin(brief, [], selection).job; journal.complete(emptyImage.id, { ...response(), data: { model: selection.model!.id, generated: true, images: [{}] } }); expect(emptyImage.state).toBe("uncertain");
  });
  it("bounds requests and retained results while preserving outcome summaries", () => {
    const journal = new ThumbnailLabHistory();
    for (let i = 0; i < 14; i++) { const { job } = journal.begin(brief, [], selection); const output = response(); output.data = { ...(output.data as object), padding: "x".repeat(2 * 1024 * 1024) }; journal.complete(job.id, output); }
    expect(journal.jobs).toHaveLength(THUMBNAIL_LAB_LIMITS.history); expect(journal.jobs[0].id).toBe(14); expect(journal.jobs.at(-1)!.id).toBe(3);
    expect(journal.jobs.reduce((sum, job) => sum + job.retainedBytes, 0)).toBeLessThanOrEqual(THUMBNAIL_LAB_LIMITS.retainedResultBytes);
    expect(journal.jobs.at(-1)!.result).toBeUndefined(); expect(journal.jobs.at(-1)!.state).toBe("succeeded"); expect(journal.jobs[0].result).toBeDefined();
  });
  it("limits reference metadata and refuses executable or credential-bearing URLs without loading them", () => {
    expect(thumbnailReferenceUrl("https://example.test/ref.png")).toBe("https://example.test/ref.png");
    for (const url of ["javascript:alert(1)", "data:image/png;base64,AA", "https://user:pass@example.test/"]) expect(() => thumbnailReferenceUrl(url)).toThrow();
    expect(() => new ThumbnailLabHistory().begin(brief, Array(13).fill(reference), selection)).toThrow(/12/);
    expect(() => new ThumbnailLabHistory().begin(brief, [{ ...reference, note: "a".repeat(501) }], selection)).toThrow(/metadados/);
  });
});
