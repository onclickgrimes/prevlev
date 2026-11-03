import type { VideoRecord } from "../shared/types";
import { parseCount } from "./parse";

const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const MAX_CHANNELS = 10;
const TIMEOUT_MS = 8_000;
type ChannelVideo = VideoRecord & { channelUrl?: string };
export type ChannelFetcher = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export interface PublicChannelInfo {
  subscribers?: number;
  channelName?: string;
  source: "public-youtube";
  warnings: string[];
}

/** Reads literal JSON and HTML metadata; never evaluates a page's scripts. */
export function parsePublicChannelPage(html: string): PublicChannelInfo {
  const result: PublicChannelInfo = { source: "public-youtube", warnings: [] };
  if (html.length > MAX_PAGE_BYTES)
    return {
      ...result,
      warnings: ["Página de canal acima do limite de 3 MiB."],
    };
  for (const match of html.matchAll(/"subscriberCountText"\s*:\s*/g)) {
    const value = readLiteral(html, match.index + match[0].length);
    const text = literalText(value);
    const subscribers = text === undefined ? undefined : parseCount(text);
    if (subscribers !== undefined) {
      result.subscribers = subscribers;
      break;
    }
  }
  // Modern channel headers often place the subscriber label in a metadata text node.
  if (result.subscribers === undefined) {
    for (const match of html.matchAll(
      /"(?:content|simpleText|text)"\s*:\s*("(?:\\.|[^"\\])*")/g,
    )) {
      const value = parseJsonString(match[1]);
      if (
        !value ||
        !/^\s*\d[\d.,\s]*(?:bilh(?:ão|ões|ao|oes)|billions?|milh(?:ão|ões|ao|oes)|millions?|mil|[kmb])?\s+(?:de\s+)?(?:subscribers?|inscritos?|assinantes?)\s*$/iu.test(
          value,
        )
      )
        continue;
      const subscribers = parseCount(value);
      if (subscribers !== undefined) {
        result.subscribers = subscribers;
        break;
      }
    }
  }
  for (const key of ["channelMetadataRenderer", "c4TabbedHeaderRenderer"]) {
    const match = new RegExp(`"${key}"\\s*:\\s*`).exec(html);
    if (!match) continue;
    const literal = record(readLiteral(html, match.index + match[0].length));
    const title = literalText(literal.title);
    if (title) {
      result.channelName = title;
      break;
    }
  }
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes: Record<string, string> = {};
    for (const attribute of match[0].matchAll(
      /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
    ))
      attributes[attribute[1].toLowerCase()] = decodeEntities(
        attribute[2] ?? attribute[3],
      );
    const key = (
      attributes.property ??
      attributes.name ??
      attributes.itemprop ??
      ""
    ).toLowerCase();
    if (!result.channelName && key === "og:title" && attributes.content)
      result.channelName = attributes.content.replace(/\s+- YouTube$/, "");
    if (
      result.subscribers === undefined &&
      /^(?:subscribercount|subscriber_count|subscribers)$/.test(key)
    )
      result.subscribers = parseCount(attributes.content ?? "");
  }
  if (result.subscribers === undefined)
    result.warnings.push(
      "Inscritos não encontrados ou não publicados nesta página; valor permanece desconhecido.",
    );
  return result;
}

/** Only canonical public channel/handle URLs are accepted as network targets. */
export function buildChannelUrl(video: ChannelVideo): string | undefined {
  if (video.channelId && /^UC[A-Za-z0-9_-]{22}$/.test(video.channelId))
    return `https://www.youtube.com/channel/${video.channelId}`;
  if (
    !video.channelUrl ||
    !/^https:\/\/www\.youtube\.com\//.test(video.channelUrl) ||
    video.channelUrl.includes("\\") ||
    [...video.channelUrl].some(
      (character) =>
        character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    )
  )
    return undefined;
  try {
    const url = new URL(video.channelUrl);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.youtube.com" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    )
      return undefined;
    const path = decodeURIComponent(url.pathname).replace(/\/$/, "");
    const rawPath = decodeURIComponent(
      video.channelUrl.slice("https://www.youtube.com".length),
    ).replace(/\/$/, "");
    if (path !== rawPath) return undefined;
    if (/^\/channel\/UC[A-Za-z0-9_-]{22}$/.test(path))
      return `https://www.youtube.com${path}`;
    if (!/^\/@[\p{L}\p{N}_.\-·]{1,100}$/u.test(path)) return undefined;
    // The URL constructor percent-encodes Unicode while preserving a single handle segment.
    return new URL(path, "https://www.youtube.com").href;
  } catch {
    return undefined;
  }
}

/** Explicit bounded public-page enrichment, suitable for an action initiated by the user. */
export async function enrichChannels(
  videos: readonly ChannelVideo[],
  fetcher: ChannelFetcher,
  signal?: AbortSignal,
): Promise<{ videos: VideoRecord[]; warnings: string[] }> {
  const enriched: VideoRecord[] = videos.map((video) => ({ ...video }));
  const warnings: string[] = [];
  const urls = [
    ...new Set(
      videos
        .filter((video) => video.subscribers === undefined)
        .map(buildChannelUrl)
        .filter((url): url is string => url !== undefined),
    ),
  ];
  if (urls.length > MAX_CHANNELS)
    warnings.push(
      `Limite de ${MAX_CHANNELS} canais por ação; ${urls.length - MAX_CHANNELS} canais não foram consultados.`,
    );
  for (const url of urls.slice(0, MAX_CHANNELS)) {
    if (signal?.aborted) {
      warnings.push(
        "Enriquecimento cancelado; canais restantes não foram consultados.",
      );
      break;
    }
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await fetcher(url, {
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        headers: { Accept: "text/html" },
        signal: combined,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (response.redirected)
        throw new Error("Redirecionamento de página recusado.");
      const type = response.headers.get("content-type");
      if (type && !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(type))
        throw new Error("A resposta não é uma página HTML.");
      const page = parsePublicChannelPage(
        await boundedText(response, combined),
      );
      for (let index = 0; index < videos.length; index++) {
        if (buildChannelUrl(videos[index]) !== url) continue;
        if (
          enriched[index].subscribers === undefined &&
          page.subscribers !== undefined
        )
          enriched[index].subscribers = page.subscribers;
        if (!enriched[index].channel && page.channelName)
          enriched[index].channel = page.channelName;
      }
      warnings.push(...page.warnings.map((warning) => `${url}: ${warning}`));
    } catch (error) {
      const reason = signal?.aborted
        ? "consulta cancelada"
        : timeout.aborted
          ? "tempo limite de 8 segundos"
          : error instanceof Error
            ? error.message
            : "falha de leitura";
      warnings.push(
        `${url}: ${reason}; inscritos permanecem desconhecidos quando indisponíveis.`,
      );
    }
  }
  return { videos: enriched, warnings };
}

async function boundedText(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  const declaredSize = response.headers.get("content-length");
  if (declaredSize && Number(declaredSize) > MAX_PAGE_BYTES) {
    await response.body?.cancel();
    throw new Error("Página acima do limite de 3 MiB.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0,
    text = "";
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_PAGE_BYTES)
        throw new Error("Página acima do limite de 3 MiB.");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function readLiteral(text: string, offset: number): unknown {
  if (text[offset] === '"') {
    const match = /^"(?:\\.|[^"\\])*"/.exec(
      text.slice(offset, offset + 65_536),
    );
    return match ? parseJsonString(match[0]) : undefined;
  }
  if (text[offset] !== "{") return undefined;
  let depth = 0,
    quoted = false,
    escaped = false;
  for (
    let index = offset;
    index < Math.min(text.length, offset + 65_536);
    index++
  ) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth++;
    else if (character === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(offset, index + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
function parseJsonString(value: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
function literalText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const object = record(value);
  if (typeof object.simpleText === "string") return object.simpleText;
  if (Array.isArray(object.runs)) {
    const text = object.runs
      .map((run) => record(run).text)
      .filter((item): item is string => typeof item === "string")
      .join("");
    return text || undefined;
  }
  return undefined;
}
function decodeEntities(text: string): string {
  return text.replace(
    /&(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi,
    (match) => {
      const named: Record<string, string> = {
        "&amp;": "&",
        "&quot;": '"',
        "&apos;": "'",
        "&lt;": "<",
        "&gt;": ">",
      };
      if (named[match.toLowerCase()]) return named[match.toLowerCase()];
      const value = match.toLowerCase().startsWith("&#x")
        ? parseInt(match.slice(3, -1), 16)
        : Number(match.slice(2, -1));
      return Number.isInteger(value) && value > 0 && value <= 0x10ffff
        ? String.fromCodePoint(value)
        : match;
    },
  );
}
