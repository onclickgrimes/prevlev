import { calculateBoundProfit, isProfitResultCurrent, type BoundProfit, type ProfitInput, type ProfitPeriod } from "../core/profit";
import type { PageSnapshot } from "../shared/types";
import type { ProfitCardObservation } from "../content/profit-card";

interface ProfitToolsDependencies {
  snapshot: () => PageSnapshot; doc?: Document;
  observeCard?: () => Promise<ProfitCardObservation>;
  showOnCard?: (input: ProfitInput, observationId: string) => Promise<void>;
  restoreCard?: () => Promise<void>;
  cancelCard?: () => Promise<void>;
}
/** Local calculation and an optional explicit, reversible presentation beside native revenue. */
export function initProfitTools(deps: ProfitToolsDependencies): { render(): void; invalidate(): void; invalidateContext(): void } {
  const {snapshot,doc=document}=deps;
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
  const cardActions=doc.createElement('div');cardActions.className='actions';
  const observeCard=doc.createElement('button'),showCard=doc.createElement('button'),restoreCard=doc.createElement('button');
  observeCard.id='profit-card-observe';observeCard.type='button';observeCard.textContent='Ler receita do card do Studio';
  showCard.id='profit-card-show';showCard.type='button';showCard.textContent='Mostrar estimativa junto ao card';showCard.hidden=true;
  restoreCard.id='profit-card-restore';restoreCard.type='button';restoreCard.textContent='Voltar à receita no Studio';
  cardActions.append(observeCard,showCard,restoreCard);cardActions.hidden=!deps.observeCard;toggle.after(cardActions);
  const cardHint=doc.createElement('p');cardHint.className='muted';cardHint.textContent='A leitura do card exige uma nova confirmação de período e quantidade. A estimativa fica em uma caixa própria junto à receita, sem salvar ou alterar o valor nativo; expira em até 2 minutos e é descartada se o contexto mudar.';cardHint.hidden=cardActions.hidden;cardActions.after(cardHint);
  let collection = "";
  let snapshotStamp = "";
  let collectionSequence = 0;
  let observedRevenue: number | undefined;
  let observedSource = "";
  let result: BoundProfit | undefined;
  let showRevenue = false;
  let cardObservation:ProfitCardObservation|undefined,cardEpoch=0;

  function clearResult(message = "Resultado invalidado. Revise e confirme os valores antes de calcular novamente.") {
    result = undefined; showRevenue = false; output.textContent = ""; toggle.hidden = true; showCard.hidden=true; showCard.disabled=false; status.textContent = message;
  }
  function invalidate() {
    const epoch=++cardEpoch;
    observeCard.disabled=false;
    void deps.restoreCard?.().catch(error=>{if(epoch===cardEpoch)status.textContent=error instanceof Error?error.message:String(error);});
    revenueConfirmed.checked = false; countConfirmed.checked = false;
    clearResult();
  }
  function invalidateContext() {
    cardEpoch++;
    if(cardObservation){
      collection=`contexto-descartado-${++collectionSequence}`;observedRevenue=undefined;observedSource='';
      revenue.value='';currency.value='';source.value='Valor manual; observação anterior do card descartada';
      mode.value='dates';start.value='';end.value='';observedOption.disabled=true;updateMode();
      observation.textContent='A observação anterior do card foi descartada. Leia o card novamente ou declare manualmente receita, moeda, origem e datas.';
    }
    cardObservation=undefined;
    void deps.cancelCard?.().catch(()=>{});
    revenueConfirmed.checked=false;countConfirmed.checked=false;clearResult('O contexto do card mudou. Leia e confirme novamente antes de mostrar uma estimativa no Studio.');
    observeCard.disabled=false;
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
      ? { kind: "observed", label: cardObservation?.period.label ?? current.studio?.period?.label ?? "", observation: collection }
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
    showCard.hidden=!cardObservation||!deps.showOnCard;
  }
  calculate.addEventListener("click", () => {
    if (JSON.stringify(snapshot()) !== snapshotStamp) { render(); return; }
    try {
      result = calculateBoundProfit(input()); showRevenue = false; showResult();
      const period = cardObservation?.period??snapshot().studio?.period;
      const label = mode.value === "observed" ? `${period?.label ?? ""} (coleta ${cardObservation?.observedAt??snapshot().studio?.observedAt ?? "sem data observada"})` : `${start.value} a ${end.value}`;
      status.textContent = `Período: ${label}. Origem: ${result.source}. Contagem manual confirmada: ${count.value}. Custos totais: ${result.totalCost.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${result.currency}. O vínculo do período foi declarado por você.`;
    } catch (error) { clearResult(error instanceof Error ? error.message : String(error)); }
  });
  observeCard.addEventListener('click',()=>{
    if(!deps.observeCard)return;
    invalidateContext();
    const epoch=++cardEpoch;observeCard.disabled=true;
    revenueConfirmed.checked=false;countConfirmed.checked=false;clearResult('Lendo a receita e o período do card selecionado…');
    void deps.observeCard().then(receipt=>{
      if(epoch!==cardEpoch)return;
      cardObservation=receipt;collection=receipt.id;observedRevenue=receipt.revenue;observedSource=receipt.source.description;
      revenue.value=String(receipt.revenue);source.value=observedSource;currency.value=receipt.currencyCode;
      observedOption.disabled=false;mode.value='observed';start.value=receipt.period.start??'';end.value=receipt.period.end??'';updateMode();
      observation.textContent=`Card observado: ${receipt.url}; período: ${receipt.period.label}; recibo: ${receipt.observedAt}; expira: ${receipt.expiresAt}. Nenhuma quantidade geral foi usada.`;
      status.textContent='Receita lida. Revise os custos e confirme novamente o vínculo da receita e a quantidade manual deste período antes de calcular.';
    }).catch(error=>{if(epoch===cardEpoch){invalidateContext();clearResult(error instanceof Error?error.message:String(error));}}).finally(()=>{if(epoch===cardEpoch)observeCard.disabled=false;});
  });
  showCard.addEventListener('click',()=>{
    if(!deps.showOnCard||!cardObservation||!result)return;
    if(JSON.stringify(snapshot())!==snapshotStamp||!isProfitResultCurrent(result,input())){invalidateContext();return;}
    const receipt=cardObservation,declared=input(),epoch=++cardEpoch;showCard.disabled=true;
    void deps.showOnCard(declared,receipt.id).then(()=>{if(epoch===cardEpoch)status.textContent='Estimativa local mostrada junto à receita nativa. Nenhuma alteração foi salva no Studio.';}).catch(error=>{if(epoch===cardEpoch)clearResult(error instanceof Error?error.message:String(error));}).finally(()=>{if(epoch===cardEpoch)showCard.disabled=false;});
  });
  restoreCard.addEventListener('click',()=>{
    const epoch=++cardEpoch;showCard.disabled=false;observeCard.disabled=false;
    void deps.restoreCard?.().then(()=>{if(epoch===cardEpoch)status.textContent='Apresentação local retirada. A receita nativa foi preservada.';}).catch(error=>{if(epoch===cardEpoch)status.textContent=error instanceof Error?error.message:String(error);});
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
  for (const node of [revenueConfirmed, countConfirmed]) node.addEventListener("change", () => {
    const epoch=++cardEpoch;observeCard.disabled=false;showCard.disabled=false;
    void deps.restoreCard?.().catch(error=>{if(epoch===cardEpoch)status.textContent=error instanceof Error?error.message:String(error);});
    clearResult("Confirmações alteradas. Calcule para obter uma nova estimativa.");
  });
  // Changing the workspace period does not silently reuse a result for another interval.
  for (const id of ["period-start", "period-end"]) doc.getElementById(id)?.addEventListener("input", invalidate);

  function render() {
    const current = snapshot();
    const next = JSON.stringify(current);
    if (next === snapshotStamp) return;
    invalidateContext();
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
  return { render, invalidate, invalidateContext };
}
