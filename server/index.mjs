import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { analyzeDataset } from "./analysis.mjs";
import { analyzeAi, isAiFeature, validateProvider } from "./ai.mjs";

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
    aiBaseUrl: env.AI_BASE_URL ?? "",
    aiApiKey: env.AI_API_KEY ?? "",
    aiModel: env.AI_MODEL ?? "",
    aiImageModel: env.AI_IMAGE_MODEL ?? "",
  };
}
function validConfig(config) {
  if (!loopback(config.bind) && !config.token)
    throw new Error("PREVLEV_TOKEN é obrigatório ao escutar fora do loopback.");
  if (config.aiBaseUrl) validateProvider(config.aiBaseUrl);
  for (const origin of config.allowedOrigins) {
    if (
      !/^chrome-extension:\/\/[a-p]{32}$/.test(origin) &&
      !/^https:\/\/[^/]+$/.test(origin)
    )
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
          version: "0.1.0",
          aiTextConfigured: Boolean(config.aiBaseUrl && config.aiModel),
          aiImageConfigured: Boolean(config.aiBaseUrl && config.aiImageModel),
        },
      });
    if (req.url !== "/v1/analyze" || req.method !== "POST")
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
        error: "Limite de 30 análises por minuto.",
      });
    if (rates.size > 1000)
      for (const [address, value] of rates)
        if (now - value.start > 60000) rates.delete(address);
    if (!(req.headers["content-type"] ?? "").startsWith("application/json"))
      return respond(415, {
        status: "error",
        source,
        error: "Use Content-Type: application/json.",
      });
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) {
          respond(413, {
            status: "error",
            source,
            error: "Corpo excede 1 MiB.",
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
        Array.isArray(input) ||
        typeof input.feature !== "string" ||
        !input.payload ||
        typeof input.payload !== "object" ||
        Array.isArray(input.payload)
      )
        return respond(400, {
          status: "error",
          source,
          error: "Informe feature e payload como objeto.",
        });
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
      const safe =
        error instanceof Error ? error.message : "Falha ao processar análise.";
      const status = error?.name === "TimeoutError" ? 504 : 400;
      respond(status, {
        status: "error",
        source,
        error: safe.replace(/Bearer\s+\S+/gi, "[redigido]"),
      });
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
