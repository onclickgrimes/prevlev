import { calculateBoundProfit, isProfitResultCurrent, type BoundProfit, type ProfitInput, type ProfitPeriod } from "../core/profit";
import type { PageSnapshot } from "../shared/types";

/** Local calculator only. Does not edit the Studio revenue card or call a service. */
export function initProfitTools({ snapshot, doc = document }: { snapshot: () => PageSnapshot; doc?: Document }): { render(): void; invalidate(): void } {
  const field = (id: string) => {
    const node = doc.getElementById(id) as HTMLInputElement | null;
    if (!node) throw new Error(`Controle de lucro ausente: ${id}.`);
    return node;
  };
  const revenue = field("revenue");
  const cost = field("cost");
  const count = field("video-total");
  const calculate = doc.getElementById("profit")!;
  const output = doc.getElementById("profit-output")!;
  const panel = doc.createElement("div"); panel.id = "profit-context";
  panel.innerHTML = `<p class="muted">Estimativa local: receita menos custo por vídeo × quantidade manual. O período da página é apenas contexto até sua confirmação. Não inclui outros custos ou impostos.</p>
    <label>Origem da receita <input id="profit-source" maxlength="2000" value="Valor informado manualmente"></label>
    <p id="profit-observation" class="muted"></p>
    <label>Moeda da receita e dos custos <input id="profit-currency" maxlength="40" placeholder="Ex.: BRL ou USD"></label>
    <label>Período da receita <select id="profit-period-mode"><option value="dates">Datas declaradas por você</option><option value="observed">Período da coleta atual</option></select></label>
    <div id="profit-period-dates"><label>Início <input id="profit-period-start" type="date"></label><label>Fim <input id="profit-period-end" type="date"></label></div>
    <label><input id="profit-revenue-confirm" type="checkbox"> Confirmo que esta receita pertence ao período declarado.</label>
    <label><input id="profit-count-confirm" type="checkbox"> Confirmei manualmente a quantidade de vídeos deste mesmo período e os custos na moeda declarada.</label>
    <p id="profit-status" role="status"></p>`;
  calculate.before(panel);
  const mode = doc.getElementById("profit-period-mode") as HTMLSelectElement;
  const source = field("profit-source");
  const currency = field("profit-currency");
  const start = field("profit-period-start");
  const end = field("profit-period-end");
  const revenueConfirmed = field("profit-revenue-confirm");
  const countConfirmed = field("profit-count-confirm");
  const status = doc.getElementById("profit-status")!;
  const observation = doc.getElementById("profit-observation")!;
  const observedOption = mode.options[1];
  const toggle = doc.createElement("button"); toggle.id = "profit-back-revenue"; toggle.type = "button"; toggle.hidden = true; toggle.textContent = "Mostrar receita nesta calculadora";
  output.after(toggle);
  let collection = "";
  let snapshotStamp = "";
  let collectionSequence = 0;
  let observedRevenue: number | undefined;
  let observedSource = "";
  let result: BoundProfit | undefined;
  let showRevenue = false;

  function clearResult(message = "Resultado invalidado. Revise e confirme os valores antes de calcular novamente.") {
    result = undefined; showRevenue = false; output.textContent = ""; toggle.hidden = true; status.textContent = message;
  }
  function invalidate() {
    revenueConfirmed.checked = false; countConfirmed.checked = false;
    clearResult();
  }
  function updateMode() {
    doc.getElementById("profit-period-dates")!.hidden = mode.value === "observed";
  }
  function number(input: HTMLInputElement): number {
    return input.value.trim() ? Number(input.value) : NaN;
  }
  function input(): ProfitInput {
    const current = snapshot();
    const period: ProfitPeriod = mode.value === "observed"
      ? { kind: "observed", label: current.studio?.period?.label ?? "", observation: collection }
      : { kind: "dates", start: start.value, end: end.value };
    const usesObserved = observedRevenue !== undefined && number(revenue) === observedRevenue && source.value === observedSource;
    return {
      revenue: number(revenue), costPerVideo: number(cost), videoCount: number(count), currency: currency.value, costCurrency: currency.value,
      period, countPeriod: period, collection,
      source: { kind: usesObserved ? "studio-dom" : "manual", description: source.value, ...(usesObserved ? { observation: collection } : {}) },
      revenuePeriodConfirmed: revenueConfirmed.checked, countConfirmed: countConfirmed.checked,
    };
  }
  function showResult() {
    if (!result) return;
    output.textContent = `${showRevenue ? "Receita declarada" : "Lucro estimado local"}: ${(showRevenue ? result.revenue : result.profit).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${result.currency}`;
    toggle.textContent = showRevenue ? "Mostrar lucro estimado nesta calculadora" : "Mostrar receita nesta calculadora";
    toggle.hidden = false;
  }
  calculate.addEventListener("click", () => {
    if (JSON.stringify(snapshot()) !== snapshotStamp) { render(); return; }
    try {
      result = calculateBoundProfit(input()); showRevenue = false; showResult();
      const period = snapshot().studio?.period;
      const label = mode.value === "observed" ? `${period?.label ?? ""} (coleta ${snapshot().studio?.observedAt ?? "sem data observada"})` : `${start.value} a ${end.value}`;
      status.textContent = `Período: ${label}. Origem: ${result.source}. Contagem manual confirmada: ${count.value}. Custos totais: ${result.totalCost.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${result.currency}. O vínculo do período foi declarado por você.`;
    } catch (error) { clearResult(error instanceof Error ? error.message : String(error)); }
  });
  toggle.addEventListener("click", () => {
    if (JSON.stringify(snapshot()) !== snapshotStamp) { render(); return; }
    if (result && !isProfitResultCurrent(result, input())) { invalidate(); return; }
    if (result) { showRevenue = !showRevenue; showResult(); }
  });
  for (const node of [revenue, cost, count, source, currency, start, end, mode]) {
    node.addEventListener("input", () => {
      if (node === revenue && observedRevenue !== undefined && number(revenue) !== observedRevenue) source.value = "Valor editado manualmente a partir da coleta";
      if (node === currency && observedRevenue !== undefined) source.value = "Receita e moeda declaradas manualmente a partir da coleta; sem conversão automática";
      updateMode(); invalidate();
    });
    node.addEventListener("change", () => { updateMode(); invalidate(); });
  }
  for (const node of [revenueConfirmed, countConfirmed]) node.addEventListener("change", () => clearResult("Confirmações alteradas. Calcule para obter uma nova estimativa."));
  // Changing the workspace period does not silently reuse a result for another interval.
  for (const id of ["period-start", "period-end"]) doc.getElementById(id)?.addEventListener("input", invalidate);

  function render() {
    const current = snapshot();
    const next = JSON.stringify(current);
    if (next === snapshotStamp) return;
    snapshotStamp = next;
    collection = `coleta-local-${++collectionSequence}`;
    const data = current.studio;
    observedRevenue = data?.revenue;
    const specific = data?.sources?.revenue;
    observedSource = specific ? `Studio: ${specific.label} (${specific.selector}; exibido: ${specific.raw})` : "Receita observada no Studio; origem específica não identificada";
    revenue.value = observedRevenue === undefined ? "" : String(observedRevenue);
    source.value = observedRevenue === undefined ? "Valor informado manualmente" : observedSource;
    currency.value = data?.currencyCode ?? data?.currency ?? "";
    observedOption.disabled = !data?.period?.label;
    mode.value = data?.period?.label ? "observed" : "dates";
    start.value = data?.period?.start ?? ""; end.value = data?.period?.end ?? "";
    observation.textContent = data?.period ? `Contexto observado: ${data.period.label}; coleta: ${data.observedAt ?? "data desconhecida"}. Quantidade observada do canal não é usada nesta calculadora.` : "Nenhum período de receita foi observado. Declare datas, moeda e origem. Informe a quantidade manual de vídeos do período; ela não é derivada de uma coleta.";
    updateMode(); invalidate();
    status.textContent = "Informe e confirme receita, período, moeda e quantidade manual para calcular. Nenhuma contagem geral do canal foi aplicada.";
  }
  render();
  return { render, invalidate };
}
