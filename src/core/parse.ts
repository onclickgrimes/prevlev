/** Parses visible PT/EN compact counters. Undefined means unavailable, never a fabricated zero. */
export function parseCount(text: string): number | undefined {
  const cleaned = text
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/\u00a0/g, " ");
  const match = cleaned.match(
    /(\d[\d.,\s]*)\s*(bilh(?:ão|ões|ao|oes)|billions?|milh(?:ão|ões|ao|oes)|millions?|mil|[kmb])?(?=\s|$|[^a-zá-ú])/i,
  );
  if (!match) return undefined;
  let digits = match[1].replace(/\s/g, "");
  const suffix = match[2] ?? "";
  const factor = /^(b|bilh|billion)/.test(suffix)
    ? 1e9
    : /^(m$|milh|million)/.test(suffix)
      ? 1e6
      : /^(k|mil$)/.test(suffix)
        ? 1e3
        : 1;
  if (factor === 1) {
    // Grouped counts have no fractional precision. Both common grouping separators are accepted.
    digits = digits.replace(/[.,]/g, "");
  } else {
    const lastDot = digits.lastIndexOf("."),
      lastComma = digits.lastIndexOf(",");
    if (lastDot >= 0 && lastComma >= 0) {
      const decimal = Math.max(lastDot, lastComma);
      digits =
        digits.slice(0, decimal).replace(/[.,]/g, "") +
        "." +
        digits.slice(decimal + 1);
    } else digits = digits.replace(",", ".");
  }
  const value = Number(digits) * factor;
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

export function parseDuration(value: string): number | undefined {
  const text = value.trim();
  const iso = text.match(
    /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i,
  );
  if (iso && iso.slice(1).some(Boolean))
    return (
      Number(iso[1] ?? 0) * 3600 +
      Number(iso[2] ?? 0) * 60 +
      Number(iso[3] ?? 0)
    );
  if (!/^\d+(?::\d{1,2}){1,2}$/.test(text)) return undefined;
  const parts = text.split(":").map(Number);
  if (parts.slice(1).some((number) => number >= 60)) return undefined;
  return parts.reduce((sum, number) => sum * 60 + number, 0);
}

export function parsePublishedAt(
  text: string,
  now = Date.now(),
): string | undefined {
  const clean = text.trim().toLowerCase();
  const relative = clean.match(
    /(?:há\s+)?(\d+)\s*(seconds?|segundos?|minutes?|minutos?|hours?|horas?|days?|dias?|weeks?|semanas?|months?|mês|meses|years?|anos?)(?:\s+ago)?/,
  );
  if (relative) {
    const unit = relative[2],
      amount = Number(relative[1]);
    const seconds = /^(second|segundo)/.test(unit)
      ? 1
      : /^(minute|minuto)/.test(unit)
        ? 60
        : /^(hour|hora)/.test(unit)
          ? 3600
          : /^(day|dia)/.test(unit)
            ? 86400
            : /^(week|semana)/.test(unit)
              ? 604800
              : /^(month|mês|mes)/.test(unit)
                ? 2629800
                : 31557600;
    return new Date(now - amount * seconds * 1000).toISOString();
  }
  // Avoid Date.parse turning a random visible number into an arbitrary date.
  if (!/\d{4}-\d{2}-\d{2}/.test(clean)) return undefined;
  const value = Date.parse(clean);
  return Number.isFinite(value) ? new Date(value).toISOString() : undefined;
}

export function videoIdFromUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw, "https://www.youtube.com");
    if (
      !["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(
        url.hostname,
      )
    )
      return undefined;
    const id =
      url.hostname === "youtu.be"
        ? url.pathname.slice(1).split("/")[0]
        : (url.searchParams.get("v") ??
          url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/)?.[1]);
    return id && /^[\w-]{11}$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}
