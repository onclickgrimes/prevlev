// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountChannelReport } from "../src/ui/channel-report";
import { serializeReportDraft, type ReportAnnotation } from "../src/core/channel-report-content";
import type { ReportVideo } from "../src/core/channel-report";

const channel = "UCaaaaaaaaaaaaaaaaaaaaaa";
let videos: ReportVideo[], section: HTMLElement, mount: ReturnType<typeof mountChannelReport>, downloads: Blob[];
let createDescriptor: PropertyDescriptor | undefined, revokeDescriptor: PropertyDescriptor | undefined;
const main = () => section.querySelector<HTMLFormElement>("form")!;
const editor = () => section.querySelector<HTMLFormElement>(".channel-report-entry-form")!;
const field = (name: string, form = editor()) => form.elements.namedItem(name) as HTMLInputElement;
const result = () => section.querySelector<HTMLElement>(".channel-report-result")!;
const submit = (form = editor()) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
function fill(name: string, value: string, form = editor()) { field(name, form).value = value; field(name, form).dispatchEvent(new Event("input", { bubbles: true })); }
function declaration() {
  fill("target", "video:abcdefghijk"); fill("group", "strategy"); fill("statement", "Estratégia declarada pelo autor"); fill("coverage", "unknown"); fill("sourceLabel", "Declaração do autor");
}
const annotation = (): ReportAnnotation => ({ id: "backup-note", group: "niche", target: { kind: "video", id: "abcdefghijk" }, statement: "Nicho declarado: jardim", coverage: "partial", source: { kind: "material", origin: "user-provided", label: "Notas fornecidas", text: "Notas: jardim, plantas e cultivo.", quote: "plantas" } });
const textOf = (blob: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob); });

beforeEach(() => {
  videos = [{ id: "abcdefghijk", title: "Título observado", channelId: channel, source: "youtube-dom" }, { id: "bcdefghijkl", title: "Segundo", channelId: channel, source: "user-provided" }, { id: "officialAPI", title: "Oficial", source: "youtube-data-api" }];
  section = document.createElement("section"); document.body.append(section); downloads = [];
  createDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL"); revokeDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn((blob: Blob) => { downloads.push(blob); return "blob:fixture"; }) });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  mount = mountChannelReport(section, () => videos);
});
afterEach(async () => {
  mount.cleanup(); section.remove(); await new Promise(resolve => setTimeout(resolve, 0)); vi.restoreAllMocks();
  if (createDescriptor) Object.defineProperty(URL, "createObjectURL", createDescriptor); else Reflect.deleteProperty(URL, "createObjectURL");
  if (revokeDescriptor) Object.defineProperty(URL, "revokeObjectURL", revokeDescriptor); else Reflect.deleteProperty(URL, "revokeObjectURL");
});

describe("structured channel report editor", () => {
  it("starts without analysis or network, adds declared text safely and leaves other groups unknown", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    expect(result().hidden).toBe(true); expect(downloads).toHaveLength(0); expect(fetch).not.toHaveBeenCalled();
    declaration(); fill("statement", '<img src=x onerror="alert(1)"> Declaração'); submit(); submit(main());
    expect(result().querySelector('[data-report-group="strategy"]')!.textContent).toContain("<img"); expect(result().querySelector("img")).toBeNull();
    expect(result().querySelector('[data-report-group="niche"]')!.textContent).toContain("Desconhecido"); expect(result().textContent).toContain("IDs associados: 1/2");
    expect(result().textContent).toContain("Declaração do usuário sem verificação"); expect(fetch).not.toHaveBeenCalled();
  });
  it("copies transcript material only by explicit action, validates the excerpt and preserves WPM semantics", () => {
    fill("videoId", "abcdefghijk", main()); fill("text", "Um dois três: jardim e plantas.", main()); fill("duration", "60", main()); fill("coverage", "partial", main());
    expect(field("sourceText").value).toBe(""); section.querySelector<HTMLButtonElement>(".channel-report-use-transcript")!.click();
    expect(field("sourceText").value).toBe("Um dois três: jardim e plantas."); expect(field("target").value).toBe("video:abcdefghijk");
    fill("group", "topics"); fill("statement", "Tema fornecido: plantas"); fill("quote", "Não existe"); submit();
    expect(section.querySelector(".channel-report-entry-list")!.children).toHaveLength(0); expect(section.querySelector(".channel-report-entry-status")!.textContent).toContain("presente");
    fill("quote", "jardim e plantas"); submit(); submit(main());
    expect(result().textContent).toContain("6 palavras / 60 segundos ≈ 6"); expect(result().querySelector('[data-report-group="topics"] blockquote')!.textContent).toBe("jardim e plantas");
    expect(result().textContent).toContain("Verificado apenas que o trecho aparece");
  });
  it("requires explicit eligible channel IDs and supporting sample IDs for a channel declaration", () => {
    declaration(); fill("target", `channel:${channel}`); fill("targetIds", "officialAPI"); submit();
    expect(section.querySelector(".channel-report-entry-status")!.textContent).toContain("ausente");
    fill("targetIds", "abcdefghijk"); submit(); submit(main());
    expect(result().querySelector('[data-report-group="strategy"]')!.textContent).toContain(`channel ${channel}`); expect(result().textContent).toContain("IDs associados: 1/2");
  });
  it("edits and removes annotations, invalidating prepared exports after every change", () => {
    declaration(); submit(); submit(main()); expect(section.querySelector<HTMLButtonElement>('[data-channel-report-export="json"]')!.disabled).toBe(false);
    section.querySelector<HTMLButtonElement>(".channel-report-entry-list button")!.click(); expect(result().hidden).toBe(true);
    fill("statement", "Revisão declarada"); submit(); submit(main()); expect(result().textContent).toContain("Revisão declarada"); expect(result().textContent).not.toContain("Estratégia declarada pelo autor");
    section.querySelectorAll<HTMLButtonElement>(".channel-report-entry-list button")[1].click(); expect(result().hidden).toBe(true); submit(main());
    expect(result().querySelector('[data-report-group="strategy"]')!.textContent).toContain("Desconhecido");
  });
  it("preserves drafts on collection change but requires explicit reassociation before preparing or exporting", () => {
    declaration(); submit(); submit(main()); videos = videos.map(video => ({ ...video, title: `${video.title} alterado` })); mount.invalidate();
    expect(result().hidden).toBe(true); expect(section.querySelector(".channel-report-entry-list")!.children).toHaveLength(1); submit(main());
    expect(result().hidden).toBe(true); expect(section.querySelector('.channel-report-status')!.textContent).toContain("reassocie");
    section.querySelector<HTMLButtonElement>(".channel-report-review-context")!.click(); submit(main()); expect(result().hidden).toBe(false); expect(result().textContent).toContain("Estratégia declarada pelo autor");
    videos = videos.filter(video => video.id !== "abcdefghijk"); mount.invalidate(); section.querySelector<HTMLButtonElement>(".channel-report-review-context")!.click();
    expect(section.querySelector(".channel-report-entry-status")!.textContent).toContain("elegível"); submit(main()); expect(result().hidden).toBe(true);
  });
  it("exports explicit JSON, CSV and Markdown with bounded excerpts and no full source material", async () => {
    declaration(); fill("sourceKind", "material"); fill("sourceText", "Introdução reservada. trecho literal. Encerramento reservado."); fill("quote", "trecho literal"); submit(); submit(main());
    for (const format of ["json", "csv", "md"]) section.querySelector<HTMLButtonElement>(`[data-channel-report-export="${format}"]`)!.click();
    expect(downloads).toHaveLength(3);
    for (const blob of downloads) { const text = await textOf(blob); expect(text).toContain("trecho literal"); expect(text).not.toContain("Introdução reservada"); }
    expect(JSON.parse(await textOf(downloads[0])).structured.groups).toHaveLength(8);
    section.querySelector<HTMLButtonElement>(".channel-report-draft-export")!.click(); expect(await textOf(downloads[3])).toContain("Introdução reservada");
  });
  it("checks the collection and WPM inputs again before exporting, including changes without DOM events", () => {
    submit(main()); field("duration", main()).value = "99"; section.querySelector<HTMLButtonElement>('[data-channel-report-export="json"]')!.click();
    expect(downloads).toHaveLength(0); expect(result().hidden).toBe(true);
    submit(main()); videos = videos.map(video => ({ ...video, source: "youtube-data-api" })); section.querySelector<HTMLButtonElement>('[data-channel-report-export="json"]')!.click();
    expect(downloads).toHaveLength(0); expect(result().hidden).toBe(true);
  });
  it("imports a bounded same-context draft explicitly and discards delayed imports after edits", async () => {
    const importer = section.querySelector<HTMLInputElement>(".channel-report-draft-import")!, data = serializeReportDraft(videos, [annotation()]);
    Object.defineProperty(importer, "files", { configurable: true, value: [{ size: data.length, text: async () => data }] }); importer.dispatchEvent(new Event("change"));
    await Promise.resolve(); await Promise.resolve(); expect(section.querySelector(".channel-report-entry-list")!.children).toHaveLength(1); submit(main()); expect(result().textContent).toContain("Nicho declarado: jardim");
    let resolve!: (value: string) => void; const pending = new Promise<string>(yes => { resolve = yes; });
    Object.defineProperty(importer, "files", { configurable: true, value: [{ size: data.length, text: () => pending }] }); importer.dispatchEvent(new Event("change"));
    fill("statement", "Alteração posterior"); resolve(data); await Promise.resolve(); await Promise.resolve();
    expect(section.querySelector(".channel-report-entry-status")!.textContent).toContain("descartada");
    mount.clearInputs(); expect(section.querySelector(".channel-report-entry-list")!.children).toHaveLength(0); expect(result().hidden).toBe(true);
  });
});
