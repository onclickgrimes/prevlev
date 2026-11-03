import type { VideoRecord } from "../shared/types";
import {
  buildChannelUrl,
  parsePublicChannelPage,
  type ChannelFetcher,
} from "./enrichment";
import { parseCount, parseDuration, parsePublishedAt } from "./parse";
import {
  inferMonetization,
  sortVideos,
  type MonetizationInference,
} from "./metrics";

const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 8_000;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const COVERAGE = "initial-public-page" as const;
type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
function literalText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const object = record(value);
  for (const key of ["simpleText", "content", "text"])
    if (typeof object[key] === "string") return object[key];
  if (Array.isArray(object.runs))
    return (
      object.runs
        .map((run) => record(run).text)
        .filter((text): text is string => typeof text === "string")
        .join("") || undefined
    );
  return undefined;
}

/** Reads a balanced JSON literal only. JavaScript expressions are never evaluated. */
export function readInitialData(html: string): unknown {
  if (new TextEncoder().encode(html).byteLength > MAX_BYTES)
    throw new Error("Página acima do limite de 3 MiB.");
  const assignments =
    /(?:\b(?:window\.)?ytInitialData|window\s*\[\s*["']ytInitialData["']\s*\])\s*=\s*/g;
  let candidates = 0;
  for (const match of html.matchAll(assignments)) {
    if (++candidates > 16) break;
    const start = match.index + match[0].length;
    if (html[start] !== "{") continue;
    let depth = 0,
      quoted = false,
      escaped = false;
    for (let index = start; index < html.length; index++) {
      const char = html[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === "{" || char === "[") depth++;
      else if ((char === "}" || char === "]") && --depth === 0) {
        try {
          return JSON.parse(html.slice(start, index + 1));
        } catch {
          break;
        }
      }
    }
  }
  return undefined;
}
function strings(value: unknown): string[] {
  const result: string[] = [],
    pending = [value];
  let count = 0;
  while (pending.length && count++ < 10_000) {
    const item = pending.pop();
    if (typeof item === "string") result.push(item);
    else if (Array.isArray(item)) {
      for (const child of item.slice(0, 10_000).reverse()) pending.push(child);
    } else if (item !== null && typeof item === "object") {
      for (const child of Object.values(item).slice(0, 10_000).reverse())
        pending.push(child);
    }
  }
  return result;
}
function chosenContent(initial: unknown): {
  content: unknown;
  scoped: boolean;
} {
  const contents = record(record(initial).contents);
  for (const rendererName of [
    "twoColumnBrowseResultsRenderer",
    "singleColumnBrowseResultsRenderer",
  ]) {
    const tabs = record(contents[rendererName]).tabs;
    if (!Array.isArray(tabs)) continue;
    for (const item of tabs) {
      const tab = record(record(item).tabRenderer);
      if (tab.selected === true && tab.content)
        return { content: tab.content, scoped: true };
    }
  }
  return { content: initial, scoped: false };
}
function parseVideo(
  renderer: JsonRecord,
  modern: boolean,
  channelUrl: string,
  now: number,
): VideoRecord | undefined {
  const id = modern ? renderer.contentId : renderer.videoId;
  if (typeof id !== "string" || !VIDEO_ID.test(id)) return undefined;
  if (
    modern &&
    renderer.contentType &&
    renderer.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO"
  )
    return undefined;
  const lockupMetadata = record(
    record(renderer.metadata).lockupMetadataViewModel,
  );
  const title = literalText(modern ? lockupMetadata.title : renderer.title);
  if (!title) return undefined;
  const metadata = modern
    ? strings(lockupMetadata.metadata)
    : [
        literalText(renderer.viewCountText),
        literalText(renderer.shortViewCountText),
        literalText(renderer.publishedTimeText),
      ].filter((value): value is string => !!value);
  const viewsText = metadata.find((value) =>
    /views|visualizaç|visualizac/i.test(value),
  );
  const publishedAt = metadata
    .map((value) => parsePublishedAt(value, now))
    .find((value) => value !== undefined);
  const overlayText = strings(
    modern ? renderer.contentImage : renderer.thumbnailOverlays,
  );
  const duration =
    literalText(renderer.lengthText) ??
    overlayText.find((value) => /^\d+(?::\d{1,2}){1,2}$/.test(value));
  const video: VideoRecord = {
    id,
    title,
    url: `https://www.youtube.com/watch?v=${id}`,
    channelUrl,
    views: viewsText ? parseCount(viewsText) : undefined,
    publishedAt,
    durationSeconds: duration ? parseDuration(duration) : undefined,
    isShort: false,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
  return video;
}

export interface ChannelResearch {
  channelUrl: string;
  channelName?: string;
  subscribers?: number;
  videos: VideoRecord[];
  recent: VideoRecord[];
  popular: VideoRecord[];
  coverage: typeof COVERAGE;
  warnings: string[];
}
export function parseChannelVideos(
  html: string,
  channelUrl: string,
  now = Date.now(),
): ChannelResearch {
  const canonical = buildChannelUrl({ id: "", title: "", url: "", channelUrl });
  if (!canonical)
    throw new Error(
      "Use uma URL pública canônica de canal do YouTube (/ @handle ou /channel/UC...).",
    );
  const initial = readInitialData(html),
    info = parsePublicChannelPage(html);
  const warnings = [
    ...info.warnings,
    "Amostra limitada aos vídeos presentes no HTML inicial público; sem paginação, contas ou catálogo completo.",
    "Datas e contagens públicas podem estar arredondadas. Recentes e populares são ordenados somente dentro desta amostra.",
  ];
  if (!initial)
    warnings.push(
      "ytInitialData JSON não encontrado; o YouTube pode exigir consentimento ou ter alterado o layout.",
    );
  const chosen = chosenContent(initial);
  if (initial && !chosen.scoped)
    warnings.push(
      "A aba selecionada não foi identificada; os cards reconhecidos podem incluir outras seções desta página.",
    );
  const pending: { value: unknown; depth: number }[] = [
      { value: chosen.content, depth: 0 },
    ],
    seen = new Set<string>(),
    videos: VideoRecord[] = [];
  let visited = 0;
  while (pending.length && visited++ < 100_000 && videos.length < 2000) {
    const { value, depth } = pending.pop()!;
    if (depth > 100) continue;
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index--)
        pending.push({ value: value[index], depth: depth + 1 });
      continue;
    }
    const object = record(value);
    for (const [key, child] of Object.entries(object).reverse()) {
      if (
        /^(?:adSlotRenderer|displayAdRenderer|inFeedAdLayoutRenderer|promotedVideoRenderer)$/.test(
          key,
        )
      )
        continue;
      if (
        ["videoRenderer", "gridVideoRenderer", "lockupViewModel"].includes(key)
      ) {
        const video = parseVideo(
          record(child),
          key === "lockupViewModel",
          canonical,
          now,
        );
        if (video && !seen.has(video.id)) {
          seen.add(video.id);
          videos.push({
            ...video,
            channel: info.channelName,
            subscribers: info.subscribers,
            channelId: canonical.match(
              /\/channel\/(UC[A-Za-z0-9_-]{22})$/,
            )?.[1],
          });
        }
      } else if (child && typeof child === "object")
        pending.push({ value: child, depth: depth + 1 });
    }
  }
  if (pending.length)
    warnings.push(
      "Limite de leitura estrutural atingido; a cobertura é parcial.",
    );
  if (!videos.length)
    warnings.push(
      "Nenhum vídeo público reconhecido nesta resposta; não significa que o canal não tenha vídeos.",
    );
  return {
    channelUrl: canonical,
    channelName: info.channelName,
    subscribers: info.subscribers,
    videos,
    recent: sortVideos(videos, "recent", now),
    popular: sortVideos(videos, "views", now),
    coverage: COVERAGE,
    warnings,
  };
}

async function publicHtml(
  url: string,
  fetcher: ChannelFetcher,
): Promise<string> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const response = await fetcher(url, {
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    headers: { Accept: "text/html" },
    signal,
  });
  if (!response.ok)
    throw new Error(`YouTube respondeu HTTP ${response.status}.`);
  if (response.redirected)
    throw new Error("Redirecionamento público recusado.");
  const type = response.headers.get("content-type");
  if (type && !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(type))
    throw new Error("A resposta pública não é HTML.");
  if (Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error("Página acima do limite de 3 MiB.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let bytes = 0,
    result = "";
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES)
        throw new Error("Página acima do limite de 3 MiB.");
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export async function researchChannel(
  channelUrl: string,
  fetcher: ChannelFetcher,
  order: "recent" | "popular" = "recent",
): Promise<ChannelResearch> {
  const canonical = buildChannelUrl({ id: "", title: "", url: "", channelUrl });
  if (!canonical)
    throw new Error(
      "Informe uma URL https://www.youtube.com/@handle ou /channel/UC... sem parâmetros.",
    );
  if (!["recent", "popular"].includes(order))
    throw new Error("Ordem inválida; use recent ou popular.");
  const result = parseChannelVideos(
    await publicHtml(`${canonical}/videos`, fetcher),
    canonical,
  );
  return {
    ...result,
    videos: order === "popular" ? result.popular : result.recent,
  };
}
export interface SampleAssessment extends MonetizationInference {
  videoId: string;
  url: string;
  source: "public-youtube";
  error?: string;
}
export async function sampleMonetization(
  videos: readonly Pick<VideoRecord, "id">[],
  fetcher: ChannelFetcher,
  maxSamples = 5,
): Promise<{ assessments: SampleAssessment[]; limitations: string[] }> {
  if (!Number.isInteger(maxSamples) || maxSamples < 1 || maxSamples > 5)
    throw new Error("A amostra precisa ter entre 1 e 5 vídeos.");
  if (
    !Array.isArray(videos) ||
    !videos.length ||
    videos.length > 2000 ||
    videos.some(
      (video) =>
        !video || typeof video.id !== "string" || !VIDEO_ID.test(video.id),
    )
  )
    throw new Error("Envie de 1 a 2000 vídeos com IDs YouTube válidos.");
  const ids = [...new Set(videos.map((video) => video.id))].slice(
      0,
      maxSamples,
    ),
    assessments: SampleAssessment[] = [];
  for (const videoId of ids) {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    try {
      assessments.push({
        ...inferMonetization(await publicHtml(url, fetcher)),
        videoId,
        url,
        source: "public-youtube",
      });
    } catch (error) {
      assessments.push({
        ...inferMonetization(""),
        videoId,
        url,
        source: "public-youtube",
        error:
          error instanceof Error ? error.message : "Falha de consulta pública.",
      });
    }
  }
  return {
    assessments,
    limitations: [
      "Amostra pública anônima de até cinco vídeos; páginas sem anúncios ou consentimento podem não conter marcadores.",
      "Marcadores de anúncios/música têm confiança baixa e não confirmam YPP, receita do criador ou monetização oficial do canal.",
      "Ausência de marcadores ou falha de consulta permanece desconhecida; não significa desmonetização.",
    ],
  };
}
