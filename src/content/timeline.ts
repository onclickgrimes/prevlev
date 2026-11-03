import { captureFrame, downloadBlob } from "../core/media";
import { videoIdFromUrl } from "../core/parse";
import {
  parseTranscript,
  transcriptText,
  transcriptVtt,
  TRANSCRIPT_ROW_SELECTOR,
} from "../core/transcript";
import type { TranscriptSegment } from "../shared/types";

export interface TimelineState {
  available: boolean;
  currentTime: number;
  duration?: number;
  paused: boolean;
  videoId?: string;
  segments: TranscriptSegment[];
  limitations: string[];
}
export interface TimelineController {
  refresh(): TimelineState;
  getState(): TimelineState;
  seek(seconds: number): TimelineState;
  togglePlayback(): Promise<TimelineState>;
  cleanup(): void;
}

const HOST_ID = "prevlev-timeline";
const controllers = new WeakMap<Document, TimelineController>();
const MEDIA_EVENTS = [
  "timeupdate",
  "durationchange",
  "loadedmetadata",
  "play",
  "pause",
  "emptied",
];
const MAX_SEGMENTS = 5000;
const MAX_VISIBLE_SEGMENTS = 200;

function time(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value / 60) % 60;
  const secondsPart = String(value % 60).padStart(2, "0");
  return `${hours ? `${hours}:` : ""}${String(minutes).padStart(2, "0")}:${secondsPart}`;
}
function normalized(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

/** One controller per document. The caller's existing DOM observer calls refresh. */
export function mountTimeline(doc: Document = document): TimelineController {
  const mounted = controllers.get(doc);
  if (mounted) return mounted;
  let video: HTMLVideoElement | null = null;
  let host: HTMLElement | undefined;
  let shadow: ShadowRoot | undefined;
  let segments: TranscriptSegment[] = [];
  let segmentSignature = "";
  let videoIdentity = "";
  let transcriptTruncated = false;
  const accumulated = new Map<number, TranscriptSegment>();
  let lastLoadedSignature = '', staleSignature = '';
  let query = "";
  let destroyed = false;
  const selected = new Set<number>();
  const segmentKey = (segment:TranscriptSegment) => Math.round(segment.start*1000);

  const field = <T extends HTMLElement>(id: string): T | undefined =>
    shadow?.getElementById(id) as T | undefined;
  const status = (message: string): void => {
    const output = field("status");
    if (output) output.textContent = message;
  };
  const getState = (): TimelineState => {
    const duration =
      video && Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : undefined;
    return {
      available: !!video?.isConnected,
      currentTime:
        video && Number.isFinite(video.currentTime) ? video.currentTime : 0,
      duration,
      paused: video?.paused ?? true,
      videoId: videoIdFromUrl(doc.location?.href ?? ""),
      segments: segments.map((segment) => ({ ...segment })),
      limitations: [
        "Passo de frame estimado em 1/30 s; a taxa de quadros real não é conhecida.",
        "Transcrição usa somente trechos já carregados pelo YouTube. Abra Mostrar transcrição para disponibilizá-los.",
        "Trechos observados são acumulados por timestamp até mudar de vídeo. Conflitos no mesmo timestamp usam o último texto observado; a lista é ordenada pelo início.",
        ...(!duration
          ? [
              "Duração ainda não disponível ou transmissão ao vivo. Busca temporal desativada.",
            ]
          : []),
        ...(transcriptTruncated
          ? [`Leitura limitada a ${MAX_SEGMENTS} trechos carregados.`]
          : []),
      ],
    };
  };

  function renderTime(): void {
    const state = getState();
    const label = field("time");
    if (label)
      label.textContent = `${time(state.currentTime)} / ${state.duration === undefined ? "duração indisponível" : time(state.duration)}`;
    const slider = field<HTMLInputElement>("seek");
    if (slider) {
      slider.disabled = !state.available || state.duration === undefined;
      slider.max = String(state.duration ?? 0);
      if (shadow?.activeElement !== slider)
        slider.value = String(state.currentTime);
      slider.setAttribute(
        "aria-valuetext",
        `${time(state.currentTime)} de ${state.duration ? time(state.duration) : "duração indisponível"}`,
      );
    }
    const play = field<HTMLButtonElement>("play");
    if (play) {
      play.textContent = state.paused ? "Reproduzir" : "Pausar";
      play.disabled = !state.available;
    }
    for (const button of shadow?.querySelectorAll<HTMLButtonElement>(
      "[data-seek]",
    ) ?? [])
      button.disabled = !state.available || state.duration === undefined;
    for (const row of shadow?.querySelectorAll<HTMLElement>("[data-segment]") ??
      []) {
      const index = Number(row.dataset.segment);
      const segment = segments[index];
      const end = segment
        ? (segments[index + 1]?.start ??
          (segment.duration>0?segment.start+segment.duration:(state.duration??segment.start)))
        : 0;
      if (
        segment &&
        state.currentTime >= segment.start &&
        state.currentTime < end
      )
        row.setAttribute("aria-current", "true");
      else row.removeAttribute("aria-current");
    }
  }

  function filteredIndices(): number[] {
    const needle = normalized(query.trim());
    return segments.flatMap((segment, index) =>
      !needle || normalized(segment.text).includes(needle) ? [index] : [],
    );
  }
  function selectedSegments(): TranscriptSegment[] {
    return segments.filter((segment) => selected.has(segmentKey(segment)));
  }
  function exportSegments(): TranscriptSegment[] {
    return selected.size
      ? selectedSegments()
      : filteredIndices().map((index) => segments[index]);
  }
  function updateCount(): void {
    const count = field("count");
    const filtered = filteredIndices();
    if (count)
      count.textContent = segments.length
        ? `${filtered.length} de ${segments.length} trechos · ${selected.size} selecionados${filtered.length > MAX_VISIBLE_SEGMENTS ? ` · exibindo os primeiros ${MAX_VISIBLE_SEGMENTS}; refine a busca` : ""}`
        : "Abra Mostrar transcrição no YouTube. Nenhum trecho carregado foi encontrado.";
    const copy = field<HTMLButtonElement>("copy");
    if (copy) copy.disabled = selected.size === 0;
    for (const id of ["txt", "vtt", "select-filtered"]) {
      const button = field<HTMLButtonElement>(id);
      if (button) button.disabled = exportSegments().length === 0;
    }
  }
  function renderTranscript(): void {
    const list = field("segments");
    if (!list) return;
    list.replaceChildren();
    for (const index of filteredIndices().slice(0, MAX_VISIBLE_SEGMENTS)) {
      const segment = segments[index];
      const row = doc.createElement("div");
      row.className = "segment";
      row.dataset.segment = String(index);
      const checkbox = doc.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(segmentKey(segment));
      checkbox.setAttribute(
        "aria-label",
        `Selecionar trecho ${time(segment.start)}: ${segment.text}`,
      );
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(segmentKey(segment));
        else selected.delete(segmentKey(segment));
        updateCount();
      });
      const button = doc.createElement("button");
      button.className = "transcript-seek";
      button.textContent = `${time(segment.start)}  ${segment.text}`;
      button.setAttribute(
        "aria-label",
        `Ir para ${time(segment.start)}: ${segment.text}`,
      );
      button.addEventListener("click", () => {
        try {
          seek(segment.start);
        } catch (error) {
          showError(error);
        }
      });
      row.append(checkbox, button);
      list.append(row);
    }
    updateCount();
    renderTime();
  }

  function showError(error: unknown): void {
    status(error instanceof Error ? error.message : String(error));
  }
  function seek(seconds: number): TimelineState {
    if (!video?.isConnected)
      throw new Error("Nenhum player de vídeo está disponível nesta página.");
    const duration = getState().duration;
    if (duration === undefined)
      throw new Error(
        "Aguarde a duração do vídeo carregar. Transmissões ao vivo não têm busca temporal nesta ferramenta.",
      );
    if (!Number.isFinite(seconds))
      throw new Error("Informe uma posição válida em segundos.");
    video.currentTime = Math.max(0, Math.min(duration, seconds));
    renderTime();
    status(
      `Posição: ${time(video.currentTime)}. A reprodução não foi iniciada automaticamente.`,
    );
    return getState();
  }
  async function togglePlayback(): Promise<TimelineState> {
    if (!video?.isConnected)
      throw new Error("Nenhum player de vídeo está disponível nesta página.");
    if (video.paused) {
      try {
        await video.play();
      } catch {
        throw new Error(
          "O navegador ou o player bloqueou a reprodução. Use o botão de reprodução do YouTube.",
        );
      }
    } else video.pause();
    renderTime();
    return getState();
  }
  function mountPanel(): void {
    if (host?.isConnected) return;
    doc.getElementById(HOST_ID)?.remove();
    host = doc.createElement("div");
    host.id = HOST_ID;
    host.style.cssText =
      "position:fixed;right:18px;bottom:18px;z-index:2147483645;max-width:calc(100vw - 36px)";
    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>:host{font:13px/1.5 system-ui;color:#f5f5fa}*{box-sizing:border-box}details{background:#15161e;border:1px solid #454050;border-radius:12px;width:390px;max-width:calc(100vw - 36px);box-shadow:0 8px 30px #0006}summary{padding:12px;cursor:pointer;font-weight:700;color:#c3baff}section{display:grid;gap:8px;padding:0 12px 12px;max-height:75vh;overflow:auto}button,input{font:inherit}button{border:0;border-radius:6px;padding:8px;background:#403564;color:#fff;cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid #c3baff;outline-offset:2px}.row{display:flex;gap:6px;flex-wrap:wrap}label{display:grid;gap:4px}input[type=range]{width:100%}input[type=search]{width:100%;padding:8px;background:#242532;color:#fff;border:1px solid #626277;border-radius:6px}p{margin:0;color:#bdc0d0;font-size:11px}.segments{max-height:230px;overflow:auto;display:grid;gap:4px}.segment{display:flex;align-items:flex-start;gap:6px;border-radius:5px}.segment[aria-current=true]{background:#373052}.segment input{margin:11px 0 0}.transcript-seek{background:transparent;text-align:left;line-height:1.5;width:100%}#status{color:#c3baff;min-height:16px}</style><details><summary>Prevlev · Timeline e transcrição</summary><section aria-label="Ferramentas locais do player"><label>Posição do vídeo <output id="time"></output><input id="seek" type="range" min="0" max="0" step="0.1" value="0" aria-label="Posição do vídeo"></label><div class="row"><button id="play">Reproduzir</button><button data-seek="-5">−5 s</button><button data-seek="5">+5 s</button><button data-seek="-0.03333333333333333">−1/30 s</button><button data-seek="0.03333333333333333">+1/30 s</button></div><p>Passo de frame estimado em 1/30 s. A taxa de quadros real não é conhecida. Mover a posição não inicia o vídeo.</p><button id="frame">Capturar e baixar frame PNG</button><label>Buscar na transcrição carregada<input id="search" type="search" placeholder="Palavra ou frase"></label><p id="count"></p><div class="row"><button id="select-filtered">Selecionar filtro</button><button id="clear">Limpar seleção</button></div><div id="segments" class="segments" aria-label="Trechos da transcrição"></div><div class="row"><button id="copy" disabled>Copiar selecionados</button><button id="txt">Baixar TXT</button><button id="vtt">Baixar VTT</button></div><p>TXT e VTT exportam a seleção; sem seleção, exportam o filtro atual. Somente texto já carregado. Os trechos clicáveis movem o player.</p><p id="status" role="status" aria-live="polite"></p></section></details>`;
    field("seek")?.addEventListener("change", () => {
      try {
        seek(Number(field<HTMLInputElement>("seek")?.value));
      } catch (error) {
        showError(error);
      }
    });
    field("play")?.addEventListener("click", () => {
      void togglePlayback().catch(showError);
    });
    for (const button of shadow.querySelectorAll<HTMLButtonElement>(
      "[data-seek]",
    ))
      button.addEventListener("click", () => {
        try {
          seek((video?.currentTime ?? 0) + Number(button.dataset.seek));
        } catch (error) {
          showError(error);
        }
      });
    field("frame")?.addEventListener("click", () => {
      if (!video?.isConnected) {
        status("Nenhum player de vídeo disponível.");
        return;
      }
      const currentVideo = video;
      const timestamp = time(video.currentTime).replace(/:/g, "-");
      void captureFrame(currentVideo)
        .then((blob) => {
          downloadBlob(blob, `prevlev-frame-${timestamp}.png`);
          status("Frame PNG capturado localmente.");
        })
        .catch(showError);
    });
    field("search")?.addEventListener("input", () => {
      query = field<HTMLInputElement>("search")?.value ?? "";
      renderTranscript();
    });
    const restoredSearch=field<HTMLInputElement>('search');if(restoredSearch)restoredSearch.value=query;
    field("select-filtered")?.addEventListener("click", () => {
      filteredIndices().forEach((index) => selected.add(segmentKey(segments[index])));
      renderTranscript();
    });
    field("clear")?.addEventListener("click", () => {
      selected.clear();
      renderTranscript();
    });
    field("copy")?.addEventListener("click", () => {
      const chosen = selectedSegments();
      if (!chosen.length) {
        status("Selecione um ou mais trechos para copiar.");
        return;
      }
      const clipboard = doc.defaultView?.navigator.clipboard;
      if (!clipboard?.writeText) {
        status("Área de transferência indisponível. Baixe o TXT.");
        return;
      }
      void clipboard
        .writeText(transcriptText(chosen))
        .then(() => status(`${chosen.length} trechos copiados.`))
        .catch(() =>
          status("A cópia foi bloqueada pelo navegador. Baixe o TXT."),
        );
    });
    for (const format of ["txt", "vtt"])
      field(format)?.addEventListener("click", () => {
        const chosen = exportSegments();
        if (!chosen.length) {
          status("Nenhum trecho disponível para exportar.");
          return;
        }
        const text =
          format === "vtt" ? transcriptVtt(chosen,{playerEndSeconds:getState().duration}) : transcriptText(chosen);
        downloadBlob(
          new Blob([text], {
            type:
              format === "vtt"
                ? "text/vtt;charset=utf-8"
                : "text/plain;charset=utf-8",
          }),
          `prevlev-transcricao.${format}`,
        );
        status(
          `${chosen.length} trechos exportados localmente em ${format.toUpperCase()}.`,
        );
      });
    doc.documentElement.append(host);
  }

  function refresh(): TimelineState {
    if (destroyed) return getState();
    // A home/search hover preview is not the video the user chose to control.
    const youtubePage = /(^|\.)youtube\.com$/.test(
      doc.location?.hostname ?? "",
    );
    const playbackRoute = /^\/(?:watch(?:\/|$)|shorts\/|live\/|embed\/)/.test(
      doc.location?.pathname ?? "",
    );
    const nextVideo =
      youtubePage &&
      (doc.location?.hostname === "studio.youtube.com" || !playbackRoute)
        ? null
        : doc.querySelector<HTMLVideoElement>(
            "video.html5-main-video,#movie_player video,video",
          );
    const nextIdentity = videoIdFromUrl(doc.location?.href ?? "") ?? "";
    const identityChanged=nextIdentity!==videoIdentity;
    if(identityChanged){staleSignature=videoIdentity?lastLoadedSignature:'';videoIdentity=nextIdentity;accumulated.clear();segments=[];selected.clear();query='';segmentSignature='';transcriptTruncated=false;const search=field<HTMLInputElement>('search');if(search)search.value='';status('');}
    if (nextVideo !== video) {
      if (video)
        MEDIA_EVENTS.forEach((event) =>
          video?.removeEventListener(event, renderTime),
        );
      video = nextVideo;
      if (video)
        MEDIA_EVENTS.forEach((event) =>
          video?.addEventListener(event, renderTime),
        );
    }
    if (!video) {
      host?.remove();
      host = undefined;
      shadow = undefined;
      return getState();
    }
    mountPanel();
    const loaded = parseTranscript(doc);
    const loadedSignature=JSON.stringify(loaded);
    const stale=!!staleSignature&&loadedSignature===staleSignature;
    if(!stale){staleSignature='';lastLoadedSignature=loadedSignature;for(const segment of loaded){const key=segmentKey(segment);if(!accumulated.has(key)&&accumulated.size>=MAX_SEGMENTS){transcriptTruncated=true;continue;}accumulated.set(key,{...segment});}}
    transcriptTruncated ||= doc.querySelectorAll(TRANSCRIPT_ROW_SELECTOR).length>MAX_SEGMENTS;
    const ordered=[...accumulated.values()].sort((a,b)=>a.start-b.start);
    const nextSegments=ordered.map((segment,index)=>{const next=ordered[index+1]?.start;return {...segment,duration:next!==undefined&&next>segment.start?Math.min(segment.duration>0?segment.duration:Infinity,next-segment.start):segment.duration};});
    const signature = JSON.stringify(nextSegments);
    if (signature !== segmentSignature) {
      segments = nextSegments;
      segmentSignature = signature;
      renderTranscript();
    } else {
      updateCount();
      renderTime();
    }
    return getState();
  }
  const onNavigation = (): void => {
    refresh();
  };
  function cleanup(): void {
    if (destroyed) return;
    destroyed = true;
    if (video)
      MEDIA_EVENTS.forEach((event) =>
        video?.removeEventListener(event, renderTime),
      );
    doc.removeEventListener("yt-navigate-finish", onNavigation);
    doc.defaultView?.removeEventListener("pagehide", cleanup);
    host?.remove();
    video = null;
    host = undefined;
    shadow = undefined;
    selected.clear();
    accumulated.clear();
    segments = [];
    controllers.delete(doc);
  }
  const controller: TimelineController = {
    refresh,
    getState,
    seek,
    togglePlayback,
    cleanup,
  };
  controllers.set(doc, controller);
  doc.addEventListener("yt-navigate-finish", onNavigation);
  doc.defaultView?.addEventListener("pagehide", cleanup);
  refresh();
  return controller;
}

export function refreshTimeline(doc: Document = document): TimelineState {
  return mountTimeline(doc).refresh();
}

/** Explicit extension messages only; capture remains the existing CAPTURE_FRAME path. */
export async function dispatchTimeline(
  message: { type: string; seconds?: unknown; expectedVideoId?: unknown },
  doc: Document = document,
): Promise<TimelineState | undefined> {
  if (!["GET_TIMELINE", "SEEK_VIDEO", "TOGGLE_PLAYBACK"].includes(message.type))
    return undefined;
  const controller = mountTimeline(doc);
  controller.refresh();
  if (message.type === "GET_TIMELINE") return controller.getState();
  if (
    message.expectedVideoId !== undefined &&
    (typeof message.expectedVideoId !== "string" ||
      controller.getState().videoId !== message.expectedVideoId)
  )
    throw new Error(
      "O vídeo da aba mudou desde a leitura do painel. Atualize a timeline antes de controlar o player.",
    );
  if (message.type === "TOGGLE_PLAYBACK") return controller.togglePlayback();
  if (typeof message.seconds !== "number")
    throw new Error("Informe uma posição numérica em segundos.");
  return controller.seek(message.seconds);
}
