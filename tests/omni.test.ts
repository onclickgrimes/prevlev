import { describe, expect, it, vi } from "vitest";
import {
  analyzeOmni,
  discoverOmni,
  validateOmniBase,
} from "../server/omni.mjs";

// Synthetic transport fixtures only. No Omni process, account, quota or generation is contacted.
const origin = "http://127.0.0.1:7814";
const config = { omniBaseUrl: origin, omniApiKey: "server-only-test-key" };
const modelId = "fixture:text";
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function descriptor(id = modelId, overrides: Record<string, unknown> = {}) {
  return {
    id,
    owned_by: id.split(":")[0],
    x_omni: {
      label: "Modelo fixture",
      capabilities: {
        input_modalities: ["text"],
        output_modalities: ["text"],
        operations: ["responses", "chat.completions"],
        streaming: true,
        ...overrides,
      },
    },
  };
}
const catalog = (items: unknown[] = [descriptor()]) =>
  json({ object: "list", data: items });
const completed = (text = "Olá mundo", id = modelId) => ({
  status: "completed",
  model: id,
  output: [
    {
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text }],
    },
    {
      type: "reasoning",
      encrypted_content: "opaque-do-not-forward",
      summary: [],
    },
  ],
});
function transport(...responses: Response[]) {
  const fetcher = vi.fn<typeof fetch>();
  for (const response of responses) fetcher.mockResolvedValueOnce(response);
  return fetcher;
}
const payload = { model: modelId, text: "Transcrição de fixture" };
function frame(type: string, body: Record<string, unknown>, sequence: number) {
  return `event: ${type}\r\ndata: ${JSON.stringify({ type, sequence_number: sequence, ...body })}\r\n\r\n`;
}
function sse(value: string, byteSize = 7) {
  const encoded = new TextEncoder().encode(value);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < encoded.length; index += byteSize)
          controller.enqueue(encoded.slice(index, index + byteSize));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
  );
}
const artifactId = `artifact_${"a".repeat(32)}`;
const artifactPath = `/v1/artifacts/${artifactId}`;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZkAAAAASUVORK5CYII=",
  "base64",
);
const imageModel = "fixture:image";
const imageDescriptor = () =>
  descriptor(imageModel, {
    output_modalities: ["image"],
    operations: ["images.generate"],
    streaming: false,
  });
const artifact = (overrides: Record<string, unknown> = {}) => ({
  id: artifactId,
  object: "artifact",
  mime_type: "image/png",
  size: png.length,
  url: artifactPath,
  ...overrides,
});
const imageResult = (item = artifact()) =>
  json({ model: imageModel, data: [item] });
const imagePayload = {
  model: imageModel,
  prompt: "Thumbnail original sobre astronomia",
};

describe("origem e descoberta OmniProviders", () => {
  it("usa porta 7814, consulta catálogo autenticado e normaliza apenas capacidades explícitas", async () => {
    const fetcher = transport(
      catalog([
        descriptor(),
        imageDescriptor(),
        descriptor("fixture:input-image", {
          input_modalities: ["image"],
          output_modalities: ["text"],
        }),
      ]),
    );
    const result = await discoverOmni(
      { omniApiKey: config.omniApiKey },
      fetcher,
    );
    expect(result).toMatchObject({
      status: "ok",
      source: "prevlev:omni",
      data: {
        origin,
        models: [
          {
            id: modelId,
            provider: "fixture",
            label: "Modelo fixture",
            textSupported: true,
            imageSupported: false,
            streaming: true,
          },
          { id: imageModel, textSupported: false, imageSupported: true },
          {
            id: "fixture:input-image",
            textSupported: false,
            imageSupported: false,
          },
        ],
      },
    });
    expect(fetcher).toHaveBeenCalledWith(
      `${origin}/v1/models`,
      expect.objectContaining({
        method: "GET",
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer server-only-test-key",
        },
      }),
    );
    expect(JSON.stringify(result)).not.toContain(config.omniApiKey);
  });
  it("rejeita credenciais na URL, caminhos, parâmetros, Nexlev e HTTP remoto sem rede", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const omniBaseUrl of [
      "https://api.nexlev.io",
      "https://u:password@omni.example",
      "https://omni.example/v1",
      "https://omni.example?q=secret",
      "https://omni.example#key",
      "http://omni.example",
      "http://127.0.0.1:7814/../v1",
      "https://omni.example\\secret",
    ]) {
      expect(() => validateOmniBase(omniBaseUrl)).toThrow();
      expect(await discoverOmni({ omniBaseUrl }, fetcher)).toMatchObject({
        status: "not_configured",
      });
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(validateOmniBase("https://omni.example/")).toBe(
      "https://omni.example",
    );
    expect(validateOmniBase("http://[::1]:7814")).toBe("http://[::1]:7814");
  });
  it("omite IDs duplicados, indisponíveis e dados sem identidade válida sem inventar capacidades", async () => {
    const fetcher = transport(
      catalog([
        descriptor(),
        descriptor(),
        { ...descriptor("fixture:offline"), available: false },
        descriptor("bare-id"),
        {
          id: "fixture:unknown",
          owned_by: "fixture",
          x_omni: { label: "Desconhecido" },
        },
      ]),
    );
    const result = await discoverOmni(config, fetcher);
    expect(result).toMatchObject({
      status: "ok",
      data: {
        models: [
          {
            id: "fixture:unknown",
            inputModalities: [],
            outputModalities: [],
            operations: [],
            textSupported: false,
            imageSupported: false,
          },
        ],
        warnings: expect.arrayContaining([expect.stringContaining("omitidas")]),
      },
    });
  });
  it("sinaliza catálogo vazio ou incompatível sem tratar saldo e cota como conhecidos", async () => {
    expect(await discoverOmni(config, transport(catalog([])))).toMatchObject({
      status: "ok",
      data: { models: [], warnings: [expect.stringContaining("não comprova")] },
    });
    expect(
      await discoverOmni(config, transport(json({ models: [] }))),
    ).toMatchObject({
      status: "error",
      error: expect.stringContaining("Catálogo"),
    });
  });
  it("sanitiza indisponibilidade, autenticação e erros de limite sem ecoar corpo upstream", async () => {
    const secret = "Bearer PRIVATE_SECRET credential-file";
    for (const status of [401, 429, 503]) {
      const result = await discoverOmni(
        config,
        transport(new Response(secret, { status })),
      );
      expect(result.status).toBe(status === 429 ? "error" : "not_configured");
      expect(result.error).toContain(String(status));
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new Error(secret));
    const result = await discoverOmni(config, offline);
    expect(result).toMatchObject({ status: "not_configured" });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(offline).toHaveBeenCalledOnce();
  });
});

describe("modelo exato e geração de texto", () => {
  it("exige escolha explícita e vínculo da origem antes de qualquer consulta", async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(
      await analyzeOmni(
        "transcript-summary",
        { text: "Fixture" },
        config,
        fetcher,
      ),
    ).toMatchObject({ status: "not_configured" });
    expect(
      await analyzeOmni(
        "transcript-summary",
        { ...payload, expectedOrigin: "https://other.example" },
        config,
        fetcher,
      ),
    ).toMatchObject({
      status: "not_configured",
      error: expect.stringContaining("origem"),
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reconsulta catálogo antes de gerar, prefere Responses e não encaminha conteúdo opaco", async () => {
    const fetcher = transport(catalog(), json(completed()));
    const result = await analyzeOmni(
      "transcript-summary",
      { ...payload, expectedOrigin: origin },
      config,
      fetcher,
    );
    expect(result).toMatchObject({
      status: "ok",
      data: {
        text: "Olá mundo",
        model: modelId,
        generated: true,
        transport: "responses-json",
      },
    });
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      `${origin}/v1/models`,
      `${origin}/v1/responses`,
    ]);
    const request = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(request).toMatchObject({
      model: modelId,
      store: false,
      stream: false,
      input: [{ role: "user", content: JSON.stringify(payload.text) }],
    });
    for (const field of [
      "tools",
      "reasoning",
      "max_output_tokens",
      "parallel_tool_calls",
      "previous_response_id",
      "conversation",
    ])
      expect(request).not.toHaveProperty(field);
    expect(JSON.stringify(result)).not.toContain("opaque-do-not-forward");
  });
  it("não substitui modelo removido ou capacidade alterada depois da descoberta", async () => {
    const fetcher = transport(catalog(), catalog([]));
    expect((await discoverOmni(config, fetcher)).status).toBe("ok");
    expect(
      await analyzeOmni("transcript-summary", payload, config, fetcher),
    ).toMatchObject({ status: "unsupported" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const mismatch = transport(
      catalog([
        descriptor(modelId, {
          input_modalities: ["image"],
          output_modalities: ["text"],
        }),
      ]),
    );
    expect(
      await analyzeOmni("transcript-summary", payload, config, mismatch),
    ).toMatchObject({ status: "unsupported" });
    expect(mismatch).toHaveBeenCalledOnce();
  });
  it("usa chat JSON somente quando o catálogo oferece apenas chat e recusa suposição OpenRouter", async () => {
    const fetcher = transport(
      catalog([descriptor(modelId, { operations: ["chat.completions"] })]),
      json({
        model: modelId,
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: "Chat concluído" },
          },
        ],
      }),
    );
    expect(
      await analyzeOmni(
        "comment-analysis",
        { model: modelId, comments: [{ text: "Gostei" }] },
        config,
        fetcher,
      ),
    ).toMatchObject({
      status: "ok",
      data: { text: "Chat concluído", transport: "chat-json" },
    });
    expect(fetcher.mock.calls[1][0]).toBe(`${origin}/v1/chat/completions`);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({
      model: modelId,
      stream: false,
    });
    const router = transport(
      catalog([
        descriptor("openrouter:fixture", { operations: ["chat.completions"] }),
      ]),
    );
    expect(
      await analyzeOmni(
        "transcript-summary",
        { ...payload, model: "openrouter:fixture" },
        config,
        router,
      ),
    ).toMatchObject({ status: "unsupported" });
    expect(router).toHaveBeenCalledOnce();
  });
  it("recusa saída truncada, modelo trocado ou somente reasoning/ferramentas", async () => {
    for (const response of [
      { ...completed(), status: "incomplete" },
      { ...completed(), model: "fixture:other" },
      { ...completed(), error: { message: "PRIVATE_SECRET" } },
      {
        ...completed(),
        output: [
          ...completed().output,
          { type: "function_call", arguments: "PRIVATE_SECRET" },
        ],
      },
      {
        ...completed(),
        output: [
          { type: "reasoning", encrypted_content: "PRIVATE_SECRET" },
          { type: "function_call", arguments: "{}" },
        ],
      },
    ]) {
      const result = await analyzeOmni(
        "transcript-summary",
        payload,
        config,
        transport(catalog(), json(response)),
      );
      expect(result).toMatchObject({ status: "error" });
      expect(result).not.toHaveProperty("data");
      expect(JSON.stringify(result)).not.toContain("PRIVATE_SECRET");
    }
  });
  it("recusa payload sem texto e não reenvia geração após 429 ou falha de transporte", async () => {
    const empty = transport(catalog());
    expect(
      await analyzeOmni(
        "transcript-summary",
        { model: modelId, transcript: [{ text: "" }] },
        config,
        empty,
      ),
    ).toMatchObject({ status: "error" });
    expect(empty).not.toHaveBeenCalled();
    const rate = transport(
      catalog(),
      new Response("PRIVATE_SECRET", { status: 429 }),
    );
    const result = await analyzeOmni(
      "transcript-summary",
      payload,
      config,
      rate,
    );
    expect(result).toMatchObject({
      status: "error",
      error: expect.stringContaining("429"),
    });
    expect(rate).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SECRET");
  });
});

describe("Responses SSE incremental estrito", () => {
  it("decodifica UTF-8 e CRLF divididos e usa apenas o resultado terminal consolidado", async () => {
    const stream =
      frame("response.created", { response: { status: "in_progress" } }, 0) +
      frame("response.output_text.delta", { delta: "Olá " }, 1) +
      frame("response.output_text.delta", { delta: "mundo" }, 2) +
      frame("response.output_text.done", { text: "Olá mundo" }, 3) +
      frame("response.completed", { response: completed() }, 4);
    const fetcher = transport(catalog(), sse(stream, 1));
    expect(
      await analyzeOmni(
        "transcript-summary",
        { ...payload, stream: true },
        config,
        fetcher,
      ),
    ).toMatchObject({
      status: "ok",
      data: { text: "Olá mundo", transport: "responses-sse" },
    });
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({
      store: false,
      stream: true,
    });
  });
  it("rejeita streaming sem capacidade ou em modelo somente chat antes do POST", async () => {
    for (const overrides of [
      { streaming: false },
      { operations: ["chat.completions"] },
    ]) {
      const fetcher = transport(catalog([descriptor(modelId, overrides)]));
      expect(
        await analyzeOmni(
          "transcript-summary",
          { ...payload, stream: true },
          config,
          fetcher,
        ),
      ).toMatchObject({ status: "unsupported" });
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });
  it.each([
    "response.failed",
    "response.incomplete",
    "EOF",
    "after-completion",
    "duplicate-completion",
  ])("descarta trechos parciais em %s sem repetir a geração", async (kind) => {
    let stream = frame(
      "response.output_text.delta",
      { delta: "PRIVATE_PARTIAL" },
      0,
    );
    if (kind === "after-completion" || kind === "duplicate-completion")
      stream +=
        frame("response.completed", { response: completed() }, 1) +
        (kind === "after-completion"
          ? frame("response.output_text.delta", { delta: "extra" }, 2)
          : frame("response.completed", { response: completed() }, 2));
    else if (kind !== "EOF")
      stream += frame(
        kind,
        {
          response: {
            status: kind === "response.failed" ? "failed" : "incomplete",
            error: { message: "PRIVATE_SECRET" },
          },
        },
        1,
      );
    const fetcher = transport(catalog(), sse(stream));
    const result = await analyzeOmni(
      "transcript-summary",
      { ...payload, stream: true },
      config,
      fetcher,
    );
    expect(result).toMatchObject({ status: "error" });
    expect(result).not.toHaveProperty("data");
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE_SECRET|PRIVATE_PARTIAL/,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("recusa evento incompleto, tipo divergente e sequência regressiva", async () => {
    const invalid = [
      frame("response.completed", { response: completed() }, 0).trimEnd(),
      `event: response.completed\ndata: {"type":"response.failed"}\n\n`,
      frame("response.created", {}, 2) +
        frame("response.completed", { response: completed() }, 1),
    ];
    for (const stream of invalid)
      expect(
        await analyzeOmni(
          "transcript-summary",
          { ...payload, stream: true },
          config,
          transport(catalog(), sse(stream)),
        ),
      ).toMatchObject({ status: "error" });
  });
});

describe("imagem Omni via artefato autenticado na mesma origem", () => {
  it("envia n1 e aspectRatio16:9 e normaliza bytes sem URL ou chave para o browser", async () => {
    const fetcher = transport(
      catalog([imageDescriptor()]),
      imageResult(),
      new Response(png, { headers: { "Content-Type": "image/png" } }),
    );
    const result = await analyzeOmni(
      "thumbnail-generation",
      imagePayload,
      config,
      fetcher,
    );
    expect(result).toMatchObject({
      status: "ok",
      data: {
        model: imageModel,
        generated: true,
        images: [{ mime: "image/png", base64: png.toString("base64") }],
      },
    });
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      `${origin}/v1/models`,
      `${origin}/v1/images/generations`,
      `${origin}${artifactPath}`,
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
      model: imageModel,
      prompt: imagePayload.prompt,
      n: 1,
      aspectRatio: "16:9",
    });
    expect(fetcher.mock.calls[2][1]).toMatchObject({
      method: "GET",
      redirect: "error",
      credentials: "omit",
      headers: { Authorization: "Bearer server-only-test-key" },
    });
    expect(JSON.stringify(result)).not.toContain("server-only-test-key");
    expect(JSON.stringify(result)).not.toContain("/v1/artifacts/");
  });
  it("nega modelo sem operação/capacidade de imagem e não gera ao pedir stream", async () => {
    for (const item of [
      descriptor(imageModel, {
        output_modalities: ["image"],
        operations: ["responses"],
      }),
      descriptor(imageModel, {
        output_modalities: ["text"],
        operations: ["images.generate"],
      }),
      descriptor(imageModel, {
        input_modalities: ["image"],
        output_modalities: ["image"],
        operations: ["images.generate"],
      }),
    ]) {
      const fetcher = transport(catalog([item]));
      expect(
        await analyzeOmni(
          "thumbnail-generation",
          imagePayload,
          config,
          fetcher,
        ),
      ).toMatchObject({ status: "unsupported" });
      expect(fetcher).toHaveBeenCalledOnce();
    }
    const fetcher = transport(catalog([imageDescriptor()]));
    expect(
      await analyzeOmni(
        "thumbnail-generation",
        { ...imagePayload, stream: true },
        config,
        fetcher,
      ),
    ).toMatchObject({ status: "unsupported" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([
    "https://evil.example" + artifactPath,
    `${artifactPath}?key=secret`,
    `${artifactPath}/../other`,
    `${origin}/v1/artifacts/other`,
    `//evil.example${artifactPath}`,
  ])("não busca URL de artefato recusada: %s", async (url) => {
    const fetcher = transport(
      catalog([imageDescriptor()]),
      imageResult(artifact({ url })),
    );
    expect(
      await analyzeOmni("thumbnail-generation", imagePayload, config, fetcher),
    ).toMatchObject({ status: "error" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("recusa MIME não suportado, assinatura falsa e imagem acima de16MiB", async () => {
    const cases = [
      new Response("<html>PRIVATE_SECRET</html>", {
        headers: { "Content-Type": "text/html" },
      }),
      new Response("not PNG", { headers: { "Content-Type": "image/png" } }),
      new Response(png, {
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(16 * 1024 * 1024 + 1),
        },
      }),
    ];
    for (const response of cases) {
      const result = await analyzeOmni(
        "thumbnail-generation",
        imagePayload,
        config,
        transport(catalog([imageDescriptor()]), imageResult(), response),
      );
      expect(result).toMatchObject({ status: "error" });
      expect(result).not.toHaveProperty("data");
      expect(JSON.stringify(result)).not.toContain("PRIVATE_SECRET");
    }
  });
  it("recusa identificador inválido e metadados que anunciam modelo diferente sem buscar arquivo", async () => {
    const fetcher = transport(
      catalog([imageDescriptor()]),
      imageResult(artifact({ id: "../../secret" })),
    );
    expect(
      await analyzeOmni("thumbnail-generation", imagePayload, config, fetcher),
    ).toMatchObject({ status: "error" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const changed = transport(
      catalog([imageDescriptor()]),
      json({ model: "fixture:other", data: [artifact()] }),
    );
    expect(
      await analyzeOmni("thumbnail-generation", imagePayload, config, changed),
    ).toMatchObject({ status: "error" });
    expect(changed).toHaveBeenCalledTimes(2);
  });
  it("recusa um PNG pequeno com dimensões acima de32MP antes de retornar bytes", async () => {
    const oversized = Buffer.from(png);
    oversized.writeUInt32BE(8000, 16);
    oversized.writeUInt32BE(8000, 20);
    const fetcher = transport(
      catalog([imageDescriptor()]),
      imageResult(),
      new Response(oversized, { headers: { "Content-Type": "image/png" } }),
    );
    const result = await analyzeOmni("thumbnail-generation", imagePayload, config, fetcher);
    expect(oversized.byteLength).toBeLessThan(100);
    expect(result).toMatchObject({ status: "error", error: expect.stringContaining("32 milhões") });
    expect(result).not.toHaveProperty("data");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("recusa múltiplos artefatos sem truncar ou buscar a primeira imagem", async () => {
    const fetcher = transport(catalog([imageDescriptor()]), json({ model: imageModel, data: [artifact(), artifact()] }));
    expect(await analyzeOmni("thumbnail-generation", imagePayload, config, fetcher)).toMatchObject({ status: "error" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("limites e cancelamento sem acesso real a serviço", () => {
  it("inclui catálogo no prazo total e não aceita geração tardia após reiniciar a espera", async () => {
    vi.useFakeTimers();
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation((milliseconds) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), milliseconds);
        return controller.signal;
      });
    try {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => setTimeout(() => resolve(catalog()), 70)),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve(json(completed("Resposta tardia"))), 70),
            ),
        );
      let result: Awaited<ReturnType<typeof analyzeOmni>> | undefined;
      const operation = analyzeOmni(
        "transcript-summary",
        payload,
        { omniTimeoutMs: 100 },
        fetcher,
      ).then((value) => {
        result = value;
      });
      await vi.advanceTimersByTimeAsync(110);
      expect(result).toMatchObject({
        status: "error",
        error: expect.stringContaining("Tempo limite"),
      });
      expect(result).not.toHaveProperty("data");
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls[1][1]?.signal?.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(100);
      await operation;
      expect(result).not.toHaveProperty("data");
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      timeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });
  it("interrompe catálogo que não resolve mesmo se o transporte simulado ignorar o signal", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() => new Promise(() => {}));
    const result = await discoverOmni({ omniTimeoutMs: 5 }, fetcher);
    expect(result).toMatchObject({
      status: "error",
      error: expect.stringContaining("Tempo limite"),
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("interrompe leitura de stream travado sem retornar texto parcial", async () => {
    const pending = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              frame(
                "response.output_text.delta",
                { delta: "PRIVATE_PARTIAL" },
                0,
              ),
            ),
          );
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
    const fetcher = transport(catalog(), pending);
    const result = await analyzeOmni(
      "transcript-summary",
      { ...payload, stream: true },
      { omniTimeoutMs: 15 },
      fetcher,
    );
    expect(result).toMatchObject({
      status: "error",
      error: expect.stringContaining("Tempo limite"),
    });
    expect(result).not.toHaveProperty("data");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("recusa catálogo com tamanho excessivo e JSON malformado sem ecoar conteúdo", async () => {
    const declared = new Response("{}", {
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(1024 * 1024 + 1),
      },
    });
    expect(await discoverOmni(config, transport(declared))).toMatchObject({
      status: "error",
      error: expect.stringContaining("limite"),
    });
    const invalid = new Response("PRIVATE_SECRET", {
      headers: { "Content-Type": "application/json" },
    });
    const result = await discoverOmni(config, transport(invalid));
    expect(result).toMatchObject({
      status: "error",
      error: expect.stringContaining("JSON inválido"),
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SECRET");
  });
});
