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
  const age = (now - Date.parse(video.publishedAt)) / 3_600_000;
  return age > 0 ? video.views / age : undefined;
}

/** Excludes the target itself and requires at least three known comparable videos. */
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
  const values = baseline
    .filter(
      (other) =>
        other.id !== video.id &&
        other.isShort === video.isShort &&
        (!video.channelId ||
          !other.channelId ||
          video.channelId === other.channelId),
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
  minOutlier?: number;
  shorts?: "all" | "only" | "exclude";
  channel?: string;
}
export function filterVideos(
  videos: readonly VideoRecord[],
  filter: VideoFilter,
  now = Date.now(),
): VideoRecord[] {
  const query = normalize(filter.query ?? "");
  return videos.filter((video) => {
    if (
      query &&
      !normalize(`${video.title} ${video.channel ?? ""}`).includes(query)
    )
      return false;
    if (
      filter.channel &&
      !normalize(video.channel ?? "").includes(normalize(filter.channel))
    )
      return false;
    if (
      (filter.shorts === "only" && !video.isShort) ||
      (filter.shorts === "exclude" && video.isShort)
    )
      return false;
    const constraints: [
      number | undefined,
      number | undefined,
      number | undefined,
    ][] = [
      [video.views, filter.minViews, filter.maxViews],
      [video.subscribers, filter.minSubscribers, filter.maxSubscribers],
      [lifetimeVph(video, now), filter.minVph, undefined],
      [outlierScore(video, videos), filter.minOutlier, undefined],
    ];
    return constraints.every(
      ([value, min, max]) =>
        (min === undefined && max === undefined) ||
        (value !== undefined &&
          (min === undefined || value >= min) &&
          (max === undefined || value <= max)),
    );
  });
}

export function sortVideos(
  videos: readonly VideoRecord[],
  by: "views" | "vph" | "outlier" | "recent" | "title",
  now = Date.now(),
): VideoRecord[] {
  if (by === "title")
    return [...videos].sort((a, b) => a.title.localeCompare(b.title));
  const get = (video: VideoRecord) =>
    by === "views"
      ? video.views
      : by === "vph"
        ? lifetimeVph(video, now)
        : by === "outlier"
          ? outlierScore(video, videos)
          : video.publishedAt
            ? Date.parse(video.publishedAt)
            : undefined;
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
