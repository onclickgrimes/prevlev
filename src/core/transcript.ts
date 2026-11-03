import type { TranscriptSegment } from "../shared/types";
import { parseDuration } from "./parse";

export function parseTranscript(
  input: string | Document | unknown,
): TranscriptSegment[] {
  if (typeof input === "string") {
    const text = input.trim();
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        return parseTranscript(JSON.parse(text));
      } catch {
        return [];
      }
    }
    if (text.startsWith("<") && typeof DOMParser !== "undefined")
      return parseTranscript(new DOMParser().parseFromString(text, "text/xml"));
    return [];
  }
  if (typeof Document !== "undefined" && input instanceof Document) {
    const xml = Array.from(input.querySelectorAll("text[start], p[t]")).map(
      (node) => ({
        start: node.hasAttribute("start")
          ? Number(node.getAttribute("start"))
          : Number(node.getAttribute("t")) / 1000,
        duration: node.hasAttribute("dur")
          ? Number(node.getAttribute("dur"))
          : Number(node.getAttribute("d") ?? 0) / 1000,
        text: node.textContent ?? "",
      }),
    );
    if (xml.length) return validate(xml);
    const rows = Array.from(
      input.querySelectorAll(
        "ytd-transcript-segment-renderer, [data-transcript-segment]",
      ),
    );
    return validate(
      rows.map((row, index) => {
        const time = row.querySelector(".segment-timestamp, [data-start]");
        const start = time?.hasAttribute("data-start")
          ? Number(time.getAttribute("data-start"))
          : parseDuration(time?.textContent ?? "");
        const next = rows[index + 1]?.querySelector(
          ".segment-timestamp, [data-start]",
        );
        const end = next?.hasAttribute("data-start")
          ? Number(next.getAttribute("data-start"))
          : parseDuration(next?.textContent ?? "");
        return {
          start: start ?? NaN,
          duration:
            end !== undefined && start !== undefined
              ? Math.max(0, end - start)
              : 0,
          text:
            row.querySelector(".segment-text, [data-text]")?.textContent ?? "",
        };
      }),
    );
  }
  if (!input || typeof input !== "object") return [];
  if (Array.isArray(input))
    return validate(
      input.map((entry) => {
        const item = asRecord(entry);
        return {
          start: Number(item.start),
          duration: Number(item.duration ?? 0),
          text: String(item.text ?? ""),
        };
      }),
    );
  const root = asRecord(input);
  if (Array.isArray(root.events))
    return validate(
      root.events.map((event) => {
        const item = asRecord(event);
        const segments = Array.isArray(item.segs) ? item.segs : [];
        return {
          start: Number(item.tStartMs) / 1000,
          duration: Number(item.dDurationMs ?? 0) / 1000,
          text: segments
            .map((segment) => String(asRecord(segment).utf8 ?? ""))
            .join(""),
        };
      }),
    );
  return [];
}

export function transcriptText(
  segments: readonly TranscriptSegment[],
  timestamps = false,
): string {
  return segments
    .map(
      (segment) =>
        `${timestamps ? `[${timestamp(segment.start, false)}] ` : ""}${segment.text}`,
    )
    .join("\n");
}

export function transcriptVtt(segments: readonly TranscriptSegment[]): string {
  return `WEBVTT\n\n${segments
    .map((segment, index) => {
      const end =
        segment.duration > 0
          ? segment.start + segment.duration
          : (segments[index + 1]?.start ?? segment.start + 2);
      const text = segment.text
        .replace(/-->/g, "→")
        .replace(/\r?\n\r?\n/g, "\n");
      return `${index + 1}\n${timestamp(segment.start)} --> ${timestamp(Math.max(segment.start + 0.001, end))}\n${text}\n`;
    })
    .join("\n")}`;
}

export function transcriptMarkdown(
  segments: readonly TranscriptSegment[],
  title = "Transcrição",
): string {
  return `# ${title.replace(/[\r\n]/g, " ")}\n\n${segments.map((segment) => `- **${timestamp(segment.start, false)}** ${segment.text.replace(/[\\`*_{}[\]<>#]/g, "\\$&").replace(/\r?\n/g, " ")}`).join("\n")}\n`;
}

function validate(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments
    .filter(
      (segment) =>
        Number.isFinite(segment.start) &&
        segment.start >= 0 &&
        Number.isFinite(segment.duration) &&
        segment.duration >= 0 &&
        segment.text.trim(),
    )
    .map((segment) => ({
      ...segment,
      text: segment.text.replace(/\s+/g, " ").trim(),
    }))
    .sort((a, b) => a.start - b.start);
}
function timestamp(seconds: number, milliseconds = true): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(ms / 3600000),
    minutes = Math.floor(ms / 60000) % 60,
    secs = Math.floor(ms / 1000) % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}${milliseconds ? `.${String(ms % 1000).padStart(3, "0")}` : ""}`;
}
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
