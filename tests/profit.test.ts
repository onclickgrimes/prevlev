// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { calculateBoundProfit, isProfitResultCurrent, profitPeriodKey, type ProfitInput } from "../src/core/profit";
import { initProfitTools } from "../src/ui/profit";
import type { PageSnapshot } from "../src/shared/types";

function input(): ProfitInput {
  return { revenue: 1000, currency: "BRL", costPerVideo: 100, costCurrency: "BRL", videoCount: 3,
    period: { kind: "dates", start: "2024-02-01", end: "2024-02-29" }, countPeriod: { kind: "dates", start: "2024-02-01", end: "2024-02-29" },
    source: { kind: "manual", description: "Planilha informada por mim" }, revenuePeriodConfirmed: true, countConfirmed: true, collection: "collection-1" };
}

describe("profit bound to period, currency and provenance", () => {
  it("calculates a declared same-period estimate, preserves negative profit and supports zero videos", () => {
    const data = input();
    expect(calculateBoundProfit(data)).toMatchObject({ revenue: 1000, profit: 700, totalCost: 300, currency: "BRL", source: "Planilha informada por mim" });
    expect(calculateBoundProfit({ ...data, costPerVideo: 400 }).profit).toBe(-200);
    expect(calculateBoundProfit({ ...data, videoCount: 0 }).profit).toBe(1000);
  });
  it("refuses a video count from another period or another rolling-period observation", () => {
    const data = input();
    expect(() => calculateBoundProfit({ ...data, countPeriod: { kind: "dates", start: "2024-01-01", end: "2024-01-31" } })).toThrow("mesmo período");
    expect(() => calculateBoundProfit({ ...data, period: { kind: "observed", label: "Últimos 28 dias", observation: "A" }, countPeriod: { kind: "observed", label: "Últimos 28 dias", observation: "B" } })).toThrow("mesmo período");
  });
  it("requires revenue-period and manual-count confirmations instead of treating default one as a derived count", () => {
    expect(() => calculateBoundProfit({ ...input(), revenuePeriodConfirmed: false })).toThrow("receita pertence");
    expect(() => calculateBoundProfit({ ...input(), videoCount: 1, countConfirmed: false })).toThrow("quantidade manual");
  });
  it("rejects mixed or ambiguous currency and never converts costs", () => {
    expect(() => calculateBoundProfit({ ...input(), costCurrency: "USD" })).toThrow("mesma moeda");
    expect(() => calculateBoundProfit({ ...input(), currency: "$", costCurrency: "$" })).toThrow("ambíguo");
    expect(calculateBoundProfit({ ...input(), currency: " brl " }).currency).toBe("BRL");
  });
  it("invalidates results after changing collection, provenance, period, amounts, count or confirmations", () => {
    const data = input(); const result = calculateBoundProfit(data);
    expect(isProfitResultCurrent(result, data)).toBe(true);
    const changed: ProfitInput[] = [
      { ...data, revenue: 999 }, { ...data, costPerVideo: 90 }, { ...data, videoCount: 2 }, { ...data, collection: "collection-2" },
      { ...data, source: { kind: "manual", description: "Outra planilha" } }, { ...data, countConfirmed: false },
      { ...data, period: { kind: "dates", start: "2024-01-01", end: "2024-01-31" }, countPeriod: { kind: "dates", start: "2024-01-01", end: "2024-01-31" } },
    ];
    for (const value of changed) expect(isProfitResultCurrent(result, value)).toBe(false);
  });
  it("refuses absent provenance, invalid dates, nonfinite amounts, fractional counts and overflow", () => {
    for (const period of [{ kind: "dates" as const, start: "2024-02-30", end: "2024-03-01" }, { kind: "dates" as const, start: "2024-03-01", end: "2024-02-29" }, { kind: "observed" as const, label: "", observation: "A" }]) expect(() => profitPeriodKey(period)).toThrow();
    for (const changes of [{ revenue: NaN }, { revenue: Infinity }, { costPerVideo: -1 }, { videoCount: 1.5 }, { videoCount: Number.MAX_SAFE_INTEGER + 1 }, { revenue: Number.MAX_VALUE, costPerVideo: Number.MAX_VALUE, videoCount: 3 }]) expect(() => calculateBoundProfit({ ...input(), ...changes })).toThrow();
    expect(() => calculateBoundProfit({ ...input(), source: { kind: "manual", description: "" } })).toThrow("Origem");
    expect(() => calculateBoundProfit({ ...input(), source: { kind: "studio-dom", description: "Receita observada" } })).toThrow("Identidade");
  });
});

function snapshot(): PageSnapshot {
  return { url: "https://studio.youtube.com/channel/fixture/analytics", title: "Fixture", videos: [], comments: [], transcript: [], warnings: [], studio: {
    source: "studio-dom", observedAt: "2024-03-01T10:00:00Z", revenue: 1000, currency: "R$", currencyCode: "BRL", videoCount: 999,
    period: { label: "Últimos 28 dias", selector: "#date-range-label" },
    sources: { revenue: { selector: "#TOTAL_ESTIMATED_EARNINGS-tab #metric-total", label: "Receita estimada", raw: "R$ 1.000,00" } },
  } };
}
function fixture() {
  document.body.innerHTML = '<section id="studio"><input id="revenue" type="number"><input id="cost" type="number" value="100"><input id="video-total" type="number" value="1"><button id="profit">Calcular</button><output id="profit-output"></output><input id="period-start" type="date"><input id="period-end" type="date"></section>';
}
function set(id: string, value: string) {
  const field = document.getElementById(id) as HTMLInputElement; field.value = value; field.dispatchEvent(new Event("input", { bubbles: true }));
}
function confirm() {
  for (const id of ["profit-revenue-confirm", "profit-count-confirm"]) (document.getElementById(id) as HTMLInputElement).click();
}
function calculate() { (document.getElementById("profit") as HTMLButtonElement).click(); }

describe("local profit UI", () => {
  it("requires manual count confirmation and restores the original revenue with its currency in the local output", () => {
    fixture(); const current = snapshot(); initProfitTools({ snapshot: () => current });
    expect((document.getElementById("video-total") as HTMLInputElement).value).toBe("1");
    expect(document.getElementById("profit-observation")!.textContent).toContain("não é usada");
    calculate(); expect(document.getElementById("profit-output")!.textContent).toBe("");
    set("video-total", "3"); confirm(); calculate();
    expect(document.getElementById("profit-output")!.textContent).toBe("Lucro estimado local: 700 BRL");
    (document.getElementById("profit-back-revenue") as HTMLButtonElement).click();
    expect(document.getElementById("profit-output")!.textContent).toBe("Receita declarada: 1.000 BRL");
    expect((document.getElementById("revenue") as HTMLInputElement).value).toBe("1000");
    expect(document.getElementById("profit-status")!.textContent).toContain("#TOTAL_ESTIMATED_EARNINGS-tab #metric-total");
  });
  it("invalidates a calculation and both confirmations immediately after changing revenue, cost, dates or workspace period", () => {
    for (const [id, value] of [["revenue", "1100"], ["cost", "150"], ["video-total", "5"], ["profit-currency", "USD"], ["profit-period-start", "2024-01-01"], ["period-start", "2024-01-01"]]) {
      fixture(); const current = snapshot(); initProfitTools({ snapshot: () => current }); confirm(); calculate();
      expect(document.getElementById("profit-output")!.textContent).toContain("900");
      set(id, value); expect(document.getElementById("profit-output")!.textContent).toBe("");
      expect((document.getElementById("profit-count-confirm") as HTMLInputElement).checked).toBe(false);
      expect((document.getElementById("profit-revenue-confirm") as HTMLInputElement).checked).toBe(false);
    }
  });
  it("invalidates unchanged rolling labels on new collections and clears stale revenue when the next collection has none", () => {
    fixture(); const current = snapshot(); const tools = initProfitTools({ snapshot: () => current }); confirm(); calculate();
    current.studio!.observedAt = "2024-03-02T10:00:00Z"; tools.render();
    expect(document.getElementById("profit-output")!.textContent).toBe("");
    confirm(); calculate(); expect(document.getElementById("profit-output")!.textContent).toContain("900");
    current.studio = undefined; tools.render();
    expect((document.getElementById("revenue") as HTMLInputElement).value).toBe("");
    expect((document.getElementById("profit-currency") as HTMLInputElement).value).toBe("");
    expect(document.getElementById("profit-output")!.textContent).toBe("");
  });
  it("preserves a manual edit on a repeated render and detects an unrendered snapshot change before calculate/toggle", () => {
    fixture(); const current = snapshot(); const tools = initProfitTools({ snapshot: () => current });
    set("revenue", "1200"); tools.render(); expect((document.getElementById("revenue") as HTMLInputElement).value).toBe("1200");
    confirm(); calculate(); expect(document.getElementById("profit-output")!.textContent).toContain("1.100");
    current.videos.push({ id: "abcdefghijk", title: "Nova coleta", url: "https://www.youtube.com/watch?v=abcdefghijk" });
    (document.getElementById("profit-back-revenue") as HTMLButtonElement).click();
    expect(document.getElementById("profit-output")!.textContent).toBe("");
    confirm(); current.studio!.revenue = 1300; calculate();
    expect(document.getElementById("profit-output")!.textContent).toBe("");
  });
});
