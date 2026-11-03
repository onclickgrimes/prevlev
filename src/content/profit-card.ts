import { calculateBoundProfit, profitPeriodKey, type BoundProfit, type ProfitInput } from "../core/profit";
import type { StudioMetrics } from "./studio";

/** The only native anchor this adapter discovers. Everything it adds is owned UI. */
export const PROFIT_CARD_REVENUE_SELECTOR = "#TOTAL_ESTIMATED_EARNINGS-tab #metric-total";
export const PROFIT_CARD_TTL_MS = 120_000;

export interface ProfitCardObservation {
  readonly id: string;
  readonly stamp: string;
  readonly url: string;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly revenue: number;
  readonly currencyCode: string;
  readonly period: { readonly label: string; readonly selector: string; readonly start?: string; readonly end?: string };
  readonly source: { readonly selector: string; readonly label: string; readonly raw: string; readonly description: string };
}
export type ProfitCardStateName = "idle" | "observed" | "shown" | "restored" | "cancelled" | "invalidated" | "expired" | "disposed";
export interface ProfitCardState {
  readonly status: ProfitCardStateName;
  readonly observationId?: string;
  readonly reason?: string;
  readonly removedOwnPresentation?: boolean;
}
export interface ProfitCardDisplay {
  readonly status: "shown";
  readonly observationId: string;
  readonly result: BoundProfit;
}
export interface ProfitCardDependencies {
  doc?: Document;
  /** Must read the current native DOM synchronously, never cached workspace metrics.
   * Inject readStudioMetrics(doc); keeping this dependency explicit avoids modifying it.
   */
  readMetrics: () => StudioMetrics;
  now?: () => number;
  onState?: (state: ProfitCardState) => void;
}

/** Value binding only; the adapter separately proves that this is its live receipt. */
export function validateProfitCardInput(input: ProfitInput, observation: ProfitCardObservation): BoundProfit {
  const result = calculateBoundProfit(input);
  if (input.collection !== observation.id || input.source.kind !== "studio-dom" ||
      input.source.observation !== observation.id || input.source.description !== observation.source.description) {
    throw new Error("A receita e a origem devem pertencer ao recibo atual deste card; observe e confirme novamente.");
  }
  if (input.revenue !== observation.revenue) throw new Error("A receita declarada difere do valor nativo observado; nenhuma estimativa foi mostrada no card.");
  if (result.currency !== observation.currencyCode) throw new Error("A moeda declarada difere da moeda nativa do card; não há conversão automática.");
  if (input.period.kind === "observed") {
    if (input.period.observation !== observation.id || input.period.label.trim() !== observation.period.label) throw new Error("O período relativo exige o mesmo recibo e rótulo observado; confirme novamente esta observação.");
  } else {
    if (!observation.period.start || !observation.period.end) throw new Error("O card não fornece limites exatos de datas. Use o período observado deste recibo; não são inferidas datas de rótulos relativos.");
    if (profitPeriodKey(input.period) !== profitPeriodKey({ kind: "dates", start: observation.period.start, end: observation.period.end })) throw new Error("As datas declaradas diferem do período nativo observado no card.");
  }
  return result;
}

interface NativeObservation {
  element: HTMLElement;
  parent: HTMLElement;
  url: string;
  stamp: string;
  revenue: number;
  currencyCode: string;
  period: ProfitCardObservation["period"];
  source: ProfitCardObservation["source"];
}
interface OwnedPresentation { root: HTMLElement; parent: HTMLElement; marker: string; markup: string; hostMarkup: string; }
let receiptSequence = 0;
const compact = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
const presentationMarkup = (root: HTMLElement) => JSON.stringify([root.outerHTML, root.shadowRoot?.innerHTML ?? null]);

/** Adjacent, explicitly labelled estimate. Native text and styles are never changed,
 * so readStudioMetrics continues reading the native revenue while profit is shown.
 * No account write, native control click, collection, service call or save is performed.
 */
export function createProfitCardAdapter(dependencies: ProfitCardDependencies) {
  const doc = dependencies.doc ?? document, view = doc.defaultView, now = dependencies.now ?? Date.now;
  if (!view) throw new Error("Documento sem janela para a apresentação local do card.");
  let receipt: { public: ProfitCardObservation; native: NativeObservation; expires: number } | undefined;
  let presentation: OwnedPresentation | undefined, contested: HTMLElement | undefined, disposed = false;
  let state: ProfitCardState = Object.freeze({ status: "idle" });
  let observer: MutationObserver | undefined, monitor: number | undefined, expiry: number | undefined;
  const emit = (next: ProfitCardState) => {
    state = Object.freeze(next);
    try { dependencies.onState?.(state); } catch { /* Host callbacks cannot interrupt restoration. */ }
  };
  const visible = (element: HTMLElement) => {
    if (!element.isConnected || element.ownerDocument !== doc) return false;
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      const style = view.getComputedStyle(node);
      if (node.hidden || node.getAttribute("aria-hidden") === "true" || style.display === "none" || ["hidden", "collapse"].includes(style.visibility) || style.opacity === "0") return false;
    }
    return true;
  };
  const stopWatching = () => { observer?.disconnect(); observer = undefined; view.clearInterval(monitor); view.clearTimeout(expiry); monitor = expiry = undefined; };

  /** Ownership compare-and-swap: remove only the exact adjacent subtree we inserted.
   * If another renderer moves or edits it, leave that renderer's content untouched.
   * No original/native text is ever written back, including after native updates.
   */
  const removePresentation = () => {
    const owned = presentation;
    if (contested && !contested.isConnected) contested = undefined;
    if (!owned) return !contested;
    if (!owned.root.isConnected) {
      // Native cloneNode does not clone shadow content. Clean up only exact empty
      // copies of our host; never remove a changed/copied foreign subtree.
      for (const copy of doc.querySelectorAll<HTMLElement>("[data-prevlev-profit-card]")) if (copy.getAttribute("data-prevlev-profit-card") === owned.marker && !copy.shadowRoot && copy.outerHTML === owned.hostMarkup) copy.remove();
      presentation = undefined; return !contested;
    }
    if (owned.root.parentElement !== owned.parent || owned.root.getAttribute("data-prevlev-profit-card") !== owned.marker || presentationMarkup(owned.root) !== owned.markup) { contested = owned.root; return false; }
    owned.root.remove(); presentation = undefined; return true;
  };
  const clear = (status: ProfitCardStateName, reason: string) => {
    const observationId = receipt?.public.id, removedOwnPresentation = removePresentation();
    presentation = undefined; receipt = undefined; stopWatching();
    emit({ status, observationId, reason: removedOwnPresentation ? reason : `${reason} A apresentação foi alterada externamente; esse conteúdo foi preservado por comparação de propriedade. A receita nativa não foi sobrescrita.`, removedOwnPresentation });
  };

  function readNative(): NativeObservation {
    if (disposed) throw new Error("Adapter local encerrado.");
    const url = new URL(doc.location.href);
    if (url.protocol !== "https:" || url.hostname !== "studio.youtube.com" || url.port || url.username || url.password) throw new Error("Abra um documento HTTPS do YouTube Studio para observar o card.");
    const candidates = [...doc.querySelectorAll<HTMLElement>(PROFIT_CARD_REVENUE_SELECTOR)].filter(visible);
    if (candidates.length !== 1 || !candidates[0].parentElement) throw new Error("Exige exatamente um valor de receita visível no anchor documentado; cards ausentes ou ambíguos são recusados.");
    const element = candidates[0], parent = element.parentElement!, nativeText = element.textContent;
    const metrics = dependencies.readMetrics(), source = metrics.sources?.revenue, currencySource = metrics.sources?.currency, periodSource = metrics.sources?.period;
    if (doc.location.href !== url.href || element.parentElement !== parent || !visible(element) || element.textContent !== nativeText) throw new Error("O contexto do card mudou durante a leitura.");
    if (metrics.source !== "studio-dom" || !source || source.selector !== PROFIT_CARD_REVENUE_SELECTOR || compact(source.raw) !== compact(nativeText) ||
        !Number.isFinite(metrics.revenue) || metrics.revenue! < 0) throw new Error("A leitura atual não confirmou a receita nativa única do anchor documentado.");
    if (typeof metrics.currencyCode !== "string" || !/^[A-Z]{3}$/.test(metrics.currencyCode) || !currencySource) throw new Error("A moeda nativa deve ter código ISO explícito e origem observada; símbolos ambíguos não são usados.");
    const period = metrics.period;
    if (!period || typeof period.label !== "string" || !period.label.trim() || period.label.length > 2000 || !period.selector ||
        !periodSource || periodSource.selector !== period.selector || compact(periodSource.raw) !== compact(period.label)) throw new Error("O período nativo aplicado não foi identificado de forma única; campos de data em edição não bastam.");
    const normalizedPeriod = Object.freeze({ label: period.label.trim(), selector: period.selector, ...(period.start !== undefined ? { start: period.start } : {}), ...(period.end !== undefined ? { end: period.end } : {}) });
    const normalizedSource = Object.freeze({ selector: source.selector, label: source.label, raw: source.raw, description: `Studio: ${source.label} (${source.selector}; exibido: ${source.raw})` });
    const stamp = JSON.stringify([url.href, nativeText, metrics.revenue, metrics.currencyCode, metrics.currency ?? null, normalizedPeriod, normalizedSource, currencySource, periodSource]);
    return { element, parent, url: url.href, stamp, revenue: metrics.revenue!, currencyCode: metrics.currencyCode, period: normalizedPeriod, source: normalizedSource };
  }
  function current(id: string): boolean {
    if (disposed || !receipt || receipt.public.id !== id) return false;
    const instant = now();
    if (!Number.isFinite(instant) || instant < Date.parse(receipt.public.observedAt)) { clear("invalidated", "O relógio da observação mudou ou ficou indisponível. Observe e confirme novamente."); return false; }
    if (instant >= receipt.expires) { clear("expired", "A observação expirou. Observe e confirme novamente antes de mostrar lucro."); return false; }
    try {
      const native = readNative();
      if (native.element !== receipt.native.element || native.parent !== receipt.native.parent || native.stamp !== receipt.native.stamp) throw new Error("Receita, moeda, período, URL ou nó do card mudou.");
      if (presentation && (presentation.root.parentElement !== presentation.parent || presentationMarkup(presentation.root) !== presentation.markup)) throw new Error("A apresentação local foi alterada por outro renderizador.");
      return true;
    } catch (error) { clear("invalidated", error instanceof Error ? error.message : "O card mudou; a estimativa local foi invalidada."); return false; }
  }
  const watch = () => {
    stopWatching();
    observer = new view.MutationObserver(() => { if (receipt) current(receipt.public.id); });
    observer.observe(doc.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    // pushState can change URL without a DOM mutation or popstate event.
    monitor = view.setInterval(() => { if (receipt) current(receipt.public.id); }, 250);
    expiry = view.setTimeout(() => { if (receipt) current(receipt.public.id); }, PROFIT_CARD_TTL_MS);
  };
  const pagehide = () => clear("cancelled", "Página suspensa ou encerrada; apresentação local descartada.");
  const navigation = () => { if (receipt) current(receipt.public.id); };
  view.addEventListener("pagehide", pagehide); view.addEventListener("popstate", navigation); view.addEventListener("hashchange", navigation);

  return {
    observe(): ProfitCardObservation {
      if (disposed) throw new Error("Adapter local encerrado.");
      if (!removePresentation()) { clear("invalidated", "A apresentação anterior foi alterada externamente."); throw new Error(state.reason); }
      receipt = undefined; stopWatching();
      try {
        const native = readNative(), instant = now();
        if (!Number.isFinite(instant)) throw new Error("Instante da observação inválido.");
        const expires = instant + PROFIT_CARD_TTL_MS;
        const observation: ProfitCardObservation = Object.freeze({ id: `profit-card-${instant.toString(36)}-${++receiptSequence}`, stamp: native.stamp, url: native.url,
          observedAt: new Date(instant).toISOString(), expiresAt: new Date(expires).toISOString(), revenue: native.revenue, currencyCode: native.currencyCode, period: native.period, source: native.source });
        receipt = { public: observation, native, expires }; watch(); emit({ status: "observed", observationId: observation.id });
        return observation;
      } catch (error) { clear("invalidated", error instanceof Error ? error.message : "Não foi possível observar o card."); throw error; }
    },
    show(input: ProfitInput, observationId: string): ProfitCardDisplay {
      if (!current(observationId) || !receipt) throw new Error(state.reason ?? "Não há recibo atual deste card. Observe e confirme os valores primeiro.");
      let result: BoundProfit;
      try { result = validateProfitCardInput(input, receipt.public); }
      catch (error) { clear("invalidated", error instanceof Error ? error.message : "Valores incompatíveis com a receita observada."); throw error; }
      if (!removePresentation()) { clear("invalidated", "A apresentação anterior foi alterada externamente."); throw new Error(state.reason); }
      const root = doc.createElement("section"), marker = receipt.public.id;
      root.setAttribute("data-prevlev-profit-card", marker); root.setAttribute("aria-label", "Estimativa de lucro local Prevlev; receita nativa preservada");
      // Native text readers and cloneNode do not include this independent shadow tree.
      const shadow = root.attachShadow({ mode: "open" }), style = doc.createElement("style");
      style.textContent = ":host{display:block;padding:12px;margin-top:8px;border:1px solid currentColor;border-radius:8px;font:14px/1.5 system-ui}strong,output{display:block}output{font-size:24px;font-weight:700}p{margin:8px 0}button{font:inherit;padding:6px 10px;cursor:pointer}";
      const title = doc.createElement("strong"); title.textContent = "Lucro estimado local · Prevlev";
      const amount = doc.createElement("output"); amount.textContent = `${result.profit.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${result.currency}`;
      const context = doc.createElement("p"); context.textContent = `Receita nativa preservada: ${receipt.public.source.raw}. Período observado: ${receipt.public.period.label}. Custo declarado: ${input.costPerVideo} × ${input.videoCount} = ${result.totalCost} ${result.currency}; quantidade manual confirmada. Estimativa visual local, sem custos adicionais ou impostos.`;
      const back = doc.createElement("button"); back.type = "button"; back.textContent = "Voltar à receita nativa";
      root.addEventListener("click", event => event.stopPropagation());
      back.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); if (!current(observationId)) return; const removedOwnPresentation = removePresentation(); emit({ status: "restored", observationId, removedOwnPresentation }); });
      shadow.append(style, title, amount, context, back);
      if (!current(observationId) || !receipt) throw new Error(state.reason ?? "O card mudou antes de mostrar a estimativa.");
      receipt.native.element.after(root);
      presentation = { root, parent: receipt.native.parent, marker, markup: presentationMarkup(root), hostMarkup: root.outerHTML };
      emit({ status: "shown", observationId });
      return Object.freeze({ status: "shown", observationId, result });
    },
    restore(): ProfitCardState {
      if (disposed) return state;
      if (receipt && !current(receipt.public.id)) return state;
      const removedOwnPresentation = removePresentation();
      if (!removedOwnPresentation) { clear("invalidated", "A apresentação foi alterada externamente; o conteúdo nativo foi preservado."); return state; }
      emit({ status: "restored", observationId: receipt?.public.id, removedOwnPresentation }); return state;
    },
    cancel(): ProfitCardState { if (!disposed) clear("cancelled", "Apresentação cancelada; nenhuma receita nativa foi alterada."); return state; },
    invalidate(reason = "Entradas ou contexto alterados; observe e confirme novamente."): ProfitCardState { if (!disposed) clear("invalidated", reason); return state; },
    isCurrent: current,
    getState: () => state,
    /** Host integration can include this adjacent estimate in selected screenshot masks.
     * Prefer restore() before a raw/native capture when no mask integration is present.
     */
    getPresentationElement: () => disposed ? undefined : presentation?.root.isConnected ? presentation.root : contested?.isConnected ? contested : undefined,
    cleanup(): void {
      if (disposed) return;
      disposed = true; clear("disposed", "Adapter local encerrado; receita nativa preservada.");
      view.removeEventListener("pagehide", pagehide); view.removeEventListener("popstate", navigation); view.removeEventListener("hashchange", navigation);
    },
  };
}

export type ProfitCardAdapter = ReturnType<typeof createProfitCardAdapter>;
