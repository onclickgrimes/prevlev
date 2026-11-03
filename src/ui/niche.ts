import type { PageSnapshot } from "../shared/types";
import { buildNicheReport, DEFAULT_NICHE_THRESHOLDS, NICHE_EXPORT_COLUMNS, nicheMarkdown, nicheRows, type NicheDuration, type NichePeriod, type NichePreset, type NicheReport, type NicheThresholds } from "../core/niche";
import type { ResearchComparisonMode } from "../core/research";
import { toCsv } from "../core/export";
import { downloadBlob } from "../core/media";

export interface NicheTools { invalidate: () => void; reset: () => void }
const instances = new WeakMap<HTMLElement, NicheTools>();

export function initNicheTools(deps: { snapshot: () => PageSnapshot }): NicheTools {
  const section = document.getElementById("niche");
  if (!section) return { invalidate: () => {}, reset: () => {} };
  const existing = instances.get(section);
  if (existing) return existing;
  section.dataset.nicheReady = "true";
  section.innerHTML = `<div class="card"><span class="eyebrow">AMOSTRA LOCAL CARREGADA</span><h2>Explorador de nicho</h2>
    <p>A análise usa apenas vídeos carregados ou fornecidos, sem registros da API oficial. Atualize após alterar a coleção ou os filtros.</p>
    <div class="row"><label>Preset<select id="niche-preset"><option value="all">Todos</option><option value="viral-small">Viral em canal pequeno</option><option value="medium">Canal médio</option><option value="new">Novos</option><option value="recent">Recentes</option><option value="500k">500 mil views ou mais</option><option value="1m">1 milhão de views ou mais</option><option value="high-outlier">Alto outlier</option><option value="high-vph">Alto VPH histórico</option><option value="manyviews-fewvideos">Muitas views, poucos vídeos</option></select></label>
    <label>Publicação<select id="niche-period"><option value="all">Todo o período</option><option value="week">7 dias</option><option value="month">30 dias</option><option value="3m">90 dias</option><option value="year">365 dias</option></select></label>
    <label>Duração<select id="niche-duration"><option value="all">Todas</option><option value="under1">Menos de 1 min</option><option value="1to4">1 a menos de 4 min</option><option value="4to10">4 a menos de 10 min</option><option value="10to20">10 a menos de 20 min</option><option value="20to60">20 a menos de 60 min</option><option value="over60">60 min ou mais</option></select></label>
    <label>Modo de outlier deste painel<select id="niche-comparison-mode"><option value="sample-median">Mediana da amostra (padrão)</option><option value="sample-channel-reference">Referência da amostra do canal</option></select></label></div>
    <p>A seleção de outlier deste painel é independente da pesquisa. Trocar o modo descarta o relatório; atualizar ou trocar a coleção preserva a seleção. Redefinir volta à mediana.</p><p id="niche-comparison-info"></p>
    <details><summary>Limiares configuráveis dos presets</summary><p>Valores locais escolhidos para exploração; não são definições oficiais. Canal médio: acima do limite pequeno até o limite médio, inclusive.</p><div id="niche-thresholds" class="row"></div></details>
    <fieldset><legend>Canais (nenhum selecionado = todos)</legend><div id="niche-channels">Atualize para carregar canais da amostra.</div></fieldset>
    <div class="row"><button id="niche-refresh" class="primary">Atualizar análise</button><button id="niche-reset">Redefinir filtros</button><button id="niche-export-json" disabled>Exportar JSON</button><button id="niche-export-csv" disabled>Exportar CSV</button><button id="niche-export-markdown" disabled>Exportar Markdown</button></div><p id="niche-status" role="status" aria-live="polite">Atualize para analisar a coleção atual.</p></div>
    <div id="niche-result" hidden><div class="card"><h3>Amostra e distribuição</h3><p id="niche-scope"></p><p id="niche-distribution"></p><p id="niche-comparison-summary"></p></div>
    <div class="card"><h3>Cobertura dos vídeos incluídos</h3><table><thead><tr><th>Dado</th><th>Conhecidos</th><th>Desconhecidos</th></tr></thead><tbody id="niche-coverage"></tbody></table></div>
    <div class="card"><h3>Publicações observadas por canal</h3><p>Contagens da amostra incluída, por data de publicação, até o instante da análise. Meses em UTC; datas desconhecidas ficam de fora.</p><div class="table-wrap"><table><thead><tr><th>Canal</th><th>Vídeos</th><th>Views conhecidas / cobertura</th><th>Inscritos observados / cobertura</th><th>30 dias</th><th>90 dias</th><th>365 dias</th><th>Datas desconhecidas</th><th>Meses observados</th></tr></thead><tbody id="niche-timeline"></tbody></table></div></div>
    <div class="card"><h3>Vídeos incluídos</h3><div class="table-wrap"><table><thead><tr><th>Vídeo</th><th>Canal</th><th>Views</th><th>Inscritos</th><th>Views/inscrito</th><th>VPH histórico</th><th>Outlier</th></tr></thead><tbody id="niche-videos"></tbody></table></div></div><div class="card"><h3>Limites</h3><ul id="niche-limitations"></ul></div></div>`;
  const get = <T extends HTMLElement = HTMLElement>(id: string) => section.querySelector<T>(`#niche-${id}`)!;
  const thresholdLabels: Record<keyof NicheThresholds, string> = { viralViews: "Views mínimas viral", smallSubs: "Inscritos máximos pequeno", mediumSubs: "Inscritos máximos médio", newDays: "Novos: dias máximos", recentDays: "Recentes: dias máximos", outlier: "Outlier mínimo (×)", vph: "VPH histórico mínimo", channelViews: "Views mínimas do canal na amostra", channelVideos: "Vídeos máximos do canal na amostra" };
  for (const key of Object.keys(DEFAULT_NICHE_THRESHOLDS) as (keyof NicheThresholds)[]) { const label = document.createElement("label"); label.textContent = thresholdLabels[key]; const input = document.createElement("input"); input.type = "number"; input.min = "0"; input.step = key === "channelVideos" ? "1" : "any"; input.id = `niche-threshold-${key}`; input.value = String(DEFAULT_NICHE_THRESHOLDS[key]); label.append(input); get("thresholds").append(label); }
  const exports = (["json", "csv", "markdown"] as const).map(format => get<HTMLButtonElement>(`export-${format}`));
  const comparisonDescription = (mode: ResearchComparisonMode) => mode === "sample-median"
    ? "Modo sample-median: mediana da amostra elegível anterior aos filtros, mesmo canal e formato, mínimo de três referências e alvo excluído por ID. Não é o índice de um catálogo completo."
    : "Modo sample-channel-reference: média da amostra elegível do canal antes dos filtros, mínimo de três referências e alvo excluído por ID; Shorts usam mediana dos positivos com ao menos dez positivos, senão média. Exige ID ou URL/handle explícito e não conflitante, regra mais estrita que a pesquisa geral; nome isolado não basta. Sem identidade ou referência válida, fica desconhecido, sem fallback à mediana padrão. Não é a média do catálogo completo.";
  const updateComparisonInfo = () => { get("comparison-info").textContent = comparisonDescription(get<HTMLSelectElement>("comparison-mode").value as ResearchComparisonMode); };
  let report: NicheReport | undefined;
  const invalidate = () => {
    report = undefined; get("result").hidden = true; exports.forEach(button => { button.disabled = true; });
    for (const id of ["scope", "distribution", "comparison-summary", "coverage", "timeline", "videos", "limitations"]) get(id).replaceChildren();
    get("status").textContent = "Filtros alterados. Atualize para recalcular.";
  };
  const invalidateSnapshot = () => { invalidate(); get("channels").textContent = "Atualize para carregar canais da amostra."; get("status").textContent = "Coleção alterada. Atualize para recalcular."; };
  section.addEventListener("change", event => { if ((event.target as HTMLElement).matches("select, input")) { updateComparisonInfo(); invalidate(); } });
  get("thresholds").addEventListener("input", invalidate);
  const selected = () => [...get("channels").querySelectorAll<HTMLInputElement>("input:checked")].map(input => input.value);
  get("refresh").addEventListener("click", () => {
    try {
      const thresholds = { ...DEFAULT_NICHE_THRESHOLDS };
      for (const key of Object.keys(thresholds) as (keyof NicheThresholds)[]) { const input = get<HTMLInputElement>(`threshold-${key}`); if (!input.value.trim()) throw new Error("Preencha todos os limiares."); thresholds[key] = input.valueAsNumber; }
      const selectedChannels = selected();
      report = buildNicheReport(deps.snapshot().videos, { preset: get<HTMLSelectElement>("preset").value as NichePreset, period: get<HTMLSelectElement>("period").value as NichePeriod, duration: get<HTMLSelectElement>("duration").value as NicheDuration, channels: selectedChannels, thresholds, comparisonMode: get<HTMLSelectElement>("comparison-mode").value as ResearchComparisonMode });
      const current = report;
      const channelChoices = [...current.availableChannels, ...selectedChannels.filter(key => !current.availableChannels.some(channel => channel.key === key)).map(key => ({ key, label: "Canal indisponível na coleção atual" }))];
      get("channels").replaceChildren(...channelChoices.map(channel => { const label = document.createElement("label"), input = document.createElement("input"); input.type = "checkbox"; input.value = channel.key; input.checked = selectedChannels.includes(channel.key); label.append(input, document.createTextNode(` ${channel.label} (${channel.key}) `)); return label; }));
      get("scope").textContent = `${current.scope.input} registros · ${current.scope.excludedApi} da API excluídos · ${current.scope.duplicates} duplicatas excluídas · ${current.scope.eligible} elegíveis · ${current.scope.included} incluídos.`;
      get("distribution").textContent = `Outliers ≥2×: ${current.distribution.atLeast2}; ≥5×: ${current.distribution.atLeast5}; conhecidos: ${current.distribution.known}; desconhecidos: ${current.distribution.unknown}.`;
      get("comparison-summary").textContent = `${comparisonDescription(current.options.comparisonMode)} VPH é média desde publicação. Origem e denominador de cada comparação estão na tabela e nas exportações.`;
      const coverageLabels: Record<string, string> = { views: "Views", subscribers: "Inscritos", publicationDate: "Publicação", duration: "Duração", channel: "Canal", vph: "VPH", outlier: "Outlier", viewsPerSubscriber: "Views/inscrito" };
      get("coverage").replaceChildren(...Object.entries(current.coverage).map(([key, count]) => row([coverageLabels[key], String(count.known), String(count.unknown)])));
      get("timeline").replaceChildren(...current.channels.map(channel => row([channel.label, String(channel.videoCount), `${number(channel.totalViews)} (${channel.knownViews} conhecidos, ${channel.unknownViews} desconhecidos)`, `${number(channel.minSubscribers)}–${number(channel.maxSubscribers)} (${channel.knownSubscribers} conhecidos, ${channel.unknownSubscribers} desconhecidos)`, String(channel.uploads30), String(channel.uploads90), String(channel.uploads365), String(channel.unknownDates), channel.months.map(month => `${month.month}: ${month.count}`).join(", ") || "desconhecido"])));
      get("videos").replaceChildren(...current.videos.map(video => row([video.title, video.channel ?? "desconhecido", number(video.views), number(video.subscribers), number(video.viewsPerSubscriber), number(video.lifetimeVph), `${video.outlier === undefined ? "desconhecido" : `${number(video.outlier)}×`}; método previsto ${video.outlierMethod}; referência ${number(video.outlierReference ?? undefined)} (${video.outlierReferenceStatus}); ${video.outlierReferences} candidatas (${video.outlierPositiveReferences} positivas); origem ${video.outlierProvenance}; ${video.outlierLimitation}`])));
      get("limitations").replaceChildren(...current.limitations.map(text => { const li = document.createElement("li"); li.textContent = text; return li; }));
      get("result").hidden = false; exports.forEach(button => { button.disabled = false; }); get("status").textContent = `Análise atualizada: ${current.scope.included} vídeos incluídos.`;
    } catch (error) { invalidate(); get("status").textContent = error instanceof Error ? error.message : "Não foi possível calcular a análise."; }
  });
  const reset = () => { for (const id of ["preset", "period", "duration"]) get<HTMLSelectElement>(id).value = "all"; get<HTMLSelectElement>("comparison-mode").value = "sample-median"; updateComparisonInfo(); for (const key of Object.keys(DEFAULT_NICHE_THRESHOLDS) as (keyof NicheThresholds)[]) get<HTMLInputElement>(`threshold-${key}`).value = String(DEFAULT_NICHE_THRESHOLDS[key]); get("channels").querySelectorAll<HTMLInputElement>("input").forEach(input => { input.checked = false; }); invalidate(); };
  get("reset").addEventListener("click", reset);
  exports.forEach((button, index) => button.addEventListener("click", () => { if (!report) return; const format = (["json", "csv", "markdown"] as const)[index]; const content = format === "json" ? JSON.stringify(report, null, 2) : format === "csv" ? toCsv(nicheRows(report), [...NICHE_EXPORT_COLUMNS]) : nicheMarkdown(report); downloadBlob(new Blob([content], { type: format === "json" ? "application/json" : format === "csv" ? "text/csv;charset=utf-8" : "text/markdown;charset=utf-8" }), `prevlev-nicho.${format === "markdown" ? "md" : format}`); }));
  updateComparisonInfo();
  const tools = { invalidate: invalidateSnapshot, reset };
  instances.set(section, tools);
  return tools;
}
function number(value: number | undefined): string { return value === undefined ? "desconhecido" : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value); }
function row(values: string[]): HTMLTableRowElement { const tr = document.createElement("tr"); for (const value of values) { const td = document.createElement("td"); td.textContent = value; tr.append(td); } return tr; }
