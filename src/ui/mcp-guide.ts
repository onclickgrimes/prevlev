import { MCP_ANALYSES, MCP_CLIENT_NOTES, MCP_TOOLS, createMcpManualConfig, createMcpPrompt, type McpAnalysis, type McpClient, type McpTool } from "../core/mcp-guide";

/** Mounting and drafting never establish a connection or call a backend. */
export function mountMcpGuide(host: HTMLElement, dependencies: { copyText?: (text: string) => Promise<void> } = {}): { destroy(): void } {
  const doc = host.ownerDocument;
  const panel = doc.createElement("div"); panel.id = "mcp-guide"; panel.className = "card";
  panel.innerHTML = `<h2>MCP local · guia e compositor</h2>
    <p>Processo opcional, desativado por padrão, somente leitura e transporte stdio. O cliente que iniciar o processo poderá ler observações existentes do diretório escolhido. Esta tela só prepara texto: não detecta cliente, não conecta e não altera arquivos externos.</p>
    <h3>Cinco ferramentas disponíveis</h3><dl id="mcp-tools"></dl>
    <p>Até 500 vídeos por análise, 100 mil caracteres de texto e 500 observações por chamada de histórico (100 por padrão). Resposta máxima: 2 MiB. Sem acesso à sessão do navegador, coleta na rede, geração de IA ou alteração de canal. Saldo e quota de serviços externos: desconhecidos.</p>
    <h3>Configuração manual</h3>
    <label>Cliente escolhido<select id="mcp-client"><option value="generic">Cliente stdio compatível</option><option value="chatgpt">ChatGPT</option><option value="claude">Claude</option></select></label><p id="mcp-client-note"></p>
    <ol><li>Instale as dependências no checkout local do Prevlev com npm ci e confirme Node compatível com o projeto (24 ou superior).</li><li>Informe os caminhos absolutos do seu computador. Revise DATA_DIR, pois suas observações serão disponibilizadas ao cliente.</li><li>Prepare e copie a entrada JSON. Adapte o formato e salve manualmente nas configurações do cliente. Não inclua chaves de IA, Omni ou YouTube.</li><li>Inicie a conexão manualmente no cliente. Se quiser verificar o escopo, copie o rascunho de prevlev_capabilities e envie você mesmo. Uma capacidade não comprova conexão, geração ou quota.</li></ol>
    <div class="form-grid"><label>Executável Node (caminho absoluto)<input id="mcp-node-path" placeholder="/caminho/absoluto/node" maxlength="4096"></label><label>Servidor Prevlev (caminho absoluto)<input id="mcp-server-path" placeholder="/caminho/absoluto/prevlev/server/mcp.mjs" maxlength="4096"></label><label>Diretório de histórico (DATA_DIR)<input id="mcp-data-dir" placeholder="/caminho/absoluto/prevlev/data/history" maxlength="4096"></label><label>Máximo de registros no índice (HISTORY_MAX_RECORDS)<input id="mcp-history-max" type="number" min="1" max="5000" step="1" value="5000"></label></div>
    <button id="mcp-prepare-config" type="button">Preparar configuração</button> <button id="mcp-copy-config" type="button" disabled>Copiar configuração</button><label>Entrada JSON para revisão<textarea id="mcp-config-output" rows="12" readonly></textarea></label>
    <h3>Compor um prompt</h3><p>Os dados ficam nesta tela. Copiar coloca o rascunho na área de transferência; você escolhe onde e quando enviá-lo. Nenhum envio é feito pelo Prevlev.</p>
    <label>Ferramenta<select id="mcp-tool"></select></label>
    <div id="mcp-analysis-fields"><label>Análise<select id="mcp-feature"></select></label><label>Origem declarada<select id="mcp-source"><option value="">Escolha a origem dos dados</option><option value="youtube-dom">Observação do navegador</option><option value="public-page">Página pública</option><option value="user-provided">Material fornecido por você</option></select></label><p>A origem é declarada por você; o compositor não a verifica externamente. Dados identificados como YouTube Data API são recusados nas análises derivadas.</p>
    <label id="mcp-videos-label">Vídeos observados (array JSON, até 500)<textarea id="mcp-videos" rows="6" placeholder='[{"id":"ID observado","title":"Título observado","source":"user-provided"}]'></textarea></label>
    <label id="mcp-text-label">Texto real para examinar possíveis divulgações comerciais<textarea id="mcp-text" rows="6" maxlength="100000"></textarea></label>
    <label>Consulta/contexto opcional<textarea id="mcp-query" maxlength="100000" rows="2"></textarea></label><label>ID alvo opcional (por exemplo, similaridade)<input id="mcp-target-id" maxlength="100"></label></div>
    <div id="mcp-history-fields"><label id="mcp-video-id-label">ID exato do vídeo (11 caracteres; opcional para exportar)<input id="mcp-video-id" maxlength="11"></label><label>Limite por chamada (1–500)<input id="mcp-limit" type="number" min="1" max="500" step="1" value="100"></label></div>
    <button id="mcp-prepare-prompt" type="button">Preparar rascunho</button> <button id="mcp-copy-prompt" type="button" disabled>Copiar prompt</button><label>Rascunho para revisão<textarea id="mcp-prompt-output" rows="12" readonly></textarea></label><p id="mcp-guide-status" role="status" aria-live="polite">Nenhuma conexão ou solicitação foi iniciada.</p>`;
  host.append(panel);
  const el = <T extends HTMLElement = HTMLElement>(id: string) => panel.querySelector<T>(`#${id}`)!;
  const input = (id: string) => el<HTMLInputElement>(id);
  const text = (id: string) => el<HTMLTextAreaElement>(id);
  const tool = el<HTMLSelectElement>("mcp-tool"), feature = el<HTMLSelectElement>("mcp-feature");
  for (const item of MCP_TOOLS) {
    const term = doc.createElement("dt"), description = doc.createElement("dd"), option = doc.createElement("option");
    term.textContent = item.name; description.textContent = `${item.title} — ${item.description} Entrada: ${item.input}.`;
    el("mcp-tools").append(term, description); option.value = item.name; option.textContent = `${item.name} · ${item.title}`; tool.append(option);
  }
  for (const name of MCP_ANALYSES) { const option = doc.createElement("option"); option.value = name; option.textContent = name; feature.append(option); }
  const status = (message: string) => { el("mcp-guide-status").textContent = message; };
  function invalidateConfig() { text("mcp-config-output").value = ""; el<HTMLButtonElement>("mcp-copy-config").disabled = true; }
  function invalidatePrompt() { text("mcp-prompt-output").value = ""; el<HTMLButtonElement>("mcp-copy-prompt").disabled = true; }
  function updateFields() {
    el("mcp-analysis-fields").hidden = tool.value !== "analyze_dataset";
    el("mcp-history-fields").hidden = !tool.value.startsWith("history_");
    el("mcp-video-id-label").hidden = tool.value === "history_list";
    el("mcp-videos-label").hidden = feature.value === "sponsorships";
    el("mcp-text-label").hidden = feature.value !== "sponsorships";
  }
  const client = el<HTMLSelectElement>("mcp-client");
  function updateClient() { el("mcp-client-note").textContent = MCP_CLIENT_NOTES[client.value as McpClient] ?? MCP_CLIENT_NOTES.generic; }
  client.addEventListener("change", updateClient);
  const configFields = ["mcp-node-path", "mcp-server-path", "mcp-data-dir", "mcp-history-max"];
  const promptFields = ["mcp-tool", "mcp-feature", "mcp-source", "mcp-videos", "mcp-text", "mcp-query", "mcp-target-id", "mcp-video-id", "mcp-limit"];
  for (const id of configFields) el(id).addEventListener("input", () => { invalidateConfig(); status("Configuração alterada. Prepare e revise novamente antes de copiar."); });
  for (const id of promptFields) for (const event of ["input", "change"]) el(id).addEventListener(event, () => { invalidatePrompt(); updateFields(); status("Rascunho alterado. Prepare e revise novamente antes de copiar."); });
  el("mcp-prepare-config").addEventListener("click", () => {
    invalidateConfig();
    try { text("mcp-config-output").value = createMcpManualConfig({ nodePath: input("mcp-node-path").value, serverPath: input("mcp-server-path").value, dataDir: input("mcp-data-dir").value, historyMaxRecords: Number(input("mcp-history-max").value) }); el<HTMLButtonElement>("mcp-copy-config").disabled = false; status("Entrada JSON preparada para revisão e configuração manual. Nenhum arquivo foi alterado."); }
    catch (error) { status(error instanceof Error ? error.message : "Configuração inválida."); }
  });
  el("mcp-prepare-prompt").addEventListener("click", () => {
    invalidatePrompt();
    try { text("mcp-prompt-output").value = createMcpPrompt({ tool: tool.value as McpTool, feature: feature.value as McpAnalysis, source: el<HTMLSelectElement>("mcp-source").value as "youtube-dom" | "public-page" | "user-provided", videosJson: text("mcp-videos").value, text: text("mcp-text").value, query: text("mcp-query").value, targetId: input("mcp-target-id").value, videoId: input("mcp-video-id").value, limit: Number(input("mcp-limit").value) }); el<HTMLButtonElement>("mcp-copy-prompt").disabled = false; status("Rascunho preparado localmente. Revise os dados; somente você pode enviá-lo ao cliente escolhido."); }
    catch (error) { status(error instanceof Error ? error.message : "Rascunho inválido."); }
  });
  let active = true;
  const copy = async (id: string, label: string) => {
    const value = text(id).value; if (!value) return;
    try {
      if (dependencies.copyText) await dependencies.copyText(value);
      else { const clipboard = doc.defaultView?.navigator.clipboard; if (!clipboard) throw new Error("Clipboard indisponível"); await clipboard.writeText(value); }
      if (active) status(`${label} copiado para a área de transferência. Nenhum envio ou conexão foi feito.`);
    } catch { if (active) status("Não foi possível copiar. Selecione e copie manualmente o texto revisado."); }
  };
  el("mcp-copy-config").addEventListener("click", () => { void copy("mcp-config-output", "Configuração"); });
  el("mcp-copy-prompt").addEventListener("click", () => { void copy("mcp-prompt-output", "Prompt"); });
  updateFields(); updateClient();
  return { destroy() { active = false; panel.remove(); } };
}
