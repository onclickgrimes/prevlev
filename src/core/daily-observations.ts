/** Manual period counts are independent of cumulative video observations and history. */
export type DailyCompletion = "partial" | "complete";
export interface DailyEntry { videoId: string; views?: number }
export interface DailyInput {
  channelId: string;
  date: string;
  timeZone: string;
  completion: DailyCompletion;
  /** UTC instant shared by every partial-day count in this report. */
  asOf?: string;
  sourceDescription?: string;
  channelViews?: number;
  videos: readonly DailyEntry[];
}
export interface DailyVideoResult { videoId: string; views?: number; conflict: boolean; occurrences: number }
export interface DailyReport {
  channelId: string; date: string; timeZone: string; completion: DailyCompletion; asOf?: string;
  source: "user-provided"; sourceDescription?: string; channelViews?: number;
  videos: DailyVideoResult[]; ranking: DailyVideoResult[];
  coverage: { known: number; unknown: number; conflicts: number; inputRows: number; uniqueVideos: number };
}

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, calendar: "gregory", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit" });
  } catch { throw new Error("Informe um fuso horário IANA válido, por exemplo America/Sao_Paulo."); }
}
function localDate(time: number, formatter: Intl.DateTimeFormat): string {
  const parts = formatter.formatToParts(new Date(time));
  const get = (type: string) => parts.find(part => part.type === type)?.value;
  return `${get("year")?.padStart(4, "0")}-${get("month")}-${get("day")}`;
}
function validDate(value: string): boolean {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
/** Find an actual instant on the civil date. Sampling checks the surrounding UTC window;
 * bisection also checks a date shorter than a sample interval at a timezone transition.
 * No 24-hour duration or fixed UTC offset is assumed. */
function civilDateExists(date: string, formatter: Intl.DateTimeFormat): boolean {
  const midnight = Date.parse(`${date}T00:00:00.000Z`);
  const step = 60 * 60 * 1000;
  const start = midnight - 48 * step, end = midnight + 48 * step;
  let left = start, leftDate = localDate(left, formatter);
  if (leftDate === date) return true;
  for (let right = start + step; right <= end; right += step) {
    const rightDate = localDate(right, formatter);
    if (rightDate === date) return true;
    // A civil date can be shortened to less than an hour by an offset transition.
    // Inspect a crossing to its millisecond boundary rather than treating a jump as a day.
    if ((leftDate < date && rightDate > date) || (leftDate > date && rightDate < date)) {
      let lo = left, hi = right;
      const leftBefore = leftDate < date;
      while (hi - lo > 1) {
        const middle = lo + Math.floor((hi - lo) / 2), middleDate = localDate(middle, formatter);
        if (middleDate === date) return true;
        if ((middleDate < date) === leftBefore) lo = middle; else hi = middle;
      }
    }
    left = right; leftDate = rightDate;
  }
  return false;
}
function count(value: number | undefined): boolean { return value === undefined || Number.isSafeInteger(value) && value >= 0; }

/** Builds one comparable, user-entered scope; no collection, network or persistence. */
export function buildDailyReport(input: DailyInput, now = Date.now()): DailyReport {
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new Error("Horário atual inválido.");
  const channelId = input.channelId.trim(), timeZone = input.timeZone.trim();
  if (!/^[A-Za-z0-9_@.-]{1,100}$/.test(channelId)) throw new Error("Informe uma identidade de canal de 1 a 100 caracteres (letras, números, _, -, . ou @).");
  if (!validDate(input.date)) throw new Error("Informe uma data válida no formato AAAA-MM-DD.");
  // Intl also accepts offsets in some runtimes: reject those and abbreviations except UTC.
  if (timeZone !== "UTC" && !/^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$/.test(timeZone)) throw new Error("Informe um fuso horário IANA válido, por exemplo America/Sao_Paulo.");
  const formatter = dateFormatter(timeZone);
  if (!civilDateExists(input.date, formatter)) throw new Error("A data não existiu neste fuso horário.");
  const today = localDate(now, formatter);
  if (input.date > today) throw new Error("A data não pode estar no futuro neste fuso.");
  if (input.completion !== "partial" && input.completion !== "complete") throw new Error("Informe se o período é parcial ou completo.");
  let asOf: string | undefined;
  if (input.completion === "partial") {
    if (!input.asOf || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input.asOf)) throw new Error("Para período parcial, informe um instante UTC completo com segundos e Z.");
    const instant = Date.parse(input.asOf);
    if (!Number.isFinite(instant) || new Date(instant).toISOString() !== input.asOf.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction: string | undefined) => `.${(fraction ?? "").padEnd(3, "0")}Z`) || instant > now || localDate(instant, formatter) !== input.date) throw new Error("O instante parcial deve ser válido, não futuro e pertencer à data no fuso informado.");
    asOf = new Date(instant).toISOString();
  } else {
    if (input.date >= today) throw new Error("Um dia completo deve ter terminado no fuso informado.");
    // A civil date can recur after midnight when clocks move backwards. For non-UTC
    // IANA zones, wait until the latest possible end using a conservative 24-hour
    // bound on absolute IANA UTC offsets. UTC has no offset transition.
    const utcMidnight = Date.parse(`${input.date}T00:00:00.000Z`);
    const safeEnd = utcMidnight + (timeZone === "UTC" ? 24 : 48) * 60 * 60 * 1000;
    if (now < safeEnd) throw new Error("Dia completo ainda não disponível: aguarde até 48 horas após 00:00 UTC da data informada (24 horas para UTC). Use período parcial durante a espera.");
    if (input.asOf) throw new Error("O instante parcial só se aplica a períodos parciais.");
  }
  if (!count(input.channelViews)) throw new Error("Views do canal devem ser um inteiro não negativo ou desconhecido.");
  if (!Array.isArray(input.videos) || input.videos.length > 500) throw new Error("Informe até 500 linhas de vídeos.");
  const description = input.sourceDescription?.trim();
  if (description && description.length > 200) throw new Error("A descrição da fonte deve ter até 200 caracteres.");
  const groups = new Map<string, (number | undefined)[]>();
  for (const entry of input.videos) {
    if (!entry || typeof entry.videoId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(entry.videoId) || !count(entry.views)) throw new Error("Cada linha precisa de um ID de vídeo válido e views inteiras não negativas ou desconhecidas.");
    const group = groups.get(entry.videoId) ?? []; group.push(entry.views); groups.set(entry.videoId, group);
  }
  const videos: DailyVideoResult[] = [...groups].map(([videoId, values]) => {
    const unique = new Set(values), conflict = unique.size > 1;
    return { videoId, views: conflict ? undefined : values[0], conflict, occurrences: values.length };
  }).sort((a, b) => a.videoId.localeCompare(b.videoId));
  const ranking = videos.filter(video => video.views !== undefined && !video.conflict).sort((a, b) => b.views! - a.views! || a.videoId.localeCompare(b.videoId));
  return { channelId, date: input.date, timeZone, completion: input.completion, asOf, source: "user-provided", sourceDescription: description || undefined, channelViews: input.channelViews, videos, ranking,
    coverage: { known: ranking.length, unknown: videos.filter(video => video.views === undefined && !video.conflict).length, conflicts: videos.filter(video => video.conflict).length, inputRows: input.videos.length, uniqueVideos: videos.length } };
}
