import type { CommentRecord } from "../shared/types";
import { filterComments } from "./metrics";

export interface CommentFilterOptions {
  query?: string; author?: string; questionsOnly?: boolean;
  minLikes?: number; maxLikes?: number; minReplies?: number; maxReplies?: number;
  replies?: "any" | "yes" | "no"; hearted?: "any" | "yes" | "no";
  sort?: "default" | "likes" | "replies";
}
export function normalizeCommentText(value: string): string { return value.normalize("NFC").replace(/\s+/g, " ").trim(); }
export function stableCommentFingerprint(author: string, text: string): string {
  const value = `${search(author)}\u0000${normalizeCommentText(text)}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return `local:${(hash >>> 0).toString(16).padStart(8, "0")}:${value.length}`;
}
export function validateCommentFilter(filter: CommentFilterOptions): void {
  for (const [minimum, maximum, label] of [[filter.minLikes, filter.maxLikes, "curtidas"], [filter.minReplies, filter.maxReplies, "respostas"]] as const) {
    for (const value of [minimum, maximum]) if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0)) throw new Error(`O filtro de ${label} exige números inteiros não negativos.`);
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) throw new Error(`No filtro de ${label}, o mínimo não pode superar o máximo.`);
  }
  if (filter.replies !== undefined && !["any", "yes", "no"].includes(filter.replies)) throw new Error("Selecione um estado de respostas válido.");
  if (filter.hearted !== undefined && !["any", "yes", "no"].includes(filter.hearted)) throw new Error("Selecione um estado de coração válido.");
  if (filter.sort !== undefined && !["default", "likes", "replies"].includes(filter.sort)) throw new Error("Selecione uma ordenação de comentários válida.");
}
/** Filters only supplied/loaded observations, preserving unknown counters and stable input order. */
export function selectComments(comments: readonly CommentRecord[], filter: CommentFilterOptions = {}): CommentRecord[] {
  validateCommentFilter(filter);
  const normalized = comments.map(comment => ({ ...comment, author: normalizeCommentText(comment.author), text: normalizeCommentText(comment.text), likes: knownCount(comment.likes), replies: knownCount(comment.replies) }));
  const selected = filterComments(normalized, { query: normalizeCommentText(filter.query ?? ""), author: normalizeCommentText(filter.author ?? ""), questionsOnly: filter.questionsOnly, minLikes: filter.minLikes, minReplies: filter.minReplies, hearted: filter.hearted === "yes" ? true : filter.hearted === "no" ? false : undefined }).filter(comment =>
    (filter.maxLikes === undefined || comment.likes !== undefined && comment.likes <= filter.maxLikes) &&
    (filter.maxReplies === undefined || comment.replies !== undefined && comment.replies <= filter.maxReplies) &&
    (filter.replies === undefined || filter.replies === "any" || comment.replies !== undefined && (filter.replies === "yes" ? comment.replies > 0 : comment.replies === 0)));
  if (filter.sort === "likes" || filter.sort === "replies") {
    const key = filter.sort;
    selected.sort((left, right) => left[key] === undefined ? right[key] === undefined ? 0 : 1 : right[key] === undefined ? -1 : right[key]! - left[key]!);
  }
  return selected;
}
export function describeCommentScope(loaded: readonly CommentRecord[], selected: readonly CommentRecord[]) {
  return {
    loadedCount: loaded.length, selectedCount: selected.length,
    knownLikes: selected.filter(comment => knownCount(comment.likes) !== undefined).length,
    knownReplies: selected.filter(comment => knownCount(comment.replies) !== undefined).length,
    knownHearts: selected.filter(comment => typeof comment.hearted === "boolean").length,
    fingerprintCount: selected.filter(comment => comment.id.startsWith("local:")).length,
    confidence: "loaded-observations" as const,
    limitations: ["Somente comentários efetivamente carregados e coletados nesta amostra; não representa todos os comentários do vídeo.", "Perguntas são identificadas apenas por ? ou ？, sem classificação semântica de frases interrogativas.", "Curtidas, respostas e coração ausentes permanecem desconhecidos. Filtros ativos desses campos excluem valores desconhecidos.", "Contadores abreviados são aproximações do texto exibido na página; não houve confirmação dos valores exatos por API.", "IDs locais são fingerprints de autor e texto, não IDs oficiais; conteúdos idênticos podem coincidir e edições podem mudar a identidade. Componentes duplicados por identidade são contados uma vez."],
  };
}
export function commentRows(comments: readonly CommentRecord[]): Record<string, unknown>[] { return comments.map(comment => ({ id: comment.id, author: comment.author, text: comment.text, likes: knownCount(comment.likes), replies: knownCount(comment.replies), hearted: comment.hearted })); }
export function commentsText(comments: readonly CommentRecord[]): string { return comments.map(comment => `${comment.author || "Autor desconhecido"}: ${comment.text}`).join("\n\n"); }
function knownCount(value: number | undefined): number | undefined { return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0 ? value : undefined; }
function search(value: string): string { return normalizeCommentText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(); }
