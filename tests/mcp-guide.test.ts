import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MCP_TOOLS, MCP_ANALYSES, createMcpManualConfig, createMcpPrompt } from "../src/core/mcp-guide";

const config = { nodePath: "/opt/node/bin/node", serverPath: "/my work/prevlev/server/mcp.mjs", dataDir: "/my work/history", historyMaxRecords: 5000 };
const analysis = { tool: "analyze_dataset" as const, feature: "niche" as const, source: "user-provided" as const, videosJson: '[{"id":"abcdefghijk","title":"Observado","views":12}]' };
function args(prompt: string): Record<string, unknown> { const json = prompt.slice(prompt.indexOf("{\n"), prompt.lastIndexOf("\n\nApresente")); return JSON.parse(json); }

describe("MCP manual guide", () => {
  it("matches the actual five tools and eight analyses registered by the server", () => {
    const source = readFileSync(new URL("../server/mcp.mjs", import.meta.url), "utf8");
    const toolNames = [...source.matchAll(/registerTool\('([^']+)'/gu)].map(match => match[1]);
    expect(MCP_TOOLS.map(tool => tool.name)).toEqual(toolNames);
    const names = source.match(/const FEATURES = \[([^\]]+)\]/u)![1].split(",").map(value => value.trim().replaceAll("'", ""));
    expect([...MCP_ANALYSES]).toEqual(names);
  });
  it("builds only a direct Node stdio entry with explicit paths and no secret fields", () => {
    expect(JSON.parse(createMcpManualConfig(config))).toEqual({ command: config.nodePath, args: [config.serverPath], env: { MCP_ENABLED: "true", DATA_DIR: config.dataDir, HISTORY_MAX_RECORDS: "5000" } });
    const windows = { ...config, nodePath: "C:\\Program Files\\nodejs\\node.exe", serverPath: "D:\\Prevlev\\server\\mcp.mjs", dataDir: "\\\\localhost\\history\\data" };
    expect(JSON.parse(createMcpManualConfig(windows)).args).toEqual([windows.serverPath]);
  });
  it("rejects placeholders, relative paths, wrong server file, control chars and index limits", () => {
    for (const nodePath of ["node", "~/node", "$HOME/node", "https://example.com/node", "/opt/node\nexecute"]) expect(() => createMcpManualConfig({ ...config, nodePath })).toThrow();
    expect(() => createMcpManualConfig({ ...config, serverPath: "/opt/other.mjs" })).toThrow();
    for (const historyMaxRecords of [0, 5001, NaN, 1.1]) expect(() => createMcpManualConfig({ ...config, historyMaxRecords })).toThrow();
  });
  it("prepares exact arguments for capabilities and each history tool without carrying irrelevant text", () => {
    expect(createMcpPrompt({ tool: "prevlev_capabilities", text: "ignored" })).toContain("{}\n\nApresente");
    expect(args(createMcpPrompt({ tool: "history_list", limit: 100, videoId: "ignored" }))).toEqual({ limit: 100 });
    expect(args(createMcpPrompt({ tool: "history_get", videoId: "abcdefghijk", limit: 3 }))).toEqual({ limit: 3, videoId: "abcdefghijk" });
    expect(args(createMcpPrompt({ tool: "history_export", limit: 500 }))).toEqual({ limit: 500 });
    expect(args(createMcpPrompt({ tool: "history_export", videoId: "abcdefghijk" }))).toEqual({ videoId: "abcdefghijk" });
    expect(() => createMcpPrompt({ tool: "history_get" })).toThrow("11 caracteres");
    expect(() => createMcpPrompt({ tool: "history_export", videoId: "../file" })).toThrow();
    expect(() => createMcpPrompt({ tool: "history_list", limit: 501 })).toThrow();
  });
  it("preserves the supplied observations and declares manual-only intent and unknown quota", () => {
    const prompt = createMcpPrompt({ ...analysis, query: "amostra observada", targetId: "abcdefghijk" });
    expect(args(prompt)).toEqual({ feature: "niche", source: "user-provided", videos: [{ id: "abcdefghijk", title: "Observado", views: 12 }], query: "amostra observada", targetId: "abcdefghijk" });
    expect(prompt).toContain("Rascunho local para envio manual");
    expect(prompt).toContain("nem invente receita, RPM, saldo, quota");
  });
  it("rejects API origin, unsupported fields, invalid numeric observations and oversized samples", () => {
    for (const videosJson of ['[]', '{}', '[{"id":"a","title":"b","source":"youtube-data-api"}]', '[{"id":"a","title":"b","views":-1}]', '[{"id":"a","title":"b","views":null}]', '[{"id":"a","title":"b","rpm":2}]', '[{"id":"a"}]', '[{"id":" ","title":"b"}]', '[{"id":"a","title":"b","isShort":"yes"}]', JSON.stringify(Array.from({ length: 501 }, () => ({ id: "a", title: "b" })))]) expect(() => createMcpPrompt({ ...analysis, videosJson })).toThrow();
    expect(() => createMcpPrompt({ ...analysis, source: "youtube-data-api" as "user-provided" })).toThrow();
    expect(() => createMcpPrompt({ ...analysis, videosJson: '[{"id":"a","title":"' + "a".repeat(501) + '"}]' })).toThrow();
  });
  it("uses actual text for sponsorships, without inventing observations or attaching inactive fields", () => {
    expect(args(createMcpPrompt({ ...analysis, feature: "sponsorships", text: "Vídeo contém uma divulgação declarada." }))).toEqual({ feature: "sponsorships", source: "user-provided", text: "Vídeo contém uma divulgação declarada." });
    expect(() => createMcpPrompt({ ...analysis, feature: "sponsorships", text: " " })).toThrow();
    expect(() => createMcpPrompt({ ...analysis, feature: "sponsorships", text: "x".repeat(100001) })).toThrow();
  });
});
