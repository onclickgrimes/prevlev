import {
  getSettings,
  saveSettings,
  getSnapshot,
  getSwipe,
  saveSwipe,
  type SwipeItem,
} from "../shared/storage";
import type {
  PageSnapshot,
  VideoRecord,
  TranscriptSegment,
  RemoteFeature,
  RemoteResponse,
} from "../shared/types";
import { backendOrigin } from "../shared/backend";
import {
  summarizeVideos,
  lifetimeVph,
  outlierScore,
  filterVideos,
  sortVideos,
  filterComments,
  netProfit,
} from "../core/metrics";
import { videoIdFromUrl } from "../core/parse";
import { toCsv } from "../core/export";
import {
  parseTranscript,
  transcriptText,
  transcriptVtt,
  transcriptMarkdown,
} from "../core/transcript";
import {
  compressImage,
  renderThumbnailPreview,
  fetchThumbnail,
  downloadBlob,
  cropScreenshot,
  loadImage,
  copyImage,
  type Rect,
} from "../core/media";
import { planMidrolls, detectSilences, type Silence } from "../core/midroll";

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
let planId: string | undefined;
let planTab: number | undefined;
let runningPlan: { id: string; tabId: number } | undefined;
let image: File | undefined;
let previewUrl: string | undefined;
let silences: Silence[] = [];
let silenceDuration: number | undefined;
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
  snapshot = result.snapshot;
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
    const result = await chrome.runtime.sendMessage({
      type: "ENRICH_CHANNELS",
      videos: snapshot.videos,
    });
    if (result.status !== "ok") throw new Error(result.error);
    snapshot.videos = result.videos as VideoRecord[];
    await chrome.storage.local.set({ snapshot });
    renderVideos();
    notice(
      `Consulta de inscritos concluída. ${(result.warnings as string[]).join(" ")}`,
    );
  } finally {
    $<HTMLButtonElement>("enrich").disabled = false;
  }
});
function visibleVideos() {
  const mode = value("short-filter");
  return sortVideos(
    filterVideos(snapshot.videos, {
      query: value("video-filter"),
      minViews: value("min-views") ? num("min-views") : undefined,
      shorts: mode === "shorts" ? "only" : mode === "long" ? "exclude" : "all",
    }),
    value("sort") === "date"
      ? "recent"
      : (value("sort") as "views" | "vph" | "title"),
  );
}
function renderVideos() {
  const videos = visibleVideos(),
    body = $("video-rows");
  body.replaceChildren();
  $("video-count").textContent = `(${videos.length})`;
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
      outlierScore(video, snapshot.videos)?.toFixed(1).concat("×") ?? "—",
      compact(video.subscribers),
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
    cell.colSpan = 6;
    row.append(cell);
    body.append(row);
  }
}
function currentComments() {
  return filterComments(snapshot.comments, {
    query: value("comment-filter"),
    minLikes: value("comment-likes") ? num("comment-likes") : undefined,
    questionsOnly: $<HTMLInputElement>("comment-questions").checked,
  });
}
function renderComments() {
  const list = $("comment-list");
  list.replaceChildren();
  for (const comment of currentComments()) {
    const card = element("article");
    card.className = "comment";
    card.append(
      element("strong", comment.author),
      element("p", comment.text),
      element(
        "small",
        `${comment.likes} curtidas · ${comment.replies} respostas`,
      ),
    );
    list.append(card);
  }
  if (!list.childNodes.length)
    list.append(
      element("p", "Nenhum comentário carregado corresponde ao filtro."),
    );
}
function render() {
  const summary = summarizeVideos(snapshot.videos);
  $("metrics").replaceChildren();
  for (const [name, val, note] of [
    ["VÍDEOS NA AMOSTRA", compact(summary.count), "Somente os carregados"],
    [
      "VIEWS CONHECIDAS",
      compact(summary.totalViews),
      `${summary.knownViews} vídeos com dados`,
    ],
    [
      "MEDIANA DE VIEWS",
      compact(summary.medianViews),
      "Referência desta amostra",
    ],
    [
      "SHORTS IDENTIFICADOS",
      compact(summary.shorts),
      "Formato obtido dos cards",
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
  renderVideos();
  renderComments();
  $("current-video").textContent =
    `${snapshot.title || "Nenhum vídeo selecionado"}${snapshot.videoId ? " · " + snapshot.videoId : ""}`;
  $<HTMLTextAreaElement>("transcript-text").value = transcriptText(segments);
  if (snapshot.studio?.revenue !== undefined)
    $<HTMLInputElement>("revenue").value = String(snapshot.studio.revenue);
  if (snapshot.studio?.videoCount !== undefined)
    $<HTMLInputElement>("video-total").value = String(
      snapshot.studio.videoCount,
    );
  $<HTMLInputElement>("swipe-title").value = snapshot.title;
  $<HTMLInputElement>("swipe-url").value = snapshot.url;
}
for (const id of ["video-filter", "min-views", "short-filter", "sort"])
  $(id).addEventListener("input", renderVideos);
for (const id of ["comment-filter", "comment-likes", "comment-questions"])
  $(id).addEventListener("input", renderComments);
on("export-json", () =>
  textFile(
    JSON.stringify(visibleVideos(), null, 2),
    "prevlev-videos.json",
    "application/json",
  ),
);
on("export-csv", () =>
  textFile(
    toCsv(
      visibleVideos().map((v) => ({
        ...v,
        vph: lifetimeVph(v),
        outlier: outlierScore(v, snapshot.videos),
      })),
    ),
    "prevlev-videos.csv",
    "text/csv",
  ),
);
on("copy-title", async () => {
  await navigator.clipboard.writeText(
    `${snapshot.title}\n${snapshot.videoId ?? snapshot.url}`,
  );
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
  const details = (await chrome.tabs.sendMessage(tabId, {
    type: "CAPTURE_CARD",
    kind,
    redact: $<HTMLInputElement>("redact").checked,
  })) as {
    status: string;
    error?: string;
    rect: Rect;
    redactions: Rect[];
    viewportWidth: number;
  };
  if (details.status !== "ok")
    throw new Error(details.error ?? "Área de captura indisponível.");
  const capture = await chrome.runtime.sendMessage({
    type: "CAPTURE_SCREENSHOT",
    tabId,
  });
  if (capture.status !== "ok") throw new Error(capture.error);
  const image = await loadImage(capture.dataUrl);
  downloadBlob(
    await cropScreenshot(
      capture.dataUrl,
      details.rect,
      image.naturalWidth / details.viewportWidth,
      details.redactions,
    ),
    `prevlev-${kind}.png`,
  );
  notice(
    "Captura da área visível salva. Confira a ocultação antes de compartilhar.",
  );
}
on("card-shot", () => screenshot("video"));
on("analytics-shot", () => screenshot("analytics"));
on("latest-shot", () => screenshot("latest-performance"));
$("image-file").addEventListener("change", () => {
  image = $<HTMLInputElement>("image-file").files?.[0];
  $("image-info").textContent = image
    ? `${image.name} · ${(image.size / 1024).toFixed(0)} KB`
    : "";
});
on("compress", async () => {
  if (!image) throw new Error("Escolha uma imagem.");
  const blob = await compressImage(image, {
    maxWidth: num("image-width"),
    maxHeight: 8192,
    quality: num("image-quality") / 100,
  });
  downloadBlob(blob, "prevlev-thumbnail.jpg");
  $("image-info").textContent =
    `Original: ${(image.size / 1024).toFixed(0)} KB · Saída: ${(blob.size / 1024).toFixed(0)} KB`;
});
on("image-preview", async () => {
  if (!image) throw new Error("Escolha uma imagem.");
  const blob = await renderThumbnailPreview(
    image,
    value("preview-title"),
    value("preview-channel"),
  );
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  $<HTMLImageElement>("image-output").src = previewUrl;
  $("image-output").hidden = false;
  $("image-preview-empty").hidden = true;
});
on("download-thumbnail", async () => {
  const input = value("thumbnail-id").trim(),
    id =
      videoIdFromUrl(input) ?? (/^[\w-]{11}$/.test(input) ? input : undefined);
  if (!id) throw new Error("Informe um ID ou URL YouTube válido.");
  downloadBlob(await fetchThumbnail(id), `prevlev-${id}.jpg`);
});
on("copy-thumbnail", async () => {
  const input = value("thumbnail-id").trim(),
    id =
      videoIdFromUrl(input) ?? (/^[\w-]{11}$/.test(input) ? input : undefined);
  if (!id) throw new Error("Informe um ID ou URL YouTube válido.");
  await copyImage(await fetchThumbnail(id));
  notice("Thumbnail copiada como imagem.");
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
on("comments-copy", async () => {
  await navigator.clipboard.writeText(
    currentComments()
      .map((c) => `${c.author}: ${c.text}`)
      .join("\n\n"),
  );
  notice("Comentários copiados.");
});
on("comments-export", () =>
  textFile(
    toCsv(currentComments().map((c) => ({ ...c }))),
    "prevlev-comentarios.csv",
    "text/csv",
  ),
);
on("profit", () => {
  const r = netProfit(num("revenue"), num("cost"), num("video-total"));
  $("profit-output").textContent =
    `${r.profit.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${snapshot.studio?.currency ?? "(mesma moeda da receita)"}`;
});
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
on("audio-analyze", async () => {
  const file = $<HTMLInputElement>("midroll-audio").files?.[0];
  if (!file) throw new Error("Escolha um arquivo de áudio local.");
  if (file.size > 50 * 1024 * 1024) throw new Error("Use áudio de até 50 MB.");
  const audio = new AudioContext();
  try {
    const buffer = await audio.decodeAudioData(await file.arrayBuffer());
    if (buffer.duration > 7200) throw new Error("Use áudio de até 2 horas.");
    const mono = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let i = 0; i < mono.length; i++)
        mono[i] = Math.max(mono[i], Math.abs(samples[i]));
    }
    silences = detectSilences(mono, buffer.sampleRate);
    silenceDuration = buffer.duration;
    $<HTMLInputElement>("duration").value = String(Math.floor(buffer.duration));
    $("audio-info").textContent =
      `${silences.length} intervalos de silêncio detectados em ${buffer.duration.toFixed(1)} segundos. O arquivo não foi enviado.`;
  } finally {
    await audio.close();
  }
});
on("studio-preview", async () => {
  const tabId = targetTab();
  const action = value("studio-action");
  const positions =
    action === "midrolls"
      ? planMidrolls({
          durationSeconds: num("duration"),
          intervalSeconds: num("interval"),
          silences:
            silenceDuration && Math.abs(silenceDuration - num("duration")) < 2
              ? silences
              : [],
        })
      : undefined;
  const plan = (await chrome.tabs.sendMessage(tabId, {
    type: "STUDIO_PREVIEW",
    action,
    input: { limit: num("action-limit"), positions },
  })) as { id: string; status: string; error?: string };
  if (plan.status === "error") throw new Error(plan.error);
  planId = plan.status === "ready" ? plan.id : undefined;
  planTab = tabId;
  $("studio-plan").textContent = JSON.stringify(plan, null, 2);
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
  if (active)
    await chrome.tabs.sendMessage(active.tabId, {
      type: "STUDIO_CANCEL",
      planId: active.id,
    });
  planId = undefined;
  $<HTMLButtonElement>("studio-confirm").disabled = true;
  notice("Cancelamento solicitado. Ações já enviadas não são desfeitas.");
});
for (const id of [
  "studio-action",
  "action-limit",
  "duration",
  "interval",
  "tab-select",
])
  $(id).addEventListener("change", () => {
    planId = undefined;
    $<HTMLButtonElement>("studio-confirm").disabled = true;
  });
async function saveVideo(video: VideoRecord) {
  const items = await getSwipe();
  items.push({
    id: crypto.randomUUID(),
    folder: value("swipe-folder") || "Références",
    title: video.title,
    url: video.url,
    createdAt: new Date().toISOString(),
  });
  await saveSwipe(items);
  await renderSwipe();
  notice("Referência salva na biblioteca local.");
}
async function renderSwipe() {
  const items = await getSwipe();
  const list = $("swipe-list");
  list.replaceChildren();
  for (const item of items) {
    const row = element("article");
    row.className = "swipe-item";
    const title = element("div"),
      a = element("a", item.title);
    a.href = safeLink(item.url);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    title.append(
      a,
      element(
        "small",
        `${item.folder} · ${new Date(item.createdAt).toLocaleDateString("pt-BR")}`,
      ),
    );
    const remove = element("button", "Excluir");
    remove.addEventListener("click", () => {
      void (async () => {
        await saveSwipe((await getSwipe()).filter((x) => x.id !== item.id));
        await renderSwipe();
      })().catch(fail);
    });
    row.append(title, remove);
    list.append(row);
  }
  if (!items.length)
    list.append(
      element("p", "Sua biblioteca está vazia. Salve um vídeo na pesquisa."),
    );
}
on("swipe-add", async () => {
  const url = safeLink(value("swipe-url"));
  if (url === "#" || !value("swipe-title").trim())
    throw new Error("Informe título e URL válidos.");
  const items = await getSwipe();
  items.push({
    id: crypto.randomUUID(),
    folder: value("swipe-folder").trim() || "Referências",
    title: value("swipe-title").trim(),
    url,
    createdAt: new Date().toISOString(),
  });
  await saveSwipe(items);
  await renderSwipe();
  notice("Referência salva.");
});
on("swipe-export", async () =>
  textFile(
    JSON.stringify(await getSwipe(), null, 2),
    "prevlev-swipe.json",
    "application/json",
  ),
);
$("swipe-import").addEventListener("change", () => {
  void (async () => {
    const file = $<HTMLInputElement>("swipe-import").files?.[0];
    if (!file) return;
    if (file.size > 5_000_000)
      throw new Error("Arquivo grande demais (máximo 5 MB).");
    const raw: unknown = JSON.parse(await file.text());
    if (!Array.isArray(raw) || raw.length > 5000)
      throw new Error("Formato de biblioteca inválido.");
    const items: SwipeItem[] = raw.map((item: unknown) => {
      if (!item || typeof item !== "object")
        throw new Error("Referência inválida.");
      const v = item as Record<string, unknown>;
      if (
        typeof v.title !== "string" ||
        typeof v.url !== "string" ||
        safeLink(v.url) === "#"
      )
        throw new Error("Título/URL inválidos na biblioteca.");
      return {
        id: crypto.randomUUID(),
        folder: String(v.folder ?? "Importados").slice(0, 120),
        title: v.title.slice(0, 1000),
        url: v.url,
        createdAt: new Date().toISOString(),
      };
    });
    await saveSwipe([...(await getSwipe()), ...items]);
    await renderSwipe();
    notice(`${items.length} referências importadas.`);
  })().catch(fail);
});
function displayRemote(response: RemoteResponse, output: string) {
  $("remote-images").replaceChildren();
  const data =
    response.data && typeof response.data === "object"
      ? (response.data as Record<string, unknown>)
      : undefined;
  const images = Array.isArray(data?.images) ? data.images : [];
  for (const raw of images.slice(0, 1)) {
    if (!raw || typeof raw !== "object") continue;
    const result = raw as Record<string, unknown>;
    const base64 =
      typeof result.base64 === "string" &&
      result.base64.length < 24_000_000 &&
      /^[A-Za-z0-9+/=]+$/.test(result.base64)
        ? result.base64
        : undefined;
    const url = base64
      ? `data:image/png;base64,${base64}`
      : typeof result.url === "string" && result.url.startsWith("https://")
        ? safeLink(result.url)
        : undefined;
    if (!url || url === "#") continue;
    const image = element("img");
    image.alt = "Thumbnail gerada pelo provedor configurado";
    image.src = url;
    image.style.cssText = "max-width:100%;max-height:500px;border-radius:8px";
    const link = element("a", "Abrir / salvar imagem gerada");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    if (base64) link.download = "prevlev-gerada.png";
    $("remote-images").append(image, element("p"), link);
  }
  $(output).textContent = JSON.stringify(
    images.length
      ? {
          ...response,
          data: {
            ...data,
            images: images.map(() => ({ image: "Veja a imagem acima." })),
          },
        }
      : response,
    null,
    2,
  );
}
async function remote(
  feature: RemoteFeature,
  output = "remote-result",
  extra: Record<string, unknown> = {},
) {
  notice("Enviando ao backend configurado…");
  const query = value("remote-query");
  const current = snapshot.videos.find((v) => v.id === snapshot.videoId);
  let payload: Record<string, unknown>;
  if (feature === "comment-analysis") payload = { comments: currentComments() };
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
  const response = (await chrome.runtime.sendMessage({
    type: "REMOTE_ANALYZE",
    feature,
    payload: { ...payload, ...extra },
  })) as RemoteResponse;
  displayRemote(response, output);
  notice(
    response.status === "ok"
      ? `Análise concluída · ${response.source}`
      : (response.error ?? "Recurso não configurado."),
    response.status === "error",
  );
}
on("remote-run", () => remote(value("remote-feature") as RemoteFeature));
on("comments-ai", async () => {
  showPage("remote");
  await remote("comment-analysis");
});
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-ai]"))
  b.addEventListener("click", () => {
    void remote(b.dataset.ai as RemoteFeature, "transcript-result", {
      text: transcriptContent(),
    }).catch(fail);
  });
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
  });
  notice("Configuração salva. O envio continua sendo manual.");
});
on("clear-connection", async () => {
  const old = await getSettings();
  if (old.backendUrl)
    await chrome.permissions.remove({
      origins: [`${backendOrigin(old.backendUrl)}/*`],
    });
  await saveSettings({ ...old, backendUrl: "", backendToken: "" });
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
  await chrome.storage.local.remove(["snapshot", "swipe"]);
  snapshot = {
    url: "",
    title: "",
    videos: [],
    comments: [],
    transcript: [],
    warnings: [],
  };
  segments = [];
  render();
  await renderSwipe();
  notice("Dados locais apagados.");
});
void (async () => {
  await tabs();
  const saved = await getSnapshot();
  if (saved) {
    snapshot = saved;
    segments = saved.transcript;
  }
  const settings = await getSettings();
  $<HTMLInputElement>("backend-url").value = settings.backendUrl;
  $<HTMLInputElement>("backend-token").value = settings.backendToken;
  render();
  await renderSwipe();
})().catch(fail);
