// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountCapturedAsset, type CapturedAssetOffer, type CapturedAssetPanel } from "../src/ui/captured-asset";
import type { SaveSwipeAssetMetadata } from "../src/ui/swipe-assets";

type Save = (blob: Blob, metadata: SaveSwipeAssetMetadata, guard: () => boolean) => Promise<string>;
let host: HTMLElement, panel: CapturedAssetPanel, saveAsset: ReturnType<typeof vi.fn<Save>>;
const metadata = (): SaveSwipeAssetMetadata => ({ title: "Captura original", url: "https://www.youtube.com/watch?v=abcdefghijk", source: "youtube-dom", folder: "Capturas", provenance: { kind: "capture", sourceUrl: "https://studio.youtube.com/video/abcdefghijk/analytics?period=28", videoId: "abcdefghijk", createdAt: "2026-11-03T12:00:00Z" } });
const offer = (overrides: Partial<CapturedAssetOffer> = {}): CapturedAssetOffer => ({ blob: new Blob(["provided pixels"], { type: "image/png" }), metadata: metadata(), isCurrent: () => true, ...overrides });
const element = <T extends HTMLElement = HTMLElement>(name: string) => host.querySelector<T>(`.captured-asset-${name}`)!;
const click = (name: string) => element(name).click();
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function title(value: string) { const input = element<HTMLInputElement>("title"); input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); }
beforeEach(() => { host = document.createElement("section"); host.innerHTML = "<p>Host preservado</p>"; document.body.append(host); saveAsset = vi.fn<Save>().mockResolvedValue("saved-id"); panel = mountCapturedAsset(host, { saveAsset }); });
afterEach(() => { panel.dispose(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("explicit captured image offer", () => {
  it("mounts and offers bytes without preview, decoder, network, compression or autosave", () => {
    const fetcher = vi.spyOn(globalThis, "fetch"), decoder = vi.fn(), value = offer(), reader = vi.fn();
    vi.stubGlobal("createImageBitmap", decoder); Object.defineProperty(value.blob, "arrayBuffer", { value: reader });
    expect(host.querySelector<HTMLElement>(".captured-asset")!.hidden).toBe(true); panel.offer(value);
    expect(saveAsset).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled(); expect(decoder).not.toHaveBeenCalled(); expect(reader).not.toHaveBeenCalled();
    expect(host.querySelector("img,a,canvas")).toBeNull(); expect(element("provenance").textContent).toContain(value.metadata.provenance.sourceUrl); expect(element("provenance").textContent).toContain(value.metadata.url); expect(element("provenance").textContent).toContain("image/png");
  });
  it("saves only after a click with edited title and unchanged declared provenance plus a live guard", async () => {
    const value = offer(), sourceUrl = value.metadata.provenance.sourceUrl; panel.offer(value);
    value.metadata.url = "https://changed.example/"; value.metadata.provenance.sourceUrl = "https://changed.example/source";
    title(" Título editado "); click("save");
    expect(saveAsset).toHaveBeenCalledOnce(); const [blob, supplied, guard] = saveAsset.mock.calls[0];
    expect(blob).toBe(value.blob); expect(supplied).toMatchObject({ title: "Título editado", url: "https://www.youtube.com/watch?v=abcdefghijk", source: "youtube-dom", folder: "Capturas", provenance: { sourceUrl, kind: "capture", videoId: "abcdefghijk", createdAt: "2026-11-03T12:00:00Z" } }); expect(guard()).toBe(true);
    await flush(); expect(element("status").textContent).toContain("Captura salva"); expect(element<HTMLButtonElement>("save").disabled).toBe(true); click("save"); expect(saveAsset).toHaveBeenCalledOnce();
  });
  it("does not invent a source, timestamp or video ID when they were not provided", async () => {
    panel.offer(offer({ metadata: { title: "Manual", url: "https://example.test/page", provenance: { kind: "capture", sourceUrl: "https://example.test/page?capture=1" } } })); click("save");
    const supplied = saveAsset.mock.calls[0][1]; expect(supplied.source).toBeUndefined(); expect(supplied.provenance.videoId).toBeUndefined(); expect(supplied.provenance.createdAt).toBeUndefined(); await flush();
  });
  it("invalidates an earlier save on title edit and ignores its completion/finally while a newer save runs", async () => {
    const first = deferred<string>(), second = deferred<string>(); saveAsset.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    panel.offer(offer()); click("save"); const firstGuard = saveAsset.mock.calls[0][2]; title("Novo título"); expect(firstGuard()).toBe(false); expect(element<HTMLButtonElement>("save").disabled).toBe(false);
    click("save"); first.resolve("old-id"); await flush(); expect(element<HTMLButtonElement>("save").disabled).toBe(true); expect(element("status").textContent).toContain("Validando e salvando");
    second.resolve("new-id"); await flush(); expect(element("status").textContent).toContain("Captura salva");
  });
  it("a stale rejection cannot overwrite a new offer or clear a newer pending save", async () => {
    const first = deferred<string>(), second = deferred<string>(); saveAsset.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    panel.offer(offer()); click("save"); const guard = saveAsset.mock.calls[0][2]; panel.offer(offer({ metadata: { ...metadata(), title: "Nova captura", url: "https://www.youtube.com/watch?v=bcdefghijkl" } })); expect(guard()).toBe(false); click("save");
    first.reject(new Error("Falha antiga")); await flush(); expect(element<HTMLInputElement>("title").value).toBe("Nova captura"); expect(element("status").textContent).not.toContain("Falha antiga"); expect(element<HTMLButtonElement>("save").disabled).toBe(true);
    second.resolve("new-id"); await flush(); expect(element("status").textContent).toContain("Captura salva");
  });
  it.each(["discard", "invalidate", "dispose"])("%s invalidates the pending guard and ignores late success", async action => {
    const work = deferred<string>(); saveAsset.mockImplementationOnce(() => work.promise); panel.offer(offer()); click("save"); const guard = saveAsset.mock.calls[0][2];
    if (action === "discard") click("discard"); else if (action === "invalidate") panel.invalidate(); else panel.dispose();
    expect(guard()).toBe(false); work.resolve("late-id"); await flush(); expect(host.textContent).not.toContain("Captura salva");
    if (action === "dispose") { panel.offer(offer()); expect(host.querySelector(".captured-asset")).toBeNull(); expect(host.textContent).toBe("Host preservado"); }
    else expect(host.querySelector<HTMLElement>(".captured-asset")!.hidden).toBe(true);
  });
  it("checks external context before saving and again before reporting success", async () => {
    let current = true; panel.offer(offer({ isCurrent: () => current })); current = false; click("save"); expect(saveAsset).not.toHaveBeenCalled(); expect(element("status").textContent).toContain("origem da captura mudou");
    const work = deferred<string>(); current = true; saveAsset.mockImplementationOnce(() => work.promise); panel.offer(offer({ isCurrent: () => current })); click("save"); current = false; expect(saveAsset.mock.calls[0][2]()).toBe(false); work.resolve("stale-id"); await flush();
    expect(element("status").textContent).not.toContain("Captura salva"); expect(element("status").textContent).toContain("origem da captura mudou");
  });
  it("treats a throwing source guard as stale and notices programmatic title edits without an event", async () => {
    panel.offer(offer({ isCurrent: () => { throw new Error("aba ausente"); } })); expect(saveAsset).not.toHaveBeenCalled(); expect(element<HTMLButtonElement>("save").disabled).toBe(true);
    const work = deferred<string>(); saveAsset.mockImplementationOnce(() => work.promise); panel.offer(offer()); click("save"); element<HTMLInputElement>("title").value = "Editado sem evento";
    expect(saveAsset.mock.calls[0][2]()).toBe(false); work.resolve("old-id"); await flush(); expect(element("status").textContent).toContain("Título alterado"); expect(element<HTMLInputElement>("title").value).toBe("Editado sem evento"); expect(element<HTMLButtonElement>("save").disabled).toBe(false);
  });
  it("shows storage-size/budget errors explicitly without changing bytes or retrying", async () => {
    const blob = new Blob([new Uint8Array(3 * 1024 * 1024 + 1)], { type: "image/png" }); saveAsset.mockRejectedValueOnce(new Error("Ativo excede 3 MiB ou orçamento total de 4 MiB.")); panel.offer(offer({ blob })); click("save"); await flush();
    expect(element("status").textContent).toContain("3 MiB"); expect(element("status").textContent).toContain("4 MiB"); expect(saveAsset).toHaveBeenCalledOnce(); expect(saveAsset.mock.calls[0][0]).toBe(blob); expect(blob.size).toBe(3 * 1024 * 1024 + 1); expect(element<HTMLButtonElement>("save").disabled).toBe(false);
  });
  it("rejects an empty title and keeps untrusted titles/source text inert", () => {
    panel.offer(offer({ metadata: { ...metadata(), title: '<img src=x onerror="alert(1)">' } })); expect(host.querySelector("img")).toBeNull(); title(" "); click("save"); expect(saveAsset).not.toHaveBeenCalled(); expect(element("status").textContent).toContain("1 a 1000");
  });
});
