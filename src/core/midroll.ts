export interface Silence {
  start: number;
  end: number;
}
export interface MidrollOptions {
  durationSeconds: number;
  intervalSeconds: number;
  edgeSeconds?: number;
  silences?: readonly Silence[];
  snapWindowSeconds?: number;
}

/** Planning only: does not perform any action on a channel. */
export function planMidrolls(options: MidrollOptions): number[] {
  const {
    durationSeconds,
    intervalSeconds,
    silences = [],
    edgeSeconds = 60,
    snapWindowSeconds = 20,
  } = options;
  if (
    ![durationSeconds, intervalSeconds, edgeSeconds, snapWindowSeconds].every(
      Number.isFinite,
    ) ||
    durationSeconds <= 0 ||
    intervalSeconds < 60 ||
    edgeSeconds < 0 ||
    snapWindowSeconds < 0
  )
    throw new Error(
      "Duração válida e intervalo mínimo de 60 segundos são necessários.",
    );
  if (durationSeconds < 480) return [];
  const result: number[] = [];
  for (
    let position = Math.max(intervalSeconds, edgeSeconds);
    position < durationSeconds - edgeSeconds;
    position += intervalSeconds
  ) {
    const candidates = silences
      .filter(
        (silence) =>
          Number.isFinite(silence.start) &&
          Number.isFinite(silence.end) &&
          silence.end > silence.start,
      )
      .map((silence) => (silence.start + silence.end) / 2)
      .filter(
        (midpoint) =>
          Math.abs(midpoint - position) <= snapWindowSeconds &&
          midpoint >= edgeSeconds &&
          midpoint < durationSeconds - edgeSeconds,
      )
      .sort((a, b) => Math.abs(a - position) - Math.abs(b - position));
    const selected = Math.round(candidates[0] ?? position);
    if (!result.length || selected - result[result.length - 1] >= 60)
      result.push(selected);
  }
  return result;
}

/** Uses real mono PCM samples, not a canvas drawing or inferred audio. */
export function detectSilences(
  samples: ArrayLike<number>,
  sampleRate: number,
  thresholdDb = -40,
  minDurationSeconds = 0.5,
): Silence[] {
  if (
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    !Number.isFinite(thresholdDb) ||
    thresholdDb > 0 ||
    !Number.isFinite(minDurationSeconds) ||
    minDurationSeconds <= 0
  )
    throw new Error("Parâmetros inválidos para análise de silêncio.");
  const threshold = Math.pow(10, thresholdDb / 20);
  const windowSize = Math.max(1, Math.round(sampleRate * 0.02));
  const silences: Silence[] = [];
  let start: number | undefined;
  const finish = (end: number) => {
    if (start !== undefined && (end - start) / sampleRate >= minDurationSeconds)
      silences.push({ start: start / sampleRate, end: end / sampleRate });
    start = undefined;
  };
  for (let offset = 0; offset < samples.length; offset += windowSize) {
    const end = Math.min(samples.length, offset + windowSize);
    let squareSum = 0;
    for (let i = offset; i < end; i++) {
      const value = samples[i];
      squareSum += Number.isFinite(value) ? value * value : Infinity;
    }
    if (Math.sqrt(squareSum / (end - offset)) <= threshold) start ??= offset;
    else finish(offset);
  }
  finish(samples.length);
  return silences;
}
