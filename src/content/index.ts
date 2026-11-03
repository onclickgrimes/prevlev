import { getSettings, saveSettings } from "../shared/storage";
import type { Settings, VideoRecord } from "../shared/types";
import { lifetimeVph, outlierScore, inferMonetization } from "../core/metrics";
import { captureFrame } from "../core/media";
import {
  readYouTubeSnapshot,
  readVideoCards,
  filterAndSortCards,
  type CardFilter,
} from "./youtube";
import {
  readStudioMetrics,
  previewStudioAction,
  executeStudioPlan,
  cancelStudioPlan,
  setStudioPeriod,
  getStudioRedactionTargets,
} from "./studio";

const HOST_ID = "prevlev-controls";
const HIDDEN = "data-prevlev-hidden";
let settings: Settings;
let observer: MutationObserver | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let suspended = false;
let navigationListening = false;
let updatePanel: () => void = () => {};
const filter: CardFilter = {
  query: "",
  minimumViews: 0,
  shorts: "all",
  sort: "default",
};
const originalOrder = new WeakMap<HTMLElement, number>();
let nextOrder = 0;

function listen(): void {
  if (!suspended)
    observer?.observe(document.documentElement, {
      childList: true,
      subtree: true,
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
  if (enabled) document.addEventListener("yt-navigate-finish", schedule);
  else document.removeEventListener("yt-navigate-finish", schedule);
}
window.addEventListener("pagehide", () => {
  suspended = true;
  observer?.disconnect();
  if (timer) clearTimeout(timer);
  timer = undefined;
  navigation(false);
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
  observer?.disconnect();
  try {
    mount();
    const cards = readVideoCards(document);
    const base = cards.map((card) => card.video);
    for (const { element } of cards)
      if (!originalOrder.has(element)) originalOrder.set(element, nextOrder++);
    const allowed = new Set(
      filterAndSortCards(cards, filter, (video) => lifetimeVph(video)).map(
        (card) => card.element,
      ),
    );
    for (const { element, video } of cards) {
      const hidden =
        !allowed.has(element) || (settings.hideShorts && !!video.isShort);
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
      const vph = lifetimeVph(video),
        outlier = outlierScore(video, base);
      const label = `Prevlev · ${video.subscribers === undefined ? "inscritos indisponíveis" : `${number(video.subscribers)} inscritos`} · ${vph === undefined ? "VPH indisponível" : `${number(vph)} VPH médio`} · ${outlier === undefined ? "outlier indisponível" : `${outlier.toFixed(1)}× outlier`}`;
      if (badge.textContent !== label) badge.textContent = label;
      badge.title =
        "VPH médio desde a publicação; não mede a última hora. Outlier usa mediana dos vídeos carregados comparáveis (mínimo 3).";
    }
    for (const element of document.querySelectorAll<HTMLElement>(
      "ytd-rich-shelf-renderer[is-shorts],ytd-reel-shelf-renderer,ytm-shorts-lockup-view-model",
    )) {
      if (settings.hideShorts) element.setAttribute(HIDDEN, "true");
      else if (!cards.some((c) => c.element === element))
        element.removeAttribute(HIDDEN);
    }
    const groups = new Map<HTMLElement, typeof cards>();
    for (const card of cards)
      if (card.element.parentElement) {
        const parent = card.element.parentElement;
        groups.set(parent, [...(groups.get(parent) ?? []), card]);
      }
    for (const [parent, group] of groups) {
      const sorted =
        filter.sort === "default"
          ? [...group].sort(
              (a, b) =>
                (originalOrder.get(a.element) ?? 0) -
                (originalOrder.get(b.element) ?? 0),
            )
          : [...group].sort((a, b) => metric(b.video) - metric(a.video));
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
  } finally {
    listen();
  }
}
function metric(video: VideoRecord): number {
  return (filter.sort === "vph" ? lifetimeVph(video) : video.views) ?? -1;
}
function number(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(value);
}

function mount(): void {
  if (document.getElementById(HOST_ID)) return;
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
  shadow.innerHTML = `<style>:host{font:13px/1.4 system-ui;color:#f5f5fa}*{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer;background:#8b7bff;border:0;border-radius:8px;padding:9px 12px;color:#fff}button.secondary{background:#30313c}details{background:#15161e;border:1px solid #454050;border-radius:12px;box-shadow:0 8px 30px #0006;width:290px}summary{cursor:pointer;padding:12px;font-weight:700;color:#c3baff}section{padding:0 12px 12px;display:grid;gap:9px}label{display:flex;align-items:center;gap:8px}label.stack{display:grid;gap:4px}input[type=text],input[type=number],select{width:100%;min-width:0;color:#fff;background:#242532;border:1px solid #484959;border-radius:6px;padding:7px}p{margin:0;color:#bfc0cd;font-size:11px}.row{display:flex;gap:6px}#status{color:#c5c0ff}a{color:#b7aaff}</style><details><summary>Prevlev · Ferramentas</summary><section><label><input id="shorts" type="checkbox"> Ocultar Shorts</label><label><input id="metrics" type="checkbox"> Mostrar métricas nos cards</label><label class="stack">Filtrar vídeos carregados<input id="query" type="text" placeholder="Título ou canal"></label><label class="stack">Mínimo de visualizações<input id="minimum" type="number" min="0" step="1" value="0"></label><label class="stack">Formato<select id="format"><option value="all">Todos</option><option value="only">Só Shorts</option><option value="exclude">Sem Shorts</option></select></label><label class="stack">Ordenação<select id="sort"><option value="default">Ordem original</option><option value="views">Mais visualizados</option><option value="vph">Maior VPH médio</option></select></label><div class="row"><button id="scan">Analisar página</button><button id="workspace" class="secondary">Abrir painel</button></div><p id="status" role="status"></p><p>Somente conteúdo já carregado. VPH médio desde a publicação. Nenhuma alteração no canal é feita ao abrir esta ferramenta.</p></section></details>`;
  const field = <T extends HTMLElement>(id: string) =>
    shadow.getElementById(id) as T;
  field<HTMLInputElement>("shorts").checked = settings.hideShorts;
  field<HTMLInputElement>("metrics").checked = settings.showMetrics;
  field("shorts").addEventListener("change", () => {
    settings.hideShorts = field<HTMLInputElement>("shorts").checked;
    void saveSettings(settings);
    apply();
  });
  field("metrics").addEventListener("change", () => {
    settings.showMetrics = field<HTMLInputElement>("metrics").checked;
    void saveSettings(settings);
    apply();
  });
  field("query").addEventListener("input", () => {
    filter.query = field<HTMLInputElement>("query").value;
    schedule();
  });
  field("minimum").addEventListener("input", () => {
    filter.minimumViews = Math.max(
      0,
      Number(field<HTMLInputElement>("minimum").value) || 0,
    );
    schedule();
  });
  field("format").addEventListener("change", () => {
    filter.shorts = field<HTMLSelectElement>("format")
      .value as CardFilter["shorts"];
    apply();
  });
  field("sort").addEventListener("change", () => {
    filter.sort = field<HTMLSelectElement>("sort").value as CardFilter["sort"];
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
    const cards = readVideoCards(document);
    field("status").textContent =
      `${cards.filter((c) => !c.element.hasAttribute(HIDDEN)).length} de ${cards.length} vídeos carregados visíveis`;
    field<HTMLInputElement>("shorts").checked = settings.hideShorts;
    field<HTMLInputElement>("metrics").checked = settings.showMetrics;
  };
  document.documentElement.append(host);
  function showError(error: unknown): void {
    field("status").textContent =
      error instanceof Error ? error.message : String(error);
  }
}

async function snapshot() {
  const value = readYouTubeSnapshot(document);
  if (location.hostname === "studio.youtube.com") {
    const metrics = readStudioMetrics(document);
    value.studio = {
      revenue: metrics.revenue,
      currency: metrics.currency,
      videoCount: metrics.videoCount,
    };
    value.warnings.push(...metrics.warnings);
  }
  await chrome.storage.local.set({ snapshot: value });
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
  action?: Parameters<typeof previewStudioAction>[0];
  input?: Parameters<typeof previewStudioAction>[1];
  planId?: string;
  start?: string;
  end?: string;
}
async function dispatch(message: Message): Promise<unknown> {
  switch (message.type) {
    case "GET_SNAPSHOT":
      return { status: "ok", snapshot: await snapshot() };
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
      const selector =
        message.kind === "analytics"
          ? "ytcp-analytics-section,ytcp-channel-analytics,#analytics-content"
          : message.kind === "latest-performance"
            ? "ytcp-video-performance-card,ytcp-latest-video-card,ytcd-video-snapshot"
            : undefined;
      const element = selector
        ? document.querySelector<HTMLElement>(selector)
        : readVideoCards(document).find((c) => {
            const r = c.element.getBoundingClientRect();
            return (
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
      const redactions = message.redact
        ? getStudioRedactionTargets(document)
            .map((el) => {
              const box = el.getBoundingClientRect();
              return {
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
      if (
        message.redact &&
        (message.kind === "analytics" ||
          message.kind === "latest-performance") &&
        redactions.length === 0
      )
        throw new Error(
          "Nenhum campo sensível visível foi reconhecido neste card. A captura foi interrompida para evitar uma imagem sem ocultação. Confira o layout do Studio ou desative a ocultação conscientemente.",
        );
      return {
        status: "ok",
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        viewportWidth: innerWidth,
        redactions,
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
      return setStudioPeriod(message.start ?? "", message.end ?? "", document);
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
    schedule();
  }
});

void getSettings()
  .then((value) => {
    settings = value;
    observer = new MutationObserver(schedule);
    if (!suspended) {
      navigation(true);
      apply();
    }
  })
  .catch(() => {
    /* The extension may have been reloaded while this tab remained open. */
  });
