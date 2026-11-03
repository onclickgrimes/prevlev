/** Local drafting only. This module has no transport, filesystem or provider access. */
export const MCP_TOOLS = [
  { name: "prevlev_capabilities", title: "Conhecer capacidades", input: "{}", description: "Lista ferramentas, análises e limites locais. Não testa conexão, modelo ou cota." },
  { name: "analyze_dataset", title: "Analisar dados fornecidos", input: "feature e videos; para sponsorships, text", description: "Analisa a amostra ou o texto enviados. Não coleta na rede e recusa dados identificados como YouTube Data API." },
  { name: "history_list", title: "Listar histórico", input: "limit opcional (1–500)", description: "Lê observações existentes do diretório configurado, mais recentes primeiro. Não descobre legado sem ID no índice." },
  { name: "history_get", title: "Abrir histórico de um vídeo", input: "videoId exato; limit opcional (1–500)", description: "Lê as observações locais do vídeo, incluindo legado reconhecido. Não consulta o YouTube." },
  { name: "history_export", title: "Exportar histórico limitado", input: "videoId opcional; limit opcional (1–500)", description: "Retorna JSON limitado na resposta. Não grava um arquivo nem altera registros." },
] as const;
export const MCP_ANALYSES = ["similar-videos", "similar-channels", "niche", "search-analysis", "channel-analytics", "channel-report", "combined-analytics", "sponsorships"] as const;
export type McpTool = typeof MCP_TOOLS[number]["name"];
export type McpAnalysis = typeof MCP_ANALYSES[number];
export type McpClient = "generic" | "chatgpt" | "claude";
export const MCP_CLIENT_NOTES: Record<McpClient, string> = {
  generic: "No cliente escolhido, confirme suporte a processos MCP locais por stdio. Adapte a entrada ao formato aceito pelo aplicativo e revise antes de salvar manualmente.",
  chatgpt: "Destino escolhido: ChatGPT. Confirme na versão e no ambiente que você usa se há suporte a este processo local por stdio. Este guia não detecta suporte nem transforma stdio em um conector remoto. Use a documentação do cliente para a configuração manual.",
  claude: "Destino escolhido: Claude. Confirme na versão e no ambiente que você usa se há suporte a este processo local por stdio. A localização e o formato da configuração dependem do cliente. Revise e insira a entrada manualmente conforme a documentação dele.",
};

function absolutePath(value: string, label: string): string {
  const path = value.trim();
  if (!path || path.length > 4096 || [...path].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || !(/^(?:\/(?!\/)|[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/u.test(path))) throw new Error(`${label}: informe um caminho absoluto, sem variáveis de ambiente ou caracteres de controle.`);
  return path;
}
export interface McpManualConfigInput { nodePath: string; serverPath: string; dataDir: string; historyMaxRecords: number; }
export function createMcpManualConfig(input: McpManualConfigInput): string {
  const command = absolutePath(input.nodePath, "Node"), serverPath = absolutePath(input.serverPath, "Servidor"), dataDir = absolutePath(input.dataDir, "Histórico");
  if (!/[\\/]server[\\/]mcp\.mjs$/u.test(serverPath)) throw new Error("Servidor: informe o caminho do arquivo Prevlev server/mcp.mjs.");
  if (!Number.isInteger(input.historyMaxRecords) || input.historyMaxRecords < 1 || input.historyMaxRecords > 5000) throw new Error("HISTORY_MAX_RECORDS deve ficar entre 1 e 5000.");
  return JSON.stringify({ command, args: [serverPath], env: { MCP_ENABLED: "true", DATA_DIR: dataDir, HISTORY_MAX_RECORDS: String(input.historyMaxRecords) } }, null, 2);
}

export interface McpPromptInput { tool: McpTool; feature?: McpAnalysis; videosJson?: string; text?: string; source?: "youtube-dom" | "public-page" | "user-provided"; videoId?: string; limit?: number; query?: string; targetId?: string; }
const VIDEO_KEYS = new Set(["id", "title", "url", "channel", "channelId", "channelUrl", "views", "durationSeconds", "subscribers", "isShort", "publishedAt", "thumbnail", "source", "observedAt"]);
const STRING_LIMITS: Record<string, number> = { id: 100, title: 500, url: 2048, channel: 200, channelId: 100, channelUrl: 2048, publishedAt: 50, thumbnail: 2048, observedAt: 50 };
function videosFromJson(value: string): Record<string, unknown>[] {
  if (value.length > 2 * 1024 * 1024) throw new Error("JSON de vídeos acima de 2 MiB; reduza a amostra.");
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("Informe um array JSON de vídeos válido."); }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 500) throw new Error("Forneça de 1 a 500 vídeos observados.");
  return parsed.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Cada vídeo precisa ser um objeto JSON.");
    const video = item as Record<string, unknown>;
    if (Object.keys(video).some(key => !VIDEO_KEYS.has(key))) throw new Error("O vídeo contém campos não aceitos pelo MCP. Use os campos de observação documentados.");
    if (typeof video.id !== "string" || !video.id.trim() || typeof video.title !== "string") throw new Error("Cada vídeo precisa de id e title de texto.");
    for (const [key, max] of Object.entries(STRING_LIMITS)) if (video[key] !== undefined && (typeof video[key] !== "string" || (video[key] as string).length > max)) throw new Error(`Campo ${key} inválido ou acima do limite.`);
    for (const key of ["views", "durationSeconds", "subscribers"]) if (video[key] !== undefined && (typeof video[key] !== "number" || !Number.isFinite(video[key]) || Number(video[key]) < 0)) throw new Error(`Campo ${key} deve ser um número não negativo.`);
    if (video.isShort !== undefined && typeof video.isShort !== "boolean") throw new Error("isShort deve ser booleano quando informado.");
    if (video.source !== undefined && !["youtube-dom", "public-page", "user-provided"].includes(video.source as string)) throw new Error("Fonte inválida: dados identificados como YouTube Data API são recusados na análise derivada.");
    return { ...video, id: video.id.trim() };
  });
}
export function createMcpPrompt(input: McpPromptInput): string {
  if (!MCP_TOOLS.some(tool => tool.name === input.tool)) throw new Error("Escolha uma das cinco ferramentas locais.");
  const args: Record<string, unknown> = {};
  if (input.tool !== "prevlev_capabilities") {
    if (input.tool === "analyze_dataset") {
      if (!MCP_ANALYSES.includes(input.feature as McpAnalysis)) throw new Error("Escolha uma análise local disponível.");
      if (!input.source || !["youtube-dom", "public-page", "user-provided"].includes(input.source)) throw new Error("Informe a origem dos dados; ela não é verificada externamente pelo compositor.");
      args.feature = input.feature; args.source = input.source;
      if (input.feature === "sponsorships") {
        if (!input.text?.trim() || input.text.length > 100000) throw new Error("Forneça texto real de até 100 mil caracteres.");
        args.text = input.text;
      } else args.videos = videosFromJson(input.videosJson ?? "");
      if (input.query) { if (input.query.length > 100000) throw new Error("Consulta acima de 100 mil caracteres."); args.query = input.query; }
      if (input.targetId) { if (input.targetId.length > 100) throw new Error("ID alvo acima de 100 caracteres."); args.targetId = input.targetId; }
    } else {
      if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500)) throw new Error("O limite da chamada deve ficar entre 1 e 500.");
      if (input.limit !== undefined) args.limit = input.limit;
      if (input.tool === "history_get" || (input.tool === "history_export" && input.videoId?.trim())) {
        const videoId = input.videoId?.trim();
        if (!videoId || !/^[A-Za-z0-9_-]{11}$/u.test(videoId)) throw new Error("Informe o ID exato do vídeo com 11 caracteres.");
        args.videoId = videoId;
      }
    }
  }
  return `Rascunho local para envio manual ao cliente MCP escolhido.\nUse somente a ferramenta Prevlev ${input.tool} com estes argumentos:\n${JSON.stringify(args, null, 2)}\n\nApresente fonte, cobertura, dados ausentes e limitações da resposta. Não trate a amostra como catálogo completo nem invente receita, RPM, saldo, quota ou previsão. Não busque dados externos, não altere o histórico ou o canal e não execute ferramentas adicionais sem minha instrução.`;
}
