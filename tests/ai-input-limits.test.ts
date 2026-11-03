import { describe, expect, it, vi } from "vitest";
import { analyzeAi } from "../server/ai.mjs";
import { analyzeOmni } from "../server/omni.mjs";

// Synthetic transports only: no catalogue, account or provider is contacted.
const model = "fixture:exact-text";
const omniConfig = { aiProvider: "omni", omniBaseUrl: "http://127.0.0.1:7814" } as const;
const directConfig = { aiProvider: "openai-compatible", aiBaseUrl: "http://127.0.0.1:9000/v1", aiModel: model } as const;
const adapters = [
  { name: "direct AI", run: (feature: string, payload: Record<string, unknown>, fetcher: typeof fetch) => analyzeAi(feature, payload, directConfig, fetcher), calls: 1 },
  { name: "Omni", run: (feature: string, payload: Record<string, unknown>, fetcher: typeof fetch) => analyzeOmni(feature, { model, ...payload }, omniConfig, fetcher), calls: 2 },
  { name: "AI routed through Omni", run: (feature: string, payload: Record<string, unknown>, fetcher: typeof fetch) => analyzeAi(feature, { model, ...payload }, omniConfig, fetcher), calls: 2 },
];
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
function transport() {
  return vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (String(url).endsWith("/v1/models")) return json({ data: [{ id: model, x_omni: { capabilities: { input_modalities: ["text"], output_modalities: ["text"], operations: ["responses"] } } }] });
    if (String(url).endsWith("/v1/responses")) return json({ status: "completed", model, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Resposta fixture" }] }] });
    return json({ model, choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Resposta fixture" } }] });
  });
}
async function errorMessage(promise: Promise<unknown>): Promise<string> {
  try { const result = await promise as { status: string; error?: string }; expect(result.status).toBe("error"); return result.error ?? ""; }
  catch (error) { return error instanceof Error ? error.message : ""; }
}
function inputSent(fetcher: ReturnType<typeof transport>): unknown {
  const request = JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body));
  expect(request.model).toBe(model);
  return JSON.parse(request.messages ? request.messages[1].content : request.input[0].content);
}
const segments = (count: number) => Array.from({ length: count }, (_, index) => ({ text: index === count - 1 ? "último segmento" : "x" }));
const comments = (count: number) => Array.from({ length: count }, (_, index) => ({ text: index === count - 1 ? "último comentário" : "x" }));

for (const adapter of adapters) describe(`${adapter.name}: complete input validation`, () => {
  const oversized = [
    { name: "complete text above 100000 characters", feature: "transcript-summary", payload: { text: "a".repeat(100001) }, limit: /100 mil/u },
    { name: "more than 5000 segments", feature: "transcript-topics", payload: { transcript: segments(5001) }, limit: /5000 segmentos/u },
    { name: "segment above 2000 characters", feature: "transcript-script", payload: { transcript: [{ start: 12, text: "a".repeat(2001) }] }, limit: /2000 caracteres/u },
    { name: "more than 1000 comments", feature: "comment-analysis", payload: { comments: comments(1001) }, limit: /1000 comentários/u },
    { name: "comment above 2000 characters", feature: "comment-analysis", payload: { comments: [{ text: "a".repeat(2001) }] }, limit: /2000 caracteres/u },
    { name: "encoded text above aggregate limit", feature: "transcript-summary", payload: { text: '"'.repeat(75000) }, limit: /150 mil/u },
    { name: "encoded transcript above aggregate limit", feature: "transcript-topics", payload: { transcript: Array.from({ length: 80 }, () => ({ text: "a".repeat(2000) })) }, limit: /150 mil/u },
    { name: "encoded comments above aggregate limit", feature: "comment-analysis", payload: { comments: Array.from({ length: 80 }, () => ({ text: "a".repeat(2000) })) }, limit: /150 mil/u },
    { name: "oversized segments masked by full text", feature: "transcript-summary", payload: { text: "selected text", transcript: segments(5001) }, limit: /5000 segmentos/u },
    { name: "oversized segment text masked by full text", feature: "transcript-summary", payload: { text: "selected text", transcript: [{ text: "a".repeat(2001) }] }, limit: /2000 caracteres/u },
    { name: "oversized whitespace masked by valid segments", feature: "transcript-script", payload: { text: " ".repeat(100001), transcript: [{ text: "real material" }] }, limit: /100 mil/u },
  ];
  it.each(oversized)("rejects $name before any provider/catalogue call", async ({ feature, payload, limit }) => {
    const fetcher = transport();
    const message = await errorMessage(adapter.run(feature, payload, fetcher));
    expect(message).toMatch(limit);
    expect(message).toContain("Nenhum material parcial foi enviado");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { feature: "transcript-summary", payload: { text: " " } },
    { feature: "transcript-topics", payload: { transcript: [{ text: "" }] } },
    { feature: "transcript-script", payload: { transcript: [{ text: 7 }] } },
    { feature: "transcript-script", payload: { transcript: [{ text: "kept" }, null] } },
    { feature: "comment-analysis", payload: { comments: [{ text: "kept" }, { missing: "text" }] } },
  ])("rejects empty or malformed material without replacing missing text", async ({ feature, payload }) => {
    const fetcher = transport();
    expect(await errorMessage(adapter.run(feature, payload, fetcher))).toContain("Nenhum material parcial foi enviado");
    expect(fetcher).not.toHaveBeenCalled();
  });
  const boundary = [
    { name: "100000 text characters", feature: "transcript-summary", payload: { text: " começo " + "a".repeat(99985) + " fim   " }, expected: " começo " + "a".repeat(99985) + " fim   " },
    { name: "5000 complete segments", feature: "transcript-topics", payload: { transcript: segments(5000) }, expected: segments(5000) },
    { name: "2000 characters in one segment", feature: "transcript-script", payload: { transcript: [{ text: "á".repeat(1990) + " fim texto", start: 12.5 }] }, expected: [{ text: "á".repeat(1990) + " fim texto", start: 12.5 }] },
    { name: "1000 complete comments", feature: "comment-analysis", payload: { comments: comments(1000) }, expected: comments(1000) },
    { name: "2000 characters in one comment", feature: "comment-analysis", payload: { comments: [{ text: "á".repeat(1990) + " fim texto", likes: 4 }] }, expected: [{ text: "á".repeat(1990) + " fim texto", likes: 4 }] },
    { name: "150000 encoded characters", feature: "transcript-summary", payload: { text: '"'.repeat(74999) }, expected: '"'.repeat(74999) },
  ];
  it.each(boundary)("accepts $name and sends every supplied text character", async ({ feature, payload, expected }) => {
    const fetcher = transport();
    expect(await adapter.run(feature, payload, fetcher)).toMatchObject({ status: "ok", data: { text: "Resposta fixture", model } });
    expect(fetcher).toHaveBeenCalledTimes(adapter.calls);
    expect(inputSent(fetcher)).toEqual(expected);
  });
});
