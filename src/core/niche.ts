import type { VideoRecord } from "../shared/types";
import { channelIdentity, groupChannelIdentities, knownPublication } from "./observations";
import { lifetimeVph } from "./metrics";
import { researchComparison, type ResearchComparison, type ResearchComparisonMode } from "./research";

export type NichePreset = "all" | "viral-small" | "medium" | "new" | "recent" | "500k" | "1m" | "high-outlier" | "high-vph" | "manyviews-fewvideos";
export type NichePeriod = "all" | "week" | "month" | "3m" | "year";
export type NicheDuration = "all" | "under1" | "1to4" | "4to10" | "10to20" | "20to60" | "over60";
export interface NicheThresholds { viralViews: number; smallSubs: number; mediumSubs: number; newDays: number; recentDays: number; outlier: number; vph: number; channelViews: number; channelVideos: number }
export const DEFAULT_NICHE_THRESHOLDS: NicheThresholds = { viralViews: 100000, smallSubs: 10000, mediumSubs: 100000, newDays: 90, recentDays: 7, outlier: 5, vph: 1000, channelViews: 1000000, channelVideos: 10 };
export interface NicheOptions { now?: number; preset?: NichePreset; period?: NichePeriod; duration?: NicheDuration; channels?: string[]; thresholds?: NicheThresholds; comparisonMode?: ResearchComparisonMode }
export interface NicheRow {
  id: string; title: string; url: string; channel?: string; channelKey?: string; views?: number; subscribers?: number; publishedAt?: string; durationSeconds?: number; lifetimeVph?: number; outlier?: number; outlierReferences: number; viewsPerSubscriber?: number; source?: VideoRecord["source"];
  outlierComparisonMode: ResearchComparisonMode; outlierMethod: ResearchComparison["method"]; outlierReference: number | null;
  outlierReferenceStatus: "unknown" | "zero" | "available"; outlierScoreStatus: "unknown" | "available";
  outlierPositiveReferences: number; outlierProvenance: ResearchComparison["provenance"]; outlierLimitation: string;
  outlierScope: "eligible-input-before-filters"; outlierTargetExclusion: "same-video-id"; outlierCountUnit: "observations";
}
export interface NicheChannel { key: string; label: string; videoCount: number; knownViews: number; unknownViews: number; totalViews?: number; knownSubscribers: number; unknownSubscribers: number; minSubscribers?: number; maxSubscribers?: number; knownDates: number; unknownDates: number; uploads30: number; uploads90: number; uploads365: number; months: { month: string; count: number }[] }
export interface NicheReport { generatedAt: string; options: Required<Omit<NicheOptions, "now">>; scope: { input: number; excludedApi: number; duplicates: number; eligible: number; included: number }; availableChannels: { key: string; label: string }[]; coverage: Record<string, { known: number; unknown: number }>; distribution: { atLeast2: number; atLeast5: number; known: number; unknown: number }; channels: NicheChannel[]; videos: NicheRow[]; limitations: string[] }
const day = 86400000;
const known = (value: number | undefined): number | undefined => value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;

/** The niche channel mode is deliberately stricter than general research: a display
 * name alone cannot establish a channel reference. No median fallback is applied.
 */
function nicheComparison(video: VideoRecord, baseline: readonly VideoRecord[], mode: ResearchComparisonMode): ResearchComparison {
  const identity = channelIdentity(video);
  if (mode === "sample-channel-reference" && (identity.ambiguous || !identity.id && !identity.handle)) {
    return { referenceCount: 0, positiveReferenceCount: 0, method: "sample-channel-mean", provenance: "loaded-observations", limitation: "Referência de canal desconhecida: o modo de canal no nicho exige ID ou URL/handle explícito e não conflitante; nome isolado não basta. Nenhuma referência geral ou mediana substituta foi usada." };
  }
  return researchComparison(video, baseline, mode);
}

/** Analysis is restricted to the provided observations; API records are discarded before any derivation. */
export function buildNicheReport(input: readonly VideoRecord[], options: NicheOptions = {}): NicheReport {
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now) || Math.abs(now) > 8640000000000000) throw new Error("Instante atual inválido.");
  const thresholds = { ...DEFAULT_NICHE_THRESHOLDS, ...options.thresholds };
  if (Object.values(thresholds).some(value => !Number.isFinite(value) || value < 0) || !Number.isInteger(thresholds.channelVideos) || thresholds.mediumSubs < thresholds.smallSubs) throw new Error("Limiares devem ser não negativos; inscritos médios devem ser ao menos os inscritos pequenos e quantidade de vídeos deve ser inteira.");
  const preset = options.preset ?? "all", period = options.period ?? "all", duration = options.duration ?? "all", channels = options.channels ?? [], comparisonMode = options.comparisonMode === undefined ? "sample-median" : options.comparisonMode;
  if (!["sample-median", "sample-channel-reference"].includes(comparisonMode)) throw new Error("Modo de comparação de outlier desconhecido.");
  if (!(["all", "viral-small", "medium", "new", "recent", "500k", "1m", "high-outlier", "high-vph", "manyviews-fewvideos"] as string[]).includes(preset) || !(["all", "week", "month", "3m", "year"] as string[]).includes(period) || !(["all", "under1", "1to4", "4to10", "10to20", "20to60", "over60"] as string[]).includes(duration)) throw new Error("Filtro de nicho inválido.");
  const eligible = input.filter(video => video.source !== "youtube-data-api");
  const baseline: VideoRecord[] = [], indices = new Map<string, number>();
  let duplicates = 0;
  const observed = (video: VideoRecord) => video.observedAt?.includes("T") ? knownPublication(video.observedAt, now) : undefined;
  for (const video of eligible) {
    const index = /^[A-Za-z0-9_-]{1,128}$/.test(video.id) ? indices.get(video.id) : undefined;
    if (index === undefined) { if (/^[A-Za-z0-9_-]{1,128}$/.test(video.id)) indices.set(video.id, baseline.length); baseline.push(video); }
    else { duplicates++; const previous = observed(baseline[index]), next = observed(video); if (next !== undefined && (previous === undefined || next > previous)) baseline[index] = video; }
  }
  const identities = groupChannelIdentities(baseline);
  const available = new Map<string, string>();
  const groups = new Map<string, VideoRecord[]>();
  for (const video of baseline) { const identity = identities.get(video); if (identity) { available.set(identity.key, identity.label); const group = groups.get(identity.key) ?? []; group.push(video); groups.set(identity.key, group); } }
  const rows: NicheRow[] = baseline.map(video => {
    const views = known(video.views), subscribers = known(video.subscribers), published = video.publishedAt ? knownPublication(video.publishedAt, now) : undefined;
    const comparison = nicheComparison(video, baseline, comparisonMode);
    const ratio = views !== undefined && subscribers !== undefined && subscribers > 0 ? views / subscribers : undefined;
    return { id: video.id, title: video.title, url: video.url, channel: video.channel, channelKey: identities.get(video)?.key, views, subscribers, publishedAt: published === undefined ? undefined : new Date(published).toISOString(), durationSeconds: known(video.durationSeconds), lifetimeVph: lifetimeVph(video, now), outlier: comparison.score, outlierReferences: comparison.referenceCount, viewsPerSubscriber: ratio !== undefined && Number.isFinite(ratio) ? ratio : undefined, source: video.source,
      outlierComparisonMode: comparisonMode, outlierMethod: comparison.method, outlierReference: comparison.reference ?? null,
      outlierReferenceStatus: comparison.reference === undefined ? "unknown" : comparison.reference === 0 ? "zero" : "available", outlierScoreStatus: comparison.score === undefined ? "unknown" : "available",
      outlierPositiveReferences: comparison.positiveReferenceCount, outlierProvenance: comparison.provenance, outlierLimitation: comparison.limitation,
      outlierScope: "eligible-input-before-filters", outlierTargetExclusion: "same-video-id", outlierCountUnit: "observations",
    };
  });
  const periodDays: Record<NichePeriod, number> = { all: Infinity, week: 7, month: 30, "3m": 90, year: 365 };
  const bounds: Record<Exclude<NicheDuration, "all">, [number, number]> = { under1: [0, 60], "1to4": [60, 240], "4to10": [240, 600], "10to20": [600, 1200], "20to60": [1200, 3600], over60: [3600, Infinity] };
  const within = (row: NicheRow, days: number) => row.publishedAt !== undefined && now - Date.parse(row.publishedAt) <= days * day;
  const included = rows.filter(row => {
    if (channels.length && (!row.channelKey || !channels.includes(row.channelKey))) return false;
    if (period !== "all" && !within(row, periodDays[period])) return false;
    if (duration !== "all") { const [min, max] = bounds[duration]; if (row.durationSeconds === undefined || row.durationSeconds < min || row.durationSeconds >= max) return false; }
    switch (preset) {
      case "viral-small": return row.views !== undefined && row.views >= thresholds.viralViews && row.subscribers !== undefined && row.subscribers <= thresholds.smallSubs;
      case "medium": return row.subscribers !== undefined && row.subscribers > thresholds.smallSubs && row.subscribers <= thresholds.mediumSubs;
      case "new": return within(row, thresholds.newDays);
      case "recent": return within(row, thresholds.recentDays);
      case "500k": return row.views !== undefined && row.views >= 500000;
      case "1m": return row.views !== undefined && row.views >= 1000000;
      case "high-outlier": return row.outlier !== undefined && row.outlier >= thresholds.outlier;
      case "high-vph": return row.lifetimeVph !== undefined && row.lifetimeVph >= thresholds.vph;
      case "manyviews-fewvideos": { const group = row.channelKey ? groups.get(row.channelKey) : undefined; if (!group || group.length > thresholds.channelVideos || group.some(video => known(video.views) === undefined)) return false; const sum = group.reduce((total, video) => total + video.views!, 0); return Number.isFinite(sum) && sum >= thresholds.channelViews; }
      default: return true;
    }
  });
  const coverage: NicheReport["coverage"] = {};
  for (const [name, predicate] of Object.entries({ views: (r: NicheRow) => r.views !== undefined, subscribers: (r: NicheRow) => r.subscribers !== undefined, publicationDate: (r: NicheRow) => r.publishedAt !== undefined, duration: (r: NicheRow) => r.durationSeconds !== undefined, channel: (r: NicheRow) => r.channelKey !== undefined, vph: (r: NicheRow) => r.lifetimeVph !== undefined, outlier: (r: NicheRow) => r.outlier !== undefined, viewsPerSubscriber: (r: NicheRow) => r.viewsPerSubscriber !== undefined })) { const count = included.filter(predicate).length; coverage[name] = { known: count, unknown: included.length - count }; }
  const byChannel = new Map<string, NicheRow[]>();
  for (const row of included) if (row.channelKey) { const group = byChannel.get(row.channelKey) ?? []; group.push(row); byChannel.set(row.channelKey, group); }
  const channelReports = [...byChannel].map(([key, group]) => { const months = new Map<string, number>(); for (const row of group) if (row.publishedAt) { const month = row.publishedAt.slice(0, 7); months.set(month, (months.get(month) ?? 0) + 1); } const knownDates = group.filter(row => row.publishedAt !== undefined).length; const viewValues = group.flatMap(row => row.views === undefined ? [] : [row.views]); const subValues = group.flatMap(row => row.subscribers === undefined ? [] : [row.subscribers]); const sumViews = viewValues.reduce((sum, value) => sum + value, 0); return { key, label: available.get(key) ?? key, videoCount: group.length, knownViews: viewValues.length, unknownViews: group.length - viewValues.length, totalViews: viewValues.length && Number.isFinite(sumViews) ? sumViews : undefined, knownSubscribers: subValues.length, unknownSubscribers: group.length - subValues.length, minSubscribers: subValues.length ? subValues.reduce((minimum, value) => Math.min(minimum, value)) : undefined, maxSubscribers: subValues.length ? subValues.reduce((maximum, value) => Math.max(maximum, value)) : undefined, knownDates, unknownDates: group.length - knownDates, uploads30: group.filter(row => within(row, 30)).length, uploads90: group.filter(row => within(row, 90)).length, uploads365: group.filter(row => within(row, 365)).length, months: [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, count]) => ({ month, count })) }; }).sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
  return { generatedAt: new Date(now).toISOString(), options: { preset, period, duration, channels, thresholds, comparisonMode }, scope: { input: input.length, excludedApi: input.length - eligible.length, duplicates, eligible: baseline.length, included: included.length }, availableChannels: [...available].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key)), coverage, distribution: { atLeast2: included.filter(row => row.outlier !== undefined && row.outlier >= 2).length, atLeast5: included.filter(row => row.outlier !== undefined && row.outlier >= 5).length, known: coverage.outlier.known, unknown: coverage.outlier.unknown }, channels: channelReports, videos: included, limitations: ["Somente registros carregados ou fornecidos; não é índice global nem catálogo completo.", "Períodos filtram data de publicação; mês = 30 dias, 3 meses = 90 dias e ano = 365 dias, contados a partir do instante do cálculo. Contadores de views não são tráfego do período.", "Uploads por canal são somente publicações observadas entre os vídeos incluídos, não frequência global; datas ausentes não são contadas. Meses usam UTC. Views de canal somam apenas contadores conhecidos dos vídeos incluídos; inscritos exibem a faixa de valores observados, sem somá-los.", comparisonMode === "sample-median" ? "Outlier usa mediana da amostra elegível anterior aos filtros, mesmo canal e formato, excluindo o alvo e exigindo três referências; sem referência válida permanece desconhecido. VPH é média desde publicação." : "Outlier alternativo usa a referência média da amostra elegível do canal com ID ou URL/handle explícito e não conflitante, antes dos filtros, mínimo de três referências do mesmo formato, excluindo o alvo. Shorts usam a mediana positiva somente com ao menos dez referências positivas; abaixo disso usam a média declarada. Sem identidade robusta ou referência válida, permanece desconhecido, sem recorrer à mediana padrão. Esta regra de identidade é mais estrita que a pesquisa geral; não representa a média do catálogo completo. VPH é média desde publicação.", "Views por inscrito usa contador conhecido de views e denominador conhecido maior que zero; não é taxa de conversão.", "Duplicatas por ID conservam registro inteiro com observedAt válido mais recente, ou o primeiro em empate/ausência. Registros da API oficial são excluídos antes de cálculos e agrupamentos.", "O preset muitas views/poucos vídeos exige views conhecidas em todos os vídeos do canal elegível; os limiares são configuráveis e descrevem esta amostra."] };
}
export const NICHE_EXPORT_COLUMNS = [
  "video_id", "title", "url", "channel", "channel_key", "source", "views", "subscribers", "published_at", "duration_seconds", "lifetime_average_vph", "sample_outlier", "outlier_references", "views_per_subscriber",
  "outlier_comparison_mode", "outlier_method", "outlier_reference", "outlier_reference_status", "outlier_score_status", "outlier_positive_references", "outlier_provenance", "outlier_limitation", "outlier_scope", "outlier_target_exclusion", "outlier_count_unit",
] as const;

export function nicheRows(report: NicheReport): Record<string, unknown>[] {
  return report.videos.map(v => ({
    video_id: v.id, title: v.title, url: v.url, channel: v.channel, channel_key: v.channelKey, source: v.source, views: v.views, subscribers: v.subscribers, published_at: v.publishedAt, duration_seconds: v.durationSeconds, lifetime_average_vph: v.lifetimeVph, sample_outlier: v.outlier ?? null, outlier_references: v.outlierReferences, views_per_subscriber: v.viewsPerSubscriber,
    outlier_comparison_mode: v.outlierComparisonMode, outlier_method: v.outlierMethod, outlier_reference: v.outlierReference,
    outlier_reference_status: v.outlierReferenceStatus, outlier_score_status: v.outlierScoreStatus, outlier_positive_references: v.outlierPositiveReferences,
    outlier_provenance: v.outlierProvenance, outlier_limitation: v.outlierLimitation, outlier_scope: v.outlierScope,
    outlier_target_exclusion: v.outlierTargetExclusion, outlier_count_unit: v.outlierCountUnit,
  }));
}

export function nicheMarkdown(report: NicheReport): string {
  const escape = (text: string) => text.replace(/[\\`*_{}[\]<>#|]/g, "\\$&").replace(/\r?\n/g, " ");
  const value = (v: number | null | undefined) => v === undefined || v === null ? "desconhecido" : String(v);
  return [
    "# Nicho local Prevlev", "", `Gerado: ${report.generatedAt}; incluídos ${report.scope.included}/${report.scope.input}; API excluídos: ${report.scope.excludedApi}; duplicatas: ${report.scope.duplicates}.`,
    `Filtros e limiares: ${escape(JSON.stringify(report.options))}`,
    `Modo de outlier deste relatório: ${report.options.comparisonMode}. Base elegível anterior aos filtros; alvo excluído por ID. Contagens são observações elegíveis, não um catálogo completo.`, "",
    `Outliers ≥2×: ${report.distribution.atLeast2}; ≥5×: ${report.distribution.atLeast5}; conhecidos: ${report.distribution.known}; desconhecidos: ${report.distribution.unknown}.`, "",
    "| Vídeo | Canal | Views | Views/inscrito | Outlier | Método previsto | Referência | Candidatas | Positivas | Origem da referência | Estado do score / referência |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...report.videos.map(v => `| ${escape(v.title)} | ${escape(v.channel ?? "desconhecido")} | ${value(v.views)} | ${value(v.viewsPerSubscriber)} | ${value(v.outlier)} | ${v.outlierMethod} | ${value(v.outlierReference)} | ${v.outlierReferences} | ${v.outlierPositiveReferences} | ${v.outlierProvenance} | ${v.outlierScoreStatus} / ${v.outlierReferenceStatus} |`),
    "", "## Limites por comparação", ...report.videos.map(v => `- ${escape(v.title)} (${escape(v.id)}): ${escape(v.outlierLimitation)}`),
    "", "## Publicações observadas por canal",
    ...report.channels.map(c => `- ${escape(c.label)}: views conhecidas ${value(c.totalViews)} (${c.knownViews} conhecidos, ${c.unknownViews} desconhecidos), inscritos observados ${value(c.minSubscribers)}–${value(c.maxSubscribers)} (${c.knownSubscribers} conhecidos, ${c.unknownSubscribers} desconhecidos); 30d ${c.uploads30}, 90d ${c.uploads90}, 365d ${c.uploads365}; datas desconhecidas ${c.unknownDates}; meses UTC ${c.months.map(m => `${m.month}: ${m.count}`).join(", ") || "desconhecido"}.`),
    "", "## Cobertura", ...Object.entries(report.coverage).map(([key, c]) => `- ${key}: ${c.known} conhecidos, ${c.unknown} desconhecidos.`),
    "", "## Limites", ...report.limitations.map(text => `- ${escape(text)}`), "",
  ].join("\n");
}
