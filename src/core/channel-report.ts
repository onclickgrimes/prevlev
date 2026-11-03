/** Local observations only. These structural types accept the workspace's VideoRecord. */
export interface ReportVideo {
  id: string; title: string; isShort?: boolean; durationSeconds?: number;
  channelId?: string;
  source?: "youtube-dom" | "public-page" | "user-provided" | "youtube-data-api";
}
export interface ManualTranscript {
  videoId: string; text: string; durationSeconds: number;
  coverage: "complete" | "partial" | "unknown";
}
export interface ChannelReport {
  scope: { input: number; included: number; excludedApi: number; excludedDuplicate: number; excludedInvalidId: number; sources: Record<string, number> };
  content: { shorts: number; nonShorts: number; unknownFormats: number; knownDuration: number; unknownDuration: number };
  titles: { known: number; missing: number; meanCharacters?: number; questionMarks: number; exclamationMarks: number; terms: { term: string; titles: number }[] };
  transcript: { status: "available" | "unknown"; reason?: string; videoId?: string; source: "user-provided"; coverage?: ManualTranscript["coverage"]; words?: number; durationSeconds?: number; wordsPerMinute?: number };
  limitations: string[];
}
const words = (text: string): string[] => text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
const validDuration = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** Shared eligibility rules for mechanical statistics and explicitly provided annotations. */
export function selectChannelReportVideos(input: readonly ReportVideo[]): { videos: ReportVideo[]; scope: ChannelReport["scope"] } {
  const seen = new Set<string>(), videos: ReportVideo[] = [];
  let excludedApi = 0, excludedDuplicate = 0, excludedInvalidId = 0;
  const sources: Record<string, number> = { "youtube-dom": 0, "public-page": 0, "user-provided": 0, unspecified: 0 };
  for (const video of input) {
    if (video.source === "youtube-data-api") { excludedApi++; continue; }
    const id = typeof video.id === "string" ? video.id.trim() : "";
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) { excludedInvalidId++; continue; }
    if (seen.has(id)) { excludedDuplicate++; continue; }
    seen.add(id); videos.push({ ...video, id });
    const key = video.source && Object.hasOwn(sources, video.source) ? video.source : "unspecified";
    sources[key]++;
  }
  return { videos, scope: { input: input.length, included: videos.length, excludedApi, excludedDuplicate, excludedInvalidId, sources } };
}

/** The first eligible row per valid YouTube video ID wins; official API rows never enter any calculation. */
export function buildChannelReport(input: readonly ReportVideo[], manual?: ManualTranscript): ChannelReport {
  const { videos, scope } = selectChannelReportVideos(input);
  const seen = new Set(videos.map(video => video.id));
  const titles = videos.map(video => typeof video.title === "string" ? video.title.trim() : "").filter(Boolean);
  const frequencies = new Map<string, number>();
  for (const title of titles) for (const term of new Set(words(title.toLocaleLowerCase("und")))) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  const terms = [...frequencies].map(([term, count]) => ({ term, titles: count })).sort((a, b) => b.titles - a.titles || a.term.localeCompare(b.term)).slice(0, 20);
  const knownDuration = videos.filter(video => validDuration(video.durationSeconds)).length;
  const transcript: ChannelReport["transcript"] = { status: "unknown", source: "user-provided" };
  if (manual) {
    const id = typeof manual.videoId === "string" ? manual.videoId.trim() : "";
    const coverage = manual.coverage;
    if (!/^[A-Za-z0-9_-]{11}$/.test(id) || !seen.has(id)) transcript.reason = "ID inválido ou não corresponde a vídeo elegível da amostra.";
    else if (!["complete", "partial", "unknown"].includes(coverage)) transcript.reason = "Informe a cobertura da transcrição.";
    else if (typeof manual.text !== "string" || !manual.text.trim()) transcript.reason = "Transcrição informada ausente.";
    else if (!validDuration(manual.durationSeconds)) transcript.reason = "Informe duração real positiva e finita em segundos.";
    else {
      const count = words(manual.text).length, rate = count * 60 / manual.durationSeconds;
      if (!count || !Number.isFinite(rate)) transcript.reason = "A contagem de palavras ou a taxa está indisponível.";
      else Object.assign(transcript, { status: "available", videoId: id, coverage, words: count, durationSeconds: manual.durationSeconds, wordsPerMinute: rate });
    }
  } else transcript.reason = "Transcrição e duração não foram informadas.";
  return {
    scope,
    content: { shorts: videos.filter(v => v.isShort === true).length, nonShorts: videos.filter(v => v.isShort === false).length, unknownFormats: videos.filter(v => v.isShort !== true && v.isShort !== false).length, knownDuration, unknownDuration: videos.length - knownDuration },
    titles: { known: titles.length, missing: videos.length - titles.length, meanCharacters: titles.length ? titles.reduce((sum, title) => sum + Array.from(title).length / titles.length, 0) : undefined, questionMarks: titles.filter(title => title.includes("?")).length, exclamationMarks: titles.filter(title => title.includes("!")).length, terms }, transcript,
    limitations: [
      "A amostra contém somente registros fornecidos; não representa o catálogo completo nem tráfego no período.",
      "A primeira linha elegível de cada ID válido do YouTube é mantida sem mesclar campos; registros da API oficial são excluídos antes da deduplicação.",
      "Formato depende do campo observado, não da duração. Termos e pontuação são contagens mecânicas dos títulos, não tópicos, estratégia ou desempenho causal.",
      "Transcrição, associação ao ID, duração real e cobertura são declarações do usuário, sem verificação. WPM divide as palavras fornecidas pela duração inteira; em cobertura parcial ou desconhecida não representa o ritmo do vídeo completo.",
      "Palavras são sequências de letras ou números, com apóstrofo interno; línguas sem espaços podem exigir outra segmentação. Não há inferência financeira ou resultado de IA.",
    ],
  };
}
