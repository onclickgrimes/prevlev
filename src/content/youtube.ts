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

export function readComments(document: Document): CommentRecord[] {
  const containers = Array.from(
    document.querySelectorAll<HTMLElement>(
      "ytd-comment-thread-renderer,ytd-comment-view-model",
    ),
  );
  return containers
    .filter(
      (el) =>
        !el.parentElement?.closest(
          "ytd-comment-thread-renderer,ytd-comment-view-model",
        ),
    )
    .flatMap((el, index) => {
      const body = firstText(el, [
        "#content-text",
        '.yt-core-attributed-string[role="text"]',
        "[data-comment-text]",
      ]);
      if (!body) return [];
      const heart = el.querySelector(
        'ytd-creator-heart-renderer button[aria-pressed="true"],ytd-creator-heart-renderer #hearted,[data-hearted="true"]',
      );
      const likesText = firstText(el, ["#vote-count-middle", "[data-likes]"]);
      const repliesText = firstText(el, [
        "#more-replies",
        "ytd-button-renderer #text",
        "[data-replies]",
      ]);
      return [
        {
          id: el.dataset.commentId ?? `loaded-${index}`,
          text: body,
          author: firstText(el, ["#author-text", "[data-author]"]),
          likes: parseCount(likesText) ?? 0,
          replies: parseCount(repliesText) ?? 0,
          hearted: !!heart,
        },
      ];
    });
}

export function readVisibleTranscript(document: Document): TranscriptSegment[] {
  const segments = Array.from(
    document.querySelectorAll(
      "ytd-transcript-segment-renderer,[data-prevlev-transcript-segment]",
    ),
  );
  return segments
    .flatMap((element) => {
      const start = parseDuration(
        firstText(element, [".segment-timestamp", "[data-start]"]),
      );
      const body = firstText(element, [".segment-text", "[data-text]"]);
      return start === undefined || !body
        ? []
        : [{ start, duration: 0, text: body }];
    })
    .map((segment, index, all) => ({
      ...segment,
      duration: Math.max(
        0,
        (all[index + 1]?.start ?? segment.start) - segment.start,
      ),
    }));
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

export interface CardFilter {
  query: string;
  minimumViews: number;
  shorts: "all" | "only" | "exclude";
  sort: "default" | "views" | "vph";
}
export function filterAndSortCards(
  cards: VideoCard[],
  filter: CardFilter,
  vph: (video: VideoRecord) => number | undefined,
): VideoCard[] {
  const visible = cards.filter(
    ({ video }) =>
      (!filter.query ||
        `${video.title} ${video.channel ?? ""}`
          .toLocaleLowerCase()
          .includes(filter.query.toLocaleLowerCase())) &&
      (video.views ?? 0) >= filter.minimumViews &&
      (filter.shorts === "all" ||
        (filter.shorts === "only") === !!video.isShort),
  );
  return filter.sort === "default"
    ? visible
    : [...visible].sort(
        (a, b) =>
          ((filter.sort === "vph" ? vph(b.video) : b.video.views) ?? -1) -
          ((filter.sort === "vph" ? vph(a.video) : a.video.views) ?? -1),
      );
}
