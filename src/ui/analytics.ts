import type { PageSnapshot } from "../shared/types";
import { describeResearchFilter, type ResearchFilter } from "../core/research";
import { buildAnalyticsReport, reportMarkdown, reportRows, type AnalyticsReport } from "../core/analytics";
import { toCsv } from "../core/export";
import { downloadBlob } from "../core/media";
import { videoIdFromUrl } from "../core/parse";

export interface AnalyticsTools { invalidate(): void; }
const mountedAnalytics = new WeakMap<HTMLElement, AnalyticsTools>();

export function initAnalyticsTools(deps: { snapshot: () => PageSnapshot; filter: () => ResearchFilter }): AnalyticsTools {
  const section = document.getElementById("analytics");
  if (!section) return { invalidate() {} };
  const existing = mountedAnalytics.get(section); if (existing) return existing;
  if (section.dataset.analyticsReady) return { invalidate() {} };
  section.dataset.analyticsReady = "true";
  section.innerHTML = `
    <div class="card"><span class="eyebrow">DADOS OBSERVADOS NO NAVEGADOR</span><h2>Analytics local</h2>
      <p>Explore a coleção carregada, a cobertura dos dados e os vídeos publicados por mês. Atualize o relatório após mudar a coleta ou os filtros.</p>
      <div class="row"><label>Escopo do relatório<select id="analytics-source"><option value="all">Toda a coleção</option><option value="filtered">Aplicar filtros da pesquisa</option></select></label><button id="analytics-refresh" class="primary">Atualizar relatório</button></div>
      <p id="analytics-status" role="status" aria-live="polite">Atualize para calcular um relatório com a coleção atual.</p>
      <div class="row"><button id="analytics-export-json" disabled>Exportar JSON</button><button id="analytics-export-csv" disabled>Exportar CSV</button><button id="analytics-export-markdown" disabled>Exportar Markdown</button></div>
    </div>
    <div id="analytics-result" hidden>
      <div class="card"><h3>Amostra e procedência</h3><p id="analytics-scope"></p><p id="analytics-provenance"></p><p id="analytics-filter-summary"></p><p id="analytics-comparison"></p></div>
      <div id="analytics-totals" class="metrics"></div>
      <div class="grid two"><div class="card"><h3>Cobertura dos dados incluídos</h3><div class="table-wrap"><table><thead><tr><th>Dado</th><th>Conhecidos</th><th>Desconhecidos</th></tr></thead><tbody id="analytics-coverage"></tbody></table></div></div>
      <div class="card"><h3>Formatos observados</h3><div id="analytics-formats"></div><p>Duração isolada não determina se um vídeo é Short. Formato não informado permanece desconhecido.</p></div></div>
      <div class="card"><h3>Canais identificados</h3><p>Identidades conhecidas são agrupadas com cautela. Nomes iguais não unem canais com IDs distintos.</p><div class="table-wrap"><table><thead><tr><th>Canal</th><th>Vídeos</th><th>Views conhecidas</th><th>Dados de views</th><th>Média</th><th>Mediana</th><th>VPH médio histórico</th></tr></thead><tbody id="analytics-channels"></tbody></table></div></div>
      <div class="card"><h3>Publicações observadas por mês</h3><p>Meses em UTC; views são os contadores atuais dos vídeos publicados no mês, não o tráfego recebido naquele mês.</p><div class="table-wrap"><table><thead><tr><th>Mês UTC</th><th>Vídeos</th><th>Views conhecidas</th><th>Views ausentes</th><th>Duração conhecida (s)</th><th>Durações ausentes</th></tr></thead><tbody id="analytics-months"></tbody></table></div></div>
      <div class="card"><h3>Até 20 vídeos por views observadas</h3><p>O outlier conserva a amostra completa elegível anterior aos filtros. Sem referência suficiente, o valor permanece desconhecido.</p><div class="table-wrap"><table><thead><tr><th>Vídeo</th><th>Canal</th><th>Formato</th><th>Views observadas</th><th>VPH médio histórico</th><th>Outlier da amostra</th></tr></thead><tbody id="analytics-top"></tbody></table></div></div>
      <div class="card"><h3>Limites e origem dos resultados</h3><ul id="analytics-limitations"></ul></div>
    </div>`;
  const get = <T extends HTMLElement = HTMLElement>(id: string) => section.querySelector<T>(`#analytics-${id}`)!;
  const source = get<HTMLSelectElement>("source");
  const status = get("status");
  const result = get("result");
  const exports = ["json", "csv", "markdown"].map(format => get<HTMLButtonElement>(`export-${format}`));
  let report: AnalyticsReport | undefined, reportStamp: string | undefined;
  const capture = () => {
    const snapshot = deps.snapshot(), mode = source.value;
    if (mode !== "all" && mode !== "filtered") throw new Error("Escolha um escopo válido para o relatório.");
    return { mode, url: snapshot.url, videoId: snapshot.videoId, title: snapshot.title,
      videos: snapshot.videos.map(video => ({ ...video })), warnings: [...snapshot.warnings],
      filter: mode === "filtered" ? structuredClone(deps.filter()) : undefined };
  };
  // Preserve invalid numbers in the binding so NaN/Infinity cannot match a previous null.
  const stamp = (input: ReturnType<typeof capture>) => JSON.stringify(input, (_key, value: unknown) => typeof value === "number" && !Number.isFinite(value) ? { invalidNumber: String(value) } : value);
  const disableExports = (disabled: boolean) => exports.forEach(button => { button.disabled = disabled; });
  const invalidate = () => {
    report = undefined; reportStamp = undefined; result.hidden = true; disableExports(true);
    for (const id of ["scope", "provenance", "filter-summary", "comparison", "totals", "coverage", "formats", "channels", "months", "top", "limitations"]) get(id).replaceChildren();
    status.textContent = "Coleção, contexto ou filtros alterados. Atualize para recalcular; o relatório anterior não está disponível para exportação. A coleção original foi preservada.";
    status.classList.remove("error");
  };
  for (const event of ["input", "change"]) source.addEventListener(event, invalidate);
  const checkContext = () => {
    if (!report) return;
    try { if (reportStamp !== stamp(capture())) invalidate(); }
    catch { invalidate(); }
  };
  for (const event of ["input", "change"]) document.getElementById("research")?.addEventListener(event, checkContext);
  get("refresh").addEventListener("click", () => {
    invalidate();
    try {
      const input = capture(), signature = stamp(input);
      const next = buildAnalyticsReport(input.videos, input.mode === "filtered" ? { filter: input.filter } : {});
      if (signature !== stamp(capture())) throw new Error("A fonte ou os filtros mudaram durante o cálculo. O resultado foi descartado; atualize novamente.");
      renderReport(next, input.warnings); report = next; reportStamp = signature;
      status.textContent = `Relatório atualizado em ${new Date(report.generatedAt).toLocaleString("pt-BR", { timeZone: "UTC" })} UTC. ${report.scope.includedCount} vídeos incluídos.`;
      status.classList.remove("error"); result.hidden = false; disableExports(false);
    } catch (error) {
      invalidate();
      status.textContent = error instanceof Error ? error.message : "Não foi possível calcular o relatório.";
      status.classList.add("error");
    }
  });
  const exportFile = (format: "json" | "csv" | "markdown") => {
    if (!report) return;
    try {
      if (reportStamp !== stamp(capture())) { invalidate(); return; }
      const content = format === "json" ? JSON.stringify(report, null, 2) : format === "csv" ? toCsv(reportRows(report)) : reportMarkdown(report);
      if (reportStamp !== stamp(capture())) { invalidate(); return; }
      const mime = format === "json" ? "application/json" : format === "csv" ? "text/csv;charset=utf-8" : "text/markdown;charset=utf-8";
      downloadBlob(new Blob([content], { type: mime }), `prevlev-analytics.${format === "markdown" ? "md" : format}`);
    } catch (error) {
      invalidate(); status.textContent = error instanceof Error ? error.message : "Não foi possível exportar. Atualize o relatório novamente."; status.classList.add("error");
    }
  };
  exports.forEach((button, index) => button.addEventListener("click", () => exportFile((["json", "csv", "markdown"] as const)[index])));

  function renderReport(current: AnalyticsReport, sourceWarnings: readonly string[]): void {
    const scope = current.scope;
    get("scope").textContent = `${scope.inputCount} registros recebidos · ${scope.includedCount} vídeos incluídos · ${scope.excludedApiCount} da API oficial excluídos · ${scope.excludedDuplicateCount} duplicatas excluídas · ${scope.excludedByFilterCount} excluídos pelos filtros (${scope.excludedByDateCount} por data).`;
    const names: Record<string, string> = { "youtube-dom": "página YouTube", "public-page": "página pública", "user-provided": "fornecido pelo usuário", "youtube-data-api": "API oficial", unspecified: "origem não declarada" };
    get("provenance").textContent = `Origem dos vídeos incluídos: ${Object.entries(current.provenance).map(([key, count]) => `${names[key] ?? key}: ${count}`).join(" · ")}.`;
    get("filter-summary").textContent = source.value === "filtered" ? `Filtros da pesquisa aplicados: ${describeResearchFilter(scope.filter ?? {})}` : "Toda a coleção elegível, após excluir dados da API oficial e duplicatas. Campos ausentes permanecem desconhecidos.";
    get("comparison").textContent = `Modo de outlier: ${scope.filter?.comparisonMode ?? "sample-median"}. A referência usa vídeos elegíveis e deduplicados antes dos filtros, excluindo o alvo por ID; não representa o catálogo completo do canal.`;
    const cards: [string, number | undefined, string][] = [
      ["Views conhecidas", current.totals.knownViews, "Soma dos contadores disponíveis"],
      ["Média de views", current.totals.meanViews, "Somente contadores conhecidos"],
      ["Mediana de views", current.totals.medianViews, "Somente contadores conhecidos"],
      ["VPH médio histórico", current.totals.meanLifetimeVph, "Desde a publicação; não últimos 60 min"],
      ["Mediana de VPH", current.totals.medianLifetimeVph, "Somente datas e views conhecidas"],
      ["Intervalo observado (dias)", current.medianPublishGapDays, "Mediana das lacunas na amostra combinada"],
      ["Duração conhecida (s)", current.totals.knownDurationSeconds, "Soma das durações disponíveis"],
    ];
    get("totals").replaceChildren(...cards.map(([title, amount, hint]) => {
      const card = element("div"); card.className = "metric";
      card.append(element("span", title), element("strong", number(amount)), element("small", hint)); return card;
    }));
    const coverageLabels = { views: "Visualizações", publicationDate: "Data de publicação", duration: "Duração", channel: "Identidade de canal" };
    get("coverage").replaceChildren(...Object.entries(current.coverage).map(([key, count]) => row([coverageLabels[key as keyof typeof coverageLabels], number(count.known), number(count.missing)])));
    get("formats").replaceChildren(element("p", `Shorts: ${number(current.formats.short)} · Vídeos não Shorts: ${number(current.formats.long)} · Desconhecidos: ${number(current.formats.unknown)}`));
    get("channels").replaceChildren(...current.channels.map(channel => row([channel.label, number(channel.videoCount), number(channel.totalViews), `${number(channel.knownViews)} conhecidos / ${number(channel.missingViews)} ausentes`, number(channel.meanViews), number(channel.medianViews), number(channel.meanLifetimeVph)])));
    if (!current.channels.length) get("channels").append(emptyRow("Nenhum canal com identidade conhecida na amostra incluída.", 7));
    get("months").replaceChildren(...current.publicationMonths.map(month => row([month.month, number(month.videoCount), number(month.totalViews), number(month.missingViews), number(month.totalDurationSeconds), number(month.missingDurationCount)])));
    if (!current.publicationMonths.length) get("months").append(emptyRow("Nenhuma data válida de publicação na amostra incluída.", 6));
    get("top").replaceChildren(...current.topVideos.map(video => {
      const videoRow = row(["", video.channel ?? "desconhecido", video.format === "short" ? "Short" : video.format === "long" ? "Não Short" : "desconhecido", number(video.views), number(video.lifetimeVph), `${video.outlierScore === undefined ? "desconhecido" : `${number(video.outlierScore)}×`} · método previsto ${video.outlierMethod ?? "desconhecido"} · denominador ${number(video.outlierReference ?? undefined)} · ${number(video.outlierReferenceCount)} candidatos (${number(video.outlierPositiveReferenceCount)} positivos) · origem ${video.outlierProvenance}`]);
      const id = videoIdFromUrl(video.url);
      const title = id ? element("a", video.title) : element("span", video.title);
      if (title instanceof HTMLAnchorElement && id) { title.href = `https://www.youtube.com/watch?v=${id}`; title.target = "_blank"; title.rel = "noopener noreferrer"; }
      videoRow.cells[0].append(title); return videoRow;
    }));
    if (!current.topVideos.length) get("top").append(emptyRow("Nenhum vídeo na amostra incluída.", 6));
    get("limitations").replaceChildren(...current.limitations.map(text => element("li", text)), ...sourceWarnings.map(text => element("li", `Aviso da coleta: ${text}`)));
  }
  const controller = { invalidate }; mountedAnalytics.set(section, controller); return controller;
}

function number(value: number | undefined): string { return value === undefined || !Number.isFinite(value) ? "desconhecido" : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value); }
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element; }
function row(values: readonly string[]): HTMLTableRowElement { const result = element("tr"); result.append(...values.map(value => element("td", value))); return result; }
function emptyRow(message: string, columns: number): HTMLTableRowElement { const result = row([message]); result.cells[0].colSpan = columns; return result; }
