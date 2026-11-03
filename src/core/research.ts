import type { VideoRecord } from "../shared/types";
import { filterVideos, lifetimeVph, median, validateVideoFilter, type VideoFilter } from "./metrics";
import { channelIdentity, comparableChannel, isoBoundary, knownPublication } from "./observations";

export type ResearchSurface = "home" | "subscriptions" | "search" | "channel" | "other";
export type ResearchSortKey = "views" | "vph" | "outlier" | "recent" | "duration" | "subscribers" | "title" | "viewsPerSubscriber";
export interface ResearchSortCriterion { key: ResearchSortKey; direction: "asc" | "desc" }
export type ResearchComparisonMode = "sample-median" | "sample-channel-reference";
export interface ResearchFilter extends VideoFilter {
  criteria?: ResearchSortCriterion[];
  priority?: "none" | "views-per-subscriber";
  comparisonMode?: ResearchComparisonMode;
  surface?: ResearchSurface;
  subscribersBelow?: number;
  publishedBeforeExclusive?: string;
  hideShortsOnFeed?: boolean;
  hideShortsOnSearch?: boolean;
}
export interface ResearchComparison { score?: number; reference?: number; referenceCount: number; positiveReferenceCount: number; method: "sample-median" | "sample-channel-mean" | "sample-shorts-median" | "not-applicable"; provenance: "loaded-observations" | "excluded-api"; limitation: string }
/** Counts are observations, not unique video IDs; all copies of the target ID are excluded. */
export function describeResearchComparison(comparison: ResearchComparison, mode: ResearchComparisonMode = "sample-median"): string {
  if (comparison.provenance === "excluded-api") return `API oficial excluída. Nenhum método, referência ou métrica derivada foi aplicado. ${comparison.limitation}`;
  return `Modo: ${mode}; método previsto: ${comparison.method}; referência: ${comparison.reference ?? "desconhecida"}; ${comparison.referenceCount} observações candidatas (${comparison.positiveReferenceCount} positivas). Fonte: observações carregadas anteriores aos filtros; formato declarado igual ou formato desconhecido em ambos, e canal comparável. Alvo sem identidade usa candidatos da amostra geral, mas o modo de canal não calcula referência sem identidade. Alvo excluído por ID; outras observações repetidas podem ser contadas. API oficial excluída. ${comparison.limitation}`;
}
export const researchSortKeys: readonly ResearchSortKey[] = ["views", "vph", "outlier", "recent", "duration", "subscribers", "title", "viewsPerSubscriber"];
export const researchSortLabels: Record<ResearchSortKey, string> = { views: "visualizações", vph: "VPH médio histórico", outlier: "outlier da amostra", recent: "data de publicação", duration: "duração", subscribers: "inscritos conhecidos", title: "título", viewsPerSubscriber: "views por inscrito conhecido" };
export const researchSurfaces: readonly ResearchSurface[] = ["home", "subscriptions", "search", "channel", "other"];

export function researchSurface(rawUrl: string): ResearchSurface {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || !["www.youtube.com", "youtube.com", "m.youtube.com"].includes(url.hostname) || url.username || url.password || url.port) return "other";
    if (url.pathname === "/results") return "search";
    if (url.pathname === "/feed/subscriptions") return "subscriptions";
    if (url.pathname === "/") return "home";
    if (/^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)(?:\/|$)/.test(url.pathname)) return "channel";
    return "other";
  } catch { return "other"; }
}

export function validateResearchFilter(filter: ResearchFilter): void {
  validateVideoFilter(filter);
  if (filter.surface !== undefined && !researchSurfaces.includes(filter.surface)) throw new Error("Contexto de pesquisa desconhecido.");
  if (filter.criteria !== undefined && (!Array.isArray(filter.criteria) || filter.criteria.length > 2)) throw new Error("Use no máximo dois critérios de ordenação.");
  const keys = new Set<string>();
  for (const criterion of filter.criteria ?? []) {
    if (!criterion || !researchSortKeys.includes(criterion.key) || !["asc", "desc"].includes(criterion.direction)) throw new Error("Critério ou direção de ordenação inválidos.");
    if (keys.has(criterion.key)) throw new Error("Os dois critérios de ordenação devem ser diferentes.");
    if (criterion.key === "viewsPerSubscriber" && filter.surface === "channel") throw new Error("A razão views por inscrito só está disponível fora de páginas de canal.");
    keys.add(criterion.key);
  }
  if (filter.priority !== undefined && !["none", "views-per-subscriber"].includes(filter.priority)) throw new Error("Prioridade de pesquisa inválida.");
  if (filter.priority === "views-per-subscriber" && filter.surface === "channel") throw new Error("A prioridade views por inscrito só está disponível fora de páginas de canal.");
  if (filter.comparisonMode !== undefined && !["sample-median", "sample-channel-reference"].includes(filter.comparisonMode)) throw new Error("Modo de comparação de outlier desconhecido.");
  if (filter.subscribersBelow !== undefined && (typeof filter.subscribersBelow !== "number" || !Number.isFinite(filter.subscribersBelow) || filter.subscribersBelow <= 0)) throw new Error("O limite exclusivo de inscritos deve ser finito e positivo.");
  if (filter.subscribersBelow !== undefined && filter.minSubscribers !== undefined && filter.minSubscribers >= filter.subscribersBelow) throw new Error("O mínimo de inscritos deve ser menor que o limite exclusivo.");
  if (filter.publishedBeforeExclusive !== undefined) {
    const before = isoBoundary(filter.publishedBeforeExclusive, false);
    if (filter.publishedAfter !== undefined && isoBoundary(filter.publishedAfter, false) >= before) throw new Error("O início da publicação deve preceder o limite final exclusivo.");
  }
  for (const key of ["hideShortsOnFeed", "hideShortsOnSearch"] as const) if (filter[key] !== undefined && typeof filter[key] !== "boolean") throw new Error("As preferências de Shorts devem ser booleanas.");
}

export function viewsPerSubscriber(video: VideoRecord): number | undefined {
  if (video.source === "youtube-data-api") return undefined;
  const views = count(video.views), subscribers = count(video.subscribers);
  if (views === undefined || subscribers === undefined || subscribers <= 0) return undefined;
  return finite(views / subscribers);
}

/** Optional sample formula. It cannot recover a complete channel's server-provided reference. */
export function researchComparison(video: VideoRecord, fullBaseline: readonly VideoRecord[], mode: ResearchComparisonMode = "sample-median"): ResearchComparison {
  if (video.source === "youtube-data-api") return { referenceCount: 0, positiveReferenceCount: 0, method: "not-applicable", provenance: "excluded-api", limitation: "Dados da API oficial não recebem métricas derivadas." };
  const baseline = fullBaseline.filter(item => item.source !== "youtube-data-api");
  const identity = channelIdentity(video);
  const peers = baseline.filter(peer => peer.id !== video.id && peer.isShort === video.isShort && comparableChannel(identity, channelIdentity(peer)) && count(peer.views) !== undefined);
  const values = peers.map(peer => peer.views!);
  const positive = values.filter(value => value > 0);
  const limitation = "Comparação aproximada de observações carregadas. A referência completa do canal não é conhecida; não equivale ao índice proprietário da Nexlev.";
  if (mode === "sample-median") {
    const reference = values.length >= 3 ? sampleMedian(values) : undefined, views = count(video.views);
    return { score: views !== undefined && reference !== undefined && reference > 0 ? finite(views / reference) : undefined, reference, referenceCount: values.length, positiveReferenceCount: positive.length, method: "sample-median", provenance: "loaded-observations", limitation };
  }
  const method = video.isShort === true && positive.length >= 10 ? "sample-shorts-median" : "sample-channel-mean";
  const knownIdentity = !identity.ambiguous && !!(identity.id || identity.handle || identity.name);
  const reference = knownIdentity && values.length >= 3 ? method === "sample-shorts-median" ? sampleMedian(positive) : finite(values.reduce((sum, value) => sum + value / values.length, 0)) : undefined;
  const views = count(video.views);
  return { score: views !== undefined && reference !== undefined && reference > 0 ? finite(views / reference) : undefined, reference, referenceCount: values.length, positiveReferenceCount: positive.length, method, provenance: "loaded-observations", limitation };
}

/** Every sort uses the complete eligible baseline, even after filters restrict the rows. */
export function sortResearchVideos(videos: readonly VideoRecord[], filter: ResearchFilter & { sort?: string } = {}, now = Date.now(), fullBaseline: readonly VideoRecord[] = videos): VideoRecord[] {
  validateResearchFilter(filter);
  const eligible = videos.filter(video => video.source !== "youtube-data-api");
  const baseline = fullBaseline.filter(video => video.source !== "youtube-data-api");
  const legacy = filter.sort === "date" ? "recent" : filter.sort;
  const criteria = filter.criteria ?? (legacy && legacy !== "default" && researchSortKeys.includes(legacy as ResearchSortKey) ? [{ key: legacy as ResearchSortKey, direction: legacy === "title" ? "asc" : "desc" }] : []);
  const rankedCriteria: readonly ResearchSortCriterion[] = filter.priority === "views-per-subscriber" ? [{ key: "viewsPerSubscriber", direction: "desc" }, ...criteria.filter(criterion => criterion.key !== "viewsPerSubscriber")] : criteria;
  const scores = new Map<VideoRecord, Map<ResearchSortKey, number | string | undefined>>();
  for (const video of eligible) {
    const values = new Map<ResearchSortKey, number | string | undefined>();
    for (const { key } of rankedCriteria) values.set(key, key === "title" ? video.title.normalize("NFC").toLocaleLowerCase() : key === "views" ? count(video.views) : key === "subscribers" ? count(video.subscribers) : key === "duration" ? count(video.durationSeconds) : key === "recent" ? video.publishedAt ? knownPublication(video.publishedAt, now) : undefined : key === "vph" ? lifetimeVph(video, now) : key === "viewsPerSubscriber" ? viewsPerSubscriber(video) : researchComparison(video, baseline, filter.comparisonMode).score);
    scores.set(video, values);
  }
  return [...eligible].sort((left, right) => {
    for (const criterion of rankedCriteria) {
      const a = scores.get(left)!.get(criterion.key), b = scores.get(right)!.get(criterion.key);
      if (a === undefined || b === undefined) { if (a !== b) return a === undefined ? 1 : -1; continue; }
      const comparison = typeof a === "string" && typeof b === "string" ? a.localeCompare(b) : (a as number) - (b as number);
      if (comparison) return criterion.direction === "asc" ? comparison : -comparison;
    }
    return 0;
  });
}

export function selectResearchVideos(videos: readonly VideoRecord[], filter: ResearchFilter & { sort?: string } = {}, now = Date.now()): VideoRecord[] {
  validateResearchFilter(filter);
  const baseline = videos.filter(video => video.source !== "youtube-data-api");
  const basic: VideoFilter = { ...filter, minOutlier: undefined, maxOutlier: undefined };
  const selected = filterVideos(baseline, basic, now).filter(video => {
    if (filter.subscribersBelow !== undefined && (count(video.subscribers) === undefined || video.subscribers! >= filter.subscribersBelow)) return false;
    if (filter.publishedBeforeExclusive !== undefined && (!video.publishedAt || knownPublication(video.publishedAt, now) === undefined || knownPublication(video.publishedAt, now)! >= isoBoundary(filter.publishedBeforeExclusive, false))) return false;
    if (video.isShort === true && (filter.hideShortsOnSearch && filter.surface === "search" || filter.hideShortsOnFeed && (filter.surface === "home" || filter.surface === "subscriptions"))) return false;
    if (filter.minOutlier !== undefined || filter.maxOutlier !== undefined) { const score = researchComparison(video, baseline, filter.comparisonMode).score; if (score === undefined || filter.minOutlier !== undefined && score < filter.minOutlier || filter.maxOutlier !== undefined && score > filter.maxOutlier) return false; }
    return true;
  });
  return sortResearchVideos(selected, filter, now, baseline);
}

export interface ResearchPreset { id: string; label: string; description: string; available: boolean; filter: ResearchFilter }
export function researchPresets(surface: ResearchSurface, now = Date.now()): ResearchPreset[] {
  if (!Number.isFinite(now) || Math.abs(now) > 8_640_000_000_000_000) throw new Error("Instante atual inválido para os atalhos.");
  const since = (days: number) => new Date(now - days * 86_400_000).toISOString();
  const sorted = (key: ResearchSortKey): ResearchFilter => ({ surface, criteria: [{ key, direction: "desc" }] });
  return [
    { id: "day-views", label: "Views nas publicações de 24 horas", description: "Publicados nas últimas 24 horas, por views observadas. Não mede tráfego nas últimas 24 horas.", available: true, filter: { ...sorted("views"), publishedAfter: since(1) } },
    { id: "week-recent", label: "Publicações recentes de 7 dias", description: "Publicados nos últimos 7 dias, mais recentes primeiro.", available: true, filter: { ...sorted("recent"), publishedAfter: since(7) } },
    { id: "million-month", label: "Um milhão em publicações de 30 dias", description: "Pelo menos 1 milhão de views e publicação nos últimos 30 dias.", available: true, filter: { ...sorted("views"), minViews: 1_000_000, publishedAfter: since(30) } },
    { id: "small-channel-50k", label: "50 mil views, canal abaixo de 10 mil", description: "Pelo menos 50 mil views e menos de 10 mil inscritos conhecidos.", available: true, filter: { ...sorted("views"), minViews: 50_000, subscribersBelow: 10_000 } },
    { id: "micro-channel-90d", label: "10 mil views em canal pequeno, 90 dias", description: "Pelo menos 10 mil views, menos de 5 mil inscritos e publicação nos últimos 90 dias.", available: true, filter: { ...sorted("views"), minViews: 10_000, subscribersBelow: 5_000, publishedAfter: since(90) } },
    { id: "growing-channel", label: "100 mil views, canal de 10 a 100 mil", description: "Pelo menos 100 mil views e entre 10 mil e 100 mil inscritos, incluindo os limites.", available: true, filter: { ...sorted("views"), minViews: 100_000, minSubscribers: 10_000, maxSubscribers: 100_000 } },
    { id: "lifetime-vph", label: "Maior VPH médio desde publicação", description: "Ordena pelo VPH médio histórico; não mede os últimos 60 minutos.", available: true, filter: sorted("vph") },
    { id: "sample-outlier", label: "Outlier da amostra a partir de 5×", description: surface === "channel" ? "Outlier local de pelo menos 5×." : "Outlier local de pelo menos 5× e canal abaixo de 50 mil inscritos.", available: true, filter: { ...sorted("outlier"), minOutlier: 5, ...(surface === "channel" ? {} : { subscribersBelow: 50_000 }) } },
    { id: "evergreen-vph", label: "Mais de 365 dias por VPH médio", description: "Publicados há mais de 365 dias, com maior VPH médio primeiro.", available: true, filter: { ...sorted("vph"), publishedBeforeExclusive: since(365) } },
    { id: "search-shorts", label: "Shorts por VPH na busca", description: "Somente na busca: Shorts por VPH médio histórico.", available: surface === "search", filter: { ...sorted("vph"), shorts: "only" } },
    { id: "deep-dives", label: "Explorar vídeos longos", description: surface === "channel" ? "Na página de canal: duração conhecida de pelo menos 20 minutos." : "Na busca: vídeos conhecidos como não Shorts.", available: surface === "search" || surface === "channel", filter: { ...sorted("views"), ...(surface === "channel" ? { minDurationSeconds: 1200 } : { shorts: "exclude" as const }) } },
  ];
}
export function researchPreset(id: string, surface: ResearchSurface, now = Date.now()): ResearchPreset { const preset = researchPresets(surface, now).find(preset => preset.id === id); if (!preset || !preset.available) throw new Error("Atalho indisponível neste contexto de página."); return preset; }
export function describeResearchFilter(filter: ResearchFilter): string {
  const parts: string[] = [];
  if (filter.query) parts.push(`texto “${filter.query}”`); if (filter.channel) parts.push(`canal “${filter.channel}”`);
  const labels = { minViews: "views mínimas", maxViews: "views máximas", minSubscribers: "inscritos mínimos", maxSubscribers: "inscritos máximos", minDurationSeconds: "duração mínima (s)", maxDurationSeconds: "duração máxima (s)", minVph: "VPH mínimo", maxVph: "VPH máximo", minOutlier: "outlier mínimo", maxOutlier: "outlier máximo" } as const;
  for (const key of Object.keys(labels) as (keyof typeof labels)[]) if (filter[key] !== undefined) parts.push(`${labels[key]}: ${filter[key]}`);
  if (filter.subscribersBelow !== undefined) parts.push(`inscritos estritamente abaixo de ${filter.subscribersBelow}`);
  if (filter.publishedAfter) parts.push(`publicação a partir de ${filter.publishedAfter}`); if (filter.publishedBefore) parts.push(`publicação até ${filter.publishedBefore}`); if (filter.publishedBeforeExclusive) parts.push(`publicação estritamente antes de ${filter.publishedBeforeExclusive}`);
  if (filter.shorts === "only") parts.push("somente Shorts"); if (filter.shorts === "exclude") parts.push("excluir Shorts");
  if (filter.hideShortsOnFeed) parts.push("ocultar Shorts no feed e inscrições"); if (filter.hideShortsOnSearch) parts.push("ocultar Shorts na busca");
  if (filter.priority === "views-per-subscriber") parts.push("prioridade por views / inscrito positivo conhecido");
  if (filter.criteria?.length) parts.push(`ordenação: ${filter.criteria.map(criterion => `${researchSortLabels[criterion.key]} ${criterion.direction === "asc" ? "crescente" : "decrescente"}`).join("; depois ")}`);
  if (filter.comparisonMode) parts.push(filter.comparisonMode === "sample-channel-reference" ? "outlier pela referência média da amostra do canal (Shorts: mediana com 10 positivos)" : "outlier pela mediana da amostra, mínimo 3 referências");
  return parts.length ? parts.join(" · ") : "nenhum limite adicional";
}
export function researchRows(videos: readonly VideoRecord[], fullBaseline: readonly VideoRecord[], filter: ResearchFilter, now = Date.now()): Record<string, unknown>[] {
  return videos.filter(video => video.source !== "youtube-data-api").map(video => {
    const comparison = researchComparison(video, fullBaseline, filter.comparisonMode);
    return { id: video.id, title: video.title, url: video.url, channel: video.channel, source: video.source, views: count(video.views), subscribers: count(video.subscribers), publishedAt: video.publishedAt, durationSeconds: count(video.durationSeconds), lifetimeVph: lifetimeVph(video, now), viewsPerSubscriber: viewsPerSubscriber(video), sampleOutlier: comparison.score, outlierReferenceCount: comparison.referenceCount, outlierMethod: comparison.method, outlierComparisonMode: filter.comparisonMode ?? "sample-median", outlierReference: comparison.reference ?? null, outlierReferenceStatus: comparison.reference === undefined ? "unknown" : comparison.reference === 0 ? "zero" : "available", outlierScoreStatus: comparison.score === undefined ? "unknown" : "available", outlierPositiveReferenceCount: comparison.positiveReferenceCount, outlierProvenance: comparison.provenance, outlierScope: "eligible-input-before-filters", outlierTargetExclusion: "same-video-id", outlierCountUnit: "observations" };
  });
}
export function researchMarkdown(videos: readonly VideoRecord[], fullBaseline: readonly VideoRecord[], filter: ResearchFilter, now = Date.now()): string {
  const escape = (text: unknown) => String(text ?? "desconhecido").replace(/[\\`*_{}[\]<>#|]/g, "\\$&").replace(/\r?\n/g, " ");
  const rows = researchRows(videos, fullBaseline, filter, now);
  return ["# Pesquisa local Prevlev", "", `${rows.length} vídeos de observações locais; contexto: ${filter.surface ?? "não informado"}. Modo de outlier: ${filter.comparisonMode ?? "sample-median"}.`, "", "| Vídeo | Canal | Views observadas | VPH médio histórico | Outlier local | Referência | Observações candidatas | Positivas | Método previsto |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |", ...rows.map(row => `| ${escape(row.title)} | ${escape(row.channel)} | ${escape(row.views)} | ${escape(row.lifetimeVph)} | ${escape(row.sampleOutlier)} | ${escape(row.outlierReference)} | ${escape(row.outlierReferenceCount)} | ${escape(row.outlierPositiveReferenceCount)} | ${escape(row.outlierMethod)} |`), "", "Fonte: observações carregadas elegíveis anteriores aos filtros, com formato declarado igual ou formato desconhecido em ambos, e canal comparável. Alvo sem identidade usa candidatos da amostra geral, mas o modo de canal não calcula referência sem identidade. Todos os registros com o ID do alvo são excluídos; outras observações repetidas podem ser contadas. API oficial excluída dos cálculos derivados. A amostra pode ser parcial e não é a referência completa do canal. Views não representam tráfego no período; VPH é médio desde a publicação. Receita/RPM não estimados.", ""].join("\n");
}
function count(value: number | undefined): number | undefined { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined; }
function finite(value: number | undefined): number | undefined { return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined; }
function sampleMedian(values: readonly number[]): number | undefined { const result = finite(median(values)); if (result !== undefined || !values.length) return result; const sorted = [...values].sort((left, right) => left - right), middle = Math.floor(sorted.length / 2); return finite(sorted[middle - 1] / 2 + sorted[middle] / 2); }
