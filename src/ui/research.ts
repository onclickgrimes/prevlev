import { researchPreset, researchPresets, researchSurface, researchSortKeys, researchMarkdown, validateResearchFilter, type ResearchFilter, type ResearchSortKey } from "../core/research";
import type { VideoRecord } from "../shared/types";
import { downloadBlob } from "../core/media";

export const researchLabels: Record<ResearchSortKey, string> = { views: "Visualizações", vph: "VPH médio histórico", outlier: "Outlier da amostra", recent: "Data de publicação", duration: "Duração", subscribers: "Inscritos conhecidos", title: "Título", viewsPerSubscriber: "Views por inscrito conhecido" };
export interface ResearchTools { readOptions: () => ResearchFilter; reset: () => void; refresh: () => void }
export function initResearchTools(deps: { getUrl: () => string; onChange: () => void; getVisibleVideos: () => VideoRecord[]; getAllVideos: () => VideoRecord[] }): ResearchTools {
  const table = document.getElementById("video-rows")?.closest(".table-wrap");
  if (!table) throw new Error("A pesquisa de vídeos não está disponível.");
  const host = document.createElement("div"); host.id = "research-enhancements";
  const choices = researchSortKeys.map(key => `<option value="${key}">${researchLabels[key]}</option>`).join("");
  host.innerHTML = `<details class="research-advanced"><summary>Atalhos e ordenação avançada</summary><div class="form-grid">
    <label>Atalho por contexto<select id="research-preset"><option value="">Escolha um atalho</option></select></label>
    <label>Primeiro critério<select id="research-sort-primary"><option value="none">Ordem da coleta</option>${choices}</select></label>
    <label>Direção do primeiro<select id="research-direction-primary"><option value="desc">Maior primeiro / Z–A</option><option value="asc">Menor primeiro / A–Z</option></select></label>
    <label>Comparação local de outlier<select id="research-comparison"><option value="sample-median">Mediana da amostra (padrão, mínimo 3)</option><option value="sample-channel-reference">Referência média da amostra do canal</option></select></label>
    <label class="toggle"><input id="research-priority" type="checkbox"> Priorizar views por inscrito conhecido, fora de canais</label>
    <label class="toggle"><input id="research-hide-feed" type="checkbox"> Ocultar Shorts no feed / inscrições ao aplicar</label>
    <label class="toggle"><input id="research-hide-search" type="checkbox"> Ocultar Shorts na busca ao aplicar</label>
    </div><div class="row"><button id="research-add-sort">Adicionar segundo critério</button><button id="research-remove-sort" hidden>Remover segundo critério</button><button id="research-reset">Limpar atalhos e ordenação avançada</button></div>
    <div id="research-secondary" class="form-grid" hidden><label>Segundo critério<select id="research-sort-secondary">${choices}</select></label><label>Direção do segundo<select id="research-direction-secondary"><option value="desc">Maior primeiro / Z–A</option><option value="asc">Menor primeiro / A–Z</option></select></label></div>
    <p id="research-status" role="status"></p><p id="research-context"></p><p id="research-comparison-note"></p><button id="research-export-markdown">Exportar pesquisa em Markdown</button><p>Atalhos próprios baseados nas regras verificadas. Ordenações mantêm valores desconhecidos no fim, nas duas direções. Views/inscrito exige denominador positivo conhecido. Dados da API oficial são excluídos das métricas derivadas.</p></details>`;
  table.before(host);
  const get = <T extends HTMLElement = HTMLElement>(id: string) => host.querySelector<T>(`#research-${id}`)!;
  const legacy = document.getElementById("sort") as HTMLSelectElement;
  for (const [key, label] of [["default", "Ordem da coleta"], ["viewsPerSubscriber", "Views por inscrito conhecido"]]) if (![...legacy.options].some(option => option.value === key)) { const option = document.createElement("option"); option.value = key; option.textContent = label; legacy.append(option); }
  const primary = get<HTMLSelectElement>("sort-primary"), secondary = get<HTMLSelectElement>("sort-secondary"), preset = get<HTMLSelectElement>("preset");
  let secondEnabled = false, lastSurface = researchSurface(deps.getUrl());
  let overrides: Pick<ResearchFilter, "publishedAfter" | "publishedBefore" | "publishedBeforeExclusive" | "subscribersBelow"> = {};
  const nativeIds = ["video-filter", "channel-filter", "min-views", "max-views", "min-subscribers", "max-subscribers", "min-duration", "max-duration", "min-vph", "max-vph", "min-outlier", "max-outlier", "published-after", "published-before", "short-filter"];
  const field = <T extends HTMLInputElement | HTMLSelectElement>(id: string) => document.getElementById(id) as T;
  function readOptions(): ResearchFilter {
    const surface = researchSurface(deps.getUrl());
    const criteria: NonNullable<ResearchFilter["criteria"]> = primary.value === "none" ? [] : [{ key: primary.value as ResearchSortKey, direction: get<HTMLSelectElement>("direction-primary").value as "asc" | "desc" }];
    if (secondEnabled) criteria.push({ key: secondary.value as ResearchSortKey, direction: get<HTMLSelectElement>("direction-secondary").value as "asc" | "desc" });
    const filter: ResearchFilter = { ...overrides, surface, criteria, priority: get<HTMLInputElement>("priority").checked ? "views-per-subscriber" : "none", comparisonMode: get<HTMLSelectElement>("comparison").value as ResearchFilter["comparisonMode"], hideShortsOnFeed: get<HTMLInputElement>("hide-feed").checked, hideShortsOnSearch: get<HTMLInputElement>("hide-search").checked };
    validateResearchFilter(filter); return filter;
  }
  function detail(): void {
    const mode = get<HTMLSelectElement>("comparison").value;
    get("comparison-note").textContent = mode === "sample-median" ? "Padrão: views / mediana de pelo menos 3 vídeos comparáveis carregados, excluindo o alvo. O canal completo e a fórmula proprietária não são conhecidos." : "Alternativa aproximada: views / média dos vídeos comparáveis carregados do canal conhecido. Shorts usam a mediana dos positivos com pelo menos 10 referências positivas; abaixo disso usam a média. Mínimo de 3 referências. Não equivale ao índice proprietário nem à média do canal completo.";
    const extra = [overrides.subscribersBelow === undefined ? "" : `inscritos < ${overrides.subscribersBelow}`, overrides.publishedAfter ? `publicação ≥ ${overrides.publishedAfter}` : "", overrides.publishedBeforeExclusive ? `publicação < ${overrides.publishedBeforeExclusive}` : ""].filter(Boolean).join(" · ");
    get("status").textContent = (preset.value ? researchPresets(researchSurface(deps.getUrl())).find(item => item.id === preset.value)?.description ?? "" : "Filtros manuais.") + (extra ? ` Limites precisos UTC: ${extra}.` : "");
  }
  function notify(): void { try { readOptions(); get("status").classList.remove("error"); detail(); deps.onChange(); } catch (error) { get("status").textContent = error instanceof Error ? error.message : "Filtro inválido."; get("status").classList.add("error"); } }
  function refresh(): void {
    const surface = researchSurface(deps.getUrl());
    const selected = preset.value;
    const options = researchPresets(surface);
    preset.replaceChildren();
    const blank = document.createElement("option"); blank.value = ""; blank.textContent = "Escolha um atalho"; preset.append(blank);
    for (const item of options) { const option = document.createElement("option"); option.value = item.id; option.textContent = item.label; option.disabled = !item.available; preset.append(option); }
    if (surface !== lastSurface) { overrides = {}; preset.value = ""; get<HTMLInputElement>("priority").checked = false; if (primary.value === "viewsPerSubscriber") primary.value = "views"; if (secondary.value === "viewsPerSubscriber") secondary.value = "title"; lastSurface = surface; }
    else preset.value = options.find(item => item.id === selected)?.available ? selected : "";
    get<HTMLInputElement>("priority").disabled = surface === "channel";
    for (const select of [primary, secondary]) for (const option of select.options) if (option.value === "viewsPerSubscriber") option.disabled = surface === "channel";
    get("context").textContent = `Contexto da coleta: ${{ home: "página inicial", subscriptions: "inscrições", search: "busca", channel: "canal", other: "outra página / origem não reconhecida" }[surface]}. Atalhos exclusivos da busca não são aplicados em outros contextos.`;
    detail();
  }
  function syncLegacy(): void { legacy.value = primary.value === "recent" ? "date" : primary.value === "none" ? "default" : primary.value; }
  function reset(): void {
    overrides = {}; preset.value = ""; secondEnabled = false; get("secondary").hidden = true; get("remove-sort").hidden = true; get("add-sort").hidden = false;
    primary.value = legacy.value === "date" ? "recent" : legacy.value === "default" ? "none" : legacy.value || "views";
    secondary.value = "title"; get<HTMLSelectElement>("direction-primary").value = primary.value === "title" ? "asc" : "desc"; get<HTMLSelectElement>("direction-secondary").value = "asc";
    get<HTMLSelectElement>("comparison").value = "sample-median"; for (const id of ["priority", "hide-feed", "hide-search"]) get<HTMLInputElement>(id).checked = false;
    refresh();
  }
  preset.addEventListener("change", () => {
    if (!preset.value) { overrides = {}; notify(); return; }
    try {
      const chosen = researchPreset(preset.value, researchSurface(deps.getUrl()));
      for (const id of nativeIds) field<HTMLInputElement>(id).value = id === "short-filter" ? "all" : "";
      const map = { minViews: "min-views", maxViews: "max-views", minSubscribers: "min-subscribers", maxSubscribers: "max-subscribers", minDurationSeconds: "min-duration", maxDurationSeconds: "max-duration", minVph: "min-vph", maxVph: "max-vph", minOutlier: "min-outlier", maxOutlier: "max-outlier" } as const;
      for (const key of Object.keys(map) as (keyof typeof map)[]) if (chosen.filter[key] !== undefined) field<HTMLInputElement>(map[key]).value = String(chosen.filter[key]);
      field<HTMLSelectElement>("short-filter").value = chosen.filter.shorts === "only" ? "shorts" : chosen.filter.shorts === "exclude" ? "long" : "all";
      if (chosen.filter.publishedAfter) field<HTMLInputElement>("published-after").value = chosen.filter.publishedAfter.slice(0, 10);
      if (chosen.filter.publishedBeforeExclusive) field<HTMLInputElement>("published-before").value = chosen.filter.publishedBeforeExclusive.slice(0, 10);
      overrides = { ...(chosen.filter.publishedAfter ? { publishedAfter: chosen.filter.publishedAfter } : {}), ...(chosen.filter.publishedBeforeExclusive ? { publishedBeforeExclusive: chosen.filter.publishedBeforeExclusive, publishedBefore: chosen.filter.publishedBeforeExclusive } : {}), ...(chosen.filter.subscribersBelow !== undefined ? { subscribersBelow: chosen.filter.subscribersBelow } : {}) };
      primary.value = chosen.filter.criteria?.[0].key ?? "views"; get<HTMLSelectElement>("direction-primary").value = chosen.filter.criteria?.[0].direction ?? "desc"; secondEnabled = false; get("secondary").hidden = true; get("remove-sort").hidden = true; get("add-sort").hidden = false;
      get<HTMLInputElement>("priority").checked = false; get<HTMLInputElement>("hide-feed").checked = false; get<HTMLInputElement>("hide-search").checked = false; syncLegacy(); notify();
    } catch (error) { get("status").textContent = error instanceof Error ? error.message : "Atalho inválido."; get("status").classList.add("error"); }
  });
  get("add-sort").addEventListener("click", () => { if (primary.value === "none") primary.value = "views"; if (secondary.value === primary.value) secondary.value = primary.value === "title" ? "views" : "title"; secondEnabled = true; get("secondary").hidden = false; get("remove-sort").hidden = false; get("add-sort").hidden = true; syncLegacy(); notify(); });
  get("remove-sort").addEventListener("click", () => { secondEnabled = false; get("secondary").hidden = true; get("remove-sort").hidden = true; get("add-sort").hidden = false; notify(); });
  for (const id of ["sort-primary", "direction-primary", "sort-secondary", "direction-secondary", "priority", "comparison", "hide-feed", "hide-search"]) get(id).addEventListener("change", () => { syncLegacy(); notify(); });
  legacy.addEventListener("change", () => { primary.value = legacy.value === "date" ? "recent" : legacy.value === "default" ? "none" : legacy.value; get<HTMLSelectElement>("direction-primary").value = primary.value === "title" ? "asc" : "desc"; notify(); });
  for (const id of nativeIds) field<HTMLInputElement>(id).addEventListener("input", () => { if (id === "published-after") delete overrides.publishedAfter; if (id === "published-before") { delete overrides.publishedBefore; delete overrides.publishedBeforeExclusive; } if (id === "max-subscribers" || id === "min-subscribers") delete overrides.subscribersBelow; preset.value = ""; notify(); });
  get("reset").addEventListener("click", () => { reset(); notify(); });
  get("export-markdown").addEventListener("click", () => { try { const filter = readOptions(); downloadBlob(new Blob([researchMarkdown(deps.getVisibleVideos(), deps.getAllVideos(), filter)], { type: "text/markdown;charset=utf-8" }), "prevlev-pesquisa.md"); } catch (error) { get("status").textContent = error instanceof Error ? error.message : "Não foi possível exportar a pesquisa."; get("status").classList.add("error"); } });
  reset();
  return { readOptions, reset, refresh };
}
