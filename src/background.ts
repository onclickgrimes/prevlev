import { getSettings } from "./shared/storage";
import { callBackend } from "./shared/backend";
import type { RemoteFeature, VideoRecord } from "./shared/types";
import { enrichChannels } from "./core/enrichment";
const ownUi = (sender: chrome.runtime.MessageSender) =>
  sender.id === chrome.runtime.id &&
  sender.url?.startsWith(chrome.runtime.getURL(""));
const youtube = (url?: string) =>
  !!url && /^https:\/\/(www|studio)\.youtube\.com\//.test(url);
let capturing = false;
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
      if (m.type === "CAPTURE_SCREENSHOT") {
        if (!ownUi(sender) && !youtube(sender.tab?.url))
          throw new Error("Origem não permitida.");
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
          return { status: "ok", dataUrl };
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
