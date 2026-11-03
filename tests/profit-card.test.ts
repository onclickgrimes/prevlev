// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { createProfitCardAdapter, validateProfitCardInput, PROFIT_CARD_TTL_MS, type ProfitCardAdapter, type ProfitCardObservation } from "../src/content/profit-card";
import { readStudioMetrics } from "../src/content/studio";
import type { ProfitInput } from "../src/core/profit";

const adapters: ProfitCardAdapter[] = [], windows: JSDOM[] = [];
const instant = Date.parse("2026-11-03T12:00:00Z");
function input(observation: ProfitCardObservation): ProfitInput {
  return { revenue: observation.revenue, currency: observation.currencyCode, costCurrency: observation.currencyCode, costPerVideo: 100, videoCount: 3,
    period: { kind: "observed", label: observation.period.label, observation: observation.id }, countPeriod: { kind: "observed", label: observation.period.label, observation: observation.id },
    source: { kind: "studio-dom", observation: observation.id, description: observation.source.description }, collection: observation.id, revenuePeriodConfirmed: true, countConfirmed: true };
}
function fixture(extra = "", options: { read?: (doc: Document) => ReturnType<typeof readStudioMetrics>; url?: string; now?: () => number } = {}) {
  const dom = new JSDOM(`<main data-video-id="abcdefghijk"><div id="TOTAL_ESTIMATED_EARNINGS-tab" data-currency="BRL"><span id="metric-total" style="font-weight:bold">R$ 1.000,00</span></div><span id="date-range-label">Últimos 28 dias</span>${extra}<button id="save">Save</button></main>`, { url: options.url ?? "https://studio.youtube.com/video/abcdefghijk/analytics" });
  windows.push(dom);
  const doc = dom.window.document, native = doc.querySelector<HTMLElement>("#metric-total")!;
  const read = vi.fn(() => options.read ? options.read(doc) : readStudioMetrics(doc));
  const adapter = createProfitCardAdapter({ doc, readMetrics: read, now: options.now ?? (() => instant) }); adapters.push(adapter);
  return { doc, native, read, adapter };
}
afterEach(() => { adapters.splice(0).forEach(adapter => adapter.cleanup()); windows.splice(0).forEach(dom => dom.window.close()); vi.restoreAllMocks(); });

describe("bound profit card values", () => {
  it("binds declared costs/manual count and revenue to the exact live receipt", () => {
    const { adapter } = fixture(), observation = adapter.observe();
    expect(validateProfitCardInput(input(observation), observation)).toMatchObject({ revenue: 1000, totalCost: 300, profit: 700, currency: "BRL" });
    expect(Object.isFrozen(observation)).toBe(true); expect(Object.isFrozen(observation.period)).toBe(true);
  });
  it("refuses unconfirmed, unrelated, manually substituted, wrong-currency and wrong-period inputs", () => {
    const { adapter } = fixture(), observation = adapter.observe(), original = input(observation);
    const invalid: ProfitInput[] = [
      { ...original, countConfirmed: false }, { ...original, revenuePeriodConfirmed: false },
      { ...original, collection: "another" }, { ...original, source: { ...original.source, kind: "manual" } },
      { ...original, source: { ...original.source, description: "Outra fonte" } }, { ...original, source: { ...original.source, observation: "another" } },
      { ...original, revenue: 999 }, { ...original, currency: "USD", costCurrency: "USD" },
      { ...original, period: { kind: "observed", observation: "another", label: observation.period.label }, countPeriod: { kind: "observed", observation: "another", label: observation.period.label } },
      { ...original, period: { kind: "observed", observation: observation.id, label: "Outro período" }, countPeriod: { kind: "observed", observation: observation.id, label: "Outro período" } },
      { ...original, period: { kind: "dates", start: "2026-10-01", end: "2026-10-28" }, countPeriod: { kind: "dates", start: "2026-10-01", end: "2026-10-28" } },
    ];
    for (const value of invalid) expect(() => validateProfitCardInput(value, observation)).toThrow();
  });
  it("allows exact dates only when the reader actually supplies the same applied boundaries", () => {
    const { adapter } = fixture("", { read: doc => ({ ...readStudioMetrics(doc), period: { ...readStudioMetrics(doc).period!, start: "2026-10-01", end: "2026-10-28" } }) });
    const observation = adapter.observe(), value = { ...input(observation), period: { kind: "dates" as const, start: "2026-10-01", end: "2026-10-28" }, countPeriod: { kind: "dates" as const, start: "2026-10-01", end: "2026-10-28" } };
    expect(validateProfitCardInput(value, observation).profit).toBe(700);
    expect(() => validateProfitCardInput({ ...value, period: { ...value.period, end: "2026-10-29" }, countPeriod: { ...value.countPeriod, end: "2026-10-29" } }, observation)).toThrow("datas declaradas");
  });
});

describe("adjacent card presentation and restoration", () => {
  it("does nothing on creation; observe does not show; show leaves native text, styles and metric reads unchanged", () => {
    const { adapter, doc, native, read } = fixture(), nativeMarkup = native.outerHTML, clicks = vi.fn();
    doc.querySelector("#save")!.addEventListener("click", clicks);
    expect(read).not.toHaveBeenCalled(); expect(adapter.getPresentationElement()).toBeUndefined();
    const observation = adapter.observe(); expect(adapter.getPresentationElement()).toBeUndefined();
    expect(adapter.show(input(observation), observation.id)).toMatchObject({ status: "shown", result: { profit: 700 } });
    const root = adapter.getPresentationElement()!;
    expect(root.shadowRoot!.querySelector("output")!.textContent).toBe("700 BRL");
    expect(root.textContent).toBe(""); expect(native.outerHTML).toBe(nativeMarkup);
    expect(readStudioMetrics(doc)).toMatchObject({ revenue: 1000, currencyCode: "BRL", period: { label: "Últimos 28 dias" } });
    expect(clicks).not.toHaveBeenCalled();
    root.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
    expect(adapter.getState().status).toBe("restored"); expect(root.isConnected).toBe(false); expect(adapter.isCurrent(observation.id)).toBe(true);
    adapter.show({ ...input(observation), costPerVideo: 200 }, observation.id);
    expect(adapter.getPresentationElement()!.shadowRoot!.querySelector("output")!.textContent).toBe("400 BRL");
  });
  it("restore preserves a valid receipt for newly confirmed costs while cancel/invalidate/cleanup discard it", () => {
    const { adapter } = fixture(), observation = adapter.observe();
    adapter.show(input(observation), observation.id); adapter.restore();
    expect(adapter.isCurrent(observation.id)).toBe(true);
    adapter.show({ ...input(observation), videoCount: 12 }, observation.id);
    expect(adapter.getPresentationElement()!.shadowRoot!.querySelector("output")!.textContent).toBe("-200 BRL");
    adapter.cancel(); expect(adapter.getPresentationElement()).toBeUndefined(); expect(adapter.isCurrent(observation.id)).toBe(false);
    const next = adapter.observe(); adapter.invalidate(); expect(adapter.isCurrent(next.id)).toBe(false);
    adapter.cleanup(); expect(adapter.getState().status).toBe("disposed"); expect(() => adapter.observe()).toThrow("encerrado");
  });
  it("invalidates when revenue, currency, period, URL, parent or node changes, preserving any new native text", () => {
    for (const mutation of ["revenue", "currency", "period", "url", "parent", "node"] as const) {
      const { adapter, doc, native } = fixture(), observation = adapter.observe(); adapter.show(input(observation), observation.id);
      if (mutation === "revenue") native.textContent = "R$ 1.500,00";
      if (mutation === "currency") doc.querySelector("#TOTAL_ESTIMATED_EARNINGS-tab")!.setAttribute("data-currency", "USD");
      if (mutation === "period") doc.querySelector("#date-range-label")!.textContent = "Últimos 7 dias";
      if (mutation === "url") doc.defaultView!.history.pushState(null, "", "/video/another/analytics");
      if (mutation === "parent") { const parent = doc.createElement("div"); native.before(parent); parent.append(native); }
      if (mutation === "node") native.replaceWith(native.cloneNode(true));
      const actualNativeText = doc.querySelector("#metric-total")!.textContent;
      expect(adapter.isCurrent(observation.id)).toBe(false); expect(adapter.getState().status).toBe("invalidated");
      expect(doc.querySelector("#metric-total")!.textContent).toBe(actualNativeText);
      expect(doc.querySelector("[data-prevlev-profit-card]")).toBeNull();
    }
  });
  it("observes native DOM changes automatically and keeps native replacement clones free of copied estimates", async () => {
    const { adapter, doc, native } = fixture(), observation = adapter.observe(); adapter.show(input(observation), observation.id);
    const card = native.parentElement!; card.replaceWith(card.cloneNode(true));
    await Promise.resolve(); await Promise.resolve();
    expect(adapter.getState().status).toBe("invalidated");
    const cloned = doc.querySelector("[data-prevlev-profit-card]");
    expect(cloned?.shadowRoot).toBeFalsy(); expect(cloned?.textContent ?? "").toBe("");
    expect(readStudioMetrics(doc).revenue).toBe(1000);
  });
  it("uses ownership compare-and-swap and never overwrites externally modified presentation or native revenue", () => {
    const { adapter, native } = fixture(), observation = adapter.observe(); adapter.show(input(observation), observation.id);
    const root = adapter.getPresentationElement()!; root.shadowRoot!.querySelector("output")!.textContent = "Conteúdo de outro renderizador";
    native.textContent = "R$ 1.111,00";
    adapter.restore();
    expect(adapter.getState()).toMatchObject({ status: "invalidated", removedOwnPresentation: false });
    expect(root.isConnected).toBe(true); expect(root.shadowRoot!.querySelector("output")!.textContent).toBe("Conteúdo de outro renderizador");
    expect(native.textContent).toBe("R$ 1.111,00");
  });
  it("expires receipts, rejects older observations and discards projections on pagehide", () => {
    let clock = instant;
    const { adapter, doc } = fixture("", { now: () => clock });
    const old = adapter.observe(), observation = adapter.observe();
    expect(adapter.isCurrent(old.id)).toBe(false); adapter.show(input(observation), observation.id);
    clock += PROFIT_CARD_TTL_MS;
    expect(adapter.isCurrent(observation.id)).toBe(false); expect(adapter.getState().status).toBe("expired"); expect(adapter.getPresentationElement()).toBeUndefined();
    const next = adapter.observe(); adapter.show(input(next), next.id);
    doc.defaultView!.dispatchEvent(new doc.defaultView!.Event("pagehide"));
    expect(adapter.getState().status).toBe("cancelled"); expect(adapter.isCurrent(next.id)).toBe(false);
  });
  it("refuses missing/hidden/ambiguous card, ambiguous currency, missing period and non-Studio URLs", () => {
    for (const mutation of ["missing", "hidden", "ambiguous", "currency", "period", "host"] as const) {
      const { adapter, doc, native } = fixture("", mutation === "host" ? { url: "https://www.youtube.com/watch?v=abcdefghijk" } : {});
      if (mutation === "missing") native.remove();
      if (mutation === "hidden") native.parentElement!.hidden = true;
      if (mutation === "ambiguous") native.after(native.cloneNode(true));
      if (mutation === "currency") { native.textContent = "$1,000.00"; native.parentElement!.removeAttribute("data-currency"); }
      if (mutation === "period") doc.querySelector("#date-range-label")!.remove();
      expect(() => adapter.observe()).toThrow(); expect(adapter.getPresentationElement()).toBeUndefined();
    }
  });
  it("clears a shown estimate on incompatible declarations instead of keeping a stale result", () => {
    const { adapter } = fixture(), observation = adapter.observe(); adapter.show(input(observation), observation.id);
    expect(() => adapter.show({ ...input(observation), countConfirmed: false }, observation.id)).toThrow();
    expect(adapter.getPresentationElement()).toBeUndefined(); expect(adapter.isCurrent(observation.id)).toBe(false);
  });
});
