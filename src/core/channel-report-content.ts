import { buildChannelReport, selectChannelReportVideos, type ChannelReport, type ManualTranscript, type ReportVideo } from "./channel-report";
import { toCsv } from "./export";

export const REPORT_GROUPS = [
  { id: "content", label: "Conteúdo" }, { id: "niche", label: "Nicho" }, { id: "strategy", label: "Estratégia" },
  { id: "feedback", label: "Feedback" }, { id: "performance", label: "Performance declarada" }, { id: "topics", label: "Tópicos" },
  { id: "script", label: "Roteiro" }, { id: "stages", label: "Etapas" },
] as const;
export type ReportGroupId = typeof REPORT_GROUPS[number]["id"];
export type ReportCoverage = "complete" | "partial" | "unknown";
export type ReportOrigin = "user-provided" | "youtube-dom" | "public-page";
export type ReportTarget = { kind: "video"; id: string } | { kind: "channel"; id: string; videoIds: string[] };
export interface ReportAnnotation {
  id: string; group: ReportGroupId; target: ReportTarget; statement: string; coverage: ReportCoverage;
  source: { kind: "declaration"; origin: ReportOrigin; label: string } |
    { kind: "material" | "transcript" | "comments"; origin: ReportOrigin; label: string; text: string; quote: string };
}
export interface PreparedAnnotation {
  id: string; group: ReportGroupId; target: ReportTarget; statement: string; coverage: ReportCoverage;
  basis: "user-declaration" | "provided-excerpt";
  verification: "not-verified" | "literal-match-only";
  source: { kind: ReportAnnotation["source"]["kind"]; origin: ReportOrigin; label: string; quote?: string };
  referencedVideoIds: string[];
}
export interface StructuredChannelReport extends ChannelReport {
  structured: {
    method: "manual-provided-material";
    context: string;
    groups: { id: ReportGroupId; label: string; status: "available" | "unknown"; reason?: string; coverage: { eligibleVideos: number; referencedVideos: number; unreferencedVideos: number }; entries: PreparedAnnotation[] }[];
    rejected: { index: number; reason: string }[];
  };
}
export const MAX_REPORT_ANNOTATIONS = 32;
export const MAX_REPORT_SOURCE_TEXT = 6000;
export const MAX_REPORT_QUOTE = 600;
export const MAX_REPORT_DRAFT_BYTES = 262144;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const ownObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function text(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label}: informe texto com até ${max} caracteres.`);
  return value.trim();
}

/** Exact collection binding; only first eligible local rows contribute, never official API rows. */
export function channelReportContext(input: readonly ReportVideo[]): string {
  return JSON.stringify(selectChannelReportVideos(input).videos.map(v => [v.id, v.channelId ?? null, v.source ?? null, v.title, v.isShort ?? null, v.durationSeconds ?? null]));
}
export function channelReportTargets(input: readonly ReportVideo[]): { videos: ReportVideo[]; channels: { id: string; videoIds: string[] }[] } {
  const { videos } = selectChannelReportVideos(input), channels = new Map<string, string[]>();
  for (const video of videos) if (video.channelId && CHANNEL_ID.test(video.channelId)) {
    const ids = channels.get(video.channelId) ?? []; ids.push(video.id); channels.set(video.channelId, ids);
  }
  return { videos, channels: [...channels].map(([id, videoIds]) => ({ id, videoIds })) };
}

function annotation(value: unknown, input: readonly ReportVideo[]): ReportAnnotation {
  if (!ownObject(value)) throw new Error("Anotação inválida.");
  const id = text(value.id, "ID da anotação", 100), statement = text(value.statement, "Anotação", 2000);
  if (!REPORT_GROUPS.some(group => group.id === value.group)) throw new Error("Escolha um grupo conhecido.");
  if (typeof value.coverage !== "string" || !["complete", "partial", "unknown"].includes(value.coverage)) throw new Error("Informe a cobertura do material ou da declaração.");
  const available = channelReportTargets(input), eligible = new Map(available.videos.map(video => [video.id, video]));
  if (!ownObject(value.target)) throw new Error("Associe a anotação a um vídeo ou canal elegível.");
  const targetId = text(value.target.id, "Alvo", 100);
  let target: ReportTarget;
  if (value.target.kind === "video") {
    if (!eligible.has(targetId)) throw new Error("O vídeo não pertence à amostra elegível local.");
    target = { kind: "video", id: targetId };
  } else if (value.target.kind === "channel") {
    if (!CHANNEL_ID.test(targetId) || !available.channels.some(channel => channel.id === targetId)) throw new Error("O canal exige channelId explícito de vídeo elegível; nomes e handles não são identidade comprovada.");
    if (!Array.isArray(value.target.videoIds) || !value.target.videoIds.length || value.target.videoIds.length > available.videos.length) throw new Error("Declare quais IDs elegíveis desse canal estão associados à anotação.");
    const ids = [...new Set(value.target.videoIds.map(id => text(id, "ID associado", 11)))];
    if (ids.some(id => eligible.get(id)?.channelId !== targetId)) throw new Error("Um ID associado está ausente ou pertence a outro canal.");
    target = { kind: "channel", id: targetId, videoIds: ids };
  } else throw new Error("Tipo de alvo desconhecido.");
  if (!ownObject(value.source)) throw new Error("Informe a origem da declaração ou do material.");
  if (value.source.origin === "youtube-data-api") throw new Error("Material da API oficial é excluído deste relatório derivado.");
  if (typeof value.source.origin !== "string" || !["user-provided", "youtube-dom", "public-page"].includes(value.source.origin)) throw new Error("Origem do material desconhecida.");
  const origin = value.source.origin as ReportOrigin, label = text(value.source.label, "Referência da origem", 300);
  let source: ReportAnnotation["source"];
  if (value.source.kind === "declaration") source = { kind: "declaration", origin, label };
  else if (typeof value.source.kind === "string" && ["material", "transcript", "comments"].includes(value.source.kind)) {
    const material = text(value.source.text, "Material fornecido", MAX_REPORT_SOURCE_TEXT), quote = text(value.source.quote, "Trecho literal", MAX_REPORT_QUOTE);
    if (!material.includes(quote)) throw new Error("O trecho literal deve estar presente, sem alterações, no material fornecido.");
    source = { kind: value.source.kind as "material" | "transcript" | "comments", origin, label, text: material, quote };
  } else throw new Error("Escolha declaração ou uma fonte de material conhecida.");
  return { id, group: value.group as ReportGroupId, statement, coverage: value.coverage as ReportCoverage, target, source };
}

export function validateReportAnnotation(value: unknown, input: readonly ReportVideo[]): ReportAnnotation { return annotation(value, input); }

/** Organizes only explicitly supplied annotations; no topic, strategy or causal inference. */
export function buildStructuredChannelReport(input: readonly ReportVideo[], entries: readonly unknown[] = [], manual?: ManualTranscript): StructuredChannelReport {
  const mechanical = buildChannelReport(input, manual), rejected: StructuredChannelReport["structured"]["rejected"] = [], valid: PreparedAnnotation[] = [], seen = new Set<string>();
  if (entries.length > MAX_REPORT_ANNOTATIONS) rejected.push({ index: MAX_REPORT_ANNOTATIONS, reason: `Limite de ${MAX_REPORT_ANNOTATIONS} anotações excedido; ${entries.length - MAX_REPORT_ANNOTATIONS} entradas extras foram excluídas.` });
  for (let index = 0; index < Math.min(entries.length, MAX_REPORT_ANNOTATIONS); index++) {
    try {
      const entry = annotation(entries[index], input);
      if (seen.has(entry.id)) throw new Error("ID de anotação repetido."); seen.add(entry.id);
      const { source } = entry;
      valid.push({ ...entry, target: { ...entry.target }, source: { kind: source.kind, origin: source.origin, label: source.label, ...(source.kind === "declaration" ? {} : { quote: source.quote }) }, basis: source.kind === "declaration" ? "user-declaration" : "provided-excerpt", verification: source.kind === "declaration" ? "not-verified" : "literal-match-only", referencedVideoIds: entry.target.kind === "video" ? [entry.target.id] : [...entry.target.videoIds] });
    } catch (error) { rejected.push({ index, reason: error instanceof Error ? error.message : "Anotação inválida." }); }
  }
  return {
    ...mechanical,
    structured: {
      method: "manual-provided-material", context: channelReportContext(input), rejected,
      groups: REPORT_GROUPS.map(group => {
        const entries = valid.filter(entry => entry.group === group.id), referenced = new Set(entries.flatMap(entry => entry.referencedVideoIds)).size;
        return { ...group, status: entries.length ? "available" : "unknown", ...(!entries.length ? { reason: "Nenhuma declaração ou evidência elegível fornecida para este grupo." } : {}), coverage: { eligibleVideos: mechanical.scope.included, referencedVideos: referenced, unreferencedVideos: mechanical.scope.included - referenced }, entries };
      }),
    },
    limitations: [...mechanical.limitations,
      "Grupos estruturados organizam declarações e material fornecido explicitamente pelo usuário. Não houve IA, detecção automática de tópicos, inferência de nicho/estratégia ou validação de desempenho, causalidade ou finanças.",
      "Origem, associação ao vídeo/canal e cobertura são declaradas. Trecho literal confirma somente presença no texto fornecido, não a autenticidade da fonte ou o apoio à interpretação.",
      "Cobertura por grupo conta IDs elegíveis explicitamente associados, não vídeos integralmente analisados. Declaração de canal exige channelId e IDs da amostra; nome/handle não agrega canais.",
      "Até 32 anotações em memória; material de até 6000 caracteres e trecho literal de até 600 por anotação. O relatório exporta o trecho, não o material completo; o backup explícito inclui o material.",
    ],
  };
}

export function serializeReportDraft(input: readonly ReportVideo[], entries: readonly unknown[]): string {
  if (entries.length > MAX_REPORT_ANNOTATIONS) throw new Error(`Limite de ${MAX_REPORT_ANNOTATIONS} anotações excedido.`);
  const normalized = entries.map(entry => annotation(entry, input));
  if (new Set(normalized.map(entry => entry.id)).size !== normalized.length) throw new Error("ID de anotação repetido.");
  const value = JSON.stringify({ schema: "prevlev-channel-report-draft", version: 1, context: channelReportContext(input), entries: normalized }, null, 2);
  if (new TextEncoder().encode(value).length > MAX_REPORT_DRAFT_BYTES) throw new Error("Backup excede 256 KiB; reduza o material fornecido.");
  return value;
}
export function parseReportDraft(value: string, input: readonly ReportVideo[]): ReportAnnotation[] {
  if (new TextEncoder().encode(value).length > MAX_REPORT_DRAFT_BYTES) throw new Error("Backup excede 256 KiB.");
  let draft: unknown;
  try { draft = JSON.parse(value); } catch { throw new Error("Backup JSON inválido."); }
  if (!ownObject(draft) || draft.schema !== "prevlev-channel-report-draft" || draft.version !== 1 || !Array.isArray(draft.entries)) throw new Error("Formato de backup desconhecido.");
  if (draft.context !== channelReportContext(input)) throw new Error("O backup pertence a outra amostra. Restaure a mesma coleção antes de importar.");
  if (draft.entries.length > MAX_REPORT_ANNOTATIONS) throw new Error(`Limite de ${MAX_REPORT_ANNOTATIONS} anotações excedido.`);
  const entries = draft.entries.map(entry => annotation(entry, input));
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error("ID de anotação repetido.");
  return entries;
}

export function channelReportJson(report: StructuredChannelReport): string { return JSON.stringify(report, null, 2); }
export function channelReportCsv(report: StructuredChannelReport): string {
  const rows: Record<string, unknown>[] = [];
  for (const [group, values] of Object.entries({ scope: report.scope, content: report.content, titles: report.titles, transcript: report.transcript })) for (const [metric, value] of Object.entries(values)) rows.push({ group, metric, value });
  for (const group of report.structured.groups) {
    rows.push({ group: group.id, metric: "status", value: group.status, coverage: group.coverage, reason: group.reason });
    for (const entry of group.entries) rows.push({ group: group.id, metric: "annotation", value: entry.statement, id: entry.id, target: entry.target, coverage: entry.coverage, source: entry.source.label, source_origin: entry.source.origin, source_kind: entry.source.kind, quote: entry.source.quote, verification: entry.verification, referenced_video_ids: entry.referencedVideoIds });
  }
  for (const issue of report.structured.rejected) rows.push({ group: "rejected", metric: issue.index, reason: issue.reason });
  for (const limitation of report.limitations) rows.push({ group: "limitations", value: limitation });
  rows.push({ group: "context", value: report.structured.context });
  return toCsv(rows, ["group", "metric", "value", "id", "target", "coverage", "source", "source_origin", "source_kind", "quote", "verification", "referenced_video_ids", "reason"]);
}
const md = (value: unknown) => String(value ?? "desconhecido").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_{}[\]()#+!|]/g, "\\$&").replace(/\r?\n/g, " ");
export function channelReportMarkdown(report: StructuredChannelReport): string {
  const lines = ["# Relatório local da amostra", "", "Organização manual de material fornecido; sem IA ou inferência automática.", ""];
  for (const [group, values] of Object.entries({ "Amostra e origem": report.scope, "Formatos": report.content, "Títulos mecânicos": report.titles, "WPM declarado": report.transcript })) {
    lines.push(`## ${group}`, "");
    for (const [key, value] of Object.entries(values)) lines.push(`- ${key}: ${md(typeof value === "object" ? JSON.stringify(value) : value)}`);
    lines.push("");
  }
  for (const group of report.structured.groups) {
    lines.push(`## ${group.label}`, "", `${group.status === "unknown" ? "Desconhecido" : "Material declarado disponível"}. IDs associados: ${group.coverage.referencedVideos}/${group.coverage.eligibleVideos}.`, "");
    if (group.reason) lines.push(md(group.reason), "");
    for (const entry of group.entries) lines.push(`- ${md(entry.statement)}`, `  - Alvo: ${md(JSON.stringify(entry.target))}; cobertura declarada: ${entry.coverage}.`, `  - Origem declarada: ${md(entry.source.label)} (${entry.source.origin}, ${entry.source.kind}); verificação: ${entry.verification}.`, ...(entry.source.quote ? [`  - Trecho literal fornecido: ${md(entry.source.quote)}`] : []), "");
  }
  if (report.structured.rejected.length) lines.push("## Anotações recusadas", "", ...report.structured.rejected.map(issue => `- ${issue.index + 1}: ${md(issue.reason)}`), "");
  lines.push("## Limites", "", ...report.limitations.map(item => `- ${md(item)}`), "", "## Contexto da amostra", "", md(report.structured.context), "");
  return lines.join("\n");
}
