// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mountChannelReport } from "../src/ui/channel-report";

describe("channel report mount", () => {
  it("renders text safely, uses explicit manual inputs, invalidates and cleans up", () => {
    const section = document.createElement("section"); document.body.append(section);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const mount = mountChannelReport(section, () => [{ id: "abcdefghijk", title: "<img src=x onerror=alert(1)> hello", isShort: true, source: "youtube-dom" }]);
    const form = section.querySelector("form")!;
    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
    expect(field("coverage").value).toBe(""); expect(field("coverage").required).toBe(false);
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    const result = section.querySelector<HTMLElement>(".channel-report-result")!;
    expect(result.hidden).toBe(false); expect(result.textContent).toContain("Transcrição e duração não foram informadas");
    field("videoId").value = "abcdefghijk"; field("text").value = "one two three"; field("duration").value = "60";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(result.textContent).toContain("Informe a cobertura da transcrição"); expect(result.textContent).not.toContain("palavras por minuto.");
    field("videoId").value = "abcdefghijk"; field("text").value = "one two three"; field("duration").value = "60"; field("coverage").value = "partial";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(result.hidden).toBe(false); expect(result.textContent).toContain("3 palavras / 60 segundos ≈ 3 palavras por minuto");
    expect(result.textContent).toContain("cobertura declarada: parcial"); expect(result.querySelector("img")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    field("duration").value = "0,000000001"; form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(result.textContent).toContain("3 palavras / 1e-9 segundos ≈ 180000000000 palavras por minuto");
    field("duration").value = "1000000000000"; form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(result.textContent).toContain("≈ 1.8e-10 palavras por minuto");
    field("duration").value = "1e3"; form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(result.textContent).toContain("Informe duração real positiva");
    field("text").dispatchEvent(new Event("input", { bubbles: true })); expect(result.hidden).toBe(true);
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); mount.invalidate(); expect(result.hidden).toBe(true);
    expect(field("text").value).toBe("one two three");
    mount.clearInputs(); expect(field("text").value).toBe(""); expect(field("videoId").value).toBe(""); expect(field("coverage").value).toBe(""); expect(result.hidden).toBe(true);
    mount.cleanup(); expect(section.childNodes).toHaveLength(0); expect(section.dataset.channelReportMounted).toBeUndefined();
    fetchSpy.mockRestore(); section.remove();
  });
});
