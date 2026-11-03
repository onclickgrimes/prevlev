import { getSettings } from "./shared/storage";
import { callBackend } from "./shared/backend";
import type { RemoteFeature, VideoRecord } from "./shared/types";
import { fetchThumbnail } from "./core/media";
import { enrichChannels } from "./core/enrichment";
import { researchChannel, sampleMonetization } from "./core/channel-research";
const ownUi = (sender: chrome.runtime.MessageSender) =>
  sender.id === chrome.runtime.id &&
  sender.url?.startsWith(chrome.runtime.getURL(""));
const youtube = (url?: string) =>
  !!url && /^https:\/\/(www|studio)\.youtube\.com\//.test(url);
let capturing = false;
function captureMeasurement(
  value: unknown,
): Record<string, unknown> & { captureStamp: string } {
  const item =
    value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  if (item.status !== "ok")
    throw new Error(
      typeof item.error === "string"
        ? item.error
        : "Não foi possível medir o card nesta página.",
    );
  const rect =
    item.rect !== null && typeof item.rect === "object"
      ? (item.rect as Record<string, unknown>)
      : {};
  if (
    typeof item.captureStamp !== "string" ||
    !item.captureStamp ||
    typeof item.viewportWidth !== "number" ||
    item.viewportWidth <= 0 ||
    !["x", "y", "width", "height"].every(
      (key) => typeof rect[key] === "number" && Number.isFinite(rect[key]),
    ) ||
    Number(rect.width) <= 0 ||
    Number(rect.height) <= 0 ||
    !Array.isArray(item.redactions)
  )
    throw new Error(
      "Medição de captura incompatível; recarregue a página do YouTube/Studio.",
    );
  return item as Record<string, unknown> & { captureStamp: string };
}
chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;
    if (!message || typeof message !== "object" || !("type" in message)) return;
    const m = message as Record<string, unknown>;
    const run = async () => {
      if (m.type === "OPEN_WORKSPACE") {
        if (!youtube(sender.tab?.url) && !ownUi(sender))
          throw new Error("Origem não permitida.");
        await chrome.tabs.create({
          url: chrome.runtime.getURL(
            `workspace.html?tab=${sender.tab?.id ?? ""}`,
          ),
        });
        return { status: "ok" };
      }
      if (m.type === "REMOTE_ANALYZE") {
        if (!ownUi(sender))
          throw new Error(
            "Use a página da extensão para enviar dados ao backend.",
          );
        return callBackend(
          await getSettings(),
          m.feature as RemoteFeature,
          m.payload,
        );
      }
      if (m.type === "ENRICH_CHANNELS") {
        if (!ownUi(sender))
          throw new Error("Use a página da extensão para consultar canais.");
        if (!Array.isArray(m.videos) || m.videos.length > 2000)
          throw new Error("Envie até 2000 vídeos coletados.");
        return {
          status: "ok",
          ...(await enrichChannels(m.videos as VideoRecord[], fetch)),
        };
      }
      if (m.type === "CHANNEL_RESEARCH") {
        if (!ownUi(sender))
          throw new Error(
            "Use a página da extensão para pesquisar um canal público.",
          );
        if (typeof m.channelUrl !== "string")
          throw new Error("Informe uma URL pública de canal.");
        if (
          m.order !== undefined &&
          m.order !== "recent" &&
          m.order !== "popular"
        )
          throw new Error("Ordem de canal inválida.");
        return {
          status: "ok",
          data: await researchChannel(m.channelUrl, fetch, m.order),
        };
      }
      if (m.type === "SAMPLE_MONETIZATION") {
        if (!ownUi(sender))
          throw new Error(
            "Use a página da extensão para consultar uma amostra pública.",
          );
        if (
          !Array.isArray(m.videos) ||
          (m.maxSamples !== undefined && typeof m.maxSamples !== "number")
        )
          throw new Error("Informe os vídeos e o limite da amostra.");
        return {
          status: "ok",
          data: await sampleMonetization(
            m.videos as VideoRecord[],
            fetch,
            m.maxSamples as number | undefined,
          ),
        };
      }
      if (m.type === "FETCH_THUMBNAIL") {
        if (!ownUi(sender) && !youtube(sender.tab?.url)) throw new Error("Origem não permitida.");
        if(typeof m.videoId!=="string"||!/^[-\w]{11}$/.test(m.videoId))throw new Error("ID de vídeo inválido.");
        const blob=await fetchThumbnail(m.videoId);const bytes=new Uint8Array(await blob.arrayBuffer());let binary="";
        for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
        return {status:"ok",dataUrl:`data:${blob.type};base64,${btoa(binary)}`};
      }
      if (m.type === "CAPTURE_SCREENSHOT") {
        if (!ownUi(sender) && !youtube(sender.tab?.url))
          throw new Error("Origem não permitida.");
        if(!ownUi(sender)&&m.tabId!==undefined&&m.tabId!==sender.tab?.id)throw new Error("A captura contextual pertence somente à aba de origem.");
        if(m.targetVideoId!==undefined&&(typeof m.targetVideoId!=="string"||!/^[-\w]{11}$/.test(m.targetVideoId)))throw new Error("ID do card inválido.");
        const tab = await chrome.tabs.get(Number(m.tabId ?? sender.tab?.id));
        if (!youtube(tab.url) || tab.id === undefined)
          throw new Error("Selecione uma aba YouTube/Studio.");
        if (capturing) throw new Error("Aguarde a captura atual terminar.");
        capturing = true;
        let previous: chrome.tabs.Tab | undefined;
        try {
          [previous] = await chrome.tabs.query({
            active: true,
            windowId: tab.windowId,
          });
          await chrome.tabs.update(tab.id, { active: true });
          await new Promise((r) => setTimeout(r, 180));
          const [active] = await chrome.tabs.query({
            active: true,
            windowId: tab.windowId,
          });
          if (active?.id !== tab.id || active.url !== tab.url)
            throw new Error("A aba mudou durante a captura. Tente novamente.");
          const kind = m.kind ?? "video";
          if (
            !["video", "analytics", "latest-performance"].includes(String(kind))
          )
            throw new Error("Tipo de captura inválido.");
          const measure = async () => {
            let value: unknown;
            try {
              value = await chrome.tabs.sendMessage(tab.id!, {
                type: "CAPTURE_CARD",
                kind,
                redact: Boolean(m.redact),
                ...(m.targetVideoId ? {targetVideoId:m.targetVideoId} : {}),
              });
            } catch {
              throw new Error(
                "Abra o painel Prevlev pela aba YouTube/Studio e recarregue a página para medir o card.",
              );
            }
            return captureMeasurement(value);
          };
          const capture = await measure();
          const [ready] = await chrome.tabs.query({
            active: true,
            windowId: tab.windowId,
          });
          if (ready?.id !== tab.id || ready.url !== tab.url)
            throw new Error("A aba mudou antes da captura. Tente novamente.");
          let dataUrl: string;
          try {
            dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
              format: "png",
            });
          } catch {
            throw new Error(
              "Clique no ícone Prevlev na aba YouTube/Studio e abra o painel por ele para conceder acesso à captura.",
            );
          }
          const [after] = await chrome.tabs.query({
            active: true,
            windowId: tab.windowId,
          });
          if (after?.id !== tab.id || after.url !== tab.url)
            throw new Error(
              "A aba mudou durante a captura. Imagem descartada.",
            );
          const measuredAfter = await measure();
          if (
            capture.captureStamp !== measuredAfter.captureStamp ||
            JSON.stringify([
              capture.rect,
              capture.redactions,
              capture.viewportWidth,
            ]) !==
              JSON.stringify([
                measuredAfter.rect,
                measuredAfter.redactions,
                measuredAfter.viewportWidth,
              ])
          )
            throw new Error(
              "A rolagem, o layout ou os campos sensíveis mudaram durante a captura. Imagem descartada.",
            );
          const [verified] = await chrome.tabs.query({
            active: true,
            windowId: tab.windowId,
          });
          if (verified?.id !== tab.id || verified.url !== tab.url)
            throw new Error(
              "A aba mudou durante a medição. Imagem descartada.",
            );
          return { status: "ok", dataUrl, capture };
        } finally {
          try {
            const [active] = await chrome.tabs.query({
              active: true,
              windowId: tab.windowId,
            });
            if (previous?.id && previous.id !== tab.id && active?.id === tab.id)
              await chrome.tabs.update(previous.id, { active: true });
          } finally {
            capturing = false;
          }
        }
      }
      throw new Error("Ação desconhecida.");
    };
    void run().then(sendResponse, (error) =>
      sendResponse({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return true;
  },
);
