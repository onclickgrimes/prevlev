import type { VideoRecord } from "../shared/types";
import type { CardFilter } from "./youtube";
import type { CollectionController, CollectionState } from "./collection";
import { researchPresets, researchPreset, researchSurface, selectResearchVideos, researchComparison, describeResearchComparison, describeResearchFilter, researchRows, researchMarkdown, type ResearchSortKey } from "../core/research";
import { isoBoundary } from "../core/observations";
import { researchLabels } from "../ui/research";
import { toCsv } from "../core/export";
import { downloadBlob } from "../core/media";
import { videoIdFromUrl } from "../core/parse";

export interface ResearchOverlayDeps { getVideos: () => VideoRecord[]; getFilter: () => CardFilter; setFilter: (filter: CardFilter) => void; getUrl: () => string; collector: CollectionController; getMetrics?: () => boolean; setMetrics?: (enabled: boolean) => void }
const PAGE_SIZE = 100;
export function mountResearchOverlay(container: HTMLElement, deps: ResearchOverlayDeps): { refresh: () => void; dispose: () => void } {
  const shell = document.createElement("div"); shell.dataset.prevlevResearchOverlay = "";
  const choices = Object.entries(researchLabels).map(([key, label]) => `<option value="${key}">${label}</option>`).join("");
  shell.innerHTML = `<style>[data-prevlev-research-overlay] fieldset{min-width:0;border:1px solid #46435b;border-radius:8px;margin:8px 0;padding:9px}[data-prevlev-research-overlay] label{display:grid;gap:3px}[data-prevlev-research-overlay] .smallrow{display:flex;flex-wrap:wrap;gap:5px}[data-prevlev-research-overlay] .smallrow>*{flex:1;min-width:70px}[data-prevlev-research-overlay] .sample{display:grid;gap:7px;max-height:400px;overflow:auto}[data-prevlev-research-overlay] .sample[data-layout=grid]{grid-template-columns:repeat(2,minmax(0,1fr))}[data-prevlev-research-overlay] .sample[data-layout=sidebar]{position:fixed;right:min(350px,45vw);top:80px;bottom:20px;width:min(400px,48vw);max-height:none;z-index:2147483646;background:#181923;border:1px solid #79718e;border-radius:10px;padding:12px}[data-prevlev-research-overlay] article{min-width:0;background:#292a38;border:1px solid #454257;border-radius:7px;padding:8px;overflow-wrap:anywhere}[data-prevlev-research-overlay] article a{display:block;font-weight:600}[data-prevlev-research-overlay] article small{display:block;font-size:11px;color:#c2bed4}[data-prevlev-research-overlay] progress{width:100%}[data-prevlev-research-overlay] [hidden]{display:none!important}</style>
    <details><summary>Pesquisa avançada e amostra</summary><fieldset><legend>Atalhos por contexto</legend><label>Atalho<select id="prevlev-research-preset"><option value="">Manual</option></select></label><p id="prevlev-research-context"></p></fieldset>
    <fieldset><legend>Dois critérios de ordenação</legend><label>Primeiro<select id="prevlev-research-first"><option value="default">Ordem da coleta</option>${choices}</select></label><label>Direção<select id="prevlev-research-first-direction"><option value="desc">Maior primeiro / Z–A</option><option value="asc">Menor primeiro / A–Z</option></select></label><button id="prevlev-research-add">Adicionar segundo</button><div id="prevlev-research-second-row" hidden><label>Segundo<select id="prevlev-research-second">${choices}</select></label><label>Direção<select id="prevlev-research-second-direction"><option value="desc">Maior primeiro / Z–A</option><option value="asc">Menor primeiro / A–Z</option></select></label><button id="prevlev-research-remove">Remover segundo</button></div><label><input id="prevlev-research-priority" type="checkbox"> Priorizar views por inscrito conhecido, fora de canais</label><label>Outlier local<select id="prevlev-research-comparison"><option value="sample-median">Mediana da amostra, mínimo 3 (padrão)</option><option value="sample-channel-reference">Referência média da amostra do canal</option></select></label></fieldset>
    <fieldset><legend>Datas de publicação UTC</legend><div class="smallrow"><button data-prevlev-range="7">7 dias</button><button data-prevlev-range="30">30 dias</button><button data-prevlev-range="90">90 dias</button><button data-prevlev-range="all">Todo período</button></div><label>Desde UTC (inclusivo)<input id="prevlev-research-after" type="datetime-local" step="0.001"></label><label><span id="prevlev-research-before-label">Até UTC (inclusivo)</span><input id="prevlev-research-before" type="datetime-local" step="0.001"></label><p id="prevlev-research-effective"></p></fieldset>
    <fieldset><legend>Apresentação e Shorts</legend><label>Apresentação da amostra neste painel<select id="prevlev-research-layout"><option value="list">Lista</option><option value="grid">Grade</option><option value="sidebar">Barra lateral</option></select></label><label><input id="prevlev-research-badges" type="checkbox"> Mostrar badges existentes nos cards</label><label><input id="prevlev-research-hide-feed" type="checkbox"> Ocultar Shorts no feed / inscrições</label><label><input id="prevlev-research-hide-search" type="checkbox"> Ocultar Shorts na busca</label><button id="prevlev-research-reset">Limpar filtros locais</button></fieldset>
    <fieldset><legend>Carregar mais por rolagem explícita</legend><label>Limite de itens<input id="prevlev-research-limit" type="number" min="1" max="500" value="200"></label><div class="smallrow"><button id="prevlev-research-load">Carregar mais</button><button id="prevlev-research-cancel" disabled>Cancelar</button></div><progress id="prevlev-research-progress" max="1" value="0"></progress><p id="prevlev-research-collection" role="status"></p></fieldset>
    <p id="prevlev-research-status" role="status"></p><div class="smallrow"><button id="prevlev-research-json">JSON</button><button id="prevlev-research-csv">CSV</button><button id="prevlev-research-md">Markdown</button></div><details><summary id="prevlev-research-count">Amostra carregada</summary><div id="prevlev-research-results" class="sample" data-layout="list"></div><div class="smallrow"><button id="prevlev-research-previous" disabled>Página anterior</button><span id="prevlev-research-page"></span><button id="prevlev-research-next" disabled>Próxima página</button></div><p>Até 100 itens por página. Paginar apenas navega pelos itens já observados; não inicia coleta. As exportações incluem toda a amostra filtrada, em todas as páginas.</p></details><p>Exporta somente a amostra real disponível. Nenhum atalho inicia coleta ou IA. Views são contadores observados; VPH é médio histórico. Outlier é aproximação da amostra, não referência do canal completo. Dados da API oficial são excluídos dos cálculos derivados.</p></details>`;
  container.append(shell);
  const get = <T extends HTMLElement = HTMLElement>(id: string) => shell.querySelector<T>(`#prevlev-research-${id}`)!;
  let state: CollectionState = deps.collector.status(), secondEnabled = false, activePreset = "", disposed = false, pageIndex = 0, filterSignature = "";
  const selected = () => { const filter = { ...deps.getFilter(), surface: researchSurface(deps.getUrl()) }; const baseline = deps.getVideos(); return { filter, baseline, rows: selectResearchVideos(baseline, filter) }; };
  const status = (text: string) => { get("status").textContent = text; };
  const commit = (filter: CardFilter) => { try { deps.setFilter({ ...filter, surface: researchSurface(deps.getUrl()) }); pageIndex = 0; refresh(); } catch (error) { status(error instanceof Error ? error.message : "Não foi possível aplicar o filtro."); } };
  const criteria = (): NonNullable<CardFilter["criteria"]> => { const first = get<HTMLSelectElement>("first").value; return [...(first === "default" ? [] : [{ key: first as ResearchSortKey, direction: get<HTMLSelectElement>("first-direction").value as "asc" | "desc" }]), ...(secondEnabled ? [{ key: get<HTMLSelectElement>("second").value as ResearchSortKey, direction: get<HTMLSelectElement>("second-direction").value as "asc" | "desc" }] : [])]; };
  function applyControls(): void {
    activePreset = "";
    commit({ ...deps.getFilter(), criteria: criteria(), priority: get<HTMLInputElement>("priority").checked ? "views-per-subscriber" : "none", comparisonMode: get<HTMLSelectElement>("comparison").value as CardFilter["comparisonMode"], hideShortsOnFeed: get<HTMLInputElement>("hide-feed").checked, hideShortsOnSearch: get<HTMLInputElement>("hide-search").checked });
  }
  function refresh(): void {
    if (disposed) return;
    const filter = deps.getFilter(), surface = researchSurface(deps.getUrl());
    const signature = JSON.stringify([deps.getUrl(), filter]);
    if (signature !== filterSignature) { filterSignature = signature; pageIndex = 0; }
    const preset = get<HTMLSelectElement>("preset"); preset.replaceChildren(option("", "Manual"));
    for (const item of researchPresets(surface)) { const entry = option(item.id, item.label); entry.disabled = !item.available; preset.append(entry); }
    preset.value = researchPresets(surface).find(item => item.id === activePreset)?.available ? activePreset : "";
    get("context").textContent = `Contexto: ${{ home: "início", subscriptions: "inscrições", search: "busca", channel: "canal", other: "outra página" }[surface]}. ${activePreset ? researchPresets(surface).find(item => item.id === activePreset)?.description ?? "" : "Filtros manuais na amostra."}`;
    const sorting = filter.criteria ?? (filter.sort === "default" ? [] : [{ key: filter.sort as ResearchSortKey, direction: filter.sort === "title" ? "asc" as const : "desc" as const }]);
    get<HTMLSelectElement>("first").value = sorting[0]?.key ?? "default"; get<HTMLSelectElement>("first-direction").value = sorting[0]?.direction ?? "desc";
    secondEnabled = sorting.length > 1; get("second-row").hidden = !secondEnabled; get("add").hidden = secondEnabled;
    get<HTMLSelectElement>("second").value = sorting[1]?.key ?? (sorting[0]?.key === "title" ? "views" : "title"); get<HTMLSelectElement>("second-direction").value = sorting[1]?.direction ?? "asc";
    get<HTMLInputElement>("priority").checked = filter.priority === "views-per-subscriber"; get<HTMLInputElement>("priority").disabled = surface === "channel";
    for (const id of ["first", "second"]) for (const entry of get<HTMLSelectElement>(id).options) if (entry.value === "viewsPerSubscriber") entry.disabled = surface === "channel";
    get<HTMLSelectElement>("comparison").value = filter.comparisonMode ?? "sample-median";
    get<HTMLInputElement>("hide-feed").checked = !!filter.hideShortsOnFeed; get<HTMLInputElement>("hide-search").checked = !!filter.hideShortsOnSearch;
    get<HTMLInputElement>("badges").checked = deps.getMetrics?.() ?? false; get<HTMLInputElement>("badges").disabled = !deps.setMetrics;
    try {
      // Read the stored bounds, never recompute a selected preset during refresh/export.
      const after = filter.publishedAfter ? new Date(isoBoundary(filter.publishedAfter, false)).toISOString() : undefined;
      const before = filter.publishedBefore ? new Date(isoBoundary(filter.publishedBefore, true)).toISOString() : undefined;
      const exclusive = filter.publishedBeforeExclusive ? new Date(isoBoundary(filter.publishedBeforeExclusive, false)).toISOString() : undefined;
      get<HTMLInputElement>("after").value = after?.slice(0, -1) ?? ""; get<HTMLInputElement>("before").value = (exclusive ?? before)?.slice(0, -1) ?? "";
      get("before-label").textContent = exclusive ? "Antes de UTC (exclusivo)" : "Até UTC (inclusivo)";
      get("effective").textContent = `Filtros efetivos: ${describeResearchFilter({ ...filter, criteria: sorting, publishedAfter: after, publishedBefore: before, publishedBeforeExclusive: exclusive })}. Datas acima são UTC; atualizar a amostra não desloca estes limites.`;
      const sample = selected();
      const pages = Math.max(1, Math.ceil(sample.rows.length / PAGE_SIZE));
      pageIndex = Math.min(pageIndex, pages - 1);
      const start = pageIndex * PAGE_SIZE, end = Math.min(start + PAGE_SIZE, sample.rows.length);
      get("count").textContent = `${sample.rows.length} correspondem / ${sample.baseline.length} observados · mostrando ${sample.rows.length ? start + 1 : 0}–${end}`;
      get("page").textContent = `Página ${pageIndex + 1} de ${pages}`;
      get<HTMLButtonElement>("previous").disabled = pageIndex === 0; get<HTMLButtonElement>("next").disabled = pageIndex === pages - 1;
      const list = get("results"); list.replaceChildren();
      for (const video of sample.rows.slice(start, end)) {
        const card = document.createElement("article"), id = videoIdFromUrl(video.url), title = document.createElement(id ? "a" : "strong"); title.textContent = video.title;
        if (title instanceof HTMLAnchorElement && id) { title.href = `https://www.youtube.com/watch?v=${id}`; title.target = "_blank"; title.rel = "noopener noreferrer"; }
        const detail = document.createElement("small"), comparison = researchComparison(video, sample.baseline, sample.filter.comparisonMode);
        detail.textContent = `${video.channel ?? "Canal desconhecido"} · ${video.views ?? "?"} views · outlier ${comparison.score?.toFixed(2) ?? "?"}× (${comparison.referenceCount} observações)`; detail.title = describeResearchComparison(comparison, sample.filter.comparisonMode); card.append(title, detail); list.append(card);
      }
      if (!sample.rows.length) { const paragraph = document.createElement("p"); paragraph.textContent = "Nenhum item reconhecido corresponde aos filtros."; list.append(paragraph); }
      for (const id of ["json", "csv", "md"]) get<HTMLButtonElement>(id).disabled = state.phase === "running" || !sample.rows.length;
    } catch (error) { status(error instanceof Error ? error.message : "Não foi possível ler a amostra."); }
    get<HTMLButtonElement>("load").disabled = state.phase === "running"; get<HTMLButtonElement>("cancel").disabled = state.phase !== "running";
    const progress = get<HTMLProgressElement>("progress"); progress.max = state.maxItems || 1; progress.value = state.collectedCount;
    get("collection").textContent = `${state.collectedCount} IDs observados · ${state.steps} rolagens · ${state.reason}`;
  }
  get("preset").addEventListener("change", () => { const id = get<HTMLSelectElement>("preset").value; if (!id) { activePreset = ""; refresh(); status("Modo manual selecionado. Os filtros efetivos foram preservados para edição."); return; } try { const preset = researchPreset(id, researchSurface(deps.getUrl())); activePreset = id; commit({ ...preset.filter, comparisonMode: deps.getFilter().comparisonMode, sort: preset.filter.criteria?.[0].key ?? "default" }); } catch (error) { status(error instanceof Error ? error.message : "Atalho indisponível."); } });
  for (const id of ["first", "first-direction", "second", "second-direction", "priority", "comparison", "hide-feed", "hide-search"]) get(id).addEventListener("change", applyControls);
  get("add").addEventListener("click", () => {
    const first = get<HTMLSelectElement>("first"), second = get<HTMLSelectElement>("second");
    if (first.value === "default") first.value = "views";
    if (second.value === first.value || !second.value) { second.value = first.value === "title" ? "views" : "title"; get<HTMLSelectElement>("second-direction").value = second.value === "title" ? "asc" : "desc"; }
    secondEnabled = true; get("second-row").hidden = false; get("add").hidden = true; applyControls();
  });
  get("remove").addEventListener("click", () => { secondEnabled = false; applyControls(); });
  get("layout").addEventListener("change", () => { get("results").dataset.layout = get<HTMLSelectElement>("layout").value; });
  get("previous").addEventListener("click", () => { if (pageIndex > 0) { pageIndex--; refresh(); } });
  get("next").addEventListener("click", () => { pageIndex++; refresh(); });
  get("badges").addEventListener("change", () => deps.setMetrics?.(get<HTMLInputElement>("badges").checked));
  get("reset").addEventListener("click", () => { activePreset = ""; const old = deps.getFilter(); commit({ sort: "default", criteria: [], hideShortsOnFeed: old.hideShortsOnFeed, hideShortsOnSearch: old.hideShortsOnSearch }); status("Filtros locais limpos; preferências específicas de Shorts preservadas."); });
  for (const button of shell.querySelectorAll<HTMLButtonElement>("[data-prevlev-range]")) button.addEventListener("click", () => { const days = button.dataset.prevlevRange; activePreset = ""; commit({ ...deps.getFilter(), publishedAfter: days === "all" ? undefined : new Date(Date.now() - Number(days) * 86400000).toISOString(), publishedBefore: undefined, publishedBeforeExclusive: undefined }); });
  for (const id of ["after", "before"]) get(id).addEventListener("change", () => { activePreset = ""; const value = get<HTMLInputElement>(id).value; commit({ ...deps.getFilter(), [id === "after" ? "publishedAfter" : "publishedBefore"]: value ? `${value}Z` : undefined, ...(id === "before" ? { publishedBeforeExclusive: undefined } : {}) }); });
  get("load").addEventListener("click", () => { try { deps.collector.start({ kind: "videos", maxItems: Number(get<HTMLInputElement>("limit").value), maxSteps: 30, timeoutMs: 60000 }); status("Coleta por rolagem iniciada explicitamente. A amostra continua parcial."); } catch (error) { status(error instanceof Error ? error.message : "Não foi possível iniciar a coleta."); } });
  get("cancel").addEventListener("click", () => { deps.collector.cancel(); });
  for (const format of ["json", "csv", "md"] as const) get(format).addEventListener("click", () => { try { const sample = selected(); if (state.phase === "running") throw new Error("Aguarde ou cancele a coleta antes de exportar."); const rows = researchRows(sample.rows, sample.baseline, sample.filter); const content = format === "json" ? JSON.stringify({ source: "local-observations", url: deps.getUrl(), filter: sample.filter, count: sample.rows.length, videos: sample.rows, comparisons: rows }, null, 2) : format === "csv" ? toCsv(rows) : researchMarkdown(sample.rows, sample.baseline, sample.filter); downloadBlob(new Blob([content], { type: format === "json" ? "application/json" : format === "csv" ? "text/csv;charset=utf-8" : "text/markdown;charset=utf-8" }), `prevlev-pesquisa-local.${format}`); } catch (error) { status(error instanceof Error ? error.message : "Não foi possível exportar."); } });
  const unsubscribe = deps.collector.subscribe(value => { state = value; refresh(); });
  refresh();
  return { refresh, dispose: () => { disposed = true; unsubscribe(); shell.remove(); } };
}
function option(value: string, text: string): HTMLOptionElement { const option = document.createElement("option"); option.value = value; option.textContent = text; return option; }
