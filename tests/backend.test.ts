import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createPrevlevServer } from "../server/index.mjs";
import { analyzeDataset } from "../server/analysis.mjs";
import { analyzeAi, validateProvider } from "../server/ai.mjs";

const servers: Server[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    ),
  );
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function start(options: Parameters<typeof createPrevlevServer>[0] = {}) {
  const server = createPrevlevServer(options);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const videos = [
  {
    id: "one",
    title: "Python para dados",
    channel: "Dados",
    channelId: "dados",
    views: 100,
    publishedAt: "2026-10-01T00:00:00Z",
    isShort: false,
  },
  {
    id: "two",
    title: "Python para iniciantes",
    channel: "Código",
    channelId: "codigo",
    views: 300,
    isShort: true,
  },
  {
    id: "three",
    title: "Como cozinhar arroz",
    channel: "Cozinha",
    channelId: "cozinha",
  },
];

describe("análises próprias com dados observados", () => {
  it("calcula cobertura sem inventar views ausentes e remove vídeos repetidos", async () => {
    const result = await analyzeDataset(
      "channel-report",
      { videos: [...videos, videos[0]] },
      { now: Date.parse("2026-10-02T00:00:00Z") },
    );
    expect(result.status).toBe("ok");
    expect(result.data).toMatchObject({
      videoCount: 3,
      knownViewCount: 2,
      totalObservedViews: 400,
      medianViews: 200,
      viewsCoverage: 2 / 3,
      shorts: 1,
      longForm: 1,
      formatUnknown: 1,
    });
    expect(JSON.stringify(result.data)).not.toMatch(/revenue|rpm|geography/);
  });
  it("ranqueia somente similares com palavras compartilhadas e exclui o próprio alvo", async () => {
    const result = await analyzeDataset("similar-videos", {
      videos,
      targetId: "one",
    });
    expect(result.data).toMatchObject({
      results: [{ id: "two", score: 1 / 3, shared: ["python"] }],
    });
  });
  it("agrupa canais com pontuação explicável e calcula termos do nicho", async () => {
    const result = await analyzeDataset("similar-channels", {
      videos,
      targetId: "dados",
    });
    expect(result.data).toMatchObject({
      results: [{ id: "codigo", score: 1 / 3 }],
    });
    expect((await analyzeDataset("niche", { videos })).data).toMatchObject({
      channelCount: 3,
      terms: expect.arrayContaining([{ term: "python", count: 2 }]),
    });
  });
  it("identifica apenas marcadores textuais de patrocínio, sem estimar receita", async () => {
    const result = await analyzeDataset("sponsorships", {
      text: "Tutorial de hoje. Este vídeo é patrocinado pela Exemplo. Obrigado!",
    });
    expect(result.data).toMatchObject({
      mentions: [{ excerpt: "Este vídeo é patrocinado pela Exemplo." }],
      estimatedRevenue: null,
    });
  });
  it("persiste observações reais concorrentes sem preencher passado", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "prevlev-history-"));
    directories.push(dataDir);
    const empty = await analyzeDataset(
      "view-history",
      { videoId: "abc" },
      { dataDir, now: 1000 },
    );
    expect(empty.data).toMatchObject({ observations: [] });
    await Promise.all([
      analyzeDataset(
        "view-history",
        { videoId: "abc", views: 50 },
        { dataDir, now: 1000 },
      ),
      analyzeDataset(
        "view-history",
        { videoId: "abc", views: 75 },
        { dataDir, now: 2000 },
      ),
    ]);
    const result = await analyzeDataset(
      "view-history",
      { videoId: "abc" },
      { dataDir, now: 3000 },
    );
    expect(result.data).toMatchObject({
      observations: [
        { observedAt: "1970-01-01T00:00:01.000Z", views: 50 },
        { observedAt: "1970-01-01T00:00:02.000Z", views: 75 },
      ],
    });
  });
  it("rejeita caminhos arbitrários e recursos desconhecidos", async () => {
    await expect(
      analyzeDataset(
        "view-history",
        { videoId: "../../secret" },
        { dataDir: "/tmp" },
      ),
    ).rejects.toThrow("videoId");
    expect(await analyzeDataset("inexistente", {})).toMatchObject({
      status: "unsupported",
    });
  });
});

describe("servidor HTTP real em loopback", () => {
  it("responde health e exige origem exata e token para análise", async () => {
    const origin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const base = await start({ token: "test-token", allowedOrigins: [origin] });
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect(
      (
        await fetch(`${base}/v1/analyze`, {
          method: "POST",
          headers: {
            Origin: "https://evil.example",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ feature: "niche", payload: { videos } }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${base}/v1/analyze`, {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(401);
    const result = await fetch(`${base}/v1/analyze`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify({ feature: "search-analysis", payload: { videos } }),
    });
    expect(result.status).toBe(200);
    expect(result.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(await result.json()).toMatchObject({
      status: "ok",
      data: { videoCount: 3 },
    });
  });
  it("rejeita bind público sem autenticação e origem com curinga", () => {
    expect(() => createPrevlevServer({ bind: "0.0.0.0" })).toThrow(
      "PREVLEV_TOKEN",
    );
    expect(() => createPrevlevServer({ allowedOrigins: ["*"] })).toThrow(
      "ALLOWED_ORIGINS",
    );
  });
  it("valida JSON, tipo de conteúdo, recurso e limite de corpo", async () => {
    const base = await start();
    const post = (body: string, contentType = "application/json") =>
      fetch(`${base}/v1/analyze`, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body,
      });
    expect((await post("{}", "text/plain")).status).toBe(415);
    expect((await post("bad")).status).toBe(400);
    expect(
      (await post(JSON.stringify({ feature: "unknown", payload: {} }))).status,
    ).toBe(422);
    expect(
      (
        await post(
          JSON.stringify({ feature: "niche", payload: { videos: [] } }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await post(JSON.stringify({ padding: "x".repeat(1024 * 1024) }))).status,
    ).toBe(413);
  });
  it("responde not_configured para IA sem fazer requisição externa", async () => {
    const fetcher = vi.fn();
    const server = createPrevlevServer({}, { fetcher });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const result = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/analyze`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feature: "comment-analysis",
          payload: { comments: [{ text: "Teste" }] },
        }),
      },
    );
    expect(await result.json()).toMatchObject({ status: "not_configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("aplica limite de análises por endereço", async () => {
    const base = await start();
    const statuses = [];
    for (let index = 0; index < 31; index++)
      statuses.push(
        (
          await fetch(`${base}/v1/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ feature: "niche", payload: { videos } }),
          })
        ).status,
      );
    expect(statuses.slice(0, 30).every((status) => status === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});

describe("adaptador de IA configurável sem consumo externo nos testes", () => {
  it("nega Nexlev, credenciais na URL, HTTP remoto e parâmetros", () => {
    for (const url of [
      "https://api.nexlev.io/v1",
      "http://ai.example/v1",
      "https://name:token@ai.example/v1",
      "https://ai.example/v1?token=bad",
    ])
      expect(() => validateProvider(url)).toThrow();
    expect(validateProvider("http://127.0.0.1:8080/v1/")).toBe(
      "http://127.0.0.1:8080/v1",
    );
  });
  it("envia contrato de chat ao provedor explícito e preserva resultado como gerado", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Resumo de exemplo" } }],
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      );
    const result = await analyzeAi(
      "transcript-summary",
      { transcript: [{ start: 0, text: "Conteúdo de teste" }] },
      { aiBaseUrl: "http://127.0.0.1:9000/v1", aiModel: "local-test" },
      fetcher,
    );
    expect(fetcher.mock.calls[0][0]).toBe(
      "http://127.0.0.1:9000/v1/chat/completions",
    );
    expect(result).toMatchObject({
      status: "ok",
      data: { text: "Resumo de exemplo", generated: true },
    });
    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(request.messages[0].role).toBe("system");
    expect(request.messages[1].content).toContain("Conteúdo de teste");
  });
  it("propaga falhas explícitas e rejeita resposta sem imagem", async () => {
    const failed = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 429 }));
    expect(
      await analyzeAi(
        "comment-analysis",
        { comments: [{ text: "teste" }] },
        { aiBaseUrl: "http://localhost:9000/v1", aiModel: "test" },
        failed,
      ),
    ).toMatchObject({
      status: "error",
      error: "O provedor de IA respondeu HTTP 429.",
    });
    const empty = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    await expect(
      analyzeAi(
        "thumbnail-generation",
        { prompt: "thumbnail original" },
        { aiBaseUrl: "http://localhost:9000/v1", aiImageModel: "test" },
        empty,
      ),
    ).rejects.toThrow("imagem compatível");
  });
});
