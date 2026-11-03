// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { createProfitCardAdapter, type ProfitCardObservation } from "../src/content/profit-card";
import { createProfitCardBridge, PROFIT_CARD_MAX_SESSIONS, type ProfitCardBridge } from "../src/content/profit-card-bridge";
import { readStudioMetrics } from "../src/content/studio";
import type { ProfitInput } from "../src/core/profit";

const sessionA = "11111111-1111-4111-8111-111111111111", sessionB = "22222222-2222-4222-8222-222222222222";
const bridges: ProfitCardBridge[] = [], windows: JSDOM[] = [];
const input = (receipt: ProfitCardObservation): ProfitInput => ({ revenue: receipt.revenue, currency: receipt.currencyCode, costCurrency: receipt.currencyCode, costPerVideo: 100, videoCount: 3,
  period: { kind: "observed", observation: receipt.id, label: receipt.period.label }, countPeriod: { kind: "observed", observation: receipt.id, label: receipt.period.label },
  source: { kind: "studio-dom", observation: receipt.id, description: receipt.source.description }, collection: receipt.id, revenuePeriodConfirmed: true, countConfirmed: true });
function fixture(settle: () => Promise<void> = async () => {}) {
  const dom = new JSDOM('<div id="TOTAL_ESTIMATED_EARNINGS-tab" data-currency="BRL"><span id="metric-total">R$ 1.000,00</span></div><span id="date-range-label">Últimos 28 dias</span>', { url: "https://studio.youtube.com/video/abcdefghijk/analytics" });
  windows.push(dom);
  const doc = dom.window.document, read = vi.fn(() => readStudioMetrics(doc)), adapter = createProfitCardAdapter({ doc, readMetrics: read });
  const bridge = createProfitCardBridge(adapter, { doc, settle }); bridges.push(bridge);
  return { doc, read, adapter, bridge };
}
afterEach(() => { bridges.splice(0).forEach(bridge => bridge.cleanup()); windows.splice(0).forEach(dom => dom.window.close()); });

describe("sequenced, bounded profit card commands", () => {
  it("opens without reading, requires an observe owner, and restores without discarding its receipt", async () => {
    const { bridge, adapter, read } = fixture(); expect(read).not.toHaveBeenCalled();
    expect((await bridge.dispatch({ type: "STUDIO_PROFIT_RESTORE", session: sessionA, sequence: 1, observationId: "unknown" })).status).toBe("error");
    const observed = await bridge.dispatch({ type: "STUDIO_PROFIT_OBSERVE", session: sessionA, sequence: 2 });
    expect(observed.status).toBe("ok"); const receipt = observed.observation!;
    const shown = await bridge.dispatch({ type: "STUDIO_PROFIT_SHOW", session: sessionA, sequence: 3, observationId: receipt.id, input: input(receipt) });
    expect(shown.display?.result.profit).toBe(700);
    expect((await bridge.dispatch({ type: "STUDIO_PROFIT_RESTORE", session: sessionA, sequence: 4, observationId: receipt.id })).state?.status).toBe("restored");
    expect(adapter.isCurrent(receipt.id)).toBe(true); expect(adapter.getPresentationElement()).toBeUndefined();
    expect((await bridge.dispatch({ type: "STUDIO_PROFIT_SHOW", session: sessionA, sequence: 5, observationId: receipt.id, input: { ...input(receipt), costPerVideo: 200 } })).display?.result.profit).toBe(400);
  });
  it("rejects delayed/repeated sequences, wrong receipts and former owners, including an old OBSERVE with a higher sequence", async () => {
    const { bridge, adapter } = fixture();
    const first = (await bridge.dispatch({ type: "STUDIO_PROFIT_OBSERVE", session: sessionA, sequence: 1 })).observation!;
    await bridge.dispatch({ type: "STUDIO_PROFIT_SHOW", session: sessionA, sequence: 3, observationId: first.id, input: input(first) });
    for (const sequence of [1, 2, 3]) expect((await bridge.dispatch({ type: "STUDIO_PROFIT_RESTORE", session: sessionA, sequence, observationId: first.id })).error).toContain("atrasada");
    expect(adapter.getPresentationElement()).toBeDefined();
    const second = (await bridge.dispatch({ type: "STUDIO_PROFIT_OBSERVE", session: sessionB, sequence: 1 })).observation!;
    expect(adapter.isCurrent(first.id)).toBe(false);
    for (const type of ["STUDIO_PROFIT_OBSERVE", "STUDIO_PROFIT_RESTORE", "STUDIO_PROFIT_CANCEL"]) expect((await bridge.dispatch({ type, session: sessionA, sequence: 100, observationId: first.id })).error).toContain("substituída");
    expect((await bridge.dispatch({ type: "STUDIO_PROFIT_SHOW", session: sessionB, sequence: 2, observationId: first.id, input: input(first) })).error).toContain("outra observação");
    expect(adapter.isCurrent(second.id)).toBe(true);
  });
  it("requires a receipt for every non-observe command and refuses invalid envelopes without native actions", async () => {
    const { bridge, read } = fixture();
    for (const value of [null, {}, { type: "unknown" }, { type: "STUDIO_PROFIT_OBSERVE", session: "not-uuid", sequence: 1 }, { type: "STUDIO_PROFIT_OBSERVE", session: sessionA, sequence: NaN }, { type: "STUDIO_PROFIT_OBSERVE", session: sessionA, sequence: 0 }, { type: "STUDIO_PROFIT_SHOW", session: sessionA, sequence: 1 }, { type: "STUDIO_PROFIT_CANCEL", session: sessionA, sequence: 1 }]) expect((await bridge.dispatch(value)).status).toBe("error");
    expect(read).not.toHaveBeenCalled();
  });
  it("keeps at most eight session histories and does not evict retired sessions that could resurrect late requests", async () => {
    const { bridge } = fixture();
    const session = (index: number) => `${String(index).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
    for (let index = 1; index <= PROFIT_CARD_MAX_SESSIONS; index++) expect((await bridge.dispatch({ type: "STUDIO_PROFIT_OBSERVE", session: session(index), sequence: 1 })).status).toBe("ok");
    expect((await bridge.dispatch({ type: "STUDIO_PROFIT_OBSERVE", session: session(9), sequence: 1 })).error).toContain("Muitos painéis");
    expect((await bridge.dispatch({ type: "STUDIO_PROFIT_OBSERVE", session: session(1).toUpperCase(), sequence: 900 })).error).toContain("substituída");
  });
  it("cancellation discards the receipt and a new observation requires new receipt bindings", async () => {
    const { bridge, adapter } = fixture();
    const first = (await bridge.dispatch({ type: "STUDIO_PROFIT_OBSERVE", session: sessionA, sequence: 1 })).observation!;
    expect((await bridge.dispatch({ type: "STUDIO_PROFIT_CANCEL", session: sessionA, sequence: 2, observationId: first.id })).state?.status).toBe("cancelled");
    expect(adapter.isCurrent(first.id)).toBe(false);
    const next = (await bridge.dispatch({ type: "STUDIO_PROFIT_OBSERVE", session: sessionA, sequence: 3 })).observation!;
    expect((await bridge.dispatch({ type: "STUDIO_PROFIT_SHOW", session: sessionA, sequence: 4, observationId: next.id, input: input(first) })).status).toBe("error");
    expect(adapter.getPresentationElement()).toBeUndefined();
  });
  it("does not turn a cancelled receipt into a restored/current receipt when preparing a capture", async () => {
    const { bridge, adapter } = fixture();
    const receipt = (await bridge.dispatch({ type: "STUDIO_PROFIT_OBSERVE", session: sessionA, sequence: 1 })).observation!;
    adapter.cancel();
    await bridge.prepareCapture();
    expect(adapter.getState().status).toBe("cancelled");
    expect((await bridge.dispatch({ type: "STUDIO_PROFIT_SHOW", session: sessionA, sequence: 2, observationId: receipt.id, input: input(receipt) })).error).toContain("outra observação");
    expect(adapter.getPresentationElement()).toBeUndefined();
  });
});

describe("capture preparation removes or refuses adjacent private estimates", () => {
  it("restores before the settle boundary and preserves the receipt for later explicit recalculation", async () => {
    let settle!: () => void;
    const pending = new Promise<void>(resolve => { settle = resolve; });
    const { adapter, bridge } = fixture(() => pending);
    const receipt = (await bridge.dispatch({ type: "STUDIO_PROFIT_OBSERVE", session: sessionA, sequence: 1 })).observation!;
    await bridge.dispatch({ type: "STUDIO_PROFIT_SHOW", session: sessionA, sequence: 2, observationId: receipt.id, input: input(receipt) });
    const preparation = bridge.prepareCapture(); expect(adapter.getPresentationElement()).toBeUndefined();
    expect((await bridge.dispatch({ type: "STUDIO_PROFIT_SHOW", session: sessionA, sequence: 3, observationId: receipt.id, input: input(receipt) })).error).toContain("captura");
    settle(); await preparation; expect(adapter.isCurrent(receipt.id)).toBe(true);
    expect((await bridge.dispatch({ type: "STUDIO_PROFIT_SHOW", session: sessionA, sequence: 4, observationId: receipt.id, input: input(receipt) })).status).toBe("ok");
  });
  it("refuses a capture after ownership CAS failure, including subsequent cancel attempts", async () => {
    const { adapter, bridge, doc } = fixture();
    const receipt = (await bridge.dispatch({ type: "STUDIO_PROFIT_OBSERVE", session: sessionA, sequence: 1 })).observation!;
    await bridge.dispatch({ type: "STUDIO_PROFIT_SHOW", session: sessionA, sequence: 2, observationId: receipt.id, input: input(receipt) });
    const host = adapter.getPresentationElement()!; host.shadowRoot!.querySelector("output")!.textContent = "Conteúdo externo";
    await expect(bridge.prepareCapture()).rejects.toThrow("Captura recusada");
    adapter.cancel(); await expect(bridge.prepareCapture()).rejects.toThrow("Captura recusada");
    expect(host.shadowRoot!.querySelector("output")!.textContent).toBe("Conteúdo externo"); expect(doc.querySelector("#metric-total")!.textContent).toBe("R$ 1.000,00");
    expect(() => adapter.observe()).toThrow("alterada externamente");
    host.remove(); await bridge.prepareCapture();
  });
  it("checks again after settling and refuses a direct out-of-band projection or cleanup", async () => {
    let settle!: () => void;
    const pending = new Promise<void>(resolve => { settle = resolve; });
    const { adapter, bridge } = fixture(() => pending), receipt = adapter.observe();
    const preparation = bridge.prepareCapture(); adapter.show(input(receipt), receipt.id); settle();
    await expect(preparation).rejects.toThrow("permanece");
    adapter.restore();
    const second = bridge.prepareCapture(); bridge.cleanup();
    await expect(second).rejects.toThrow("encerrado");
    expect((await bridge.dispatch({ type: "STUDIO_PROFIT_OBSERVE", session: sessionA, sequence: 1 })).status).toBe("error");
  });
});
