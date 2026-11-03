import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { analyzeDataset } from "./analysis.mjs";
import { analyzeAi, isAiFeature, validateProvider } from "./ai.mjs";
import { discoverOmni, validateOmniBase } from "./omni.mjs";
import { searchYouTube } from "./youtube.mjs";
import { handleLibrary } from "./library.mjs";
import { handleHistory } from "./history.mjs";

const loopback = (bind) => ["127.0.0.1", "localhost", "::1"].includes(bind);
export function configFromEnv(env = process.env) {
  return {
    bind: env.BIND ?? "127.0.0.1",
    port: Number(env.PORT ?? 8787),
    token: env.PREVLEV_TOKEN ?? "",
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    dataDir: resolve(env.DATA_DIR ?? "data/history"),
    youtubeEnabled: env.YOUTUBE_ENABLED === "true",
    youtubeApiKey: env.YOUTUBE_API_KEY ?? "",
    historyMaxRecords: Number(env.HISTORY_MAX_RECORDS ?? 5000),
    mcpEnabled: env.MCP_ENABLED === "true",
    aiProvider: env.AI_PROVIDER ?? "omni",
    omniBaseUrl: env.OMNI_BASE_URL ?? "http://127.0.0.1:7814",
    omniApiKey: env.OMNI_API_KEY ?? "",
    omniTimeoutMs: Number(env.OMNI_TIMEOUT_MS ?? 120000),
    aiBaseUrl: env.AI_BASE_URL ?? "",
    aiApiKey: env.AI_API_KEY ?? "",
    aiModel: env.AI_MODEL ?? "",
    aiImageModel: env.AI_IMAGE_MODEL ?? "",
  };
}
function validConfig(config) {
  if (!loopback(config.bind) && !config.token)
    throw new Error("PREVLEV_TOKEN é obrigatório ao escutar fora do loopback.");
  if (typeof config.youtubeEnabled !== "boolean" || typeof config.mcpEnabled !== "boolean")
    throw new Error("YOUTUBE_ENABLED e MCP_ENABLED exigem configuração booleana explícita.");
  if (!Number.isInteger(config.historyMaxRecords) || config.historyMaxRecords < 1 || config.historyMaxRecords > 5000)
    throw new Error("HISTORY_MAX_RECORDS deve ser um inteiro entre 1 e 5000.");
  if (!["omni", "openai-compatible"].includes(config.aiProvider))
    throw new Error("AI_PROVIDER deve ser omni ou openai-compatible.");
  if (config.aiProvider === "omni") {
    validateOmniBase(config.omniBaseUrl);
    if (
      !Number.isInteger(config.omniTimeoutMs) ||
      config.omniTimeoutMs < 1 ||
      config.omniTimeoutMs > 300000
    )
      throw new Error(
        "OMNI_TIMEOUT_MS deve ser um inteiro entre 1 e 300000 milissegundos.",
      );
  } else if (config.aiBaseUrl) validateProvider(config.aiBaseUrl);
  for (const origin of config.allowedOrigins) {
    let exactHttps = false;
    try {
      const url = new URL(origin);
      exactHttps =
        url.protocol === "https:" &&
        url.origin === origin &&
        !url.username &&
        !url.password;
    } catch {
      /* Rejected below. */
    }
    if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin) && !exactHttps)
      throw new Error(
        "ALLOWED_ORIGINS deve conter origens exatas de extensão ou HTTPS, sem curingas.",
      );
  }
}
const source = "prevlev:backend";
function authorized(header, token) {
  if (!token) return true;
  const expected = Buffer.from(`Bearer ${token}`),
    actual = Buffer.from(header ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function createPrevlevServer(options = {}, dependencies = {}) {
  const config = { ...configFromEnv({}), ...options };
  validConfig(config);
  const rates = new Map();
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Origin");
    const respond = (status, data) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status);
      res.end(JSON.stringify(data));
    };
    const origin = req.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin))
      return respond(403, {
        status: "error",
        source,
        error:
          "Origem não autorizada; configure ALLOWED_ORIGINS com o ID exato da extensão.",
      });
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization",
      );
      return respond(204, {});
    }
    if (req.url === "/health" && req.method === "GET")
      return respond(200, {
        status: "ok",
        source,
        data: {
          version: "0.6.3",
          youtubeEnabled: config.youtubeEnabled,
          youtubeConfigured: config.youtubeEnabled && Boolean(config.youtubeApiKey),
          youtubeSource: "youtube-data-api",
          youtubeReachable: null,
          historyMaxRecords: config.historyMaxRecords,
          mcpEnabled: config.mcpEnabled,
          aiProvider: config.aiProvider,
          aiOrigin:
            config.aiProvider === "omni"
              ? validateOmniBase(config.omniBaseUrl)
              : config.aiBaseUrl
                ? new URL(validateProvider(config.aiBaseUrl)).origin
                : null,
          aiConfigurationConfigured:
            config.aiProvider === "omni"
              ? Boolean(config.omniBaseUrl)
              : Boolean(config.aiBaseUrl),
          aiReachable: null,
          aiSelectionRequired: config.aiProvider === "omni",
          aiTextConfigured:
            config.aiProvider === "openai-compatible" &&
            Boolean(config.aiBaseUrl && config.aiModel),
          aiImageConfigured:
            config.aiProvider === "openai-compatible" &&
            Boolean(config.aiBaseUrl && config.aiImageModel),
        },
      });
    const catalogRequest = req.url === "/v1/ai/catalog" && req.method === "GET";
    const analysisRequest = req.url === "/v1/analyze" && req.method === "POST";
    const youtubeRequest = req.url === "/v1/youtube/search" && req.method === "POST";
    const historyRequest = req.url === "/v1/history" && req.method === "POST";
    const libraryRequest = req.url === "/v1/library" && req.method === "POST";
    if (!catalogRequest && !analysisRequest && !youtubeRequest && !historyRequest && !libraryRequest)
      return respond(404, {
        status: "error",
        source,
        error: "Rota não encontrada.",
      });
    if (!authorized(req.headers.authorization, config.token))
      return respond(401, {
        status: "error",
        source,
        error: "Token do backend inválido.",
      });
    const now = Date.now(),
      key = req.socket.remoteAddress ?? "unknown",
      rate = rates.get(key);
    if (!rate || now - rate.start >= 60000)
      rates.set(key, { start: now, count: 1 });
    else if (++rate.count > 30)
      return respond(429, {
        status: "error",
        source,
        error: "Limite de 30 solicitações por minuto.",
      });
    if (rates.size > 1000)
      for (const [address, value] of rates)
        if (now - value.start > 60000) rates.delete(address);
    if (
      !catalogRequest &&
      !(req.headers["content-type"] ?? "").startsWith("application/json")
    )
      return respond(415, {
        status: "error",
        source,
        error: "Use Content-Type: application/json.",
      });
    const requestAbortController = new AbortController();
    const abortRequest = () => requestAbortController.abort();
    const abortClosedResponse = () => {
      if (!res.writableEnded) requestAbortController.abort();
    };
    if (youtubeRequest) {
      req.once("aborted", abortRequest);
      res.once("close", abortClosedResponse);
      if (req.aborted || res.destroyed) requestAbortController.abort();
    }
    try {
      if (catalogRequest) {
        if (
          req.headers["transfer-encoding"] ||
          Number(req.headers["content-length"] ?? 0) > 0
        )
          return respond(400, {
            status: "error",
            source,
            error: "A consulta de catálogo não aceita corpo.",
          });
        const result =
          config.aiProvider === "omni"
            ? await discoverOmni(config, dependencies.fetcher)
            : {
                status: "unsupported",
                source: "prevlev:ai",
                error:
                  "O catálogo Omni exige AI_PROVIDER=omni. O modo openai-compatible usa os modelos configurados explicitamente no servidor.",
              };
        return respond(result.status === "unsupported" ? 422 : 200, result);
      }
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > (libraryRequest ? 4 * 1024 * 1024 + 2048 : 1024 * 1024)) {
          respond(413, {
            status: "error",
            source,
            error: libraryRequest ? "Biblioteca excede o limite de 4 MiB." : "Corpo excede 1 MiB.",
          });
          return;
        }
        chunks.push(chunk);
      }
      let input;
      try {
        input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return respond(400, {
          status: "error",
          source,
          error: "JSON inválido.",
        });
      }
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input)
      )
        return respond(400, {
          status: "error",
          source,
          error: "Informe um corpo JSON como objeto.",
        });
      if (youtubeRequest) {
        const result = await searchYouTube(input, config, dependencies.fetcher, requestAbortController.signal);
        return respond(result.status === "unsupported" ? 422 : 200, result);
      }
      if (libraryRequest) {
        const result=await handleLibrary(input,{dataDir:config.dataDir});
        return respond(result.data?.conflict?409:result.status==='error'?400:200,result);
      }
      if (historyRequest) {
        const result = await handleHistory(input, {dataDir:config.dataDir, historyMaxRecords:config.historyMaxRecords});
        return respond(result.status === "unsupported" ? 422 : 200, result);
      }
      if (typeof input.feature !== "string" || !input.payload || typeof input.payload !== "object" || Array.isArray(input.payload))
        return respond(400, {status:"error", source, error:"Informe feature e payload como objeto."});
      const result = isAiFeature(input.feature)
        ? await analyzeAi(
            input.feature,
            input.payload,
            config,
            dependencies.fetcher,
          )
        : await analyzeDataset(input.feature, input.payload, {
            dataDir: config.dataDir,
          });
      respond(result.status === "unsupported" ? 422 : 200, result);
    } catch (error) {
      let safe =
        error instanceof Error ? error.message : "Falha ao processar análise.";
      for (const secret of [config.omniApiKey, config.aiApiKey, config.youtubeApiKey, config.token])
        if (secret) safe = safe.split(secret).join("[redigido]");
      const status = error?.name === "TimeoutError" ? 504 : 400;
      respond(status, {
        status: "error",
        source,
        error: safe.replace(/Bearer\s+\S+/gi, "[redigido]"),
      });
    } finally {
      if (youtubeRequest) {
        req.off("aborted", abortRequest);
        res.off("close", abortClosedResponse);
      }
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const config = configFromEnv();
  const server = createPrevlevServer(config);
  server.listen(config.port, config.bind, () =>
    console.log(
      `Prevlev backend em http://${config.bind}:${config.port}; configure ALLOWED_ORIGINS com a origem da extensão.`,
    ),
  );
}
