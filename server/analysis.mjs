import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";

const number = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
const text = (value, max = 2000) =>
  typeof value === "string" ? value.slice(0, max).trim() : "";
const stop = new Set(
  "a o os as e de do da dos das um uma em para por com que no na nos nas the an of to in on and for with is are".split(
    " ",
  ),
);
const tokens = (value) =>
  new Set(
    text(value, 10000)
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]{2,}/gu)
      ?.filter((token) => !stop.has(token)) ?? [],
  );
const jaccard = (left, right) => {
  const a = tokens(left),
    b = tokens(right);
  const shared = [...a].filter((token) => b.has(token));
  return {
    score:
      a.size + b.size - shared.length
        ? shared.length / (a.size + b.size - shared.length)
        : 0,
    shared,
  };
};
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? (sorted[Math.floor((sorted.length - 1) / 2)] +
        sorted[Math.ceil((sorted.length - 1) / 2)]) /
        2
    : null;
};
const datasetLimits = [
  "Somente os vídeos enviados pelo navegador; não representa o catálogo completo do YouTube.",
  "Views são observações fornecidas pelo usuário. Receita, RPM, geografia e saturação real não são conhecidos.",
];
const ok = (data, limitations = datasetLimits, source = "prevlev:dataset") => ({
  status: "ok",
  source,
  data,
  limitations,
});

function videosFrom(payload) {
  if (!Array.isArray(payload.videos) || !payload.videos.length)
    throw new Error("Envie payload.videos com pelo menos um vídeo observado.");
  if (payload.videos.length > 2000)
    throw new Error("Máximo de 2000 vídeos por análise.");
  const seen = new Set();
  return payload.videos
    .map((video, index) => {
      if (!video || typeof video !== "object" || Array.isArray(video))
        throw new Error(`Vídeo ${index + 1} inválido.`);
      const id = text(video.id, 100);
      if (!id) throw new Error(`Vídeo ${index + 1} sem ID.`);
      const publishedAt =
        typeof video.publishedAt === "string" &&
        Number.isFinite(Date.parse(video.publishedAt))
          ? new Date(video.publishedAt).toISOString()
          : undefined;
      return {
        id,
        title: text(video.title, 500),
        channel: text(video.channel, 200),
        channelId: text(video.channelId, 100),
        views: number(video.views),
        durationSeconds: number(video.durationSeconds),
        isShort: typeof video.isShort === "boolean" ? video.isShort : undefined,
        publishedAt,
      };
    })
    .filter((video) => {
      if (seen.has(video.id)) return false;
      seen.add(video.id);
      return true;
    });
}
function aggregate(videos, now) {
  const views = videos.flatMap((video) =>
    video.views === undefined ? [] : [video.views],
  );
  const dated = videos.flatMap((video) =>
    video.publishedAt && Date.parse(video.publishedAt) <= now ? [video] : [],
  );
  const vph = dated.flatMap((video) =>
    video.views === undefined
      ? []
      : [
          video.views /
            Math.max((now - Date.parse(video.publishedAt)) / 3600000, 1),
        ],
  );
  const shorts = videos.filter((video) => video.isShort === true).length;
  return {
    videoCount: videos.length,
    knownViewCount: views.length,
    totalObservedViews: views.length ? views.reduce((a, b) => a + b, 0) : null,
    meanViews: views.length
      ? views.reduce((a, b) => a + b, 0) / views.length
      : null,
    medianViews: median(views),
    medianLifetimeVph: median(vph),
    knownPublicationCount: dated.length,
    shorts,
    longForm: videos.filter((video) => video.isShort === false).length,
    formatUnknown: videos.filter((video) => video.isShort === undefined).length,
    viewsCoverage: videos.length ? views.length / videos.length : 0,
  };
}
function groups(videos, now) {
  const map = new Map();
  for (const video of videos) {
    const id = video.channelId || video.channel;
    if (!id) continue;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(video);
  }
  return [...map].map(([id, list]) => ({
    id,
    name: list[0].channel || id,
    corpus: list.map((v) => v.title).join(" "),
    ...aggregate(list, now),
  }));
}
export async function analyzeDataset(
  feature,
  payload,
  { dataDir, now = Date.now() } = {},
) {
  if (feature === "view-history") return history(payload, dataDir, now);
  if (feature === "sponsorships") {
    const source = text(payload.text, 100000);
    if (!source)
      throw new Error(
        "Envie payload.text com a descrição ou transcrição a examinar.",
      );
    const lines = source
      .split(/\n|(?<=[.!?])\s+/)
      .filter((line) =>
        /(patrocinad[oa]|parceria paga|paid partnership|sponsored by|sponsor(?:ed|ship)?|cupom|c[oó]digo de desconto|affiliate|afiliad[oa]|#ad\b)/i.test(
          line,
        ),
      );
    return ok(
      {
        mentions: lines
          .slice(0, 200)
          .map((excerpt) => ({
            excerpt: excerpt.slice(0, 1000),
            classification: "possível divulgação comercial",
            confidence: "regra textual; requer revisão",
          })),
        estimatedRevenue: null,
      },
      [
        "Busca por marcadores de publicidade apenas no texto enviado; não identifica todos os patrocínios nem comprova relação comercial.",
        "Não estima valores de contratos.",
      ],
    );
  }
  if (
    ![
      "similar-videos",
      "similar-channels",
      "niche",
      "search-analysis",
      "channel-analytics",
      "channel-report",
      "combined-analytics",
    ].includes(feature)
  )
    return {
      status: "unsupported",
      source: "prevlev:backend",
      error: "Recurso não suportado por este backend.",
    };
  const videos = videosFrom(payload);
  const channels = groups(videos, now);
  switch (feature) {
    case "similar-videos": {
      const target = videos.find((v) => v.id === payload.targetId);
      const query = text(payload.query) || target?.title;
      if (!query)
        throw new Error(
          "Informe payload.query ou targetId presente em videos.",
        );
      return ok(
        {
          query,
          algorithm: "Jaccard de palavras dos títulos",
          results: videos
            .filter((v) => v.id !== target?.id)
            .map((video) => ({ ...video, ...jaccard(query, video.title) }))
            .filter((v) => v.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 50),
        },
        [
          ...datasetLimits,
          "Similaridade lexical; não é recomendação oficial nem semelhança visual.",
        ],
      );
    }
    case "similar-channels": {
      const target = channels.find((c) => c.id === payload.targetId);
      const query = text(payload.query) || target?.corpus;
      if (!query)
        throw new Error(
          "Informe payload.query ou targetId de um canal presente nos vídeos.",
        );
      return ok({
        algorithm: "Jaccard dos títulos observados por canal",
        results: channels
          .filter((c) => c.id !== target?.id)
          .map(({ corpus, ...channel }) => ({
            ...channel,
            ...jaccard(query, corpus),
          }))
          .filter((c) => c.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 50),
      });
    }
    case "niche":
    case "search-analysis": {
      const frequencies = new Map();
      for (const video of videos)
        for (const token of tokens(video.title))
          frequencies.set(token, (frequencies.get(token) || 0) + 1);
      return ok({
        query: text(payload.query),
        ...aggregate(videos, now),
        channelCount: channels.length,
        terms: [...frequencies]
          .map(([term, count]) => ({ term, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 50),
        channels: channels.map(({ corpus: _corpus, ...channel }) => channel),
      });
    }
    case "channel-analytics":
    case "channel-report":
    case "combined-analytics":
      return ok({
        ...aggregate(videos, now),
        channels: channels.map(({ corpus: _corpus, ...channel }) => channel),
        topVideos: [...videos]
          .filter((v) => v.views !== undefined)
          .sort((a, b) => b.views - a.views)
          .slice(0, 20),
      });
    default:
      return {
        status: "unsupported",
        source: "prevlev:backend",
        error: "Recurso não suportado por este backend.",
      };
  }
}

const queues = new Map();
async function history(payload, dataDir, now) {
  const videoId = text(payload.videoId, 100);
  if (!/^[\w-]{1,100}$/.test(videoId))
    throw new Error("Informe payload.videoId válido.");
  if (!dataDir)
    return {
      status: "not_configured",
      source: "prevlev:history",
      error: "Configure DATA_DIR para armazenar observações de views.",
    };
  if (payload.views !== undefined && number(payload.views) === undefined)
    throw new Error("views deve ser um número não negativo.");
  const key = createHash("sha256").update(videoId).digest("hex");
  const filename = join(dataDir, `${key}.json`);
  const previous = queues.get(filename) ?? Promise.resolve();
  const task = previous
    .catch(() => {})
    .then(async () => {
      await mkdir(dataDir, { recursive: true });
      let observations = [];
      try {
        const parsed = JSON.parse(await readFile(filename, "utf8"));
        if (!Array.isArray(parsed)) throw new Error("invalid");
        observations = parsed;
      } catch (error) {
        if (error.code !== "ENOENT")
          throw new Error("Não foi possível ler o histórico armazenado.");
      }
      if (payload.views !== undefined) {
        observations.push({
          observedAt: new Date(now).toISOString(),
          views: payload.views,
          source: "user-provided-observation",
        });
        observations = observations.slice(-10000);
        const temporary = `${filename}.tmp`;
        await writeFile(temporary, JSON.stringify(observations), {
          mode: 0o600,
        });
        await rename(temporary, filename);
      }
      return ok(
        { videoId, observations },
        [
          "O histórico começa nas observações registradas aqui; não recupera dados anteriores.",
          "Views são fornecidas pelo navegador, sem verificação financeira. RPM e receita não são estimados.",
        ],
        "prevlev:history",
      );
    });
  queues.set(filename, task);
  try {
    return await task;
  } finally {
    if (queues.get(filename) === task) queues.delete(filename);
  }
}
