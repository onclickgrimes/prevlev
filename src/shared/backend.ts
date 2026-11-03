import type {
  Settings,
  RemoteFeature,
  RemoteResponse,
  AiCatalogData,
} from "./types";
export function backendOrigin(value: string): string {
  const u = new URL(value);
  if (u.username || u.password || u.search || u.hash || u.pathname !== "/")
    throw new Error(
      "Use somente a origem do backend, sem caminho, senha ou parâmetros.",
    );
  if (
    u.protocol !== "https:" &&
    !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))
  )
    throw new Error("Use HTTPS ou HTTP local.");
  if (/(^|\.)nexlev\./i.test(u.hostname))
    throw new Error("Configure seu próprio backend.");
  return u.origin;
}
export async function callBackend(
  settings: Settings,
  feature: RemoteFeature,
  payload: unknown,
): Promise<RemoteResponse> {
  if (!settings.backendUrl)
    return {
      status: "not_configured",
      source: "Prevlev",
      error: "Configure um backend próprio na aba Conexão.",
    };
  const origin = backendOrigin(settings.backendUrl);
  let response: Response;
  try {
    response = await fetch(`${origin}/v1/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(settings.backendToken
          ? { Authorization: `Bearer ${settings.backendToken}` }
          : {}),
      },
      body: JSON.stringify({ feature, payload }),
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(isAiFeature(feature) ? 305000 : 45000),
    });
  } catch {
    throw new Error(
      "Não foi possível concluir a conexão com o backend Prevlev. O resultado da solicitação é incerto; nenhuma repetição foi enviada. Confira o serviço antes de reenviar.",
    );
  }
  let body: RemoteResponse;
  try {
    body = (await response.json()) as RemoteResponse;
  } catch {
    throw new Error(
      "O backend Prevlev não devolveu uma resposta JSON completa. O resultado da solicitação é incerto; nenhuma repetição foi enviada.",
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Resposta incompatível com o contrato Prevlev.");
  if (!response.ok && !body.error)
    throw new Error(`Backend respondeu HTTP ${response.status}`);
  if (
    !["ok", "not_configured", "unsupported", "error"].includes(body.status) ||
    typeof body.source !== "string"
  )
    throw new Error("Resposta incompatível com o contrato Prevlev.");
  return body;
}
export function isAiFeature(feature: string): boolean {
  return [
    "comment-analysis",
    "thumbnail-generation",
    "transcript-summary",
    "transcript-topics",
    "transcript-script",
  ].includes(feature);
}
export async function fetchAiCatalog(
  settings: Settings,
): Promise<RemoteResponse & { data?: AiCatalogData }> {
  if (!settings.backendUrl)
    return {
      status: "not_configured",
      source: "prevlev:client",
      error:
        "Configure e salve o backend Prevlev antes de consultar o OmniProviders.",
    };
  const origin = backendOrigin(settings.backendUrl);
  let response: Response;
  try {
    response = await fetch(`${origin}/v1/ai/catalog`, {
      headers: settings.backendToken
        ? { Authorization: `Bearer ${settings.backendToken}` }
        : {},
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error(
      "O backend Prevlev está offline ou não respondeu ao catálogo. Confira o endereço e inicie npm run server na máquina do OmniProviders.",
    );
  }
  let body: RemoteResponse & { data?: AiCatalogData };
  try {
    body = (await response.json()) as RemoteResponse & { data?: AiCatalogData };
  } catch {
    throw new Error(
      "O catálogo do backend Prevlev não retornou JSON completo. Nenhuma geração foi solicitada.",
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Catálogo incompatível com o backend Prevlev.");
  if (
    !["ok", "not_configured", "unsupported", "error"].includes(body.status) ||
    typeof body.source !== "string"
  )
    throw new Error("Catálogo incompatível com o backend Prevlev.");
  if (
    body.status === "ok" &&
    (!body.data ||
      typeof body.data.origin !== "string" ||
      !Array.isArray(body.data.models) ||
      body.data.models.length > 10000 ||
      body.data.models.some(
        (m) =>
          !m ||
          typeof m !== "object" ||
          typeof m.id !== "string" ||
          !/^[a-z][a-z0-9_-]*:[^\s]{1,400}$/i.test(m.id) ||
          typeof m.provider !== "string" ||
          m.provider !== m.id.slice(0, m.id.indexOf(":")) ||
          typeof m.label !== "string" ||
          ![m.operations, m.outputModalities, m.inputModalities].every(
            (a) => Array.isArray(a) && a.every((s) => typeof s === "string"),
          ) ||
          typeof m.streaming !== "boolean" ||
          typeof m.textSupported !== "boolean" ||
          typeof m.imageSupported !== "boolean" ||
          (m.textSupported &&
            (!m.inputModalities.includes("text") ||
              !m.outputModalities.includes("text") ||
              !m.operations.some(
                (o) => o === "responses" || o === "chat.completions",
              ))) ||
          (m.imageSupported &&
            (!m.inputModalities.includes("text") ||
              !m.outputModalities.includes("image") ||
              !m.operations.includes("images.generate"))),
      ) ||
      !Array.isArray(body.data.warnings))
  )
    throw new Error("O backend retornou um catálogo sem capacidades válidas.");
  return body;
}
