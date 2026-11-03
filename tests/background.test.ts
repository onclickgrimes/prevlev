import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backendOrigin, callBackend } from "../src/shared/backend";
import { defaultSettings } from "../src/shared/types";

type Listener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean | void;
const extensionId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const extensionRoot = `chrome-extension://${extensionId}/`;
const tab = (id: number, url: string): chrome.tabs.Tab => ({
  id,
  url,
  windowId: 1,
  index: id,
  active: true,
  pinned: false,
  highlighted: true,
  incognito: false,
  selected: true,
  discarded: false,
  autoDiscardable: true,
  groupId: -1,
  frozen: false,
});
const first = tab(1, "https://www.youtube.com/watch?v=first");
const target = tab(2, "https://studio.youtube.com/video/target/edit");
const uiSender: chrome.runtime.MessageSender = {
  id: extensionId,
  url: `${extensionRoot}workspace.html`,
};
const contentSender: chrome.runtime.MessageSender = {
  id: extensionId,
  url: first.url,
  tab: first,
};
const baseMeasurement = {
  status: "ok",
  captureStamp: "stable-layout",
  rect: { x: 10, y: 20, width: 400, height: 200 },
  viewportWidth: 1280,
  redactions: [] as { x: number; y: number; width: number; height: number }[],
};

function chromeHarness() {
  let active = first;
  const addListener = vi.fn<(listener: Listener) => void>();
  const query = vi.fn(async () => [active]);
  const get = vi.fn(async (id: number) => (id === target.id ? target : first));
  const update = vi.fn(async (id: number) => {
    active = id === target.id ? target : first;
    return active;
  });
  const captureVisibleTab = vi.fn(async () => "data:image/png;base64,captured");
  const create = vi.fn(async () => target);
  const sendMessage = vi.fn(async () => ({ ...baseMeasurement }));
  const storageGet = vi.fn(async () => ({
    settings: {
      ...defaultSettings,
      backendUrl: "http://127.0.0.1:8787",
      backendToken: "local-token",
    },
  }));
  const runtime = {
    id: extensionId,
    getURL: vi.fn((path: string) => `${extensionRoot}${path}`),
    onMessage: { addListener },
  };
  const chromeApi = {
    runtime,
    tabs: { get, query, update, captureVisibleTab, create, sendMessage },
    storage: { local: { get: storageGet } },
  };
  return {
    chromeApi,
    addListener,
    get,
    query,
    update,
    captureVisibleTab,
    create,
    sendMessage,
    storageGet,
    runtime,
    setActive: (value: chrome.tabs.Tab) => {
      active = value;
    },
  };
}
let browser: ReturnType<typeof chromeHarness>;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
async function importBackground() {
  await import("../src/background");
  const listener = browser.addListener.mock.calls[0]?.[0];
  if (!listener) throw new Error("Listener não registrado");
  return listener;
}
async function send(listener: Listener, message: unknown, sender = uiSender) {
  const response = new Promise<unknown>((resolve) => {
    expect(listener(message, sender, resolve)).toBe(true);
  });
  await vi.advanceTimersByTimeAsync(250);
  return response;
}
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  browser = chromeHarness();
  vi.stubGlobal("chrome", browser.chromeApi);
  fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        status: "ok",
        source: "prevlev:test",
        data: { videoCount: 2 },
      }),
      { headers: { "Content-Type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("service worker e autorização de mensagens", () => {
  it("obtém thumbnail somente por ação confiável em CDN fixo, sem cookies ou redirecionamentos", async () => {
    const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGv8AAAAASUVORK5CYII=";
    fetcher.mockImplementation(async()=>new Response(Buffer.from(png,'base64'),{headers:{"Content-Type":"image/png"}}));
    const listener=await importBackground();
    expect(await send(listener,{type:"FETCH_THUMBNAIL",videoId:"abcdefghijk"},contentSender)).toMatchObject({status:"ok",dataUrl:`data:image/png;base64,${png}`});
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg");
    expect(fetcher.mock.calls[0][1]).toMatchObject({credentials:"omit",redirect:"error"});
  });
  it("recusa URL de thumbnail arbitrária e alvo de captura de outra aba antes de acessar dados",async()=>{
    const listener=await importBackground();
    expect(await send(listener,{type:"FETCH_THUMBNAIL",videoId:"https://secret.invalid"})).toMatchObject({status:"error"});
    expect(await send(listener,{type:"CAPTURE_SCREENSHOT",tabId:2},contentSender)).toMatchObject({status:"error"});
    expect(await send(listener,{type:"CAPTURE_SCREENSHOT",targetVideoId:"bad"})).toMatchObject({status:"error"});
    expect(fetcher).not.toHaveBeenCalled();expect(browser.get).not.toHaveBeenCalled();
  });

  it("apenas registra o listener ao importar: não consulta abas, armazenamento ou rede", async () => {
    await importBackground();
    expect(browser.addListener).toHaveBeenCalledTimes(1);
    for (const fn of [
      browser.get,
      browser.query,
      browser.update,
      browser.captureVisibleTab,
      browser.create,
      browser.sendMessage,
      browser.storageGet,
      browser.runtime.getURL,
      fetcher,
    ])
      expect(fn).not.toHaveBeenCalled();
  });
  it("ignora mensagens externas e entradas malformadas sem responder ou iniciar trabalho", async () => {
    const listener = await importBackground();
    const respond = vi.fn();
    expect(
      listener(
        { type: "OPEN_WORKSPACE" },
        { id: "outra-extensao", tab: first },
        respond,
      ),
    ).toBeUndefined();
    for (const message of [null, "REMOTE_ANALYZE", {}, 42])
      expect(listener(message, uiSender, respond)).toBeUndefined();
    expect(respond).not.toHaveBeenCalled();
    expect(browser.create).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("impede o content script de enviar dados ao backend", async () => {
    const listener = await importBackground();
    expect(
      await send(
        listener,
        { type: "REMOTE_ANALYZE", feature: "niche", payload: { videos: [] } },
        contentSender,
      ),
    ).toMatchObject({
      status: "error",
      error: expect.stringContaining("página da extensão"),
    });
    expect(browser.storageGet).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("permite a UI própria mesmo com sender.tab e usa credenciais explícitas do backend", async () => {
    const listener = await importBackground();
    expect(
      await send(
        listener,
        {
          type: "REMOTE_ANALYZE",
          feature: "niche",
          payload: { videos: [{ id: "one" }] },
        },
        { ...uiSender, tab: first },
      ),
    ).toMatchObject({ status: "ok", source: "prevlev:test" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8787/v1/analyze");
    expect(options).toMatchObject({
      method: "POST",
      credentials: "omit",
      redirect: "error",
      headers: { Authorization: "Bearer local-token" },
    });
    expect(JSON.parse(String(options?.body))).toEqual({
      feature: "niche",
      payload: { videos: [{ id: "one" }] },
    });
  });
  it("abre workspace só para UI própria ou content script em YouTube", async () => {
    const listener = await importBackground();
    expect(
      await send(
        listener,
        { type: "OPEN_WORKSPACE" },
        {
          id: extensionId,
          url: "https://example.com",
          tab: tab(9, "https://example.com"),
        },
      ),
    ).toMatchObject({ status: "error", error: "Origem não permitida." });
    expect(browser.create).not.toHaveBeenCalled();
    expect(
      await send(listener, { type: "OPEN_WORKSPACE" }, contentSender),
    ).toEqual({ status: "ok" });
    expect(browser.create).toHaveBeenCalledWith({
      url: `${extensionRoot}workspace.html?tab=1`,
    });
  });
});

describe("pesquisa pública iniciada pela UI própria", () => {
  it("nega pesquisa e amostragem originadas do content script antes da rede", async () => {
    const listener = await importBackground();
    expect(
      await send(
        listener,
        {
          type: "CHANNEL_RESEARCH",
          channelUrl: "https://www.youtube.com/@fixture",
        },
        contentSender,
      ),
    ).toMatchObject({ status: "error" });
    expect(
      await send(
        listener,
        { type: "SAMPLE_MONETIZATION", videos: [{ id: "aaaaaaaaaaa" }] },
        contentSender,
      ),
    ).toMatchObject({ status: "error" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("entrega cards públicos com cobertura explícita para UI própria com sender.tab", async () => {
    const html = `var ytInitialData = ${JSON.stringify({ videoRenderer: { videoId: "aaaaaaaaaaa", title: { simpleText: "Vídeo fixture" }, viewCountText: { simpleText: "10 views" } } })};`;
    fetcher.mockResolvedValueOnce(
      new Response(html, { headers: { "Content-Type": "text/html" } }),
    );
    const listener = await importBackground();
    const result = await send(
      listener,
      {
        type: "CHANNEL_RESEARCH",
        channelUrl: "https://www.youtube.com/@fixture",
        order: "popular",
      },
      { ...uiSender, tab: first },
    );
    expect(result).toMatchObject({
      status: "ok",
      data: {
        coverage: "initial-public-page",
        videos: [{ id: "aaaaaaaaaaa", views: 10 }],
      },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://www.youtube.com/@fixture/videos",
      expect.objectContaining({ credentials: "omit", redirect: "error" }),
    );
  });
  it("valida URL e máximo de amostras antes de buscar e mantém marcadores como inferência", async () => {
    const listener = await importBackground();
    expect(
      await send(listener, {
        type: "CHANNEL_RESEARCH",
        channelUrl: "https://evil.example/@fixture",
      }),
    ).toMatchObject({ status: "error" });
    expect(
      await send(listener, {
        type: "SAMPLE_MONETIZATION",
        videos: [{ id: "aaaaaaaaaaa" }],
        maxSamples: 6,
      }),
    ).toMatchObject({ status: "error" });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(
      new Response('{"adSlots":[{"slot":true}]}', {
        headers: { "Content-Type": "text/html" },
      }),
    );
    expect(
      await send(listener, {
        type: "SAMPLE_MONETIZATION",
        videos: [{ id: "aaaaaaaaaaa", url: "https://evil.example" }],
        maxSamples: 1,
      }),
    ).toMatchObject({
      status: "ok",
      data: {
        assessments: [
          {
            videoId: "aaaaaaaaaaa",
            status: "markers-present",
            confidence: "low",
            source: "public-youtube",
          },
        ],
      },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=aaaaaaaaaaa",
      expect.objectContaining({ credentials: "omit", redirect: "error" }),
    );
  });
});

describe("captura com validação da aba e recuperação", () => {
  it("captura somente a aba alvo validada e restaura a aba anterior", async () => {
    const listener = await importBackground();
    expect(
      await send(
        listener,
        { type: "CAPTURE_SCREENSHOT", tabId: 2 },
        { ...uiSender, tab: first },
      ),
    ).toEqual({
      status: "ok",
      dataUrl: "data:image/png;base64,captured",
      capture: baseMeasurement,
      tabContext:{tabId:target.id,url:target.url},
    });
    expect(browser.captureVisibleTab).toHaveBeenCalledWith(1, {
      format: "png",
    });
    expect(browser.update.mock.calls.map((call) => call[0])).toEqual([2, 1]);
    expect(browser.sendMessage).toHaveBeenCalledTimes(2);
    expect(browser.sendMessage).toHaveBeenCalledWith(2, {
      type: "CAPTURE_CARD",
      kind: "video",
      redact: false,
    });
    expect(browser.sendMessage.mock.invocationCallOrder[0]).toBeLessThan(
      browser.captureVisibleTab.mock.invocationCallOrder[0],
    );
    expect(browser.sendMessage.mock.invocationCallOrder[1]).toBeGreaterThan(
      browser.captureVisibleTab.mock.invocationCallOrder[0],
    );
  });
  it.each(["scroll", "layout", "redaction"])(
    "descarta a imagem quando %s muda sem mudança da URL",
    async (change) => {
      browser.sendMessage
        .mockResolvedValueOnce(baseMeasurement)
        .mockResolvedValueOnce({
          ...baseMeasurement,
          captureStamp: `${change}-changed`,
          ...(change === "redaction"
            ? { redactions: [{ x: 80, y: 30, width: 100, height: 20 }] }
            : {}),
        });
      const listener = await importBackground();
      const result = await send(listener, {
        type: "CAPTURE_SCREENSHOT",
        tabId: 2,
        kind: "analytics",
        redact: true,
      });
      expect(result).toMatchObject({
        status: "error",
        error: expect.stringContaining("Imagem descartada"),
      });
      expect(result).not.toHaveProperty("dataUrl");
      expect(browser.captureVisibleTab).toHaveBeenCalledOnce();
    },
  );
  it("interrompe antes da captura se a medição falhar ou não tiver revisão verificável", async () => {
    browser.sendMessage.mockResolvedValueOnce({
      ...baseMeasurement,
      captureStamp: "",
    });
    const listener = await importBackground();
    expect(
      await send(listener, { type: "CAPTURE_SCREENSHOT", tabId: 2 }),
    ).toMatchObject({
      status: "error",
      error: expect.stringContaining("Medição de captura incompatível"),
    });
    expect(browser.captureVisibleTab).not.toHaveBeenCalled();
  });
  it("descarta antes de capturar quando a página alvo navega durante a ativação", async () => {
    browser.query
      .mockResolvedValueOnce([first])
      .mockResolvedValueOnce([
        { ...target, url: "https://www.youtube.com/watch?v=other" },
      ]);
    const listener = await importBackground();
    expect(
      await send(listener, { type: "CAPTURE_SCREENSHOT", tabId: 2 }),
    ).toMatchObject({
      status: "error",
      error: expect.stringContaining("aba mudou"),
    });
    expect(browser.captureVisibleTab).not.toHaveBeenCalled();
  });
  it("descarta a imagem se a URL mudar durante a captura", async () => {
    browser.captureVisibleTab.mockImplementation(async () => {
      browser.setActive({
        ...target,
        url: "https://studio.youtube.com/video/different/edit",
      });
      return "data:image/png;base64,private";
    });
    const listener = await importBackground();
    const result = await send(listener, {
      type: "CAPTURE_SCREENSHOT",
      tabId: 2,
    });
    expect(result).toMatchObject({
      status: "error",
      error: expect.stringContaining("Imagem descartada"),
    });
    expect(result).not.toHaveProperty("dataUrl");
  });
  it("descarta imagem e preserva a nova seleção quando o usuário troca de aba", async () => {
    browser.captureVisibleTab.mockImplementation(async () => {
      browser.setActive(tab(3, "https://www.youtube.com/watch?v=third"));
      return "data:image/png;base64,private";
    });
    const listener = await importBackground();
    const result = await send(listener, {
      type: "CAPTURE_SCREENSHOT",
      tabId: 2,
    });
    expect(result).toMatchObject({
      status: "error",
      error: expect.stringContaining("Imagem descartada"),
    });
    expect(browser.update.mock.calls.map((call) => call[0])).toEqual([2]);
  });
  it("traduz recusa de captureVisibleTab para instrução acionável e libera outra captura", async () => {
    browser.captureVisibleTab.mockRejectedValueOnce(
      new Error("activeTab permission missing"),
    );
    const listener = await importBackground();
    expect(
      await send(listener, { type: "CAPTURE_SCREENSHOT", tabId: 2 }),
    ).toMatchObject({
      status: "error",
      error: expect.stringContaining("Clique no ícone Prevlev"),
    });
    expect(
      await send(listener, { type: "CAPTURE_SCREENSHOT", tabId: 2 }),
    ).toMatchObject({ status: "ok" });
  });
  it("libera a trava de captura se a consulta inicial da aba ativa falhar", async () => {
    browser.query.mockRejectedValueOnce(new Error("consulta indisponível"));
    const listener = await importBackground();
    expect(
      await send(listener, { type: "CAPTURE_SCREENSHOT", tabId: 2 }),
    ).toMatchObject({ status: "error" });
    expect(
      await send(listener, { type: "CAPTURE_SCREENSHOT", tabId: 2 }),
    ).toMatchObject({ status: "ok" });
  });
});

describe("cliente de backend próprio", () => {
  it("rejeita serviços Nexlev, credenciais, caminhos, parâmetros e HTTP remoto antes da rede", async () => {
    const invalid = [
      "https://api.nexlev.io",
      "https://nexlev.io",
      "https://u:senha@backend.example",
      "https://backend.example/v1",
      "https://backend.example?token=bad",
      "https://backend.example#secret",
      "http://backend.example",
      "ftp://backend.example",
    ];
    for (const backendUrl of invalid) {
      expect(() => backendOrigin(backendUrl)).toThrow();
      await expect(
        callBackend({ ...defaultSettings, backendUrl }, "niche", {}),
      ).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(backendOrigin("https://backend.example")).toBe(
      "https://backend.example",
    );
    expect(backendOrigin("http://localhost:8787")).toBe(
      "http://localhost:8787",
    );
  });
  it("retorna não configurado sem rede e recusa resposta fora do contrato", async () => {
    expect(await callBackend(defaultSettings, "niche", {})).toMatchObject({
      status: "not_configured",
    });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "invented", source: "unknown" })),
    );
    await expect(
      callBackend(
        { ...defaultSettings, backendUrl: "https://backend.example" },
        "niche",
        {},
      ),
    ).rejects.toThrow("contrato Prevlev");
  });
});
