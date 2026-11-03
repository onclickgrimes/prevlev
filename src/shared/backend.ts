import type { Settings, RemoteFeature, RemoteResponse } from "./types";
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
  const response = await fetch(`${origin}/v1/analyze`, {
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
    signal: AbortSignal.timeout(45000),
  });
  const body = (await response.json()) as RemoteResponse;
  if (!response.ok && !body.error)
    throw new Error(`Backend respondeu HTTP ${response.status}`);
  if (
    !["ok", "not_configured", "unsupported", "error"].includes(body.status) ||
    typeof body.source !== "string"
  )
    throw new Error("Resposta incompatível com o contrato Prevlev.");
  return body;
}
