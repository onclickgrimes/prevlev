import type { AiCatalogModel, RemoteResponse } from "../shared/types";

export const THUMBNAIL_LAB_LIMITS = Object.freeze({ history: 12, references: 12, retainedResultBytes: 12 * 1024 * 1024 });
export interface ThumbnailBrief { title: string; newTitle: string; script: string; instructions: string; }
export interface ThumbnailReference { id: string; kind: "file" | "url"; group: "composition" | "style" | "content"; label: string; location: string; note: string; bytes?: number; }
export interface ThumbnailSelection { model?: AiCatalogModel; origin: string; backendOrigin?: string; }
export interface ThumbnailPayload { prompt: string; model: string; expectedOrigin: string; stream: false; }
export type ThumbnailJobState = "sending" | "succeeded" | "error" | "unsupported" | "not_configured" | "uncertain";
export interface ThumbnailJob {
  id: number; createdAt: string; updatedAt: string; brief: ThumbnailBrief; prompt: string;
  model: string; origin: string; backendOrigin?: string; references: ThumbnailReference[];
  state: ThumbnailJobState; message: string; source?: string; responseStatus?: RemoteResponse["status"]; imageCount?: number;
  result?: RemoteResponse; retainedBytes: number; stoppedFollowing: boolean;
}

/** The current Prevlev bridge supports text prompts only; references are never payload fields. */
export function thumbnailPrompt(brief: ThumbnailBrief): string {
  const limits: Record<keyof ThumbnailBrief, number> = { title: 300, newTitle: 300, script: 2500, instructions: 2500 };
  for (const key of Object.keys(limits) as (keyof ThumbnailBrief)[]) {
    if (typeof brief[key] !== "string" || brief[key].length > limits[key]) throw new Error(`Campo ${key} excede o limite do briefing.`);
  }
  const values = [
    ["Título original", brief.title], ["Novo título proposto", brief.newTitle],
    ["Roteiro/contexto fornecido", brief.script], ["Instruções de composição", brief.instructions],
  ].filter(([, value]) => value.trim()).map(([label, value]) => `${label}:\n${value.trim()}`);
  if (!values.length) throw new Error("Preencha ao menos um campo do briefing.");
  const prompt = `Crie uma thumbnail a partir deste briefing fornecido pelo usuário.\n\n${values.join("\n\n")}`;
  if (prompt.length > 4000) throw new Error("O briefing completo excede 4000 caracteres. Reduza os campos; nada foi enviado.");
  return prompt;
}

export function thumbnailPayload(brief: ThumbnailBrief, selection: ThumbnailSelection): ThumbnailPayload {
  const m = selection.model;
  if (!m || !/^[a-z][a-z0-9_-]*:[^\s]{1,400}$/i.test(m.id) || !m.imageSupported || !m.operations.includes("images.generate") || !m.inputModalities.includes("text") || !m.outputModalities.includes("image")) throw new Error("Selecione na Conexão um modelo que anuncie images.generate, entrada text e saída image.");
  if (!selection.origin.trim() || selection.origin.length > 2048 || (selection.backendOrigin?.length ?? 0) > 2048) throw new Error("Atualize o catálogo e confirme a origem OmniProviders antes de gerar.");
  return { prompt: thumbnailPrompt(brief), model: m.id, expectedOrigin: selection.origin, stream: false };
}

export function thumbnailReferenceUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || value.length > 2048) throw new Error("Use uma URL HTTP/HTTPS sem credenciais. Ela será guardada somente como referência local.");
  return url.href;
}

/** In-memory session journal. No persistence, transport, retry, credentials or quota inference. */
export class ThumbnailLabHistory {
  private nextId = 1;
  private entries: ThumbnailJob[] = [];
  private inFlight = new Set<number>();
  get jobs(): readonly ThumbnailJob[] { return this.entries; }
  begin(brief: ThumbnailBrief, references: readonly ThumbnailReference[], selection: ThumbnailSelection, now = new Date().toISOString()): { job: ThumbnailJob; payload: ThumbnailPayload } {
    const payload = thumbnailPayload(brief, selection);
    if (this.inFlight.size) throw new Error("Aguarde a solicitação atual concluir.");
    if (references.length > THUMBNAIL_LAB_LIMITS.references) throw new Error("Limite de 12 referências locais por briefing.");
    for (const ref of references) {
      if (!["file", "url"].includes(ref.kind) || !["composition", "style", "content"].includes(ref.group) || ref.id.length > 100 || ref.label.length > 200 || ref.location.length > 2048 || ref.note.length > 500 || (ref.bytes !== undefined && (!Number.isFinite(ref.bytes) || ref.bytes < 0 || ref.bytes > 50 * 1024 * 1024))) throw new Error("Referência local excede os limites de metadados.");
      if (ref.kind === "url") thumbnailReferenceUrl(ref.location);
    }
    const job: ThumbnailJob = { id: this.nextId++, createdAt: now, updatedAt: now, brief: { ...brief }, prompt: payload.prompt, model: payload.model, origin: payload.expectedOrigin, ...(selection.backendOrigin ? { backendOrigin: selection.backendOrigin } : {}), references: references.map(ref => ({ ...ref })), state: "sending", message: "Solicitação preparada; aguardando validação e resposta do transporte Prevlev. Referências locais não enviadas.", retainedBytes: 0, stoppedFollowing: false };
    this.entries.unshift(job);
    this.inFlight.add(job.id);
    this.entries.length = Math.min(this.entries.length, THUMBNAIL_LAB_LIMITS.history);
    return { job, payload };
  }
  stopFollowing(id: number): void {
    const job = this.find(id);
    if (job.state !== "sending") return;
    job.state = "uncertain"; job.stoppedFollowing = true; job.updatedAt = new Date().toISOString();
    job.message = "Acompanhamento interrompido. O backend pode concluir a geração; cancelamento remoto não é suportado. Aguarde a resposta antes de decidir reenviar.";
  }
  complete(id: number, response: RemoteResponse): void {
    const job = this.find(id); job.updatedAt = new Date().toISOString();
    this.inFlight.delete(id);
    if (!["ok", "error", "unsupported", "not_configured"].includes(response.status) || !response.source) { this.fail(id, "Resposta incompatível após o envio."); return; }
    job.source = response.source.slice(0, 500);
    job.responseStatus = response.status;
    if (response.status === "ok") {
      const data = response.data as { model?: unknown; generated?: unknown; images?: { base64?: unknown; mime?: unknown }[] } | undefined;
      const image = Array.isArray(data?.images) ? data.images[0] : undefined;
      if (data?.model !== job.model || data?.generated !== true || !Array.isArray(data.images) || data.images.length !== 1 || !image || typeof image.base64 !== "string" || !image.base64.trim() || typeof image.mime !== "string" || !["image/png", "image/jpeg", "image/webp"].includes(image.mime)) { this.fail(id, "Resposta não confirma exatamente uma imagem do modelo solicitado."); return; }
      job.state = "succeeded"; job.imageCount = data.images.length;
      job.message = `${job.stoppedFollowing ? "Resposta recebida após interromper acompanhamento. " : ""}Backend retornou uma imagem para o modelo solicitado. Imagem gerada por IA; desempenho e CTR desconhecidos.`;
    } else if (response.status === "error" && response.source !== "prevlev:client") {
      // The server can return status:error after the provider accepted a generation.
      // Its current contract has no phase/accepted flag, so do not infer rejection.
      job.state = "uncertain"; job.message = `Backend informou erro; resultado da geração incerto: ${response.error?.slice(0, 1000) ?? "Sem detalhes."} Nenhuma repetição automática foi enviada.`;
    } else { job.state = response.status; job.message = response.error?.slice(0, 1000) ?? `Backend respondeu ${response.status}.`; }
    // Retain complete results only within one shared memory budget, discarding oldest first.
    const size = new TextEncoder().encode(JSON.stringify(response)).byteLength;
    if (size <= THUMBNAIL_LAB_LIMITS.retainedResultBytes) {
      job.result = response; job.retainedBytes = size;
      let total = this.entries.reduce((sum, item) => sum + item.retainedBytes, 0);
      for (const old of [...this.entries].reverse()) {
        if (total <= THUMBNAIL_LAB_LIMITS.retainedResultBytes) break;
        total -= old.retainedBytes; delete old.result; old.retainedBytes = 0;
      }
    }
  }
  fail(id: number, detail: string): void {
    this.inFlight.delete(id);
    const job = this.find(id); job.state = "uncertain"; job.updatedAt = new Date().toISOString();
    job.message = `Resultado incerto após envio: ${detail.slice(0, 500)} Nenhuma repetição automática foi enviada.`;
  }
  clear(): void { if (this.inFlight.size) throw new Error("Aguarde a solicitação atual antes de limpar o histórico."); this.entries = []; }
  private find(id: number): ThumbnailJob { const job = this.entries.find(item => item.id === id); if (!job) throw new Error("Solicitação não está no histórico desta sessão."); return job; }
}
