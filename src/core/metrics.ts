import type { CommentRecord, VideoRecord } from "../shared/types";

export function median(values: readonly number[]): number | undefined {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length
    ? sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2
    : undefined;
}

/** Lifetime average, not the views received in the last 60 minutes. */
export function lifetimeVph(
  video: Pick<VideoRecord, "views" | "publishedAt">,
  now = Date.now(),
): number | undefined {
  if (
    video.views === undefined ||
    !Number.isFinite(video.views) ||
    video.views < 0 ||
    !video.publishedAt
  )
    return undefined;
  const published = knownPublication(video.publishedAt, now);
  if (published === undefined) return undefined;
  const age = (now - published) / 3_600_000;
  const rate = age > 0 ? video.views / age : undefined;
  return rate !== undefined && Number.isFinite(rate) ? rate : undefined;
}

/**
 * Excludes the target and requires at least three known comparable videos.
 * Known channels use their own identity; only an identity-free target uses the whole dataset.
 */
export function outlierScore(
  video: VideoRecord,
  baseline: readonly VideoRecord[],
): number | undefined {
  if (
    video.views === undefined ||
    !Number.isFinite(video.views) ||
    video.views < 0
  )
    return undefined;
  const channel = channelIdentity(video);
  const values = baseline
    .filter(
      (other) =>
        other.id !== video.id &&
        other.isShort === video.isShort &&
        comparableChannel(channel, channelIdentity(other)),
    )
    .map((other) => other.views)
    .filter(
      (value): value is number =>
        value !== undefined && Number.isFinite(value) && value >= 0,
    );
  if (values.length < 3) return undefined;
  const reference = median(values);
  return reference && reference > 0 ? video.views / reference : undefined;
}

export function summarizeVideos(
  videos: readonly VideoRecord[],
  now = Date.now(),
) {
  const views = videos
    .map((video) => video.views)
    .filter(
      (value): value is number =>
        value !== undefined && Number.isFinite(value) && value >= 0,
    );
  const rates = videos
    .map((video) => lifetimeVph(video, now))
    .filter((value): value is number => value !== undefined);
  const sum = views.reduce((total, value) => total + value, 0);
  return {
    count: videos.length,
    knownViews: views.length,
    totalViews: sum,
    meanViews: views.length ? sum / views.length : undefined,
    medianViews: median(views),
    medianVph: median(rates),
    shorts: videos.filter((video) => video.isShort).length,
    coverage: "loaded-videos" as const,
  };
}

export function netProfit(
  revenue: number,
  costPerVideo: number,
  videoCount: number,
): {
  revenue: number;
  cost: number;
  profit: number;
  margin: number | undefined;
} {
  if (
    ![revenue, costPerVideo, videoCount].every(Number.isFinite) ||
    costPerVideo < 0 ||
    videoCount < 0 ||
    !Number.isInteger(videoCount)
  )
    throw new Error(
      "Informe receita válida, custo não negativo e quantidade inteira não negativa.",
    );
  const cost = costPerVideo * videoCount;
  return {
    revenue,
    cost,
    profit: revenue - cost,
    margin: revenue ? ((revenue - cost) / revenue) * 100 : undefined,
  };
}

export interface VideoFilter {
  query?: string;
  minViews?: number;
  maxViews?: number;
  minSubscribers?: number;
  maxSubscribers?: number;
  minVph?: number;
  maxVph?: number;
  minOutlier?: number;
  maxOutlier?: number;
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  /** YYYY-MM-DD includes the start of that UTC day; timestamp bounds are exact. */
  publishedAfter?: string;
  /** YYYY-MM-DD includes the end of that UTC day; timestamp bounds are exact. */
  publishedBefore?: string;
  shorts?: "all" | "only" | "exclude";
  channel?: string;
}

/** Throws before filtering so an impossible range cannot silently hide every result. */
export function validateVideoFilter(filter: VideoFilter): void {
  const pairs = [
    ["minViews", "maxViews", "visualizações"],
    ["minSubscribers", "maxSubscribers", "inscritos"],
    ["minVph", "maxVph", "VPH"],
    ["minOutlier", "maxOutlier", "outlier"],
    ["minDurationSeconds", "maxDurationSeconds", "duração em segundos"],
  ] as const;
  for (const [minKey, maxKey, label] of pairs) {
    const min = filter[minKey],
      max = filter[maxKey];
    for (const value of [min, max]) {
      if (
        value !== undefined &&
        (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      )
        throw new Error(
          `O filtro de ${label} exige valores finitos não negativos.`,
        );
    }
    if (min !== undefined && max !== undefined && min > max)
      throw new Error(
        `No filtro de ${label}, o mínimo não pode superar o máximo.`,
      );
  }
  const after =
    filter.publishedAfter === undefined
      ? undefined
      : isoBoundary(filter.publishedAfter, false);
  const before =
    filter.publishedBefore === undefined
      ? undefined
      : isoBoundary(filter.publishedBefore, true);
  if (after !== undefined && before !== undefined && after > before)
    throw new Error(
      "A data inicial de publicação não pode superar a data final.",
    );
  if (
    filter.shorts !== undefined &&
    !["all", "only", "exclude"].includes(filter.shorts)
  )
    throw new Error("Selecione um filtro de Shorts válido.");
}

export function filterVideos(
  videos: readonly VideoRecord[],
  filter: VideoFilter,
  now = Date.now(),
): VideoRecord[] {
  validateVideoFilter(filter);
  const after =
    filter.publishedAfter === undefined
      ? undefined
      : isoBoundary(filter.publishedAfter, false);
  const before =
    filter.publishedBefore === undefined
      ? undefined
      : isoBoundary(filter.publishedBefore, true);
  const query = normalize(filter.query ?? "");
  return videos.filter((video) => {
    if (
      query &&
      !normalize(`${video.title} ${video.channel ?? ""}`).includes(query)
    )
      return false;
    if (
      filter.channel &&
      !normalize(
        `${video.channel ?? ""} ${video.channelId ?? ""} ${video.channelUrl ?? ""}`,
      ).includes(normalize(filter.channel))
    )
      return false;
    if (
      (filter.shorts === "only" && video.isShort !== true) ||
      (filter.shorts === "exclude" && video.isShort !== false)
    )
      return false;
    if (after !== undefined || before !== undefined) {
      const published = video.publishedAt
        ? knownPublication(video.publishedAt, now)
        : undefined;
      if (
        published === undefined ||
        (after !== undefined && published < after) ||
        (before !== undefined && published > before)
      )
        return false;
    }
    const constraints: [
      number | undefined,
      number | undefined,
      number | undefined,
    ][] = [
      [video.views, filter.minViews, filter.maxViews],
      [video.subscribers, filter.minSubscribers, filter.maxSubscribers],
      [
        video.durationSeconds,
        filter.minDurationSeconds,
        filter.maxDurationSeconds,
      ],
      [lifetimeVph(video, now), filter.minVph, filter.maxVph],
      [outlierScore(video, videos), filter.minOutlier, filter.maxOutlier],
    ];
    return constraints.every(
      ([value, min, max]) =>
        (min === undefined && max === undefined) ||
        (value !== undefined &&
          Number.isFinite(value) &&
          value >= 0 &&
          (min === undefined || value >= min) &&
          (max === undefined || value <= max)),
    );
  });
}

export function sortVideos(
  videos: readonly VideoRecord[],
  by:
    | "views"
    | "vph"
    | "outlier"
    | "recent"
    | "title"
    | "duration"
    | "subscribers",
  now = Date.now(),
  baseline: readonly VideoRecord[] = videos,
): VideoRecord[] {
  if (by === "title")
    return [...videos].sort((a, b) => a.title.localeCompare(b.title));
  const get = (video: VideoRecord): number | undefined => {
    if (by === "recent")
      return video.publishedAt
        ? knownPublication(video.publishedAt, now)
        : undefined;
    const value =
      by === "views"
        ? video.views
        : by === "duration"
          ? video.durationSeconds
          : by === "subscribers"
            ? video.subscribers
            : by === "vph"
              ? lifetimeVph(video, now)
              : outlierScore(video, baseline);
    return value !== undefined && Number.isFinite(value) && value >= 0
      ? value
      : undefined;
  };
  return [...videos].sort((a, b) => {
    const left = get(a),
      right = get(b);
    const knownLeft = left !== undefined && Number.isFinite(left),
      knownRight = right !== undefined && Number.isFinite(right);
    return knownLeft && knownRight
      ? right - left
      : knownLeft
        ? -1
        : knownRight
          ? 1
          : 0;
  });
}

export interface CommentFilter {
  query?: string;
  author?: string;
  questionsOnly?: boolean;
  minLikes?: number;
  minReplies?: number;
  hearted?: boolean;
}
export function filterComments(
  comments: readonly CommentRecord[],
  filter: CommentFilter,
): CommentRecord[] {
  return comments.filter(
    (comment) =>
      (!filter.query ||
        normalize(comment.text).includes(normalize(filter.query))) &&
      (!filter.author ||
        normalize(comment.author).includes(normalize(filter.author))) &&
      (!filter.questionsOnly || /[?？]/.test(comment.text)) &&
      (filter.minLikes === undefined || comment.likes >= filter.minLikes) &&
      (filter.minReplies === undefined ||
        comment.replies >= filter.minReplies) &&
      (filter.hearted === undefined || comment.hearted === filter.hearted),
  );
}

export interface MonetizationInference {
  status: "markers-present" | "unknown";
  confidence: "low";
  markers: string[];
  explanation: string;
}
export function inferMonetization(html: string): MonetizationInference {
  const patterns: [string, RegExp][] = [
    ["adPlacements", /"adPlacements"\s*:\s*\[\s*\{/],
    ["playerAds", /"playerAds"\s*:\s*\[\s*\{/],
    ["adSlots", /"adSlots"\s*:\s*\[\s*\{/],
    ["music-metadata", /"musicDescriptionShelfRenderer"\s*:/],
  ];
  const markers = patterns
    .filter(([, pattern]) => pattern.test(html))
    .map(([name]) => name);
  return {
    status: markers.length ? "markers-present" : "unknown",
    confidence: "low",
    markers,
    explanation: markers.length
      ? "Marcadores de anúncio ou música encontrados. Isso não confirma participação no YPP, monetização do canal nem recebimento de receita pelo criador."
      : "Nenhum marcador reconhecido foi encontrado nesta resposta. Ausência de marcadores não prova desmonetização.",
  };
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

/** Accept unambiguous ISO dates only, rejecting Date.parse's invalid-day rollover. */
function isoBoundary(value: string, endOfDay: boolean): number {
  if (typeof value !== "string")
    throw new Error(
      "Informe uma data ISO válida: AAAA-MM-DD ou timestamp com fuso horário.",
    );
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const timestamp =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!dateOnly && !timestamp)
    throw new Error(
      "Informe uma data ISO válida: AAAA-MM-DD ou timestamp com fuso horário.",
    );
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1])
    throw new Error("A data de publicação contém um dia ou mês inválido.");
  if (timestamp) {
    const zone = timestamp[8];
    if (
      Number(timestamp[4]) > 23 ||
      Number(timestamp[5]) > 59 ||
      Number(timestamp[6] ?? 0) > 59 ||
      (zone !== "Z" &&
        (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))
    )
      throw new Error("O horário ou fuso da data de publicação é inválido.");
  }
  const parsed = Date.parse(
    dateOnly
      ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
      : value,
  );
  if (!Number.isFinite(parsed))
    throw new Error("A data de publicação é inválida.");
  return parsed;
}

function knownPublication(value: string, now: number): number | undefined {
  if (!Number.isFinite(now)) return undefined;
  try {
    const timestamp = isoBoundary(value, false);
    return timestamp <= now ? timestamp : undefined;
  } catch {
    return undefined;
  }
}

interface ChannelIdentity {
  id?: string;
  handle?: string;
  name?: string;
  ambiguous?: boolean;
}

function channelIdentity(video: VideoRecord): ChannelIdentity {
  const explicitId = video.channelId?.trim();
  let id =
    explicitId && /^[A-Za-z0-9_-]{1,128}$/.test(explicitId)
      ? explicitId
      : undefined;
  let handle: string | undefined;
  if (video.channelUrl) {
    try {
      const url = new URL(video.channelUrl);
      if (
        url.protocol === "https:" &&
        ["www.youtube.com", "youtube.com", "m.youtube.com"].includes(
          url.hostname,
        ) &&
        !url.username &&
        !url.password &&
        !url.port
      ) {
        const path = decodeURIComponent(url.pathname).replace(/\/$/, "");
        const linkedId = /^\/channel\/([A-Za-z0-9_-]{1,128})$/.exec(path)?.[1];
        if (id && linkedId && id !== linkedId) return { ambiguous: true };
        id ??= linkedId;
        handle = /^\/@([\p{L}\p{N}_.\-·]{1,100})$/u
          .exec(path)?.[1]
          .normalize("NFC")
          .toLocaleLowerCase();
      }
    } catch {
      /* Invalid URLs cannot establish a channel alias. */
    }
  }
  const name = video.channel
    ? normalize(video.channel).trim().replace(/\s+/g, " ") || undefined
    : undefined;
  return { id, handle, name };
}

function comparableChannel(
  target: ChannelIdentity,
  peer: ChannelIdentity,
): boolean {
  if (target.ambiguous || peer.ambiguous) return false;
  if (!target.id && !target.handle && !target.name) return true;
  // A definitive shared ID also handles channel URL aliases and handle renames.
  if (target.id && peer.id) return target.id === peer.id;
  if (target.handle && peer.handle) return target.handle === peer.handle;
  // Names can collide, so use them only when neither side has a stronger identity.
  if (target.id || target.handle || peer.id || peer.handle) return false;
  return !!target.name && target.name === peer.name;
}
