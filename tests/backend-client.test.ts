import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backendOrigin,
  callBackend,
  fetchAiCatalog,
} from "../src/shared/backend";
import { defaultSettings, type AiCatalogData } from "../src/shared/types";

const settings = {
  ...defaultSettings,
  backendUrl: "http://127.0.0.1:8787",
  backendToken: "fixture-prevlev-token",
  aiModel: "fixture:text",
  aiOrigin: "http://127.0.0.1:7814",
  aiStreaming: true,
};
const catalogue: AiCatalogData = {
  origin: "http://127.0.0.1:7814",
  models: [
    {
      id: "fixture:text",
      provider: "fixture",
      label: "Texto fixture",
      inputModalities: ["text"],
      outputModalities: ["text"],
      operations: ["responses"],
      streaming: true,
      textSupported: true,
      imageSupported: false,
    },
  ],
  warnings: ["Catálogo não comprova saldo."],
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("cliente browser para a ponte Prevlev/Omni, sem rede real", () => {
  it("observa somente tentativas de fetch iniciadas, sem presumir recebimento ou repetir falhas", async () => {
    const events: string[] = [], observer = vi.fn(() => { events.push('dispatch'); });
    const fetcher = vi.fn<typeof fetch>(async () => { events.push('fetch'); throw new Error('fixture offline'); });
    vi.stubGlobal('fetch',fetcher);
    await callBackend(defaultSettings,'transcript-summary',{text:'fixture'},observer);
    await expect(callBackend({...settings,backendUrl:'https://invalid.test/path'},'transcript-summary',{},observer)).rejects.toThrow();
    const circular: Record<string,unknown>={};circular.self=circular;
    await expect(callBackend(settings,'transcript-summary',circular,observer)).rejects.toThrow();
    expect(observer).not.toHaveBeenCalled();
    await expect(callBackend(settings,'transcript-summary',{text:'fixture'},observer)).rejects.toThrow('incerto');
    expect(events).toEqual(['dispatch','fetch']);expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("limita JSON de imagens antes da leitura e cancela stream que excede o teto sem repetir",async()=>{
    const cancel=vi.fn();let reads=0;
    const hugeHeader=new Response(new ReadableStream({cancel}),{headers:{'content-length':String(24*1024*1024+1)}});
    const streamed=new Response(new ReadableStream({pull(controller){reads++;controller.enqueue(new Uint8Array(1024*1024));},cancel}));
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(hugeHeader).mockResolvedValueOnce(streamed);vi.stubGlobal('fetch',fetcher);
    await expect(callBackend(settings,'thumbnail-generation',{prompt:'fixture'})).rejects.toThrow('limite de leitura');
    await expect(callBackend(settings,'thumbnail-generation',{prompt:'fixture'})).rejects.toThrow('limite de leitura');
    expect(reads).toBeLessThanOrEqual(27);expect(cancel).toHaveBeenCalledTimes(2);expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("não consulta nem gera antes de configurar o backend", async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    expect(await fetchAiCatalog(defaultSettings)).toMatchObject({
      status: "not_configured",
    });
    expect(
      await callBackend(defaultSettings, "transcript-summary", {
        text: "Texto fixture",
      }),
    ).toMatchObject({ status: "not_configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("recusa credenciais, parâmetros e destinos não permitidos antes de enviar token", async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    for (const backendUrl of [
      "https://u:secret@prevlev.example",
      "https://prevlev.example?token=secret",
      "https://prevlev.example/#secret",
      "https://prevlev.example/v1",
      "http://remote.example",
      "https://api.nexlev.io",
    ]) {
      expect(() => backendOrigin(backendUrl)).toThrow();
      await expect(
        fetchAiCatalog({ ...settings, backendUrl }),
      ).rejects.toThrow();
      await expect(
        callBackend({ ...settings, backendUrl }, "comment-analysis", {
          comments: [],
        }),
      ).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("consulta somente o catálogo do próprio backend com bearer separado e sem cookies", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        json({ status: "ok", source: "prevlev:omni", data: catalogue }),
      );
    vi.stubGlobal("fetch", fetcher);
    expect(await fetchAiCatalog(settings)).toMatchObject({
      status: "ok",
      data: catalogue,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/v1/ai/catalog",
      expect.objectContaining({
        headers: { Authorization: "Bearer fixture-prevlev-token" },
        credentials: "omit",
        redirect: "error",
      }),
    );
    const [url, request] = fetcher.mock.calls[0];
    expect(String(url)).not.toContain(settings.backendToken);
    expect(String(url)).not.toContain(":7814");
    expect(request).not.toHaveProperty("body");
  });
  it("permite backend local sem token configurado sem criar Authorization fictícia", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        json({ status: "ok", source: "prevlev:omni", data: catalogue }),
      );
    vi.stubGlobal("fetch", fetcher);
    await fetchAiCatalog({ ...settings, backendToken: "" });
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({});
  });
  it("valida envelope e capacidades em vez de aceitar dados arbitrários como catálogo", async () => {
    const invalid = [
      { models: [] },
      { status: "ok", source: "prevlev:omni" },
      {
        status: "ok",
        source: "prevlev:omni",
        data: { ...catalogue, models: [{ id: "fixture:invalid" }] },
      },
      {
        status: "ok",
        source: "prevlev:omni",
        data: { ...catalogue, warnings: "inválido" },
      },
    ];
    const fetcher = vi.fn<typeof fetch>();
    for (const value of invalid) fetcher.mockResolvedValueOnce(json(value));
    vi.stubGlobal("fetch", fetcher);
    for (const _value of invalid)
      await expect(fetchAiCatalog(settings)).rejects.toThrow(
        /[Cc]atálogo|capacidades/,
      );
  });
  it("recusa modelos nulos, identidade divergente e capacidades positivas sem contrato correspondente", async () => {
    const model = catalogue.models[0];
    const invalid = [
      null,
      { ...model, id: "sem-dois-pontos" },
      { ...model, provider: "outro" },
      { ...model, inputModalities: ["image"] },
      { ...model, outputModalities: [] },
      { ...model, operations: [] },
      { ...model, imageSupported: true },
      { ...model, operations: [42] },
    ];
    const fetcher = vi.fn<typeof fetch>();
    for (const entry of invalid)
      fetcher.mockResolvedValueOnce(
        json({
          status: "ok",
          source: "prevlev:omni",
          data: { ...catalogue, models: [entry] },
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    for (const _entry of invalid)
      await expect(fetchAiCatalog(settings)).rejects.toThrow(
        "capacidades válidas",
      );
    expect(fetcher).toHaveBeenCalledTimes(invalid.length);
  });
  it("não revela trechos do corpo inválido ao falhar o JSON do catálogo ou de uma geração", async () => {
    const secret = "PRIVATE_KEY_FROM_PROVIDER";
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () =>
          new Response(`${secret} não é JSON`, {
            headers: { "Content-Type": "application/json" },
          }),
      );
    vi.stubGlobal("fetch", fetcher);
    const catalogError = await fetchAiCatalog(settings).catch(
      (error: unknown) => error,
    );
    expect(catalogError).toBeInstanceOf(Error);
    expect(String(catalogError)).toContain("Nenhuma geração foi solicitada");
    expect(String(catalogError)).not.toContain(secret);
    expect(fetcher).toHaveBeenCalledOnce();
    const analysisError = await callBackend(settings, "transcript-summary", {
      text: "Fixture",
      model: "fixture:text",
    }).catch((error: unknown) => error);
    expect(analysisError).toBeInstanceOf(Error);
    expect(String(analysisError)).toContain(
      "resultado da solicitação é incerto",
    );
    expect(String(analysisError)).toContain("nenhuma repetição foi enviada");
    expect(String(analysisError)).not.toContain(secret);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("não repete geração nem ecoa segredo quando a conexão falha após o envio", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("PRIVATE_KEY_FROM_PROVIDER"));
    vi.stubGlobal("fetch", fetcher);
    const error = await callBackend(settings, "comment-analysis", {
      comments: [{ text: "Fixture" }],
      model: "fixture:text",
    }).catch((error: unknown) => error);
    expect(String(error)).toContain("resultado da solicitação é incerto");
    expect(String(error)).toContain("nenhuma repetição foi enviada");
    expect(String(error)).not.toContain("PRIVATE_KEY_FROM_PROVIDER");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("preserva erro de autenticação do backend e explica offline sem ecoar erro de transporte", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json(
          {
            status: "error",
            source: "prevlev:backend",
            error: "Token Prevlev inválido (HTTP 401).",
          },
          401,
        ),
      )
      .mockRejectedValueOnce(new Error("PRIVATE_OMNI_KEY=never-show"));
    vi.stubGlobal("fetch", fetcher);
    expect(await fetchAiCatalog(settings)).toMatchObject({
      status: "error",
      error: "Token Prevlev inválido (HTTP 401).",
    });
    await expect(fetchAiCatalog(settings)).rejects.toThrow(
      "backend Prevlev está offline",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("envia o modelo exato e dados da tarefa ao backend, sem buscar a origem Omni no navegador", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        json({
          status: "ok",
          source: "prevlev:omni",
          data: {
            text: "Resultado fixture",
            model: "fixture:text",
            generated: true,
          },
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const payload = {
      text: "Transcrição fixture",
      model: settings.aiModel,
      stream: settings.aiStreaming,
      expectedOrigin: settings.aiOrigin,
    };
    expect(
      await callBackend(settings, "transcript-summary", payload),
    ).toMatchObject({ status: "ok" });
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8787/v1/analyze");
    expect(request).toMatchObject({
      method: "POST",
      credentials: "omit",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer fixture-prevlev-token",
      },
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      feature: "transcript-summary",
      payload,
    });
    expect(String(request?.body)).not.toContain(settings.backendToken);
    expect(String(url)).not.toContain(":7814");
  });
  it("aguarda o limite servidor de IA sem impor o antigo timeout de 45 segundos", async () => {
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockImplementation(async (url) =>
          json({
            status: "ok",
            source: "prevlev:backend",
            data: String(url).endsWith("/catalog") ? catalogue : {},
          }),
        ),
    );
    await callBackend(settings, "transcript-topics", {
      model: "fixture:text",
      text: "Fixture",
    });
    expect(timeout).toHaveBeenLastCalledWith(305000);
    await callBackend(settings, "channel-report", { videos: [] });
    expect(timeout).toHaveBeenLastCalledWith(45000);
    await fetchAiCatalog(settings);
    expect(timeout).toHaveBeenLastCalledWith(30000);
  });
});
