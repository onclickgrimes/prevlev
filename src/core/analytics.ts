import type { VideoRecord } from "../shared/types";
import { filterVideos, lifetimeVph, median as coreMedian, outlierScore, validateVideoFilter, type VideoFilter } from "./metrics";

export type VideoSource = "youtube-dom" | "public-page" | "user-provided" | "youtube-data-api";
type LocalVideo = VideoRecord & { source?: VideoSource; observedAt?: string };
export interface AnalyticsOptions { now?: number; publishedAfter?: string; publishedBefore?: string; filter?: VideoFilter }
export interface CoverageCount { known: number; missing: number }
export interface AnalyticsVideo {
  id: string; title: string; url: string; channel?: string; views?: number;
  publishedAt?: string; durationSeconds?: number; format: "short" | "long" | "unknown";
  lifetimeVph?: number; outlierScore?: number; source?: VideoSource;
}
export interface ChannelAnalytics {
  key: string; label: string; videoCount: number; knownViews: number; missingViews: number;
  totalViews?: number; meanViews?: number; medianViews?: number;
  meanLifetimeVph?: number; medianLifetimeVph?: number;
  shorts: number; longs: number; unknownFormats: number;
}
export interface MonthAnalytics {
  month: string; videoCount: number; knownViews: number; missingViews: number; totalViews?: number;
  knownDurationCount: number; missingDurationCount: number; totalDurationSeconds?: number;
}
export interface AnalyticsReport {
  generatedAt: string;
  scope: { inputCount: number; includedCount: number; excludedApiCount: number; excludedDuplicateCount: number; excludedByDateCount: number; excludedByFilterCount: number; publishedAfter?: string; publishedBefore?: string; filter?: VideoFilter };
  coverage: { views: CoverageCount; publicationDate: CoverageCount; duration: CoverageCount; channel: CoverageCount };
  totals: { knownViews?: number; meanViews?: number; medianViews?: number; meanLifetimeVph?: number; medianLifetimeVph?: number; knownDurationSeconds?: number };
  formats: { short: number; long: number; unknown: number };
  provenance: Record<VideoSource | "unspecified", number>;
  channels: ChannelAnalytics[]; publicationMonths: MonthAnalytics[];
  medianPublishGapDays?: number; videos: AnalyticsVideo[]; topVideos: AnalyticsVideo[];
  limitations: string[];
}

/** Derives a report only from local/user observations; official API rows are excluded. */
export function buildAnalyticsReport(videos: readonly LocalVideo[], options: AnalyticsOptions = {}): AnalyticsReport {
  const now = options.now ?? Date.now();
  validateNow(now);
  const filter: VideoFilter = { ...options.filter };
  if (options.publishedAfter !== undefined) filter.publishedAfter = options.publishedAfter;
  if (options.publishedBefore !== undefined) filter.publishedBefore = options.publishedBefore;
  validateVideoFilter(filter);
  const dates = { publishedAfter: filter.publishedAfter, publishedBefore: filter.publishedBefore };
  const eligible = videos.filter(video => video.source !== "youtube-data-api");
  const unique = deduplicateVideos(eligible, now);
  const baseline = unique.videos.map(video => ({ ...video, views: knownCount(video.views), subscribers: knownCount(video.subscribers), durationSeconds: knownCount(video.durationSeconds), publishedAt: validDate(video.publishedAt, now)?.iso }));
  const included = filterVideos(baseline, filter, now);
  const dateIncludedCount = filterVideos(baseline, dates, now).length;
  const views = numbers(included.map(video => video.views));
  const durations = numbers(included.map(video => video.durationSeconds));
  const rates = numbers(included.map(video => lifetimeVph(video, now)));
  const identities = channelGroups(included);
  const channelBuckets = new Map<string, { label: string; videos: LocalVideo[] }>();
  const monthBuckets = new Map<string, LocalVideo[]>();
  const provenance: AnalyticsReport["provenance"] = { "youtube-dom": 0, "public-page": 0, "user-provided": 0, "youtube-data-api": 0, unspecified: 0 };
  const formats = { short: 0, long: 0, unknown: 0 };
  const rows: AnalyticsVideo[] = [];
  for (const video of included) {
    const identity = identities.get(video);
    if (identity) {
      const group = channelBuckets.get(identity.key) ?? { label: identity.label, videos: [] };
      group.videos.push(video); channelBuckets.set(identity.key, group);
    }
    if (video.publishedAt) {
      const month = video.publishedAt.slice(0, 7);
      const group = monthBuckets.get(month) ?? []; group.push(video); monthBuckets.set(month, group);
    }
    const source = (video as LocalVideo).source;
    if (source && Object.hasOwn(provenance, source)) provenance[source]++; else provenance.unspecified++;
    const format = video.isShort === true ? "short" : video.isShort === false ? "long" : "unknown";
    formats[format]++;
    rows.push({ id: video.id, title: video.title, url: video.url, channel: video.channel, views: video.views, publishedAt: video.publishedAt, durationSeconds: video.durationSeconds, format, lifetimeVph: lifetimeVph(video, now), outlierScore: knownCount(outlierScore(video, baseline)), source });
  }
  const knownDates = included.filter(video => video.publishedAt !== undefined).length;
  const channels: ChannelAnalytics[] = [...channelBuckets].map(([key, group]) => {
    const knownViews = numbers(group.videos.map(video => video.views));
    const knownRates = numbers(group.videos.map(video => lifetimeVph(video, now)));
    return { key, label: group.label, videoCount: group.videos.length, knownViews: knownViews.length, missingViews: group.videos.length - knownViews.length, totalViews: total(knownViews), meanViews: mean(knownViews), medianViews: median(knownViews), meanLifetimeVph: mean(knownRates), medianLifetimeVph: median(knownRates), shorts: group.videos.filter(video => video.isShort === true).length, longs: group.videos.filter(video => video.isShort === false).length, unknownFormats: group.videos.filter(video => video.isShort === undefined).length };
  }).sort((left, right) => left.label.localeCompare(right.label) || left.key.localeCompare(right.key));
  const publicationMonths: MonthAnalytics[] = [...monthBuckets].map(([month, group]) => {
    const knownViews = numbers(group.map(video => video.views)), knownDurations = numbers(group.map(video => video.durationSeconds));
    return { month, videoCount: group.length, knownViews: knownViews.length, missingViews: group.length - knownViews.length, totalViews: total(knownViews), knownDurationCount: knownDurations.length, missingDurationCount: group.length - knownDurations.length, totalDurationSeconds: total(knownDurations) };
  }).sort((left, right) => left.month.localeCompare(right.month));
  const publicationTimes = [...new Set(included.flatMap(video => video.publishedAt ? [Date.parse(video.publishedAt)] : []))].sort((left, right) => left - right);
  const gaps = publicationTimes.slice(1).map((time, index) => (time - publicationTimes[index]) / 86_400_000);
  const limitations = [
    "A amostra contém somente vídeos carregados ou fornecidos; não representa o catálogo completo de um canal nem tráfego oficial.",
    "Visualizações são contadores observados, não visualizações recebidas no período selecionado; as datas filtram a publicação dos vídeos.",
    "VPH é a média de visualizações desde a publicação, não a contagem dos últimos 60 minutos. Datas relativas coletadas podem ser aproximadas.",
    "Outlier usa a amostra completa anterior ao filtro de datas, com pelo menos três referências do mesmo formato e identidade de canal conhecida; alvo sem identidade usa a amostra geral.",
    "Meses de publicação usam UTC. Intervalos são lacunas entre datas distintas da amostra combinada, sem interpolar publicações ausentes nem prever frequência futura de um canal.",
    "Receita, RPM, lucro, geografia e monetização não são conhecidos por estes dados e não são estimados neste relatório.",
  ];
  if (videos.length !== eligible.length) limitations.push(`${videos.length - eligible.length} registros marcados como youtube-data-api foram excluídos; o relatório não calcula métricas derivadas sobre dados da API oficial.`);
  if (unique.excluded) limitations.push(`${unique.excluded} registros repetidos por ID foram excluídos antes dos filtros e cálculos. Foi preservado o registro inteiro com observedAt completo válido mais recente; sem esse timestamp, ou em empate, vale a primeira entrada. Contadores de registros diferentes não foram combinados.`);
  if (unique.conflicts) limitations.push(`${unique.conflicts} duplicatas tinham contadores ou metadados conflitantes; a regra explícita de seleção acima foi aplicada, sem somar versões do mesmo vídeo.`);
  if (provenance.unspecified) limitations.push(`${provenance.unspecified} registros incluídos não declaram origem. Ausência de origem não foi interpretada como API oficial.`);
  if (dates.publishedAfter !== undefined || dates.publishedBefore !== undefined) limitations.push("O filtro de publicação exclui vídeos com datas ausentes, inválidas ou futuras. Cobertura e totais descrevem somente os vídeos incluídos.");
  if (included.length < baseline.length) limitations.push("Filtros locais restringem a amostra exibida. Os totais e a cobertura descrevem somente os vídeos incluídos; a referência de outlier preserva a amostra completa elegível.");
  if (rows.some(video => !video.publishedAt)) limitations.push("Datas ausentes, inválidas ou futuras permanecem desconhecidas e ficam fora dos agrupamentos mensais e do cálculo de VPH.");
  if (views.length && total(views) === undefined || durations.length && total(durations) === undefined) limitations.push("Somas fora do intervalo numérico disponível permanecem desconhecidas; não foram convertidas em infinito nem zero.");
  return {
    generatedAt: new Date(now).toISOString(),
    scope: { inputCount: videos.length, includedCount: included.length, excludedApiCount: videos.length - eligible.length, excludedDuplicateCount: unique.excluded, excludedByDateCount: baseline.length - dateIncludedCount, excludedByFilterCount: baseline.length - included.length, ...dates, filter },
    coverage: { views: coverage(included.length, views.length), publicationDate: coverage(included.length, knownDates), duration: coverage(included.length, durations.length), channel: coverage(included.length, identities.size) },
    totals: { knownViews: total(views), meanViews: mean(views), medianViews: median(views), meanLifetimeVph: mean(rates), medianLifetimeVph: median(rates), knownDurationSeconds: total(durations) },
    formats, provenance, channels, publicationMonths, medianPublishGapDays: median(gaps), videos: rows,
    topVideos: [...rows].sort((left, right) => left.views === undefined ? right.views === undefined ? 0 : 1 : right.views === undefined ? -1 : right.views - left.views).slice(0, 20), limitations,
  };
}

export interface HistoryObservation { videoId: string; observedAt: string; views?: number; subscribers?: number; source?: VideoSource }
export interface HistoryChange { videoId: string; from: string; to: string; elapsedHours: number; viewsDelta?: number; viewsPerHour?: number; subscribersDelta?: number; subscribersPerHour?: number }
export interface HistoryTrend { observations: HistoryObservation[]; changes: HistoryChange[]; excludedApiCount: number; warnings: string[] }

/** Pairs actual known endpoints per metric; never fills missing dates or counters. */
export function deriveHistoryTrend(records: readonly HistoryObservation[], now = Date.now()): HistoryTrend {
  validateNow(now);
  const warnings: string[] = [];
  const excludedApiCount = records.filter(record => record.source === "youtube-data-api").length;
  const buckets = new Map<string, HistoryObservation[]>();
  for (const record of records) {
    if (record.source === "youtube-data-api") continue;
    const date = record.observedAt.includes("T") ? validDate(record.observedAt, now) : undefined;
    if (!record.videoId.trim() || !date) { warnings.push("Observação sem ID ou sem timestamp completo válido com fuso, ou com data futura, foi excluída."); continue; }
    const key = JSON.stringify([record.videoId, date.iso]);
    const group = buckets.get(key) ?? [];
    group.push({ ...record, observedAt: date.iso, views: knownCount(record.views), subscribers: knownCount(record.subscribers) }); buckets.set(key, group);
    if (record.views !== undefined && knownCount(record.views) === undefined || record.subscribers !== undefined && knownCount(record.subscribers) === undefined) warnings.push("Contador absoluto inválido permanece desconhecido; não foi convertido em zero.");
  }
  const observations: HistoryObservation[] = [...buckets.values()].map(group => {
    if (group.length === 1) return group[0];
    const views = new Set(numbers(group.map(record => record.views))), subscribers = new Set(numbers(group.map(record => record.subscribers)));
    if (views.size > 1 || subscribers.size > 1) warnings.push("Contadores conflitantes no mesmo instante permanecem desconhecidos; nenhuma taxa foi calculada com o valor conflitante.");
    return { ...group[0], views: views.size === 1 ? [...views][0] : undefined, subscribers: subscribers.size === 1 ? [...subscribers][0] : undefined };
  }).sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt) || left.videoId.localeCompare(right.videoId));
  const grouped = new Map<string, HistoryObservation[]>();
  for (const observation of observations) { const group = grouped.get(observation.videoId) ?? []; group.push(observation); grouped.set(observation.videoId, group); }
  const changes = new Map<string, HistoryChange>();
  for (const group of grouped.values()) {
    for (const metric of ["views", "subscribers"] as const) {
      let previous: HistoryObservation | undefined;
      for (const observation of group) {
        const value = observation[metric];
        if (value === undefined) continue;
        if (previous) {
          const elapsedHours = (Date.parse(observation.observedAt) - Date.parse(previous.observedAt)) / 3_600_000;
          const delta = value - previous[metric]!;
          const key = JSON.stringify([observation.videoId, previous.observedAt, observation.observedAt]);
          const change = changes.get(key) ?? { videoId: observation.videoId, from: previous.observedAt, to: observation.observedAt, elapsedHours };
          const rate = delta / elapsedHours;
          if (metric === "views") { change.viewsDelta = delta; change.viewsPerHour = Number.isFinite(rate) ? rate : undefined; }
          else { change.subscribersDelta = delta; change.subscribersPerHour = Number.isFinite(rate) ? rate : undefined; }
          if (!Number.isFinite(rate)) warnings.push("Taxa fora da precisão numérica disponível permanece desconhecida; a diferença observada foi preservada.");
          changes.set(key, change);
          if (delta < 0) warnings.push(`Contador de ${metric === "views" ? "visualizações" : "inscritos"} diminuiu em ${observation.videoId}; a diferença negativa foi preservada como possível revisão do contador.`);
        }
        previous = observation;
      }
    }
  }
  if (excludedApiCount) warnings.push(`${excludedApiCount} observações da API oficial foram excluídas das métricas derivadas.`);
  warnings.push("Diferenças e taxas usam somente instantes realmente observados; não há histórico retroativo, interpolação, previsão nem estimativa financeira.");
  return { observations, changes: [...changes.values()].sort((left, right) => Date.parse(left.to) - Date.parse(right.to) || left.videoId.localeCompare(right.videoId) || Date.parse(left.from) - Date.parse(right.from)), excludedApiCount, warnings: [...new Set(warnings)] };
}

/** One row per included video; undefined fields stay empty when passed to toCsv. */
export function reportRows(report: AnalyticsReport): Record<string, unknown>[] {
  return report.videos.map(video => ({ video_id: video.id, title: video.title, url: video.url, channel: video.channel, source: video.source, format: video.format, observed_views: video.views, published_at: video.publishedAt, duration_seconds: video.durationSeconds, lifetime_average_vph: video.lifetimeVph, sample_outlier: video.outlierScore }));
}

export function reportMarkdown(report: AnalyticsReport): string {
  const value = (number: number | undefined) => number === undefined ? "desconhecido" : String(number);
  return ["# Relatório local Prevlev", "", `Gerado em ${report.generatedAt}. Amostra incluída: ${report.scope.includedCount}/${report.scope.inputCount} vídeos.`, "", `Visualizações conhecidas: ${value(report.totals.knownViews)}. Média: ${value(report.totals.meanViews)}. Mediana: ${value(report.totals.medianViews)}.`, `VPH médio desde publicação: ${value(report.totals.meanLifetimeVph)}. Intervalo mediano observado entre publicações: ${value(report.medianPublishGapDays)} dias.`, "", "| Vídeo | Canal | Views observadas | VPH médio histórico |", "| --- | --- | --- | --- |", ...report.topVideos.map(video => `| ${markdown(video.title)} | ${markdown(video.channel ?? "desconhecido")} | ${value(video.views)} | ${value(video.lifetimeVph)} |`), "", "## Limites dos dados", "", ...report.limitations.map(limitation => `- ${markdown(limitation)}`), ""].join("\n");
}

function knownCount(value: number | undefined): number | undefined { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined; }
function deduplicateVideos(videos: readonly LocalVideo[], now: number): { videos: LocalVideo[]; excluded: number; conflicts: number } {
  const selected: LocalVideo[] = [], indices = new Map<string, number>();
  let excluded = 0, conflicts = 0;
  const time = (video: LocalVideo) => video.observedAt?.includes("T") ? validDate(video.observedAt, now)?.time : undefined;
  const signature = (video: LocalVideo) => JSON.stringify([knownCount(video.views), knownCount(video.subscribers), knownCount(video.durationSeconds), video.publishedAt, video.channelId, video.channelUrl, video.channel, video.isShort, video.source]);
  for (const video of videos) {
    const key = /^[A-Za-z0-9_-]{1,128}$/.test(video.id) ? video.id : undefined;
    const index = key === undefined ? undefined : indices.get(key);
    if (index === undefined) { if (key !== undefined) indices.set(key, selected.length); selected.push(video); continue; }
    excluded++;
    const previous = selected[index];
    if (signature(previous) !== signature(video)) conflicts++;
    const previousTime = time(previous), nextTime = time(video);
    if (nextTime !== undefined && (previousTime === undefined || nextTime > previousTime)) selected[index] = video;
  }
  return { videos: selected, excluded, conflicts };
}
function numbers(values: readonly (number | undefined)[]): number[] { return values.filter((value): value is number => knownCount(value) !== undefined); }
function total(values: readonly number[]): number | undefined { if (!values.length) return undefined; const sum = values.reduce((sum, value) => sum + value, 0); return Number.isFinite(sum) ? sum : undefined; }
function mean(values: readonly number[]): number | undefined { return values.length ? knownCount(values.reduce((sum, value) => sum + value / values.length, 0)) : undefined; }
function median(values: readonly number[]): number | undefined {
  const value = coreMedian(values);
  if (value === undefined || Number.isFinite(value)) return value;
  // Halving each middle value avoids overflow from adding two individually finite counters.
  const sorted = [...values].sort((left, right) => left - right), middle = Math.floor(sorted.length / 2);
  return knownCount(sorted[middle - 1] / 2 + sorted[middle] / 2);
}
function coverage(count: number, known: number): CoverageCount { return { known, missing: count - known }; }
function validateNow(now: number): void { if (!Number.isFinite(now) || Math.abs(now) > 8_640_000_000_000_000) throw new Error("Informe um instante atual válido para o relatório."); }
function validDate(value: string | undefined, now: number): { iso: string; time: number } | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return undefined;
  try { validateVideoFilter({ publishedAfter: value }); } catch { return undefined; }
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= now ? { iso: new Date(time).toISOString(), time } : undefined;
}
interface Identity { id?: string; handle?: string; name?: string; ambiguous?: boolean }
function identity(video: VideoRecord): Identity {
  const rawId = video.channelId?.trim();
  let id = rawId && /^[A-Za-z0-9_-]{1,128}$/.test(rawId) ? rawId : undefined, handle: string | undefined;
  try {
    if (video.channelUrl) {
      const url = new URL(video.channelUrl);
      if (url.protocol === "https:" && ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname) && !url.username && !url.password && !url.port) {
        const path = decodeURIComponent(url.pathname).replace(/\/$/, "");
        const linkedId = /^\/channel\/([A-Za-z0-9_-]{1,128})$/.exec(path)?.[1];
        if (id && linkedId && id !== linkedId) return { ambiguous: true };
        id ??= linkedId;
        handle = /^\/@([\p{L}\p{N}_.\-·]{1,100})$/u.exec(path)?.[1].normalize("NFC").toLocaleLowerCase();
      }
    }
  } catch { /* Unrecognized URL does not establish identity. */ }
  const name = video.channel?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim().replace(/\s+/g, " ") || undefined;
  return { id, handle, name };
}
function channelGroups(videos: readonly LocalVideo[]): Map<VideoRecord, { key: string; label: string }> {
  const identities = videos.map(video => identity(video));
  const aliases = new Map<string, Set<string>>();
  for (const item of identities) if (!item.ambiguous && item.id && item.handle) { const ids = aliases.get(item.handle) ?? new Set<string>(); ids.add(item.id); aliases.set(item.handle, ids); }
  const groups = new Map<VideoRecord, { key: string; label: string }>();
  videos.forEach((video, index) => {
    const item = identities[index];
    if (item.ambiguous) return;
    const linkedIds = item.handle ? aliases.get(item.handle) : undefined;
    const id = item.id ?? (linkedIds?.size === 1 ? [...linkedIds][0] : undefined);
    const key = id ? `id:${id}` : item.handle ? `handle:${item.handle}` : item.name ? `name:${item.name}` : undefined;
    if (key) groups.set(video, { key, label: video.channel?.trim() || (id ? id : item.handle ? `@${item.handle}` : item.name!) });
  });
  return groups;
}
function markdown(text: string): string { return text.replace(/[\\`*_{}[\]<>#|]/g, "\\$&").replace(/\r?\n/g, " "); }
