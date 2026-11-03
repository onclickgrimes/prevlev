// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { completedPublicationPeriod, initStudioOverview } from "../src/ui/studio-overview";
import { readStudioMetrics } from "../src/content/studio";
import type { PageSnapshot } from "../src/shared/types";

const now = new Date("2024-03-08T23:59:59Z");
function fixture() {
  document.body.innerHTML = '<section id="studio"><input id="period-start" type="date"><input id="period-end" type="date"><input id="video-total" value="1"><button id="period">Preencher</button></section>';
}
function snapshot(): PageSnapshot { return { url: "", title: "", videos: [], comments: [], transcript: [], warnings: [] }; }
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("UTC publication periods", () => {
  it("includes publication day, crosses leap day, and requires a completed final day", () => {
    expect(completedPublicationPeriod("2024-02-29", 7, now)).toEqual({ start: "2024-02-29", end: "2024-03-06" });
    expect(completedPublicationPeriod("2024-03-01", 7, new Date("2024-03-07T23:59:59Z"))).toBeUndefined();
    expect(completedPublicationPeriod("2024-03-01", 7, new Date("2024-03-08T00:00:00Z"))).toEqual({ start: "2024-03-01", end: "2024-03-07" });
    expect(completedPublicationPeriod("2023-12-30", 7, now)).toEqual({ start: "2023-12-30", end: "2024-01-05" });
    for (const days of [7, 14, 28, 60, 90, 180, 365]) {
      const start = Date.parse("2024-01-01T00:00:00Z");
      const lastDay = start + (days - 1) * 86_400_000;
      expect(completedPublicationPeriod("2024-01-01", days, new Date(lastDay + 86_400_000 - 1))).toBeUndefined();
      expect(completedPublicationPeriod("2024-01-01", days, new Date(lastDay + 86_400_000))?.end).toBe(new Date(lastDay).toISOString().slice(0, 10));
    }
    for (const value of ["2023-02-29", "2024-02-30", "2024-2-01", "", "2025-01-01"]) expect(completedPublicationPeriod(value, 7, now)).toBeUndefined();
  });
});

describe("Studio overview on a real DOM fixture", () => {
  it("clears declared publication and period when video changes and refuses an unrendered context switch",()=>{
    fixture();const current=snapshot();current.url='https://studio.youtube.com/video/aaaaaaaaaaa/analytics';current.videoId='aaaaaaaaaaa';
    const tools=initStudioOverview({snapshot:()=>current});const publication=document.querySelector<HTMLInputElement>('#studio-publication-date')!,seven=document.querySelector<HTMLButtonElement>('[data-days="7"]')!;
    publication.value='2020-01-01';publication.dispatchEvent(new Event('input'));seven.click();
    expect(document.querySelector<HTMLInputElement>('#period-start')!.value).toBe('2020-01-01');
    current.url='https://studio.youtube.com/video/bbbbbbbbbbb/analytics';current.videoId='bbbbbbbbbbb';tools.render();
    expect(publication.value).toBe('');expect(seven.disabled).toBe(true);expect(document.querySelector<HTMLInputElement>('#period-start')!.value).toBe('');expect(document.querySelector<HTMLInputElement>('#period-end')!.value).toBe('');
    publication.value='2021-01-01';publication.dispatchEvent(new Event('input'));current.videoId='ccccccccccc';
    seven.click();expect(publication.value).toBe('');expect(document.querySelector<HTMLInputElement>('#period-start')!.value).toBe('');
  });
  it("preserves the declaration for the same video when only query parameters or unrelated metrics change",()=>{
    fixture();const current=snapshot();current.url='https://studio.youtube.com/video/aaaaaaaaaaa/analytics?period=28';current.videoId='aaaaaaaaaaa';const tools=initStudioOverview({snapshot:()=>current});
    const publication=document.querySelector<HTMLInputElement>('#studio-publication-date')!;publication.value='2020-01-01';publication.dispatchEvent(new Event('input'));
    current.url='https://studio.youtube.com/video/aaaaaaaaaaa/analytics?period=90';current.title='Changed metric render';tools.render();
    expect(publication.value).toBe('2020-01-01');expect(document.querySelector<HTMLButtonElement>('[data-days="7"]')!.disabled).toBe(false);
    tools.invalidateContext();expect(publication.value).toBe('');expect(document.querySelector<HTMLButtonElement>('[data-days="7"]')!.disabled).toBe(true);
  });
  it("renders observed fields, provenance, unknowns and warnings without inventing a period or quantity", () => {
    fixture();
    const source = new DOMParser().parseFromString('<div id="TOTAL_ESTIMATED_EARNINGS-tab" data-currency="BRL"><span id="metric-total">R$ 1.234,56</span></div><span id="date-range-label">Últimos 28 dias</span><yta-key-metric-card data-metric="Quantidade de vídeos"><b id="metric-value">12</b></yta-key-metric-card>', "text/html");
    // readStudioMetrics requires a real Studio URL.
    const studioDoc = new JSDOM(source.body.innerHTML, { url: "https://studio.youtube.com/channel/fixture/analytics" }).window.document;
    const current = snapshot(); current.studio = readStudioMetrics(studioDoc);
    const controller = initStudioOverview({ snapshot: () => current });
    const text = document.querySelector("#studio-overview")!.textContent!;
    expect(text).toContain("1234.56"); expect(text).toContain("Últimos 28 dias"); expect(text).toContain("BRL"); expect(text).toContain("escopo da contagem não confirmado"); expect(text).toContain("#metric-total");
    expect((document.querySelector("#video-total") as HTMLInputElement).value).toBe("1");
    current.studio = undefined; controller.render();
    expect(document.querySelector("#studio-overview-fields")!.textContent).toContain("Desconhecida");
    expect(document.querySelector("#studio-overview-fields")!.textContent).toContain("Desconhecido");
  });
  it("requires a user-entered date and never invokes native period action or network", () => {
    vi.useFakeTimers(); vi.setSystemTime(now); fixture();
    const network = vi.spyOn(globalThis, "fetch"); const nativeClick = vi.fn(); document.querySelector("#period")!.addEventListener("click", nativeClick);
    initStudioOverview({ snapshot });
    const pub = document.querySelector<HTMLInputElement>("#studio-publication-date")!;
    const seven = document.querySelector<HTMLButtonElement>('[data-days="7"]')!;
    expect(seven.disabled).toBe(true); pub.value = "2024-03-01"; pub.dispatchEvent(new Event("input", { bubbles: true }));
    expect(seven.disabled).toBe(false); expect(document.querySelector<HTMLButtonElement>('[data-days="14"]')!.disabled).toBe(true);
    seven.click(); expect(document.querySelector<HTMLInputElement>("#period-start")!.value).toBe("2024-03-01"); expect(document.querySelector<HTMLInputElement>("#period-end")!.value).toBe("2024-03-07");
    expect(nativeClick).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
});
