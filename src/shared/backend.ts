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
  const signal = AbortSignal.timeout(isAiFeature(feature) ? 305000 : 45000);
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
      signal,
    });
  } catch {
    throw new Error(
      "Não foi possível concluir a conexão com o backend Prevlev. O resultado da solicitação é incerto; nenhuma repetição foi enviada. Confira o serviço antes de reenviar.",
    );
  }
  let body: RemoteResponse;
  try {
    body = (await boundedBackendJson(response, feature === "thumbnail-generation" ? 24 * 1024 * 1024 : 2 * 1024 * 1024,signal)) as RemoteResponse;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Resposta do backend excede")) throw error;
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

/** Image JSON carries base64 overhead; bound the HTTP body before JSON/string allocation. */
async function boundedBackendJson(response:Response,maxBytes:number,signal:AbortSignal):Promise<unknown> {
  const oversized=()=>new Error("Resposta do backend excede o limite de leitura. O resultado é incerto; nenhuma repetição foi enviada.");
  if(Number(response.headers.get("content-length"))>maxBytes) {void response.body?.cancel().catch(()=>{});throw oversized();}
  const reader=response.body?.getReader();if(!reader)throw new Error("Resposta vazia.");
  const decoder=new TextDecoder();let text="",bytes=0,done=false;
  try {
    for(;;) {
      signal.throwIfAborted();
      const chunk=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{
        const abort=()=>reject(signal.reason);signal.addEventListener("abort",abort,{once:true});
        reader.read().then(resolve,reject).finally(()=>signal.removeEventListener("abort",abort));
        if(signal.aborted)abort();
      });
      if(chunk.done) {done=true;break;}
      bytes+=chunk.value.byteLength;if(bytes>maxBytes)throw oversized();
      text+=decoder.decode(chunk.value,{stream:true});
    }
    text+=decoder.decode();signal.throwIfAborted();return JSON.parse(text);
  } finally {
    if(!done)void reader.cancel().catch(()=>{}).finally(()=>reader.releaseLock());else reader.releaseLock();
  }
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

/** Explicit local-backend operations. Never retries or discovers a remote source. */
export async function callBackendOperation(
  settings: Settings,
  path: "/v1/youtube/search" | "/v1/history" | "/v1/library",
  payload: unknown,
  signal?: AbortSignal,
): Promise<RemoteResponse> {
  if (!["/v1/youtube/search", "/v1/history", "/v1/library"].includes(path))
    throw new Error("Operação de backend desconhecida.");
  if (!settings.backendUrl)
    return {
      status: "not_configured",
      source: "prevlev:client",
      error: "Configure e salve seu backend Prevlev na aba Conexão.",
    };
  const origin = backendOrigin(settings.backendUrl);
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(45000)])
    : AbortSignal.timeout(45000);
  try {
    requestSignal.throwIfAborted();
    const response = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(settings.backendToken
          ? { Authorization: `Bearer ${settings.backendToken}` }
          : {}),
      },
      body: JSON.stringify(payload),
      credentials: "omit",
      redirect: "error",
      signal: requestSignal,
    });
    // History exports are bounded server-side to 10 MiB; also bound untrusted responses.
    const maxBytes = 12 * 1024 * 1024;
    if (Number(response.headers.get("content-length")) > maxBytes) {
      await response.body?.cancel();
      throw new Error("Resposta do backend excedeu o limite de leitura.");
    }
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let raw = "", bytes = 0;
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) {
            await reader.cancel();
            throw new Error("Resposta do backend excedeu o limite de leitura.");
          }
          raw += decoder.decode(value, { stream: true });
        }
        raw += decoder.decode();
      } finally { reader.releaseLock(); }
    }
    requestSignal.throwIfAborted();
    let body: RemoteResponse;
    try { body = JSON.parse(raw) as RemoteResponse; }
    catch { throw new Error("O backend não devolveu JSON completo. O resultado é incerto; consulte o histórico antes de reenviar uma alteração. Nenhuma repetição foi enviada."); }
    if (
      !body || typeof body !== "object" || Array.isArray(body) ||
      !["ok", "not_configured", "unsupported", "error"].includes(body.status) ||
      typeof body.source !== "string"
    ) throw new Error("Resposta incompatível com o contrato Prevlev.");
    if (!response.ok && !body.error)
      throw new Error(`Backend respondeu HTTP ${response.status}. Nenhuma repetição foi enviada.`);
    return body;
  } catch (error) {
    if (signal?.aborted)
      throw new DOMException("Solicitação cancelada. Uma operação já aceita pelo servidor pode ter sido concluída.", "AbortError");
    if (error instanceof Error && error.message.startsWith("Resposta")) throw error;
    if (error instanceof Error && (error.message.startsWith("O backend") || error.message.startsWith("Backend respondeu"))) throw error;
    throw new Error("Não foi possível concluir a operação no backend Prevlev. O resultado é incerto; confira o serviço antes de reenviar. Nenhuma repetição foi enviada.");
  }
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
