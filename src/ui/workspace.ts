import {
  getSettings,
  saveSettings,
  getSnapshot,
  saveSwipe,
} from "../shared/storage";
import type {
  PageSnapshot,
  VideoRecord,
  TranscriptSegment,
  RemoteFeature,
  RemoteResponse,
  AiCatalogData,
} from "../shared/types";
import {
  backendOrigin,
  callBackend,
  fetchAiCatalog,
  isAiFeature,
} from "../shared/backend";
import {
  summarizeVideos,
  lifetimeVph,
  sortVideos,
} from "../core/metrics";
import { selectResearchVideos, researchComparison, type ResearchFilter } from "../core/research";
import { initResearchTools } from "./research";
import { toCsv } from "../core/export";
import {
  parseTranscript,
  transcriptText,
  transcriptVtt,
  transcriptMarkdown,
} from "../core/transcript";
import {
  downloadBlob,
  cropScreenshot,
  loadImage,
  type Rect,
} from "../core/media";
import { mountMidrollTools } from "./midroll-tools";
import { initProfitTools } from "./profit";
import { mountThumbnailLab } from "./thumbnail-lab";
import { mountMcpGuide } from "./mcp-guide";
import { mountWaveformTools } from "./waveform";
import { mountMidrollRemoval } from "./midroll-removal";
import { mountRemoteImages } from "./remote-images";
import { mountStudioComposition } from "./studio-composition";
import type { MidrollRemovalObservation } from "../core/midroll-removal";
import { initOfficialSearch } from "./official-search";
import { initAnalyticsTools } from "./analytics";
import { initHistoryTools } from "./history";
import { initCommentTools } from "./comments";
import { initSwipeTools } from "./swipe";
import { initSwipeSync } from "./swipe-sync";
import { initImageTools } from "./images";
import { initSponsorshipTools } from "./sponsorships";
import { initCollectionTools } from "./collection";
import { initNicheTools } from "./niche";
import { mountDailyObservations } from "./daily-observations";
import { mountChannelReport } from "./channel-report";
import { initCardCompositionTools } from "./card-composition";
import { initVisualSimilarityTools } from "./visual-similarity";
import { initStudioOverview } from "./studio-overview";
import { initCaptureOptions } from "./capture-options";
import { initTranscriptExtras, type TranscriptAiFeature } from "./transcript-extra";

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const value = (id: string) => $<HTMLInputElement>(id).value;
const num = (id: string) => Number(value(id));
let snapshot: PageSnapshot = {
  url: "",
  title: "",
  videos: [],
  comments: [],
  transcript: [],
  warnings: [],
};
let segments: TranscriptSegment[] = [];
let transcriptStamp = "";
function invalidateTranscriptContext() {const stamp=JSON.stringify([segments,document.getElementById("transcript-text")?.textContent,($<HTMLTextAreaElement>("transcript-text")?.value),snapshot.url,snapshot.videoId]);if(stamp!==transcriptStamp){transcriptExtras?.invalidate();transcriptStamp=stamp;}}
let planId: string | undefined;
let studioPreviewGeneration = 0;
let planTab: number | undefined;
let runningPlan: { id: string; tabId: number } | undefined;
let channelVideos: VideoRecord[] = [];
interface TimelineView {
  available: boolean;
  currentTime: number;
  duration?: number;
  paused: boolean;
  videoId?: string;
  segments: TranscriptSegment[];
  limitations: string[];
}
let timeline: TimelineView | undefined;
let aiCatalog: AiCatalogData | undefined;
let selectedAiModel = "";
let selectedAiOrigin = "http://127.0.0.1:7814";
let savedBackendOrigin = "";
let selectedAiStreaming = false;
let aiSelectionSaving = false;
let aiRequestRunning = false;
let imageContextRevision=0,imageTabRevision=0,studioCaptureRevision=0,studioCaptureRequest=0;
let studioCaptureObserved:{tabId:number;url:string;stamp:string;kind:"analytics"|"latest-performance";redact:boolean;categories:ReturnType<typeof getRedactionCategories>;token:number}|undefined;
const studioCaptureContext=()=>JSON.stringify([value("tab-select"),snapshot.url,snapshot.videoId,studioCaptureRevision,studioCaptureObserved?.url,studioCaptureObserved?.token,$<HTMLInputElement>("redact").checked,getRedactionCategories()]);
function invalidateStudioComposition(reason="A aba, coleta ou ocultação mudou. Capture novamente para compor.") {studioCaptureRevision++;studioCaptureRequest++;studioComposer.invalidate(reason);}
async function validateStudioCaptureContext(key:string):Promise<boolean> {
  const observed=studioCaptureObserved;
  if(!observed||key!==studioCaptureContext()||Number(value("tab-select"))!==observed.tabId)return false;
  try {
    const tab=await chrome.tabs.get(observed.tabId);
    if(key!==studioCaptureContext()||observed!==studioCaptureObserved||tab.url!==observed.url)return false;
    const measurement=await chrome.tabs.sendMessage(observed.tabId,{type:"CAPTURE_CARD",kind:observed.kind,redact:observed.redact,...(observed.redact?{redactionCategories:observed.categories}:{})}) as {status?:string;captureStamp?:string};
    const after=await chrome.tabs.get(observed.tabId);
    return key===studioCaptureContext()&&observed===studioCaptureObserved&&after.url===observed.url&&measurement.status==="ok"&&measurement.captureStamp===observed.stamp;
  } catch {return false;}
}
let remoteOutputEpoch = 0;
function invalidateRemoteOutput() { remoteOutputEpoch++; remoteImages.invalidate(); $("remote-result").textContent=""; }
const transcriptExtras=initTranscriptExtras({segments:()=>segments,text:transcriptContent,metadata:()=>snapshot,aiContext:()=>JSON.stringify([savedBackendOrigin,selectedAiOrigin,selectedAiModel,selectedAiStreaming]),aiProvenance:()=>({model:selectedAiModel,origin:selectedAiOrigin,backendOrigin:savedBackendOrigin})});
const commentTools = initCommentTools({snapshot: () => snapshot, onAi: async () => {showPage("remote"); await remote("comment-analysis");}});
const swipeTools = initSwipeTools();
const renderComments = () => commentTools.render();
const currentComments = () => commentTools.currentComments();
const renderSwipe = () => swipeTools.render();
async function saveVideo(video: VideoRecord) {await swipeTools.saveVideo(video); notice("Referência salva na biblioteca local.");}

const filterIds = [
  "video-filter",
  "channel-filter",
  "min-views",
  "max-views",
  "min-subscribers",
  "max-subscribers",
  "min-duration",
  "max-duration",
  "min-vph",
  "max-vph",
  "min-outlier",
  "max-outlier",
  "published-after",
  "published-before",
  "short-filter",
  "sort",
];
const compact = (n?: number) =>
  n === undefined
    ? "—"
    : new Intl.NumberFormat("pt-BR", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(n);
function notice(message: string, error = false) {
  $("notice").textContent = message;
  $("notice").classList.toggle("error", error);
}
function on(id: string, task: () => unknown) {
  $(id).addEventListener("click", () => {
    void Promise.resolve().then(task).catch(fail);
  });
}
function fail(error: unknown) {
  notice(error instanceof Error ? error.message : String(error), true);
}
function textFile(content: string, name: string, type = "text/plain") {
  downloadBlob(new Blob([content], { type }), name);
}
const safeLink = (url: string): string => {
  try {
    const u = new URL(url);
    return ["http:", "https:"].includes(u.protocol) ? u.href : "#";
  } catch {
    return "#";
  }
};
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  return el;
}
function showPage(id: string) {
  for (const page of document.querySelectorAll<HTMLElement>(".page"))
    page.hidden = page.id !== id;
  for (const b of document.querySelectorAll<HTMLElement>("nav [data-page]"))
    b.classList.toggle("active", b.dataset.page === id);
  $("page-title").textContent =
    document
      .querySelector(`[data-page="${id}"]`)
      ?.textContent?.trim()
      .replace(/^\S+\s*/, "") ?? id;
}
for (const b of document.querySelectorAll<HTMLElement>("[data-page]"))
  b.addEventListener("click", () => showPage(b.dataset.page!));
async function tabs() {
  const all = await chrome.tabs.query({});
  const target = Number(new URL(location.href).searchParams.get("tab"));
  const select = $<HTMLSelectElement>("tab-select");
  select.replaceChildren();
  for (const tab of all.filter((t) =>
    /^https:\/\/(www|studio)\.youtube\.com\//.test(t.url ?? ""),
  )) {
    const option = element("option", tab.title ?? tab.url);
    option.value = String(tab.id);
    option.selected = tab.id === target;
    select.append(option);
  }
  if (!select.options.length) {
    const option = element("option", "Abra uma aba YouTube / Studio");
    option.value = "";
    select.append(option);
  }
}
function targetTab() {
  const id = Number(value("tab-select"));
  if (!id) throw new Error("Abra o YouTube ou Studio e atualize este painel.");
  return id;
}
async function tabMessage<T = Record<string, unknown>>(
  type: string,
  extra: Record<string, unknown> = {},
): Promise<T> {
  const response = await chrome.tabs.sendMessage(targetTab(), {
    type,
    ...extra,
  });
  if (response?.status === "error") throw new Error(response.error);
  return response as T;
}
async function scan() {
  const result = await tabMessage<{ snapshot: PageSnapshot }>("GET_SNAPSHOT");
  if (!result.snapshot)
    throw new Error(
      "Não foi possível coletar. Recarregue a aba YouTube após instalar a extensão.",
    );
  snapshot = {
    ...result.snapshot,
    videos: result.snapshot.videos.map((video) => ({
      ...video,
      source: video.source ?? "youtube-dom",
      observedAt: video.observedAt ?? new Date().toISOString(),
    })),
  };
  nicheTools.invalidate(); cardComposer.invalidateSnapshot(); channelReport.invalidate();
  segments = snapshot.transcript;
  await chrome.storage.local.set({ snapshot });
  render();
  notice(
    `Coletados ${snapshot.videos.length} vídeos e ${snapshot.comments.length} comentários. ${snapshot.warnings.join(" ")}`,
  );
}
on("scan", scan);
on("enrich", async () => {
  if (!snapshot.videos.length) throw new Error("Colete vídeos primeiro.");
  $<HTMLButtonElement>("enrich").disabled = true;
  notice(
    "Consultando até 10 canais públicos no YouTube, sem enviar credenciais…",
  );
  try {
    const tabId = targetTab();
    const result = await chrome.runtime.sendMessage({
      type: "ENRICH_CHANNELS",
      videos: snapshot.videos,
    });
    if (result.status !== "ok") throw new Error(result.error);
    snapshot.videos = result.videos as VideoRecord[];
    imageContextRevision++;
    imageTools.invalidateContext();
    invalidateRemoteOutput();
    nicheTools.invalidate(); cardComposer.invalidateSnapshot(); channelReport.invalidate();
    await chrome.tabs.sendMessage(tabId, {
      type: "SET_ENRICHMENT",
      videos: snapshot.videos,
    });
    await chrome.storage.local.set({ snapshot });
    renderVideos();
    notice(
      `Consulta de inscritos concluída. ${(result.warnings as string[]).join(" ")}`,
    );
  } finally {
    $<HTMLButtonElement>("enrich").disabled = false;
  }
});
function readVideoFilter(): ResearchFilter {
  const optional = (id: string) => (value(id) === "" ? undefined : num(id));
  const mode = value("short-filter");
  return {
    query: value("video-filter"),
    channel: value("channel-filter"),
    minViews: optional("min-views"),
    maxViews: optional("max-views"),
    minSubscribers: optional("min-subscribers"),
    maxSubscribers: optional("max-subscribers"),
    minDurationSeconds: optional("min-duration"),
    maxDurationSeconds: optional("max-duration"),
    minVph: optional("min-vph"),
    maxVph: optional("max-vph"),
    minOutlier: optional("min-outlier"),
    maxOutlier: optional("max-outlier"),
    publishedAfter: value("published-after") || undefined,
    publishedBefore: value("published-before") || undefined,
    shorts: mode === "shorts" ? "only" : mode === "long" ? "exclude" : "all",
    ...researchTools?.readOptions(),
  };
}
function visibleVideos() {
  return selectResearchVideos(snapshot.videos, { ...readVideoFilter(), sort: value("sort") });
}
function renderVideos() {
  researchTools?.refresh();
  const videos = visibleVideos(),
    body = $("video-rows");
  renderMetrics(videos);
  body.replaceChildren();
  $("video-count").textContent = `(${videos.length})`;
  const mode = readVideoFilter().comparisonMode ?? "sample-median";
  const excludedApi = snapshot.videos.filter(video => video.source === "youtube-data-api").length;
  $("outlier-details").textContent = `Modo selecionado: ${mode}. Amostra: ${snapshot.videos.length} registros recebidos, ${videos.length} incluídos; ${excludedApi} da API oficial e ${snapshot.videos.length - excludedApi - videos.length} pelos filtros excluídos. Referências: observações carregadas elegíveis antes dos filtros. O alvo é excluído por ID; outras observações repetidas podem ser contadas. O denominador é a referência da amostra, não a referência completa do canal. Valores desconhecidos aparecem como desconhecido.${videos.length ? "" : " Exportações sem linhas não incluem esses totais; consulte este resumo."}`;
  for (const video of videos) {
    const row = element("tr"),
      title = element("td"),
      a = element("a", video.title);
    a.href = safeLink(video.url);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    title.append(a, element("small", video.channel ?? "Canal indisponível"));
    row.append(title);
    for (const val of [
      compact(video.views),
      compact(lifetimeVph(video)),
      (() => { const comparison = researchComparison(video, snapshot.videos, readVideoFilter().comparisonMode); return `${comparison.score?.toFixed(1).concat("×") ?? "desconhecido"} · método previsto ${comparison.method} · denominador ${comparison.reference === undefined ? "desconhecido" : String(comparison.reference)} · ${comparison.referenceCount} candidatos (${comparison.positiveReferenceCount} positivas) · origem ${comparison.provenance}`; })(),
      compact(video.subscribers),
      video.durationSeconds === undefined
        ? "—"
        : `${Math.floor(video.durationSeconds / 60)}:${String(Math.floor(video.durationSeconds % 60)).padStart(2, "0")}`,
      video.publishedAt
        ? new Date(video.publishedAt).toLocaleDateString("pt-BR")
        : "—",
    ])
      row.append(element("td", val));
    const action = element("td"),
      save = element("button", "+ Salvar");
    save.addEventListener("click", () => {
      void saveVideo(video).catch(fail);
    });
    action.append(save);
    row.append(action);
    body.append(row);
  }
  if (!videos.length) {
    const row = element("tr"),
      cell = element(
        "td",
        "Nenhum vídeo carregado corresponde aos filtros. Abra o YouTube e colete a aba.",
      );
    cell.colSpan = 8;
    row.append(cell);
    body.append(row);
  }
}
function renderMetrics(videos: VideoRecord[]) {
  const summary = summarizeVideos(videos);
  $("metrics").replaceChildren();
  for (const [name, val, note] of [
    [
      "VÍDEOS FILTRADOS",
      compact(summary.count),
      `${summary.shorts} Shorts identificados`,
    ],
    [
      "VIEWS CONHECIDAS",
      compact(summary.knownViews ? summary.totalViews : undefined),
      `${summary.knownViews} vídeos com dados`,
    ],
    [
      "MEDIANA DE VIEWS",
      compact(summary.medianViews),
      `Média ${compact(summary.meanViews)} · amostra filtrada`,
    ],
    [
      "MEDIANA DE VPH MÉDIO",
      compact(summary.medianVph),
      "Desde a publicação; não é a última hora",
    ],
  ]) {
    const card = element("div");
    card.className = "metric";
    card.append(
      element("span", name),
      element("strong", val),
      element("small", note),
    );
    $("metrics").append(card);
  }
}
function render() {
  imageContextRevision++;
  imageTools.invalidateContext();
  invalidateStudioComposition();
  midrollTools.refreshTimeline();
  swipeTools.invalidatePreviews();
  invalidateRemoteOutput();
  studioOverview.render();
  renderVideos();
  renderComments();
  $("current-video").textContent =
    `${snapshot.title || "Nenhum vídeo selecionado"}${snapshot.videoId ? " · " + snapshot.videoId : ""}`;
  $<HTMLTextAreaElement>("transcript-text").value = transcriptText(segments);
  invalidateTranscriptContext();
  profitTools.render();
  removalTools.invalidate();
  $<HTMLInputElement>("swipe-title").value = snapshot.title;
  $<HTMLInputElement>("swipe-url").value = snapshot.url;
  if (!value("channel-url"))
    $<HTMLInputElement>("channel-url").value =
      snapshot.videos.find((v) => v.id === snapshot.videoId)?.channelUrl ??
      snapshot.videos.find((v) => v.channelUrl)?.channelUrl ??
      (/^https:\/\/www\.youtube\.com\/(?:@|channel\/)/.test(snapshot.url)
        ? snapshot.url.replace(
            /\/(?:videos|shorts|featured|about)(?:[?#].*)?$/,
            "",
          )
        : "");
}
for (const id of filterIds)
  $(id).addEventListener("input", () => {
    try {
      renderVideos();
      if ($("notice").classList.contains("error"))
        notice("Filtros atualizados na amostra coletada.");
    } catch (error) {
      fail(error);
    }
  });
on("reset-filters", () => {
  for (const id of filterIds)
    $<HTMLInputElement>(id).value =
      id === "short-filter" ? "all" : id === "sort" ? "views" : "";
  researchTools?.reset();
  renderVideos();
  notice("Filtros do painel limpos.");
});
on("apply-page-filter", async () => {
  visibleVideos();
  const result = await tabMessage<{ visible: number; total: number }>(
    "APPLY_FILTER",
    {
      filter: {
        ...readVideoFilter(),
        sort: value("sort") === "date" ? "recent" : value("sort"),
      },
    },
  );
  notice(
    `Filtros aplicados na aba: ${result.visible} de ${result.total} cards visíveis.`,
  );
});
on("clear-page-filter", async () => {
  await tabMessage("CLEAR_FILTER");
  notice(
    "Filtros da aba YouTube removidos. A preferência Ocultar Shorts continua ativa se selecionada.",
  );
});
function workspaceExportRows() {
  const mode = readVideoFilter().comparisonMode ?? "sample-median";
  const excludedApi = snapshot.videos.filter(video => video.source === "youtube-data-api").length;
  const videos = visibleVideos();
  return videos.map(video => {
    const comparison = researchComparison(video, snapshot.videos, mode);
    return {
      ...video,
      vph: lifetimeVph(video),
      outlier: comparison.score ?? null,
      outlier_status: comparison.score === undefined ? "desconhecido" : "conhecido",
      outlier_reference_count: comparison.referenceCount,
      outlier_comparison_mode: mode,
      outlier_method: comparison.method,
      outlier_reference_status: comparison.reference === undefined ? "desconhecido" : comparison.reference === 0 ? "zero" : "conhecido",
      observation_source: video.source ?? "desconhecido",
      outlier_target_exclusion: "same-video-id",
      outlier_count_unit: "observations",
      outlier_reference: comparison.reference ?? "desconhecido",
      outlier_positive_reference_count: comparison.positiveReferenceCount,
      outlier_provenance: comparison.provenance,
      outlier_limitation: comparison.limitation,
      sample_input_count: snapshot.videos.length,
      sample_included_count: videos.length,
      excluded_api_count: excludedApi,
      excluded_by_filter_count: snapshot.videos.length - excludedApi - videos.length,
    };
  });
}
on("export-json", () =>
  textFile(
    JSON.stringify(workspaceExportRows(), null, 2),
    "prevlev-videos.json",
    "application/json",
  ),
);
on("export-csv", () => {
  const rows = workspaceExportRows();
  const columns = rows.length ? [...new Set(rows.flatMap(row => Object.keys(row)))] : [
    "id", "title", "url", "channel", "channelId", "channelUrl", "views", "publishedAt", "durationSeconds", "subscribers", "isShort", "thumbnail", "source", "observedAt", "vph", "outlier", "outlier_status", "outlier_reference_count", "outlier_comparison_mode", "outlier_method", "outlier_reference_status", "observation_source", "outlier_target_exclusion", "outlier_count_unit", "outlier_reference", "outlier_positive_reference_count", "outlier_provenance", "outlier_limitation", "sample_input_count", "sample_included_count", "excluded_api_count", "excluded_by_filter_count",
  ];
  textFile(toCsv(rows, columns), "prevlev-videos.csv", "text/csv");
});
on("copy-title", async () => {
  const result = await tabMessage<{metadata:{title:string;id?:string;url:string}}>("GET_CURRENT_METADATA");
  if (!result.metadata) throw new Error("A aba selecionada não devolveu metadados atuais.");
  await navigator.clipboard.writeText(`${result.metadata.title}\n${result.metadata.id ?? result.metadata.url}`);
  notice("Título e ID copiados.");
});
on("monetization", async () => {
  $("video-result").textContent = JSON.stringify(
    await tabMessage("GET_MONETIZATION"),
    null,
    2,
  );
});
on("frame", async () => {
  const r = await tabMessage<{ dataUrl: string }>("CAPTURE_FRAME");
  downloadBlob(await (await fetch(r.dataUrl)).blob(), "prevlev-frame.png");
  notice("Frame capturado localmente.");
});
async function screenshot(kind: string) {
  const tabId = targetTab();
  const request=++studioCaptureRequest;
  let contextKey=studioCaptureContext();
  const compose=(kind==="analytics"||kind==="latest-performance")&&studioComposer.wantsComposition();
  const redact=$<HTMLInputElement>("redact").checked;
  const categories=redact&&kind!=="video"?getRedactionCategories():[];
  const current=()=>request===studioCaptureRequest&&contextKey===studioCaptureContext()&&tabId===targetTab();
  if(compose)studioComposer.invalidate("Preparando uma captura validada; nenhuma composição será gerada automaticamente.");
  const sourceTab=compose?await chrome.tabs.get(tabId):undefined;
  if(!current())return;
  if(compose&&!/^https:\/\/studio\.youtube\.com\//.test(sourceTab?.url??""))throw new Error("Selecione a aba Studio autorizada para compor esta captura.");
  const capture = await chrome.runtime.sendMessage({
    type: "CAPTURE_SCREENSHOT",
    tabId,
    kind,
    redact,
    ...(redact&&kind!=="video"?{redactionCategories:categories}:{}),
  });
  if(!current())return;
  if (capture.status !== "ok") throw new Error(capture.error);
  const details = capture.capture as
    | {
        rect: Rect;
        redactions: Rect[];
        viewportWidth: number;
        captureStamp: string;
        coarse?: boolean;
        coarseSelectors?: string[];
      }
    | undefined;
  if (!details?.captureStamp || !details.rect || !details.viewportWidth)
    throw new Error(
      "A captura não retornou uma medição validada; imagem descartada.",
    );
  if(compose&&(kind==="analytics"||kind==="latest-performance")) {
    const receipt=capture.tabContext as {tabId?:number;url?:string}|undefined;
    const latest=await chrome.tabs.get(tabId);
    if(!current())return;
    if(!receipt||typeof receipt.url!=="string"||receipt.tabId!==tabId||receipt.url!==sourceTab?.url||latest.url!==receipt.url)throw new Error("A URL da aba mudou ou a captura não preservou a identidade da origem. Pixels descartados.");
    studioCaptureObserved={tabId,url:receipt.url,stamp:details.captureStamp,kind,redact,categories,token:request};
    contextKey=studioCaptureContext();
  }
  const image = await loadImage(capture.dataUrl);
  if(!current())return;
  const cropped=await cropScreenshot(
      capture.dataUrl,
      details.rect,
      image.naturalWidth / details.viewportWidth,
      details.redactions,
    );
  if(!current())return;
  if(compose&&(kind==="analytics"||kind==="latest-performance")) {
    const valid=await validateStudioCaptureContext(contextKey);
    if(!current())return;
    if(!valid){invalidateStudioComposition("A página da captura mudou. Capture novamente antes de compor.");return;}
    await studioComposer.setCapture(cropped,{kind,contextKey,capturedAt:new Date().toISOString(),redactionValidated:true,redacted:redact,categories});
    return;
  }
  downloadBlob(cropped,`prevlev-${kind}.png`);
  notice(
    details.coarse ? `Captura salva com ocultação ampla (${(details.coarseSelectors??[]).join(", ")}). Confira a imagem antes de compartilhar.` : "Captura da área visível salva. Confira a ocultação antes de compartilhar.",
  );
}
on("card-shot", () => screenshot("video"));
on("analytics-shot", () => screenshot("analytics"));
on("latest-shot", () => screenshot("latest-performance"));
function renderChannel() {
  for (const [id, sort] of [
    ["channel-recent", "recent"],
    ["channel-popular", "views"],
  ] as const) {
    const container = $(id);
    container.replaceChildren();
    const records = sortVideos(channelVideos, sort).slice(0, 10);
    for (const video of records) {
      const row = element("article");
      row.className = "channel-video";
      const a = element("a", video.title);
      a.href = safeLink(video.url);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      row.append(
        a,
        element(
          "small",
          `${compact(video.views)} views · ${video.publishedAt ? new Date(video.publishedAt).toLocaleDateString("pt-BR") : "data indisponível"}`,
        ),
      );
      const save = element("button", "+ Salvar referência");
      save.addEventListener("click", () => {
        void saveVideo(video).catch(fail);
      });
      row.append(save);
      container.append(row);
    }
    if (!records.length)
      container.append(element("p", "Nenhum vídeo disponível nesta amostra."));
  }
  $<HTMLButtonElement>("channel-use").disabled = !channelVideos.length;
}
on("channel-load", async () => {
  $<HTMLButtonElement>("channel-load").disabled = true;
  notice("Consultando a primeira página pública do canal no YouTube…");
  try {
    const r = await chrome.runtime.sendMessage({
      type: "CHANNEL_RESEARCH",
      channelUrl: value("channel-url").trim(),
    });
    if (r.status !== "ok") throw new Error(r.error);
    const data = r.data as {
      videos: VideoRecord[];
      channelUrl: string;
      channelName?: string;
      warnings: string[];
    };
    channelVideos = data.videos.map((video) => ({
      ...video,
      source: video.source ?? "public-page",
      observedAt: video.observedAt ?? new Date().toISOString(),
    }));
    renderChannel();
    $("channel-source").textContent =
      `${data.channelName ?? data.channelUrl} · ${channelVideos.length} vídeos encontrados na primeira resposta pública. ${data.warnings.join(" ")}`;
    notice(
      "Amostra pública carregada. A lista não representa todo o catálogo do canal.",
    );
  } finally {
    $<HTMLButtonElement>("channel-load").disabled = false;
  }
});
on("channel-loaded", () => {
  const url = value("channel-url").trim().replace(/\/$/, "");
  channelVideos = snapshot.videos.filter(
    (v) => !url || v.channelUrl?.replace(/\/$/, "") === url,
  );
  renderChannel();
  $("channel-source").textContent =
    `${channelVideos.length} vídeos da coleta atual${url ? " com URL de canal correspondente" : ""}. Não foi feita consulta de rede.`;
});
on("channel-use", async () => {
  const videos = new Map(snapshot.videos.map((v) => [v.id, v]));
  for (const video of channelVideos)
    videos.set(video.id, { ...videos.get(video.id), ...video });
  snapshot.videos = [...videos.values()];
  nicheTools.invalidate(); cardComposer.invalidateSnapshot(); channelReport.invalidate();
  await chrome.storage.local.set({ snapshot });
  render();
  notice(
    `${channelVideos.length} vídeos da amostra do canal adicionados à pesquisa.`,
  );
});
on("sample-monetization", async () => {
  const videos = channelVideos.length ? channelVideos : snapshot.videos;
  if (!videos.length)
    throw new Error("Colete vídeos ou consulte um canal primeiro.");
  $<HTMLButtonElement>("sample-monetization").disabled = true;
  notice("Examinando marcadores em páginas públicas de uma amostra limitada…");
  try {
    const r = await chrome.runtime.sendMessage({
      type: "SAMPLE_MONETIZATION",
      videos,
      maxSamples: num("monetization-count"),
    });
    if (r.status !== "ok") throw new Error(r.error);
    $("channel-monetization").textContent = JSON.stringify(r.data, null, 2);
    notice(
      "Amostra examinada. O resultado não confirma receita nem monetização do canal.",
    );
  } finally {
    $<HTMLButtonElement>("sample-monetization").disabled = false;
  }
});
function timeLabel(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
function renderTimeline() {
  const state = timeline;
  const slider = $<HTMLInputElement>("timeline-range");
  slider.disabled = !state?.available || !state.duration;
  slider.max = String(state?.duration ?? 0);
  slider.value = String(state?.currentTime ?? 0);
  $("timeline-state").textContent = state?.available
    ? `${timeLabel(state.currentTime)} / ${state.duration ? timeLabel(state.duration) : "duração indisponível"} · ${state.paused ? "Pausado" : "Reproduzindo"} · ${state.limitations.join(" ")}`
    : "Nenhum vídeo carregado na aba selecionada.";
  const list = $("timeline-segments");
  list.replaceChildren();
  const query = value("timeline-query").toLocaleLowerCase();
  for (const segment of (state?.segments ?? [])
    .filter((s) => !query || s.text.toLocaleLowerCase().includes(query))
    .slice(0, 500)) {
    const b = element(
      "button",
      `${timeLabel(segment.start)} · ${segment.text}`,
    );
    b.addEventListener("click", () => {
      void updateTimeline("SEEK_VIDEO", {
        seconds: segment.start,
        expectedVideoId: state?.videoId,
      }).catch(fail);
    });
    list.append(b);
  }
  if (!list.childNodes.length)
    list.append(
      element(
        "p",
        "Abra a transcrição no YouTube e atualize a timeline para navegar por trechos.",
      ),
    );
}
async function updateTimeline(
  type = "GET_TIMELINE",
  extra: Record<string, unknown> = {},
) {
  const r = await tabMessage<{ state: TimelineView }>(type, extra);
  if (!r.state)
    throw new Error(
      "O content script não disponibilizou a timeline. Recarregue a aba YouTube.",
    );
  timeline = r.state;
  renderTimeline();
}
on("timeline-refresh", () => updateTimeline());
on("timeline-toggle", () =>
  updateTimeline("TOGGLE_PLAYBACK", { expectedVideoId: timeline?.videoId }),
);
for (const [id, delta] of [
  ["timeline-back", -5],
  ["timeline-forward", 5],
  ["timeline-frame-back", -1 / 30],
  ["timeline-frame-forward", 1 / 30],
] as const)
  on(id, async () => {
    if (!timeline?.available) await updateTimeline();
    if (!timeline?.available)
      throw new Error("Abra um vídeo na aba selecionada.");
    await updateTimeline("SEEK_VIDEO", {
      seconds: Math.max(0, timeline.currentTime + delta),
      expectedVideoId: timeline.videoId,
    });
  });
$("timeline-range").addEventListener("change", () => {
  void updateTimeline("SEEK_VIDEO", {
    seconds: num("timeline-range"),
    expectedVideoId: timeline?.videoId,
  }).catch(fail);
});
$("timeline-query").addEventListener("input", renderTimeline);
$("tab-select").addEventListener("change", () => {
  timeline = undefined;
  renderTimeline();
});
on("timeline-capture", async () => {
  const r = await tabMessage<{ dataUrl: string }>("CAPTURE_FRAME");
  downloadBlob(await (await fetch(r.dataUrl)).blob(), "prevlev-frame.png");
  notice("Frame capturado localmente.");
});
$("transcript-file").addEventListener("change", () => {
  void (async () => {
    const file = $<HTMLInputElement>("transcript-file").files?.[0];
    if (!file) return;
    if (file.size > 5_000_000) throw new Error("Use arquivo de até 5 MB.");
    const text = await file.text(),
      parsed = parseTranscript(text);
    segments = parsed;
    $<HTMLTextAreaElement>("transcript-text").value = parsed.length
      ? transcriptText(parsed)
      : text;
    invalidateTranscriptContext();
    notice(
      parsed.length
        ? `${parsed.length} segmentos importados.`
        : "Texto importado sem timestamps reconhecidos.",
    );
  })().catch(fail);
});
function transcriptContent() {
  return $<HTMLTextAreaElement>("transcript-text").value;
}
function timedSegments() {
  if (!segments.length || transcriptContent() !== transcriptText(segments))
    throw new Error(
      "Timestamps originais necessários. Colete ou importe segmentos e mantenha o texto sem edição para exportar VTT.",
    );
  return segments;
}
on("transcript-copy", async () => {
  await navigator.clipboard.writeText(transcriptContent());
  notice("Transcrição copiada.");
});
on("transcript-txt", () =>
  textFile(transcriptContent(), "prevlev-transcricao.txt"),
);
on("transcript-vtt", () =>
  textFile(
    transcriptVtt(timedSegments()),
    "prevlev-transcricao.vtt",
    "text/vtt",
  ),
);
on("transcript-md", () =>
  textFile(
    segments.length && transcriptContent() === transcriptText(segments)
      ? transcriptMarkdown(segments, snapshot.title)
      : transcriptContent(),
    "prevlev-transcricao.md",
    "text/markdown",
  ),
);
on("period", async () => {
  $("studio-plan").textContent = JSON.stringify(
    await tabMessage("STUDIO_PERIOD", {
      start: value("period-start"),
      end: value("period-end"),
    }),
    null,
    2,
  );
});
function invalidateStudioPreview() {
  studioPreviewGeneration++;
  planId = undefined;
  planTab = undefined;
  $("studio-plan").textContent = "";
  $<HTMLButtonElement>("studio-confirm").disabled = true;
}
on("studio-preview", async () => {
  invalidateStudioPreview();
  $("studio-plan").textContent = "Preparando prévia…";
  const generation = studioPreviewGeneration;
  const tabId = targetTab();
  const action = value("studio-action");
  let localPlan:ReturnType<typeof midrollTools.getPlan>|undefined;
  let positionFps:number|undefined;
  try {
    localPlan=action==="midrolls"?midrollTools.getPlan():undefined;
    const editorFps=value("studio-fps")?num("studio-fps"):undefined;
    if(localPlan?.positionPrecision==="frames" && editorFps!==undefined && editorFps!==localPlan.positionFps)
      throw new Error("O FPS do plano difere do FPS declarado do editor. Revise os dois valores antes de preparar a prévia.");
    positionFps=localPlan?.positionPrecision==="frames"?localPlan.positionFps:editorFps;
  } catch(error) {
    $("studio-plan").textContent=error instanceof Error?error.message:"Planejamento inválido.";
    throw error;
  }
  const positions = localPlan?.positions;
  let plan: { id: string; status: string; error?: string };
  try {
    plan = (await chrome.tabs.sendMessage(tabId, {
      type: "STUDIO_PREVIEW",
      action,
      input: { limit: num("action-limit"), positions, ...(positionFps!==undefined?{fps:positionFps}:{}) },
    })) as typeof plan;
  } catch (error) {
    if (generation !== studioPreviewGeneration) return;
    throw error;
  }
  if (generation !== studioPreviewGeneration) return;
  if (plan.status === "error") throw new Error(plan.error);
  planId = plan.status === "ready" ? plan.id : undefined;
  planTab = tabId;
  $("studio-plan").textContent = JSON.stringify(localPlan ? { ...plan, planejamentoLocal: localPlan } : plan, null, 2);
  $<HTMLButtonElement>("studio-confirm").disabled = !planId;
});
on("studio-confirm", async () => {
  if (runningPlan) throw new Error("Aguarde a ação atual terminar.");
  if (!planId || targetTab() !== planTab || !planTab)
    throw new Error("Prepare uma nova prévia para a aba selecionada.");
  const active = { id: planId, tabId: planTab };
  runningPlan = active;
  planId = undefined;
  $<HTMLButtonElement>("studio-confirm").disabled = true;
  $<HTMLButtonElement>("studio-preview").disabled = true;
  try {
    $("studio-plan").textContent = JSON.stringify(
      await chrome.tabs.sendMessage(active.tabId, {
        type: "STUDIO_EXECUTE",
        planId: active.id,
      }),
      null,
      2,
    );
  } finally {
    runningPlan = undefined;
    $<HTMLButtonElement>("studio-preview").disabled = false;
  }
});
on("studio-cancel", async () => {
  const active =
    runningPlan ??
    (planId && planTab ? { id: planId, tabId: planTab } : undefined);
  invalidateStudioPreview();
  if (active)
    await chrome.tabs.sendMessage(active.tabId, {
      type: "STUDIO_CANCEL",
      planId: active.id,
    });
  notice("Cancelamento solicitado. Ações já enviadas não são desfeitas.");
});
for (const id of [
  "studio-action",
  "action-limit",
  "studio-fps",
  "duration",
  "interval",
  "tab-select",
]) {
  $(id).addEventListener("input", invalidateStudioPreview);
  $(id).addEventListener("change", invalidateStudioPreview);
}
$("studio").addEventListener("input", event => {
  if (event.target instanceof Element && (event.target.closest("#midroll-tools") || event.target.id === "midroll-audio")) invalidateStudioPreview();
});
async function displayRemote(response: RemoteResponse, output: string) {
  const data =
    response.data && typeof response.data === "object"
      ? (response.data as Record<string, unknown>)
      : undefined;
  const images = Array.isArray(data?.images) ? data.images : [];
  $(output).textContent = JSON.stringify(
    images.length
      ? {
          ...response,
          data: {
            ...data,
            images: images.map(() => ({ image: "Bytes omitidos; prévia sujeita à validação local." })),
          },
        }
      : response,
    null,
    2,
  );
  await remoteImages.show(response);
}
async function remote(
  feature: RemoteFeature,
  output: string | null = "remote-result",
  extra: Record<string, unknown> = {},
  expectedAi?: { model: string; origin: string; backendOrigin: string },
): Promise<RemoteResponse> {
  const ai = isAiFeature(feature);
  if (ai && (aiRequestRunning || aiSelectionSaving)) {
    if (expectedAi) return {status:"error",source:"prevlev:client",error:"Solicitação não enviada. Aguarde a análise ou o salvamento da seleção atual concluir."};
    throw new Error("Aguarde a análise ou o salvamento da seleção atual concluir.");
  }
  if (ai) {
    aiRequestRunning = true;
    updateAiButtons();
  }
  try {
    const requestEpoch=++remoteOutputEpoch;
    remoteImages.invalidate();
    if(output!==null)$(output).textContent="";
    const query = value("remote-query");
    const current = snapshot.videos.find((v) => v.id === snapshot.videoId);
    let payload: Record<string, unknown>;
    if (feature === "comment-analysis")
      payload = { comments: currentComments() };
    else if (feature === "thumbnail-generation") payload = { prompt: query };
    else if (feature.startsWith("transcript-"))
      payload = { text: transcriptContent() };
    else if (feature === "sponsorships") payload = { text: query };
    else if (feature === "view-history")
      payload = {
        videoId: snapshot.videoId ?? query.trim(),
        views: current?.views,
      };
    else
      payload = {
        videos: snapshot.videos,
        query,
        targetId:
          feature === "similar-channels"
            ? (current?.channelId ?? current?.channel)
            : snapshot.videoId,
      };
    let settings;
    try { settings = await getSettings(); }
    catch (error) {
      if (expectedAi) return {status:"error",source:"prevlev:client",error:"Solicitação não enviada. Não foi possível ler a configuração local."};
      throw error;
    }
    if (expectedAi && (settings.aiModel !== expectedAi.model || settings.aiOrigin !== expectedAi.origin || settings.backendUrl !== expectedAi.backendOrigin))
      return {status:"error",source:"prevlev:client",error:"Solicitação não enviada. A seleção de modelo, origem ou backend mudou; revise o briefing."};
    if (expectedAi && settings.backendUrl) {
      try { backendOrigin(settings.backendUrl); }
      catch { return {status:"error",source:"prevlev:client",error:"Solicitação não enviada. Revise a origem do backend configurado."}; }
    }
    notice("Enviando ao backend configurado…");
    const response = await callBackend(settings, feature, {
      ...payload,
      ...extra,
      ...(isAiFeature(feature)
        ? {
            model: settings.aiModel,
            stream:
              feature === "thumbnail-generation" ? false : settings.aiStreaming,
            expectedOrigin: settings.aiOrigin,
          }
        : {}),
    });
    if (feature === "thumbnail-generation" && response.status === "ok") await remoteImages.validate(response,true);
    if (requestEpoch !== remoteOutputEpoch) return response;
    if (output !== null) await displayRemote(response, output);
    if (requestEpoch !== remoteOutputEpoch) return response;
    notice(
      response.status === "ok"
        ? `Análise concluída · ${response.source}`
        : (response.error ?? "Recurso não configurado."),
      response.status === "error",
    );
    return response;
  } finally {
    if (ai) {
      aiRequestRunning = false;
      updateAiButtons();
    }
  }
}
on("remote-run", () => remote(value("remote-feature") as RemoteFeature));
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-ai]"))
  b.addEventListener("click", () => {
    void (async()=>{
      const feature=b.dataset.ai as TranscriptAiFeature;
      const request=transcriptExtras?.beginAi(feature);
      if(!request||request.cached)return;
      try {const response=await remote(feature,null,{text:transcriptContent()});transcriptExtras?.completeAi(feature,response,request.requestId);}
      catch(error){transcriptExtras?.failAi(feature,error,request.requestId);throw error;}
    })().catch(fail);
  });
function updateAiButtons() {
  const model = aiCatalog?.models.find((m) => m.id === selectedAiModel);
  const busy = aiRequestRunning || aiSelectionSaving;
  const textBlocked =
    busy ||
    (!!aiCatalog &&
      (!model?.textSupported ||
        (selectedAiStreaming &&
          !(model.streaming && model.operations.includes("responses")))));
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-ai]",
  ))
    button.disabled = textBlocked;
  $<HTMLButtonElement>("comments-ai").disabled = textBlocked;
  const feature = value("remote-feature");
  $<HTMLButtonElement>("remote-run").disabled =
    isAiFeature(feature) &&
    (busy ||
      (!!aiCatalog &&
        (feature === "thumbnail-generation"
          ? !model?.imageSupported
          : textBlocked)));
  $("ai-selected-label").textContent = selectedAiModel
    ? `${selectedAiModel} · ${selectedAiStreaming ? "streaming solicitado" : "JSON"} · backend revalida antes de enviar`
    : "Nenhum modelo selecionado. Consulte o OmniProviders na aba Conexão.";
  thumbnailLab?.refreshSelection();
}
async function persistAiSelection() {
  aiSelectionSaving = true;
  updateAiButtons();
  $<HTMLSelectElement>("ai-provider-select").disabled = true;
  $<HTMLSelectElement>("ai-model-select").disabled = true;
  $<HTMLInputElement>("ai-stream").disabled = true;
  try {
    const old = await getSettings();
    await saveSettings({
      ...old,
      aiModel: selectedAiModel,
      aiOrigin: selectedAiOrigin,
      aiStreaming: selectedAiStreaming,
    });
  } catch (error) {
    const old = await getSettings();
    selectedAiModel = old.aiModel;
    selectedAiOrigin = old.aiOrigin;
    selectedAiStreaming = old.aiStreaming;
    throw error;
  } finally {
    aiSelectionSaving = false;
    $<HTMLSelectElement>("ai-provider-select").disabled = false;
    renderAiSelection();
  }
}
function renderAiSelection(providerFilter?: string) {
  const provider = $<HTMLSelectElement>("ai-provider-select");
  const chosenProvider =
    providerFilter ?? (provider.value || selectedAiModel.split(":")[0] || "");
  provider.replaceChildren();
  const placeholder = element("option", "Selecione um provedor");
  placeholder.value = "";
  provider.append(placeholder);
  const providers = aiCatalog
    ? [...new Set(aiCatalog.models.map((m) => m.provider))].sort()
    : selectedAiModel
      ? [selectedAiModel.split(":")[0]]
      : [];
  for (const id of providers) {
    const option = element("option", id);
    option.value = id;
    provider.append(option);
  }
  provider.value = chosenProvider;
  const models = $<HTMLSelectElement>("ai-model-select");
  models.replaceChildren();
  const empty = element("option", "Nenhum modelo selecionado");
  empty.value = "";
  models.append(empty);
  for (const model of (aiCatalog?.models ?? []).filter(
    (m) => m.provider === chosenProvider,
  )) {
    const option = element(
      "option",
      `${model.label} · ${model.id}${model.textSupported ? " · texto" : ""}${model.imageSupported ? " · imagem" : ""}${!model.textSupported && !model.imageSupported ? " · capacidade não utilizada pelo Prevlev" : ""}`,
    );
    option.value = model.id;
    option.disabled = !model.textSupported && !model.imageSupported;
    models.append(option);
  }
  if (
    selectedAiModel &&
    !Array.from(models.options).some((o) => o.value === selectedAiModel)
  ) {
    const saved = element(
      "option",
      `${selectedAiModel} · ${aiCatalog ? "indisponível no catálogo atual" : "salvo; catálogo ainda não consultado"}`,
    );
    saved.value = selectedAiModel;
    saved.disabled = true;
    models.append(saved);
  }
  models.value = selectedAiModel;
  models.disabled = !aiCatalog || !chosenProvider;
  const selected = aiCatalog?.models.find((m) => m.id === selectedAiModel);
  const supportsStream =
    selected?.textSupported &&
    selected.streaming &&
    selected.operations.includes("responses");
  const streaming = $<HTMLInputElement>("ai-stream");
  streaming.checked = selectedAiStreaming;
  streaming.disabled =
    !selected?.textSupported || (!supportsStream && !selectedAiStreaming);
  $<HTMLInputElement>("ai-origin").value =
    aiCatalog?.origin ?? selectedAiOrigin;
  $("ai-capabilities").textContent = selected
    ? `Saída: ${selected.outputModalities.join(", ") || "não anunciada"}. Operações: ${selected.operations.join(", ") || "nenhuma"}.${selectedAiStreaming && !supportsStream ? " O streaming salvo não está disponível; desmarque a opção ou escolha outro modelo." : ""}`
    : aiCatalog
      ? selectedAiModel
        ? "O modelo salvo não está disponível. Escolha um modelo do catálogo; nenhuma alternativa foi selecionada."
        : "Escolha provedor e modelo. Apenas capacidades anunciadas são habilitadas."
      : "Capacidades ainda não consultadas. A origem exibida é configuração, não uma confirmação de conexão.";
  updateAiButtons();
}
on("ai-discover", async () => {
  $<HTMLButtonElement>("ai-discover").disabled = true;
  $("ai-catalog-status").textContent =
    "Consultando o catálogo pela ponte Prevlev…";
  try {
    const response = await fetchAiCatalog(await getSettings());
    if (response.status !== "ok" || !response.data) {
      $("ai-catalog-status").textContent =
        response.error ?? "Catálogo não disponível.";
      throw new Error(response.error ?? "Catálogo não disponível.");
    }
    aiCatalog = response.data;
    if (selectedAiModel && selectedAiOrigin !== aiCatalog.origin) {
      selectedAiModel = "";
      selectedAiStreaming = false;
      const old = await getSettings();
      await saveSettings({ ...old, aiModel: "", aiStreaming: false });
      $("ai-catalog-status").textContent =
        "A origem do OmniProviders mudou. Selecione novamente o provedor e modelo antes de enviar dados.";
    } else
      $("ai-catalog-status").textContent =
        `${aiCatalog.models.length} modelos anunciados. ${aiCatalog.warnings.join(" ")} Catálogo não comprova saldo nem aceitação de geração.`;
    renderAiSelection();
    notice("Catálogo consultado. Nenhuma geração foi iniciada.");
  } catch (error) {
    $("ai-catalog-status").textContent =
      error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    $<HTMLButtonElement>("ai-discover").disabled = false;
  }
});
$("ai-provider-select").addEventListener("change", () => {
  void (async () => {
    if (aiSelectionSaving) return;
    const provider = value("ai-provider-select");
    selectedAiModel = "";
    selectedAiStreaming = false;
    await persistAiSelection();
    renderAiSelection(provider);
  })().catch(fail);
});
$("ai-model-select").addEventListener("change", () => {
  void (async () => {
    if (aiSelectionSaving) return;
    const model = aiCatalog?.models.find(
      (m) => m.id === value("ai-model-select"),
    );
    if (!model || (!model.textSupported && !model.imageSupported))
      throw new Error(
        "Escolha um modelo com capacidade anunciada para texto ou imagem.",
      );
    selectedAiModel = model.id;
    selectedAiOrigin = aiCatalog!.origin;
    selectedAiStreaming = false;
    await persistAiSelection();
    renderAiSelection(model.provider);
    $("ai-catalog-status").textContent =
      `Seleção salva: ${model.id}. O catálogo será revalidado no próximo envio.`;
  })().catch(fail);
});
$("ai-stream").addEventListener("change", () => {
  void (async () => {
    if (aiSelectionSaving) return;
    const selected = aiCatalog?.models.find((m) => m.id === selectedAiModel);
    const checked = $<HTMLInputElement>("ai-stream").checked;
    if (
      checked &&
      (!selected?.streaming ||
        !selected.textSupported ||
        !selected.operations.includes("responses"))
    ) {
      $<HTMLInputElement>("ai-stream").checked = selectedAiStreaming;
      throw new Error("Este modelo não anuncia streaming Responses de texto.");
    }
    selectedAiStreaming = checked;
    await persistAiSelection();
  })().catch(fail);
});
$("remote-feature").addEventListener("change", updateAiButtons);
on("save-settings", async () => {
  const url = value("backend-url").trim(),
    origin = url ? backendOrigin(url) : "";
  if (origin) {
    const granted = await chrome.permissions.request({
      origins: [`${origin}/*`],
    });
    if (!granted)
      throw new Error("Acesso ao backend não concedido pelo navegador.");
  }
  const old = await getSettings();
  await saveSettings({
    ...old,
    backendUrl: origin,
    backendToken: value("backend-token").trim(),
    ...(old.backendUrl !== origin ? { aiModel: "", aiStreaming: false } : {}),
  });
  savedBackendOrigin = origin;
  transcriptExtras.invalidate();
  invalidateRemoteOutput();
  if (old.backendUrl !== origin) {
    aiCatalog = undefined;
    selectedAiModel = "";
    selectedAiStreaming = false;
    renderAiSelection();
  }
  notice("Configuração salva. O envio continua sendo manual.");
});
on("clear-connection", async () => {
  const old = await getSettings();
  if (old.backendUrl)
    await chrome.permissions.remove({
      origins: [`${backendOrigin(old.backendUrl)}/*`],
    });
  await saveSettings({
    ...old,
    backendUrl: "",
    backendToken: "",
    aiModel: "",
    aiStreaming: false,
  });
  savedBackendOrigin = "";
  transcriptExtras.invalidate();
  invalidateRemoteOutput();
  aiCatalog = undefined;
  selectedAiModel = "";
  selectedAiStreaming = false;
  renderAiSelection();
  $<HTMLInputElement>("backend-url").value = "";
  $<HTMLInputElement>("backend-token").value = "";
  notice("Backend desconectado.");
});
on("clear-data", async () => {
  if (
    !window.confirm(
      "Apagar a coleta e toda a biblioteca deste perfil? Exporte antes de continuar.",
    )
  )
    return;
  await chrome.storage.local.remove(["snapshot"]);
  await saveSwipe([]);
  snapshot = {
    url: "",
    title: "",
    videos: [],
    comments: [],
    transcript: [],
    warnings: [],
  };
  nicheTools.invalidate(); cardComposer.invalidateSnapshot(); channelReport.clearInputs();
  segments = [];
  render();
  await renderSwipe();
  notice("Dados locais apagados.");
});
const getRedactionCategories = initCaptureOptions();
const compositionHost=element("div");compositionHost.id="studio-composition-host";$("studio").append(compositionHost);
const studioComposer=mountStudioComposition(compositionHost,{contextKey:studioCaptureContext,validateContext:validateStudioCaptureContext,notice});
for(const event of ["input","change"])$("studio").addEventListener(event,evt=>{
  const target=evt.target;if(!(target instanceof Element))return;
  if(target.id==="redact"||target.closest("#capture-redaction-categories"))invalidateStudioComposition();
  if(target.id==="studio-compose-file"||target.id==="studio-compose-enabled")studioCaptureRequest++;
});
$("studio-compose-cancel").addEventListener("click",()=>studioCaptureRequest++);
const midrollTools = mountMidrollTools(document, invalidateStudioPreview);
const profitTools = initProfitTools({snapshot:()=>snapshot});
const removalTools = mountMidrollRemoval(document, {observe:async()=>{
  const tabId = targetTab();
  const response = await chrome.tabs.sendMessage(tabId,{type:"STUDIO_OBSERVE_MIDROLLS"}) as {status:string;error?:string;observation?:MidrollRemovalObservation};
  if (tabId !== targetTab()) return undefined;
  if (response.status === "error") throw new Error(response.error ?? "Não foi possível observar os slots.");
  return response.observation ? {...response.observation,contextKey:JSON.stringify([tabId,response.observation.contextKey])} : undefined;
}});
$("tab-select").addEventListener("change",()=>removalTools.invalidate());
$("tab-select").addEventListener("input",()=>removalTools.invalidate());
mountWaveformTools(document, invalidateStudioPreview);
mountMcpGuide($("mcp"));
const thumbnailLab = mountThumbnailLab($("thumbnail-lab"), {
  selection: () => ({
    model: aiCatalog?.models.find(model => model.id === selectedAiModel),
    origin: selectedAiOrigin,
    backendOrigin: savedBackendOrigin,
  }),
  generate: payload => remote("thumbnail-generation", null, {prompt:payload.prompt}, {model:payload.model,origin:payload.expectedOrigin,backendOrigin:savedBackendOrigin}),
  showResult: response => { void displayRemote(response,"remote-result").catch(fail); showPage("remote"); },
});
const studioOverview = initStudioOverview({snapshot:()=>snapshot});
$("tab-select").addEventListener("change",()=>studioOverview.invalidateContext());
$("tab-select").addEventListener("input",()=>studioOverview.invalidateContext());
mountDailyObservations($("daily-observations"));
const channelReport = mountChannelReport($("channel-report"),()=>snapshot.videos);
const nicheTools = initNicheTools({snapshot:()=>snapshot});
const cardComposer = initCardCompositionTools({snapshot:()=>snapshot});
initVisualSimilarityTools();
const imageContextIdentity=(source:"collection"|"selected-tab")=>source==="collection"?`collection:${imageContextRevision}`:value("tab-select")?`tab:${value("tab-select")}:${imageTabRevision}`:undefined;
const imageTools = initImageTools({notice,contextVideos:()=>snapshot.videos,contextIdentity:imageContextIdentity,captureContext:async({source,expectedIdentity,signal})=>{
  signal.throwIfAborted();
  if(imageContextIdentity(source)!==expectedIdentity)throw new Error("A fonte da amostra mudou. Escolha novamente.");
  if(source==="collection")return {source,identity:expectedIdentity,url:snapshot.url,title:snapshot.title,videos:structuredClone(snapshot.videos)};
  const tabId=targetTab(),before=await chrome.tabs.get(tabId);signal.throwIfAborted();
  if(!/^https:\/\/(?:www\.|m\.)?youtube\.com\//.test(before.url??""))throw new Error("Selecione uma aba pública do YouTube para esta amostra.");
  const response=await chrome.tabs.sendMessage(tabId,{type:"GET_IMAGE_CONTEXT"}) as {status:string;error?:string;snapshot?:PageSnapshot};signal.throwIfAborted();
  const after=await chrome.tabs.get(tabId);signal.throwIfAborted();
  if(imageContextIdentity(source)!==expectedIdentity||tabId!==targetTab()||before.url!==after.url||response.snapshot?.url!==after.url)throw new Error("A aba ou URL mudou durante a captura. A amostra foi descartada.");
  if(response.status!=="ok"||!response.snapshot)throw new Error(response.error??"A aba não devolveu uma amostra observada.");
  return {source,identity:expectedIdentity,url:response.snapshot.url,title:response.snapshot.title,observedAt:new Date().toISOString(),videos:response.snapshot.videos};
}});
for(const event of ["input","change"])$("tab-select").addEventListener(event,()=>{imageTabRevision++;imageTools.invalidateContext();invalidateStudioComposition();});
chrome.tabs.onUpdated?.addListener((tabId,change)=>{
  if(tabId!==Number(value("tab-select"))||(!change.url&&change.status!=="loading"))return;
  imageTabRevision++;imageTools.invalidateContext();studioOverview.invalidateContext();studioCaptureObserved=undefined;invalidateStudioComposition("A aba selecionada navegou. Declare novamente o contexto e faça outra captura.");
});
chrome.tabs.onRemoved?.addListener(tabId=>{if(tabId===Number(value("tab-select"))){imageTabRevision++;imageTools.invalidateContext();studioOverview.invalidateContext();studioCaptureObserved=undefined;invalidateStudioComposition("A aba foi fechada. Selecione outra origem.");}});
const remoteImages = mountRemoteImages($("remote-images"));
initCollectionTools({targetTab,snapshot:()=>snapshot,notice,adopt:async(next)=>{snapshot=next;nicheTools.invalidate(); cardComposer.invalidateSnapshot(); channelReport.invalidate();segments=next.transcript;await chrome.storage.local.set({snapshot});render();}});
initSponsorshipTools();
const researchTools = initResearchTools({ getUrl: () => snapshot.url, getVisibleVideos: visibleVideos, getAllVideos: () => snapshot.videos, onChange: () => { try { renderVideos(); if ($("notice").classList.contains("error")) notice("Filtros de pesquisa atualizados."); } catch (error) { fail(error); } } });
initSwipeSync(renderSwipe);
initOfficialSearch();
initAnalyticsTools({ snapshot: () => snapshot, filter: readVideoFilter });
initHistoryTools({ snapshot: () => snapshot, filter: readVideoFilter });
void (async () => {
  await tabs();
  const saved = await getSnapshot();
  if (saved) {
    snapshot = saved;
    nicheTools.invalidate(); cardComposer.invalidateSnapshot(); channelReport.invalidate();
    segments = saved.transcript;
  }
  const settings = await getSettings();
  savedBackendOrigin = settings.backendUrl;
  $<HTMLInputElement>("backend-url").value = settings.backendUrl;
  $<HTMLInputElement>("backend-token").value = settings.backendToken;
  selectedAiModel = settings.aiModel;
  selectedAiOrigin = settings.aiOrigin;
  selectedAiStreaming = settings.aiStreaming;
  renderAiSelection();
  render();
  await renderSwipe();
})().catch(fail);
