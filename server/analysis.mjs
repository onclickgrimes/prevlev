import {legacyHistory} from './history.mjs';
import {analyzeSponsorships} from './sponsorships.mjs';
import { observedLifetimeVph, knownPublication, groupChannelIdentities } from '../src/core/observations.ts';

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
    ? sorted[Math.floor((sorted.length - 1) / 2)] / 2 +
        sorted[Math.ceil((sorted.length - 1) / 2)] / 2
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
      const publication = typeof video.publishedAt === "string" ? knownPublication(video.publishedAt, 8.64e15) : undefined;
      const publishedAt = publication === undefined ? undefined : new Date(publication).toISOString();
      return {
        id,
        title: text(video.title, 500),
        channel: text(video.channel, 200),
        channelId: text(video.channelId, 100),
        channelUrl: text(video.channelUrl, 2000),
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
  const vph = videos.flatMap(video => {
    const rate=observedLifetimeVph(video,now);return rate===undefined?[]:[rate];
  });
  const shorts = videos.filter((video) => video.isShort === true).length;
  return {
    videoCount: videos.length,
    knownViewCount: views.length,
    totalObservedViews: views.length && Number.isFinite(views.reduce((a, b) => a + b, 0)) ? views.reduce((a, b) => a + b, 0) : null,
    meanViews: views.length
      ? views.reduce((a, b) => a + b / views.length, 0)
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
  const identities=groupChannelIdentities(videos), map=new Map();
  for(const video of videos){const identity=identities.get(video);if(!identity)continue;const group=map.get(identity.key)??{identity,videos:[]};group.videos.push(video);map.set(identity.key,group);}
  return [...map].map(([key,{identity,videos:list}])=>({
    id:key.startsWith('id:')?key.slice(3):key,key,name:identity.label,
    corpus:list.map(video=>video.title).join(' '),...aggregate(list,now),
  }));
}
export async function analyzeDataset(
  feature,
  payload,
  { dataDir, now = Date.now() } = {},
) {
  // Reject the entire provenance-marked batch before any feature dispatch or
  // projection can discard its source, including textual and unknown features.
  if (payload?.source === "youtube-data-api" ||
    (Array.isArray(payload?.videos) && payload.videos.some(video => video?.source === "youtube-data-api")))
    throw new Error("Dados com origem youtube-data-api pertencem somente à pesquisa oficial e não podem alimentar análises derivadas locais. A amostra inteira foi recusada.");
  if (feature === "view-history") return legacyHistory(payload, dataDir, now);
  if (feature === "sponsorships") {
    return analyzeSponsorships(payload);
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
