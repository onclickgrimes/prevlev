import type {
  CommentRecord,
  PageSnapshot,
  TranscriptSegment,
  VideoRecord,
} from "../shared/types";
import {
  parseCount,
  parseDuration,
  parsePublishedAt,
  videoIdFromUrl,
} from "../core/parse";
import { selectResearchVideos, validateResearchFilter, type ResearchFilter } from "../core/research";
import { normalizeCommentText, stableCommentFingerprint } from "../core/comments";
import { parseTranscript } from "../core/transcript";

export const CARD_SELECTOR =
  "ytd-rich-item-renderer,ytd-video-renderer,ytd-grid-video-renderer,ytd-compact-video-renderer,yt-lockup-view-model,ytd-reel-item-renderer,ytm-shorts-lockup-view-model";
export interface VideoCard {
  element: HTMLElement;
  video: VideoRecord;
}

function text(node: Element | null): string {
  return node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}
function firstText(element: Element, selectors: string[]): string {
  for (const selector of selectors) {
    const value = text(element.querySelector(selector));
    if (value) return value;
  }
  return "";
}
function visibleMetadata(card: Element): string[] {
  const values = Array.from(
    card.querySelectorAll(
      "#metadata-line span,.yt-content-metadata-view-model__metadata-text,.inline-metadata-item",
    ),
  )
    .map((el) => text(el))
    .filter(Boolean);
  return values.length ? values : [text(card)];
}
function countFromMetadata(
  values: string[],
  pattern: RegExp,
): number | undefined {
  return parseCount(values.find((value) => pattern.test(value)) ?? "");
}
function safeChannelUrl(
  anchor: HTMLAnchorElement | null | undefined,
): string | undefined {
  const raw = anchor?.getAttribute("href");
  if (!raw) return undefined;
  try {
    const url = new URL(raw, "https://www.youtube.com");
    if (
      url.protocol !== "https:" ||
      !["www.youtube.com", "youtube.com"].includes(url.hostname) ||
      url.username ||
      url.password ||
      !/^\/(?:@[^/?#]+|channel\/[^/?#]+|c\/[^/?#]+|user\/[^/?#]+)\/?$/.test(
        url.pathname,
      )
    )
      return undefined;
    return `https://www.youtube.com${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return undefined;
  }
}

export function readVideoCards(
  document: Document,
  now = new Date(),
): VideoCard[] {
  const all = Array.from(document.querySelectorAll<HTMLElement>(CARD_SELECTOR));
  return all
    .filter((card) => !card.parentElement?.closest(CARD_SELECTOR))
    .flatMap((element) => {
      const anchor = element.querySelector<HTMLAnchorElement>(
        'a#video-title-link,a#video-title,a.yt-lockup-metadata-view-model__title,a[href*="/watch?"],a[href*="/shorts/"]',
      );
      if (!anchor) return [];
      let url: string;
      try {
        url = new URL(
          anchor.getAttribute("href") ?? "",
          document.location?.href ?? "https://www.youtube.com",
        ).href;
      } catch {
        return [];
      }
      const id = videoIdFromUrl(url);
      if (!id) return [];
      const title = anchor.getAttribute("title") ?? text(anchor) ?? "";
      const metadata = visibleMetadata(element);
      const dateValue = metadata
        .map((value) => parsePublishedAt(value, now.getTime()))
        .find((value) => value !== undefined);
      const thumbnail = element.querySelector<HTMLImageElement>(
        'img[src*="ytimg"],img',
      )?.src;
      const channelAnchor = element.querySelector<HTMLAnchorElement>(
        'ytd-channel-name a,a.yt-content-metadata-view-model__metadata-text,a[href^="/@"],a[href^="/channel/"]',
      );
      const channelUrl = safeChannelUrl(channelAnchor);
      const subscriberText = firstText(element, [
        "#subscriber-count",
        ".subscriber-count",
        "[data-subscribers]",
      ]);
      const durationText = firstText(element, [
        "ytd-thumbnail-overlay-time-status-renderer",
        ".yt-badge-shape__text",
        "[data-duration]",
      ]);
      const video: VideoRecord = {
        id,
        title: title || id,
        url,
        channel: text(channelAnchor) || undefined,
        channelId: channelUrl?.match(/\/channel\/([^/?]+)/)?.[1],
        channelUrl,
        views: countFromMetadata(metadata, /views|visualizaç|visualizac/i),
        publishedAt: dateValue,
        durationSeconds: parseDuration(durationText),
        subscribers: parseCount(subscriberText),
        isShort:
          url.includes("/shorts/") ||
          element.matches(
            "ytd-reel-item-renderer,ytm-shorts-lockup-view-model",
          ),
        thumbnail,
      };
      return [{ element, video }];
    });
}

export function readComments(root: Document | Element): CommentRecord[] {
  const component = "ytd-comment-view-model,ytd-comment-renderer,ytcp-comment,[data-prevlev-comment]";
  const selector = `${component},ytd-comment-thread-renderer`;
  const containers = Array.from(root.querySelectorAll<HTMLElement>(selector));
  if (root.nodeType === 1 && (root as Element).matches(selector)) containers.unshift(root as HTMLElement);
  const document = root.nodeType === 9 ? root as Document : root.ownerDocument!;
  const comments = new Map<string, CommentRecord>();
  for (const owner of containers) {
    const ownNodes = (query: string): Element[] => {
      const nodes = Array.from(owner.querySelectorAll(query));
      if (owner.matches(query)) nodes.unshift(owner);
      return nodes.filter(node => node.closest(selector) === owner);
    };
    const ownValue = (queries: readonly string[], attribute?: string): string => {
      for (const query of queries) for (const node of ownNodes(query)) {
        const value = normalizeCommentText(attribute ? node.getAttribute(attribute) ?? node.textContent ?? "" : node.textContent ?? "");
        if (value) return value;
      }
      return "";
    };
    const bodyNode = ownNodes("#content-text,[data-comment-text]")[0] ?? ownNodes('.yt-core-attributed-string[role="text"]').find(node => !node.closest("#author-text,[data-author],#published-time-text,#vote-count-middle"));
    const body = normalizeCommentText(bodyNode?.textContent ?? "");
    if (!body) continue;
    const author = ownValue(["#author-text", "[data-author]"], "data-author");
    const likesText = ownValue(["[data-likes]"], "data-likes") || ownValue(["#vote-count-middle", "#vote-count-left", '[aria-label*=" likes"]', '[aria-label*=" curtidas"]'], "aria-label");
    let repliesText = ownValue(["[data-replies]"], "data-replies") || ownValue(["#more-replies", "ytd-comment-replies-renderer #text", '[aria-label*=" replies"]', '[aria-label*=" respostas"]'], "aria-label");
    const thread = owner.closest("ytd-comment-thread-renderer");
    // YouTube also renders the main comment's reply count beside its view model.
    // A loaded reply must never inherit that count or a sibling reply's metadata.
    if (!repliesText && thread && thread.querySelector(component) === owner) {
      const counts = new Map<number, string>();
      for (const node of thread.querySelectorAll('#more-replies,ytd-comment-replies-renderer #text')) {
        if (node.closest(selector) !== thread) continue;
        const raw = normalizeCommentText(node.getAttribute('aria-label') || node.textContent || '');
        const value = parseCount(raw);
        if (value !== undefined) counts.set(value, raw);
      }
      if (counts.size === 1) repliesText = [...counts.values()][0];
    }
    const trueHeart = ownNodes('[data-hearted="true"],ytd-creator-heart-renderer button[aria-pressed="true"],ytd-creator-heart-renderer #hearted').length > 0;
    const falseHeart = ownNodes('[data-hearted="false"],ytd-creator-heart-renderer button[aria-pressed="false"]').length > 0;
    let id = owner.getAttribute("data-comment-id") ?? owner.getAttribute("comment-id") ?? ownNodes("[data-comment-id],[comment-id]").map(node => node.getAttribute("data-comment-id") ?? node.getAttribute("comment-id")).find(Boolean);
    if (!id && thread && (thread === owner || thread.querySelector(component) === owner)) id = thread.getAttribute("data-comment-id") ?? thread.getAttribute("comment-id");
    if (id && !/^[A-Za-z0-9_.:-]{1,256}$/.test(id)) id = undefined;
    if (!id) {
      const anchors = ownNodes('a[href*="lc="]') as HTMLAnchorElement[];
      for (const anchor of anchors) {
        if (bodyNode?.contains(anchor)) continue;
        try {
          const url = new URL(anchor.getAttribute("href") ?? "", document.location?.href.startsWith("https://") ? document.location.href : "https://www.youtube.com");
          const commentId = url.searchParams.get("lc");
          if (url.protocol === "https:" && ["www.youtube.com", "youtube.com", "m.youtube.com"].includes(url.hostname) && !url.username && !url.password && commentId && /^[A-Za-z0-9_.-]{1,256}$/.test(commentId)) { id = commentId; break; }
        } catch { /* An invalid/non-YouTube link cannot identify this comment. */ }
      }
    }
    id ??= stableCommentFingerprint(author, body);
    if (!comments.has(id)) comments.set(id, { id, text: body, author, likes: parseCount(likesText), replies: parseCount(repliesText), hearted: trueHeart ? true : falseHeart ? false : undefined });
  }
  return [...comments.values()];
}

export function readVisibleTranscript(document: Document): TranscriptSegment[] {
  return parseTranscript(document);
}

export function readYouTubeSnapshot(
  document: Document,
  now = new Date(),
): PageSnapshot {
  const videos = readVideoCards(document, now).map((card) => card.video);
  const title =
    firstText(document.documentElement, [
      "ytd-watch-metadata h1",
      "h1.ytd-video-primary-info-renderer",
      'meta[itemprop="name"]',
    ]) || document.title.replace(/\s*- YouTube$/, "");
  const transcript = readVisibleTranscript(document);
  const currentId = videoIdFromUrl(document.location.href);
  if (currentId && !videos.some((v) => v.id === currentId)) {
    const meta = (name: string) =>
      document.querySelector<HTMLMetaElement>(`meta[itemprop="${name}"]`)
        ?.content;
    const viewText = firstText(document.documentElement, [
      "ytd-watch-info-text #view-count",
      "ytd-video-view-count-renderer",
      ".view-count",
    ]);
    const ownerAnchor = document.querySelector<HTMLAnchorElement>(
      'ytd-video-owner-renderer ytd-channel-name a,#owner #channel-name a,#owner a[href^="/@"],#owner a[href^="/channel/"]',
    );
    const channelUrl = safeChannelUrl(ownerAnchor);
    videos.unshift({
      id: currentId,
      title,
      url: document.location.href,
      views: parseCount(meta("interactionCount") ?? viewText),
      publishedAt: meta("datePublished"),
      durationSeconds: parseDuration(meta("duration") ?? ""),
      channel:
        firstText(document.documentElement, [
          "ytd-video-owner-renderer ytd-channel-name",
          "#owner #channel-name",
        ]) || undefined,
      channelUrl,
      channelId: channelUrl?.match(/\/channel\/([^/?]+)/)?.[1],
      subscribers: parseCount(
        firstText(document.documentElement, [
          "#owner-sub-count",
          "#subscriber-count",
        ]),
      ),
      thumbnail: `https://i.ytimg.com/vi/${currentId}/hqdefault.jpg`,
      isShort: document.location.pathname.startsWith("/shorts/"),
    });
  }
  return {
    url: document.location.href,
    title,
    videoId: videoIdFromUrl(document.location.href),
    videos,
    comments: readComments(document),
    transcript,
    warnings: [
      "Somente itens já carregados na página são incluídos.",
      "Datas relativas e contagens arredondadas do YouTube são estimativas.",
      ...(transcript.length
        ? ["O tempo final da última linha da transcrição não está disponível."]
        : ["Abra a transcrição do YouTube para ler e exportar seu texto."]),
      ...(videos.some(
        (v) => v.views === undefined || v.publishedAt === undefined,
      )
        ? [
            "Alguns vídeos não exibem views ou data; suas métricas ficam indisponíveis.",
          ]
        : []),
    ],
  };
}

export type CardSort =
  | "default"
  | "views"
  | "vph"
  | "outlier"
  | "recent"
  | "duration"
  | "subscribers"
  | "viewsPerSubscriber"
  | "title";
export interface CardFilter extends ResearchFilter {
  minimumViews?: number;
  sort: CardSort;
}
export const cardSorts: readonly CardSort[] = [
  "default",
  "views",
  "vph",
  "outlier",
  "recent",
  "duration",
  "subscribers",
  "viewsPerSubscriber",
  "title",
];
export const cardNumericFields = [
  "minViews",
  "maxViews",
  "minSubscribers",
  "maxSubscribers",
  "minDurationSeconds",
  "maxDurationSeconds",
  "minVph",
  "maxVph",
  "minOutlier",
  "maxOutlier",
  "subscribersBelow",
] as const;
/** Validate both UI input and messages before changing the page. Legacy minimumViews remains accepted. */
export function normalizeCardFilter(input: unknown): CardFilter {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Filtro inválido.");
  const raw = input as Record<string, unknown>;
  const result: CardFilter = {
    sort: "default",
    shorts: "all",
    query: "",
    channel: "",
  };
  if (raw.sort !== undefined) {
    if (!cardSorts.includes(raw.sort as CardSort))
      throw new Error("Ordenação desconhecida.");
    result.sort = raw.sort as CardSort;
  }
  if (raw.shorts !== undefined) {
    if (!["all", "only", "exclude"].includes(String(raw.shorts)))
      throw new Error("Formato de vídeo desconhecido.");
    result.shorts = raw.shorts as CardFilter["shorts"];
  }
  for (const key of [
    "query",
    "channel",
    "publishedAfter",
    "publishedBefore",
    "publishedBeforeExclusive",
  ] as const)
    if (raw[key] !== undefined && raw[key] !== "") {
      if (typeof raw[key] !== "string")
        throw new Error("Use texto e datas válidas no filtro.");
      result[key] = raw[key] as string;
    }
  for (const key of cardNumericFields)
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== "number")
        throw new Error("Os limites do filtro devem ser números.");
      result[key] = raw[key] as number;
    }
  if (raw.minimumViews !== undefined && raw.minViews === undefined) {
    if (typeof raw.minimumViews !== "number")
      throw new Error("O mínimo de views deve ser numérico.");
    result.minViews = raw.minimumViews;
  }
  for (const key of ["surface", "priority", "comparisonMode"] as const) if (raw[key] !== undefined) {
    if (typeof raw[key] !== "string") throw new Error("Opção de pesquisa inválida.");
    Object.assign(result, { [key]: raw[key] });
  }
  if (raw.criteria !== undefined) {
    if (!Array.isArray(raw.criteria)) throw new Error("Ordenação múltipla inválida.");
    result.criteria = raw.criteria.map(value => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Critério de ordenação inválido.");
      const criterion = value as Record<string, unknown>;
      return { key: criterion.key, direction: criterion.direction } as NonNullable<ResearchFilter["criteria"]>[number];
    });
  }
  for (const key of ["hideShortsOnFeed", "hideShortsOnSearch"] as const) if (raw[key] !== undefined) {
    if (typeof raw[key] !== "boolean") throw new Error("Preferência de Shorts inválida.");
    result[key] = raw[key];
  }
  validateResearchFilter(result);
  return result;
}
export function filterAndSortCards(
  cards: VideoCard[],
  filter: CardFilter,
  _vph?: (video: VideoRecord) => number | undefined,
  now = Date.now(),
): VideoCard[] {
  const normalized = normalizeCardFilter(filter),
    baseline = cards.map((card) => card.video);
  const sorted = selectResearchVideos(baseline, normalized, now);
  const byVideo = new Map(cards.map((card) => [card.video, card]));
  return sorted
    .map((video) => byVideo.get(video)!);
}
