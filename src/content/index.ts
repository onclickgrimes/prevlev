import { getSettings, saveSettings } from "../shared/storage";
import type { Settings, VideoRecord } from "../shared/types";
import {
  lifetimeVph,
  inferMonetization,
} from "../core/metrics";
import {sortResearchVideos,researchSurface,researchComparison,describeResearchComparison} from '../core/research';
import { captureFrame } from "../core/media";
import {
  readYouTubeSnapshot,
  readVideoCards,
  filterAndSortCards,
  normalizeCardFilter,
  type CardFilter,
} from "./youtube";
import {
  readStudioMetrics,
  previewStudioAction,
  executeStudioPlan,
  cancelStudioPlan,
  setStudioPeriodVerified,
  getStudioRedactionDetails,
  getStudioScreenshotTargets,
  observeStudioMidrollSlots,
} from "./studio";
import { mountTimeline, refreshTimeline, dispatchTimeline } from "./timeline";
import {createCollectionController,mountCollectionControls,type CollectionKind} from './collection';
import {videoIdFromUrl} from '../core/parse';
import {mountContextualTools,type ContextualController} from './contextual';
import {mountResearchOverlay} from './research-overlay';
import { validateCaptureCategories } from '../ui/capture-options';
import {createProfitCardAdapter} from './profit-card';
import {createProfitCardBridge} from './profit-card-bridge';

const contentScope=globalThis as typeof globalThis&{__prevlevContentInitialized?:boolean};
if(!contentScope.__prevlevContentInitialized){
contentScope.__prevlevContentInitialized=true;
const HOST_ID = "prevlev-controls";
const HIDDEN = "data-prevlev-hidden";
const collector=createCollectionController(document);
const profitCard=createProfitCardAdapter({doc:document,readMetrics:()=>readStudioMetrics(document)});
const profitCardBridge=createProfitCardBridge(profitCard,{doc:document});
let collectionControlsCleanup:(()=>void)|undefined;
let contextual:ContextualController|undefined;
let researchOverlay:ReturnType<typeof mountResearchOverlay>|undefined;
let settings: Settings & {hideShortsOnFeed?:boolean;hideShortsOnSearch?:boolean};
let observer: MutationObserver | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let suspended = false;
let navigationListening = false;
let updatePanel: () => void = () => {};
let filter: CardFilter = {
  query: "",
  shorts: "all",
  sort: "default",
};
let filterError = "";
let syncFilterForm: () => void = () => {};
function shortsPreferences():Pick<CardFilter,'hideShortsOnFeed'|'hideShortsOnSearch'>{
  return {hideShortsOnFeed:typeof settings.hideShortsOnFeed==='boolean'?settings.hideShortsOnFeed:settings.hideShorts,hideShortsOnSearch:typeof settings.hideShortsOnSearch==='boolean'?settings.hideShortsOnSearch:settings.hideShorts};
}
function setFilter(candidate:CardFilter):void{
  const before=shortsPreferences();
  filter={...before,...candidate};
  if(filter.hideShortsOnFeed!==before.hideShortsOnFeed||filter.hideShortsOnSearch!==before.hideShortsOnSearch){
    settings={...settings,hideShortsOnFeed:filter.hideShortsOnFeed,hideShortsOnSearch:filter.hideShortsOnSearch};
    void saveSettings(settings).catch(error=>{filterError=error instanceof Error?error.message:String(error);updatePanel();});
  }
}
const channelEnrichment = new Map<
  string,
  { subscribers: number; channel?: string }
>();
let pageRevision = 0;
let identitySequence = 0;
const elementIdentities = new WeakMap<Element, number>();
function elementIdentity(element: Element): number {
  let identity = elementIdentities.get(element);
  if (identity === undefined) {
    identity = ++identitySequence;
    elementIdentities.set(element, identity);
  }
  return identity;
}
function channelKeys(
  video: Pick<VideoRecord, "channelId" | "channelUrl">,
): string[] {
  const keys: string[] = [];
  if (video.channelId && /^UC[\w-]{1,100}$/.test(video.channelId))
    keys.push(`id:${video.channelId}`);
  if (video.channelUrl)
    try {
      const url = new URL(video.channelUrl);
      if (
        url.origin === "https://www.youtube.com" &&
        !url.search &&
        !url.hash &&
        /^\/(?:@[^/]+|channel\/[^/]+)$/.test(url.pathname)
      )
        keys.push(url.href);
    } catch {
      /* Malformed identities are ignored. */
    }
  return keys;
}
function enrichedVideo(video: VideoRecord): VideoRecord {
  const info = channelKeys(video)
    .map((key) => channelEnrichment.get(key))
    .find(Boolean);
  return info
    ? {
        ...video,
        subscribers: video.subscribers ?? info.subscribers,
        channel: video.channel ?? info.channel,
      }
    : video;
}
function loadedCards() {
  return readVideoCards(document).map((card) => ({
    ...card,
    video: enrichedVideo(card.video),
  }));
}
const originalOrder = new WeakMap<HTMLElement, number>();
let nextOrder = 0;

function listen(): void {
  if (!suspended)
    observer?.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
}
function schedule(): void {
  if (suspended || !settings) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    apply();
  }, 300);
}
function navigation(enabled: boolean): void {
  if (navigationListening === enabled) return;
  navigationListening = enabled;
  if (enabled) {
    document.addEventListener("yt-navigate-finish", schedule);
    window.addEventListener("scroll", captureViewportChanged, true);
    window.addEventListener("resize", captureViewportChanged);
    window.visualViewport?.addEventListener("scroll", captureViewportChanged);
    window.visualViewport?.addEventListener("resize", captureViewportChanged);
  } else {
    document.removeEventListener("yt-navigate-finish", schedule);
    window.removeEventListener("scroll", captureViewportChanged, true);
    window.removeEventListener("resize", captureViewportChanged);
    window.visualViewport?.removeEventListener(
      "scroll",
      captureViewportChanged,
    );
    window.visualViewport?.removeEventListener(
      "resize",
      captureViewportChanged,
    );
  }
}
function captureViewportChanged(): void {
  if (!suspended) pageRevision++;
}
window.addEventListener("pagehide", () => {
  suspended = true;
  observer?.disconnect();
  if (timer) clearTimeout(timer);
  timer = undefined;
  navigation(false);
  collector.dispose();
  profitCard.cancel();
  contextual?.cleanup();contextual=undefined;
  researchOverlay?.dispose();researchOverlay=undefined;
});
window.addEventListener("pageshow", (event) => {
  if (!event.persisted || !suspended) return;
  suspended = false;
  if (settings) {
    navigation(true);
    apply();
  }
});
function apply(): void {
  if (!settings || suspended) return;
  if (observer?.takeRecords().length) pageRevision++;
  observer?.disconnect();
  try {
    mount();
    mountTimeline(document).refresh();
    const surface=researchSurface(location.href);
    if(filter.surface!==undefined&&filter.surface!==surface){filter=normalizeCardFilter({sort:'default',surface,hideShortsOnFeed:filter.hideShortsOnFeed,hideShortsOnSearch:filter.hideShortsOnSearch});filterError='O contexto da página mudou. Os filtros específicos foram reiniciados.';syncFilterForm();}
    const effectiveFilter={...filter,surface};
    const hideShorts=surface==='search'?(effectiveFilter.hideShortsOnSearch??settings.hideShorts):surface==='home'||surface==='subscriptions'?(effectiveFilter.hideShortsOnFeed??settings.hideShorts):settings.hideShorts;
    const cards = loadedCards();
    const base = cards.map((card) => card.video);
    for (const { element } of cards)
      if (!originalOrder.has(element)) originalOrder.set(element, nextOrder++);
    const allowed = new Set(
      filterAndSortCards(cards, effectiveFilter).map((card) => card.element),
    );
    for (const { element, video } of cards) {
      const hidden =
        !allowed.has(element) || (hideShorts && !!video.isShort);
      if (hidden) element.setAttribute(HIDDEN, "true");
      else element.removeAttribute(HIDDEN);
      let badge = element.querySelector<HTMLElement>("[data-prevlev-metric]");
      if (!settings.showMetrics) {
        badge?.remove();
        continue;
      }
      if (!badge) {
        badge = document.createElement("span");
        badge.dataset.prevlevMetric = "";
        badge.style.cssText =
          "display:block;color:#8e83ff;font:12px/1.5 system-ui;padding:3px 0";
        element.append(badge);
      }
      const vph = lifetimeVph(video),comparison=researchComparison(video,base,effectiveFilter.comparisonMode),outlier=comparison.score;
      const label = `Prevlev · ${video.subscribers === undefined ? "inscritos indisponíveis" : `${number(video.subscribers)} inscritos`} · ${vph === undefined ? "VPH indisponível" : `${number(vph)} VPH médio`} · ${outlier === undefined ? "outlier indisponível" : `${outlier.toFixed(1)}× outlier aproximado da amostra`}`;
      if (badge.textContent !== label) badge.textContent = label;
      badge.title =
        `VPH médio desde a publicação; não mede a última hora. ${describeResearchComparison(comparison, effectiveFilter.comparisonMode)}`;
    }
    for (const element of document.querySelectorAll<HTMLElement>(
      "ytd-rich-shelf-renderer[is-shorts],ytd-reel-shelf-renderer,ytm-shorts-lockup-view-model",
    )) {
      if (hideShorts) element.setAttribute(HIDDEN, "true");
      else if (!cards.some((c) => c.element === element))
        element.removeAttribute(HIDDEN);
    }
    const ranked =
      sortResearchVideos(base,effectiveFilter,Date.now(),base);
    const rank = new Map(ranked.map((video, index) => [video, index]));
    const groups = new Map<HTMLElement, typeof cards>();
    for (const card of cards)
      if (card.element.parentElement) {
        const parent = card.element.parentElement;
        groups.set(parent, [...(groups.get(parent) ?? []), card]);
      }
    for (const [parent, group] of groups) {
      const sorted =
        filter.sort === "default"&&!filter.criteria?.length&&filter.priority!=='views-per-subscriber'
          ? [...group].sort(
              (a, b) =>
                (originalOrder.get(a.element) ?? 0) -
                (originalOrder.get(b.element) ?? 0),
            )
          : [...group].sort(
              (a, b) => (rank.get(a.video) ?? 0) - (rank.get(b.video) ?? 0),
            );
      // Replace only card positions, preserving advertisements and other siblings.
      const slots = Array.from(parent.childNodes).filter((node) =>
        group.some((card) => card.element === node),
      );
      if (slots.some((node, index) => node !== sorted[index]?.element)) {
        const placeholders = slots.map((node) => {
          const slot = document.createComment("prevlev-order");
          parent.replaceChild(slot, node);
          return slot;
        });
        placeholders.forEach((slot, index) =>
          parent.replaceChild(sorted[index].element, slot),
        );
      }
    }
    updatePanel();
    contextual??=mountContextualTools(document,{getVideos:()=>{const at=new Date().toISOString();return loadedCards().map(card=>({...card.video,source:'youtube-dom' as const,observedAt:at}));}});contextual.refresh();
    ensureResearchOverlay();researchOverlay?.refresh();
  } finally {
    listen();
  }
}
function observedVideos():VideoRecord[]{const result=collector.snapshot();const saved=result?.url===location.href?result.videos:[];const at=new Date().toISOString();const current=loadedCards().map(card=>({...card.video,source:'youtube-dom' as const,observedAt:at}));return[...new Map([...saved,...current].map(video=>[video.id,video])).values()];}
function ensureResearchOverlay():void{const shadow=document.getElementById(HOST_ID)?.shadowRoot;if(!shadow)return;let container=shadow.getElementById('prevlev-research-overlay-tools');if(!container){container=document.createElement('div');container.id='prevlev-research-overlay-tools';shadow.querySelector('section')!.append(container);}researchOverlay??=mountResearchOverlay(container,{getVideos:observedVideos,getFilter:()=>filter,getUrl:()=>location.href,collector,getMetrics:()=>settings.showMetrics,setMetrics:enabled=>{settings.showMetrics=enabled;void saveSettings(settings).catch(()=>{});apply();},setFilter:value=>{const normalized=normalizeCardFilter(value);if(normalized.surface!==undefined&&normalized.surface!==researchSurface(location.href))throw new Error('O filtro pertence a outro contexto de página.');filterError='';setFilter(normalized);syncFilterForm();apply();}});}
function number(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(value);
}

function mount(): void {
  if (document.getElementById(HOST_ID)) return;
  collectionControlsCleanup?.();
  if (!document.getElementById("prevlev-page-style")) {
    const style = document.createElement("style");
    style.id = "prevlev-page-style";
    style.textContent = `[${HIDDEN}="true"]{display:none!important}`;
    document.head.append(style);
  }
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText =
    "position:fixed;bottom:18px;left:18px;z-index:2147483646";
  const shadow = host.attachShadow({ mode: "open" });
  const numericControls = [
    ["minViews", "min-views", "Views mín."],
    ["maxViews", "max-views", "Views máx."],
    ["minSubscribers", "min-subscribers", "Inscritos mín."],
    ["maxSubscribers", "max-subscribers", "Inscritos máx."],
    ["minDurationSeconds", "min-duration", "Duração mín. (s)"],
    ["maxDurationSeconds", "max-duration", "Duração máx. (s)"],
    ["minVph", "min-vph", "VPH médio mín."],
    ["maxVph", "max-vph", "VPH médio máx."],
    ["minOutlier", "min-outlier", "Outlier mín."],
    ["maxOutlier", "max-outlier", "Outlier máx."],
  ] as const;
  shadow.innerHTML = `<style>:host{font:13px/1.4 system-ui;color:#f5f5fa}*{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer;background:#8b7bff;border:0;border-radius:8px;padding:9px 12px;color:#fff}button.secondary{background:#30313c}details{background:#15161e;border:1px solid #454050;border-radius:12px;box-shadow:0 8px 30px #0006;width:320px;max-height:calc(100vh - 60px);overflow:auto}summary{cursor:pointer;padding:12px;font-weight:700;color:#c3baff}section{padding:0 12px 12px;display:grid;gap:9px}label{display:flex;align-items:center;gap:8px}label.stack{display:grid;gap:4px}.ranges{display:grid;grid-template-columns:1fr 1fr;gap:8px}input[type=text],input[type=number],input[type=date],select{width:100%;min-width:0;color:#fff;background:#242532;border:1px solid #484959;border-radius:6px;padding:7px}p{margin:0;color:#bfc0cd;font-size:11px}.row{display:flex;gap:6px;flex-wrap:wrap}#status{color:#c5c0ff}a{color:#b7aaff}</style><details><summary>Prevlev · Ferramentas</summary><section><label><input id="shorts" type="checkbox"> Ocultar Shorts</label><label><input id="metrics" type="checkbox"> Mostrar métricas nos cards</label><label class="stack">Título ou texto<input id="query" type="text" placeholder="Filtrar vídeos carregados"></label><label class="stack">Canal<input id="channel" type="text" placeholder="Nome, ID ou handle"></label><div class="ranges">${numericControls.map(([, id, label]) => `<label class="stack">${label}<input id="${id}" type="number" min="0" step="any"></label>`).join("")}<label class="stack">Publicado a partir de<input id="published-after" type="date"></label><label class="stack">Publicado até<input id="published-before" type="date"></label></div><label class="stack">Formato<select id="format"><option value="all">Todos</option><option value="only">Só Shorts</option><option value="exclude">Sem Shorts</option></select></label><label class="stack">Ordenação<select id="sort"><option value="default">Ordem original</option><option value="views">Mais visualizados</option><option value="vph">Maior VPH médio</option><option value="outlier">Maior outlier</option><option value="recent">Mais recentes</option><option value="duration">Maior duração</option><option value="subscribers">Mais inscritos</option><option value="title">Título</option></select></label><div class="row"><button id="clear-filter" class="secondary">Limpar filtros</button><button id="scan">Analisar página</button><button id="workspace" class="secondary">Abrir painel</button></div><p id="status" role="status"></p><p>Somente conteúdo já carregado. VPH médio desde a publicação; datas relativas são aproximadas. Campos ausentes ficam fora quando seu limite está ativo. Nenhuma alteração no canal é feita por estes filtros.</p></section></details>`;
  const field = <T extends HTMLElement>(id: string) =>
    shadow.getElementById(id) as T;
  syncFilterForm = () => {
    field<HTMLInputElement>("query").value = filter.query ?? "";
    field<HTMLInputElement>("channel").value = filter.channel ?? "";
    for (const [key, id] of numericControls)
      field<HTMLInputElement>(id).value =
        filter[key] === undefined ? "" : String(filter[key]);
    field<HTMLInputElement>("published-after").value =
      filter.publishedAfter ?? "";
    field<HTMLInputElement>("published-before").value =
      filter.publishedBefore ?? "";
    field<HTMLSelectElement>("format").value = filter.shorts ?? "all";
    field<HTMLSelectElement>("sort").value = filter.sort;
  };
  syncFilterForm();
  field<HTMLInputElement>("shorts").checked = settings.hideShorts;
  field<HTMLInputElement>("metrics").checked = settings.showMetrics;
  field("shorts").addEventListener("change", () => {
    settings.hideShorts = field<HTMLInputElement>("shorts").checked;
    settings.hideShortsOnFeed=settings.hideShorts;
    settings.hideShortsOnSearch=settings.hideShorts;
    filter={...filter,...shortsPreferences()};
    void saveSettings(settings).catch(showError);
    apply();
  });
  field("metrics").addEventListener("change", () => {
    settings.showMetrics = field<HTMLInputElement>("metrics").checked;
    void saveSettings(settings).catch(showError);
    apply();
  });
  const readForm = () => {
    try {
      const input: Record<string, unknown> = {
        ...filter,
        query: field<HTMLInputElement>("query").value,
        channel: field<HTMLInputElement>("channel").value,
        shorts: field<HTMLSelectElement>("format").value,
        sort: field<HTMLSelectElement>("sort").value,
        publishedAfter: field<HTMLInputElement>("published-after").value,
        publishedBefore: field<HTMLInputElement>("published-before").value,
      };
      for (const [key, id] of numericControls) {
        const control = field<HTMLInputElement>(id);
        if (!control.validity.valid)
          throw new Error("Use limites numéricos não negativos.");
        input[key] = control.value === ""?undefined:Number(control.value);
      }
      filter = normalizeCardFilter(input);
      filterError = "";
      schedule();
    } catch (error) {
      filterError = error instanceof Error ? error.message : String(error);
      updatePanel();
    }
  };
  for (const id of [
    "query",
    "channel",
    "published-after",
    "published-before",
    ...numericControls.map(([, id]) => id),
  ])
    field(id).addEventListener("input", readForm);
  for (const id of ["format", "sort"])
    field(id).addEventListener("change", readForm);
  field("clear-filter").addEventListener("click", () => {
    setFilter(normalizeCardFilter({}));
    filterError = "";
    syncFilterForm();
    apply();
  });
  field("scan").addEventListener("click", () => {
    void snapshot()
      .then(() => {
        field("status").textContent =
          "Página analisada e salva neste navegador.";
      })
      .catch(showError);
  });
  field("workspace").addEventListener("click", () => {
    void chrome.runtime
      .sendMessage({ type: "OPEN_WORKSPACE" })
      .catch(showError);
  });
  updatePanel = () => {
    const cards = loadedCards();
    field("status").textContent =
      filterError ||
      `${cards.filter((c) => !c.element.hasAttribute(HIDDEN)).length} de ${cards.length} vídeos carregados visíveis`;
    const preferences=shortsPreferences(),shortsControl=field<HTMLInputElement>("shorts");
    shortsControl.checked=preferences.hideShortsOnFeed===true&&preferences.hideShortsOnSearch===true;
    shortsControl.indeterminate=preferences.hideShortsOnFeed!==preferences.hideShortsOnSearch;
    field<HTMLInputElement>("metrics").checked = settings.showMetrics;
  };
  const collectionContainer=document.createElement('div');collectionContainer.id='prevlev-collection-tools';shadow.querySelector('section')!.append(collectionContainer);
  collectionControlsCleanup=mountCollectionControls(collectionContainer,collector,async value=>{await chrome.storage.local.set({snapshot:value});await chrome.runtime.sendMessage({type:'OPEN_WORKSPACE'});});
  document.documentElement.append(host);
  function showError(error: unknown): void {
    field("status").textContent =
      error instanceof Error ? error.message : String(error);
  }
}

async function snapshot(persist = true) {
  const value = readYouTubeSnapshot(document);
  value.videos = value.videos.map(enrichedVideo);
  const timeline=refreshTimeline(document);
  if(value.videoId&&timeline.videoId===value.videoId&&(timeline.available||timeline.segments.length>0))value.transcript=timeline.segments;
  if (location.hostname === "studio.youtube.com") {
    const metrics = readStudioMetrics(document);
    value.studio = metrics;
    value.warnings.push(...metrics.warnings);
  }
  if(persist) await chrome.storage.local.set({ snapshot: value });
  return value;
}
async function blobData(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    reader.readAsDataURL(blob);
  });
}

interface Message {
  type: string;
  kind?: string;
  redact?: boolean;
  redactionCategories?: unknown;
  action?: Parameters<typeof previewStudioAction>[0];
  input?: Parameters<typeof previewStudioAction>[1];
  planId?: string;
  start?: string;
  end?: string;
  filter?: unknown;
  videos?: unknown;
  seconds?: unknown;
  expectedVideoId?: unknown;
  targetVideoId?:unknown;
  maxItems?:number;
  maxSteps?:number;
  timeoutMs?:number;
  jobId?:string;
  includeResults?:boolean;
  session?:string;
  sequence?:number;
  observationId?:string;
}
async function dispatch(message: Message): Promise<unknown> {
  switch (message.type) {
    case 'STUDIO_PROFIT_OBSERVE':
    case 'STUDIO_PROFIT_SHOW':
    case 'STUDIO_PROFIT_RESTORE':
    case 'STUDIO_PROFIT_CANCEL':{
      if(suspended)throw new Error('Ative a página antes de apresentar uma estimativa local.');
      return profitCardBridge.dispatch(message);
    }
    case 'START_COLLECTION':{
      if(suspended)throw new Error('Ative a página antes de iniciar a coleta.');
      return{status:'ok',collection:collector.start({kind:message.kind as CollectionKind,maxItems:message.maxItems,maxSteps:message.maxSteps,timeoutMs:message.timeoutMs})};
    }
    case 'COLLECTION_STATUS':{
      if(message.includeResults!==undefined&&typeof message.includeResults!=='boolean')throw new Error('includeResults deve ser booleano.');
      const collection=collector.status(message.jobId);return{status:'ok',collection,...(message.includeResults&&collection.phase!=='running'?{snapshot:collector.snapshot(message.jobId)}:{})};
    }
    case 'CANCEL_COLLECTION':return{status:'ok',collection:collector.cancel(message.jobId)};
    case 'GET_CURRENT_METADATA':{
      const title=document.querySelector('ytd-watch-metadata h1,h1.ytd-video-primary-info-renderer')?.textContent?.replace(/\s+/g,' ').trim()||document.title.replace(/\s*- YouTube$/,'');const id=videoIdFromUrl(location.href);return{status:'ok',metadata:{title,id,videoId:id,url:location.href}};
    }
    case "APPLY_FILTER":
    case "CLEAR_FILTER": {
      if (!settings) throw new Error("Aguarde a extensão carregar.");
      const candidate = normalizeCardFilter(
        message.type === "CLEAR_FILTER" ? {} : message.filter,
      );
      if(candidate.surface!==undefined&&candidate.surface!==researchSurface(location.href))throw new Error('O filtro foi preparado para outro contexto de página. Confira a aba e prepare-o novamente.');
      filterError = "";
      setFilter(candidate);
      syncFilterForm();
      apply();
      const cards = loadedCards();
      return {
        status: "ok",
        visible: cards.filter((card) => !card.element.hasAttribute(HIDDEN))
          .length,
        total: cards.length,
        filter,
      };
    }
    case "SET_ENRICHMENT": {
      if (!Array.isArray(message.videos) || message.videos.length > 2000)
        throw new Error("Envie até 2000 vídeos para atualizar os inscritos.");
      const entries: Array<
        [string, { subscribers: number; channel?: string }]
      > = [];
      for (const raw of message.videos) {
        if (!raw || typeof raw !== "object")
          throw new Error("Dados de canal inválidos.");
        const record = raw as Record<string, unknown>;
        if (record.subscribers === undefined) continue;
        if (
          typeof record.subscribers !== "number" ||
          !Number.isFinite(record.subscribers) ||
          record.subscribers < 0
        )
          throw new Error("Contagem de inscritos inválida.");
        const identity = {
          channelId:
            typeof record.channelId === "string" ? record.channelId : undefined,
          channelUrl:
            typeof record.channelUrl === "string"
              ? record.channelUrl
              : undefined,
        };
        for (const key of channelKeys(identity))
          entries.push([
            key,
            {
              subscribers: record.subscribers,
              channel:
                typeof record.channel === "string" ? record.channel : undefined,
            },
          ]);
      }
      for (const [key, info] of entries) {
        channelEnrichment.set(key, info);
        while (channelEnrichment.size > 2000)
          channelEnrichment.delete(channelEnrichment.keys().next().value!);
      }
      apply();
      return { status: "ok", updated: entries.length };
    }
    case "GET_TIMELINE":
    case "SEEK_VIDEO":
    case "TOGGLE_PLAYBACK":
      return { status: "ok", state: await dispatchTimeline(message, document) };
    case "GET_SNAPSHOT":
      return { status: "ok", snapshot: await snapshot() };
    case "GET_IMAGE_CONTEXT":
      return { status: "ok", snapshot: await snapshot(false) };
    case "COPY_TITLE_ID": {
      const value = readYouTubeSnapshot(document);
      await navigator.clipboard.writeText(
        `${value.title}\n${value.videoId ?? value.url}`,
      );
      return { status: "ok" };
    }
    case "CAPTURE_FRAME": {
      const video = document.querySelector<HTMLVideoElement>("video");
      if (!video) throw new Error("Nenhum vídeo carregado nesta página.");
      return {
        status: "ok",
        dataUrl: await blobData(await captureFrame(video)),
      };
    }
    case "CAPTURE_CARD": {
      if (suspended)
        throw new Error(
          "A página está suspensa. Ative a aba e tente novamente.",
        );
      if(message.targetVideoId!==undefined&&(typeof message.targetVideoId!=='string'||!/^[\w-]{11}$/.test(message.targetVideoId)))throw new Error('ID do card solicitado inválido.');
      if(message.targetVideoId!==undefined&&message.kind!==undefined&&message.kind!=='video')throw new Error('Um ID de vídeo só pode selecionar um card de vídeo.');
      if (message.redact !== undefined && typeof message.redact !== 'boolean') throw new Error('Opção de ocultação inválida.');
      const categories = message.redactionCategories === undefined ? undefined : validateCaptureCategories(message.redactionCategories);
      if (categories && !message.redact) throw new Error('Ative a ocultação para selecionar categorias.');
      const studioKind=message.kind==='analytics'||message.kind==='latest-performance'?message.kind:undefined;
      if(studioKind)await profitCardBridge.prepareCapture();
      const element = studioKind
        ? getStudioScreenshotTargets(studioKind,document)[0]
        : readVideoCards(document).find((c) => {
            const r = c.element.getBoundingClientRect();
            return (
              (message.targetVideoId===undefined||c.video.id===message.targetVideoId)&&
              r.width > 0 &&
              r.height > 0 &&
              r.top >= 0 &&
              r.left >= 0 &&
              r.bottom <= innerHeight &&
              r.right <= innerWidth
            );
          })?.element;
      if (!element)
        throw new Error(
          "O card solicitado não está disponível. Role até ele e tente novamente.",
        );
      const r = element.getBoundingClientRect();
      if (
        r.top < 0 ||
        r.left < 0 ||
        r.bottom > innerHeight ||
        r.right > innerWidth ||
        r.width === 0 ||
        r.height === 0
      )
        throw new Error(
          "O card precisa estar inteiro visível na janela para capturar. Ajuste a rolagem ou o zoom.",
        );
      const intersects = (el: HTMLElement) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.x < r.right && box.y < r.bottom && box.x + box.width > r.left && box.y + box.height > r.top;
      };
      if (categories) {
        for (const category of categories) {
          const categoryDetails = getStudioRedactionDetails(document, [category]);
          if (categoryDetails.coarse || !categoryDetails.elements.some(intersects))
            throw new Error(`A categoria ${category} não foi reconhecida dentro do card. Captura interrompida; revise a seleção e o layout.`);
        }
      }
      const redactionDetails=message.redact?getStudioRedactionDetails(document,categories):undefined;
      const redactionNodes = redactionDetails
        ? redactionDetails.elements
            .map((el) => {
              const box = el.getBoundingClientRect();
              return {
                element: el,
                x: box.x,
                y: box.y,
                width: box.width,
                height: box.height,
              };
            })
            .filter(
              (box) =>
                box.width > 0 &&
                box.height > 0 &&
                box.x < r.right &&
                box.y < r.bottom &&
                box.x + box.width > r.left &&
                box.y + box.height > r.top,
            )
        : [];
      const redactions = redactionNodes.map(({ x, y, width, height }) => ({
        x,
        y,
        width,
        height,
      }));
      if (
        message.redact &&
        (message.kind === "analytics" ||
          message.kind === "latest-performance") &&
        redactions.length === 0
      )
        throw new Error(
          "Nenhum campo sensível visível foi reconhecido neste card. A captura foi interrompida para evitar uma imagem sem ocultação. Confira o layout do Studio ou desative a ocultação conscientemente.",
        );
      if (observer?.takeRecords().length) pageRevision++;
      const captureVideo = studioKind ? undefined : readVideoCards(document).find(card=>card.element===element)?.video;
      const captureStamp = JSON.stringify({
        url: location.href,
        redactionCategories: categories ?? (message.redact ? 'legacy' : null),
        video: captureVideo ? {id:captureVideo.id,url:captureVideo.url,title:captureVideo.title} : undefined,
        revision: pageRevision,
        element: elementIdentity(element),
        content: element.textContent,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        viewport: {
          width: innerWidth,
          height: innerHeight,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          visual: window.visualViewport
            ? {
                x: window.visualViewport.offsetLeft,
                y: window.visualViewport.offsetTop,
                width: window.visualViewport.width,
                height: window.visualViewport.height,
                scale: window.visualViewport.scale,
              }
            : null,
        },
        redactions: redactionNodes.map(({ element: target, ...box }) => ({
          ...box,
          identity: elementIdentity(target),
          content: target.textContent,
        })),
      });
      return {
        status: "ok",
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        viewportWidth: innerWidth,
        redactions,
        captureStamp,
        coarse:redactionDetails?.coarse??false,
        coarseSelectors:redactionDetails?.coarseSelectors??[],
      };
    }
    case "GET_MONETIZATION":
      return {
        status: "ok",
        result: inferMonetization(
          Array.from(document.scripts)
            .map((s) => s.textContent ?? "")
            .join("\n"),
        ),
      };
    case "STUDIO_OBSERVE_MIDROLLS":
      return {status:"ok",observation:observeStudioMidrollSlots(document)};
    case "STUDIO_PREVIEW":
      if (!message.action) throw new Error("Selecione uma ação.");
      return previewStudioAction(message.action, message.input, document);
    case "STUDIO_EXECUTE":
      if (!message.planId) throw new Error("Uma prévia é necessária.");
      return executeStudioPlan(message.planId);
    case "STUDIO_CANCEL":
      return {
        status: cancelStudioPlan(message.planId ?? "")
          ? "cancelled"
          : "not_found",
      };
    case "STUDIO_PERIOD":
      return setStudioPeriodVerified(message.start ?? "", message.end ?? "", document);
    default:
      return { status: "unsupported", error: "Ação desconhecida." };
  }
}

chrome.runtime.onMessage.addListener(
  (message: Message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (!message || typeof message.type !== "string") return false;
    void dispatch(message)
      .then(sendResponse)
      .catch((error: unknown) =>
        sendResponse({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  },
);

chrome.storage.onChanged.addListener((changes, areaName) => {
  const value = changes.settings?.newValue;
  if (areaName === "local" && settings && value && typeof value === "object") {
    settings = { ...settings, ...(value as Partial<Settings>) };
    filter={...filter,...shortsPreferences()};
    schedule();
  }
});

void getSettings()
  .then((value) => {
    settings = value;
    filter={...filter,...shortsPreferences()};
    observer = new MutationObserver((records) => {
      if (records.length) {
        pageRevision++;
        schedule();
      }
    });
    if (!suspended) {
      navigation(true);
      apply();
    }
  })
  .catch(() => {
    /* The extension may have been reloaded while this tab remained open. */
  });

}
