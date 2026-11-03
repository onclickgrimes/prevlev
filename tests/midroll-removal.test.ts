// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { createMidrollRemovalPlanner, type MidrollRemovalCriterion, type MidrollRemovalObservation } from "../src/core/midroll-removal";
import { observeStudioMidrollSlots } from "../src/content/studio";

const instant = Date.parse("2026-11-03T04:00:00.000Z");
function observation(): MidrollRemovalObservation {
  return { source: "manual-observation", contextKey: "video-a", contextLabel: "vídeo video-a", observedAt: new Date(instant).toISOString(), slots: [120, 240, 360, 480].map((seconds, i) => ({ id: `slot-${i}`, seconds, displayedTime: String(seconds) })), limitations: ["Observação manual não verificada."] };
}
function fixture() {
  return new JSDOM('<ytcp-ad-breaks-editor data-video-id="video-1"><input aria-label="Ad slot start time" value="00:02:00"><input aria-label="Ad slot start time" value="00:04:00"><button aria-label="Insert ad slot">Insert ad slot</button></ytcp-ad-breaks-editor><button id="save">Save</button>', { url: "https://studio.youtube.com/video/video-1/monetization" }).window.document;
}

describe("local midroll removal plans without an executor", () => {
  it("previews exactly the observed all/range targets with inclusive boundaries and immutable values", () => {
    const planner = createMidrollRemovalPlanner(() => instant), source = observation();
    expect(planner.preview(source, { mode: "all" }).count).toBe(4);
    const plan = planner.preview(source, { mode: "range", startSeconds: 240, endSeconds: 360 });
    expect(plan).toMatchObject({ status: "preview", count: 2, confirmationText: "REMOVER 2 DE vídeo video-a", targets: [{ seconds: 240 }, { seconds: 360 }], expiresAt: new Date(instant + 120_000).toISOString() });
    expect(Object.isFrozen(plan.targets)).toBe(true);
    expect(Object.isFrozen(plan.targets[0])).toBe(true);
    expect(plan.limitations.join(" ")).toContain("Somente plano local");
    expect(source.slots).toHaveLength(4);
  });
  it("requires an exact video/total confirmation and closes only a local plan", () => {
    const planner = createMidrollRemovalPlanner(() => instant), source = observation(), plan = planner.preview(source, { mode: "all" });
    expect(() => planner.confirm(plan.id, "REMOVER 3 DE vídeo video-a", source)).toThrow("exatamente");
    expect(planner.confirm(plan.id, plan.confirmationText, source).status).toBe("confirmed-local");
    expect(() => planner.confirm(plan.id, plan.confirmationText, source)).toThrow("encerrado");
  });
  it("invalidates the plan when source, route, label, identity, slot value or count changes", () => {
    for (const change of ["source", "context", "label", "identity", "value", "count"] as const) {
      const planner = createMidrollRemovalPlanner(() => instant), source = observation(), plan = planner.preview(source, { mode: "all" });
      const next = { ...source, slots: source.slots.map(slot => ({ ...slot })) };
      if (change === "source") next.source = "studio-dom";
      if (change === "context") next.contextKey = "another-video";
      if (change === "label") next.contextLabel = "another label";
      if (change === "identity") next.slots[0].id = "recycled";
      if (change === "value") next.slots[0].seconds = 121;
      if (change === "count") next.slots.pop();
      expect(planner.confirm(plan.id, plan.confirmationText, next).status).toBe("stale");
    }
  });
  it("cancels, supersedes and expires plans without any executable action", () => {
    let now = instant;
    const planner = createMidrollRemovalPlanner(() => now), source = observation(), plan = planner.preview(source, { mode: "all" });
    expect(planner.cancel()?.status).toBe("cancelled");
    expect(() => planner.confirm(plan.id, plan.confirmationText, source)).toThrow("encerrado");
    const second = planner.preview(source, { mode: "all" });
    const third = planner.preview(source, { mode: "range", startSeconds: 120, endSeconds: 240 });
    expect(() => planner.confirm(second.id, second.confirmationText, source)).toThrow("encerrado");
    now += 120_000;
    expect(planner.confirm(third.id, third.confirmationText, source).status).toBe("expired");
  });
  it("rejects interruptive/unknown modes, invalid ranges, no matches and more than 50 targets", () => {
    const planner = createMidrollRemovalPlanner(() => instant), source = observation();
    expect(() => planner.preview(source, { mode: "interruptive" } as unknown as MidrollRemovalCriterion)).toThrow("marcador visível comprovado");
    for (const [startSeconds, endSeconds] of [[NaN, 20], [20, Infinity], [20, 10], [-1, 20]]) expect(() => planner.preview(source, { mode: "range", startSeconds, endSeconds })).toThrow("faixa válida");
    expect(() => planner.preview(source, { mode: "range", startSeconds: 1, endSeconds: 2 })).toThrow("Nenhum slot");
    expect(() => planner.preview({ ...source, slots: Array.from({ length: 51 }, (_, i) => ({ id: `slot-${i}`, seconds: i, displayedTime: String(i) })) }, { mode: "all" })).toThrow("Nenhum alvo foi truncado");
  });
  it("rejects invalid or old observations without inventing slot values", () => {
    const planner = createMidrollRemovalPlanner(() => instant), source = observation();
    for (const next of [
      { ...source, observedAt: "invalid" }, { ...source, observedAt: new Date(instant - 120_001).toISOString() },
      { ...source, contextKey: "" }, { ...source, slots: [{ id: "same", seconds: NaN, displayedTime: "?" }] },
      { ...source, slots: [source.slots[0], source.slots[0]] },
    ]) expect(() => planner.preview(next, { mode: "all" })).toThrow("inválida ou antiga");
  });
});

describe("read-only observation from already documented legacy slot anchors", () => {
  it("reads observed fields and never clicks or edits anything", () => {
    const doc = fixture(), click = vi.fn();
    doc.querySelectorAll("button").forEach(button => button.addEventListener("click", click));
    const before = doc.body.innerHTML, result = observeStudioMidrollSlots(doc);
    expect(result).toMatchObject({ source: "studio-dom", contextLabel: "vídeo video-1", slots: [{ seconds: 120, displayedTime: "00:02:00" }, { seconds: 240, displayedTime: "00:04:00" }] });
    expect(doc.body.innerHTML).toBe(before);
    expect(click).not.toHaveBeenCalled();
    expect(result?.limitations.join(" ")).toContain("Nenhum seletor de remoção");
  });
  it("changes context fingerprint on identical cloned fields or editor recycling", () => {
    const doc = fixture(), initial = observeStudioMidrollSlots(doc)!;
    const first = doc.querySelector("input")!; first.replaceWith(first.cloneNode(true));
    const replacedField = observeStudioMidrollSlots(doc)!;
    expect(replacedField.contextKey).not.toBe(initial.contextKey);
    const editor = doc.querySelector("ytcp-ad-breaks-editor")!; editor.replaceWith(editor.cloneNode(true));
    expect(observeStudioMidrollSlots(doc)!.contextKey).not.toBe(replacedField.contextKey);
  });
  it("fails closed on ambiguous/hidden editors, malformed position or conflicting video context", () => {
    for (const change of ["ambiguous", "hidden", "invalid", "identity", "modern"] as const) {
      const doc = fixture(), editor = doc.querySelector<HTMLElement>("ytcp-ad-breaks-editor")!;
      if (change === "ambiguous") doc.body.append(editor.cloneNode(true));
      if (change === "hidden") editor.style.display = "none";
      if (change === "invalid") doc.querySelector("input")!.value = "00:99:00";
      if (change === "identity") editor.dataset.videoId = "another-video";
      if (change === "modern") doc.body.insertAdjacentHTML("beforeend", "<ytve-ad-breaks-editor-options-panel></ytve-ad-breaks-editor-options-panel>");
      expect(observeStudioMidrollSlots(doc)).toBeUndefined();
    }
  });
  it("never interprets modern toolbar/playhead or a non-Studio page as existing slots", () => {
    const doc = new JSDOM('<ytve-ad-breaks-editor-options-panel></ytve-ad-breaks-editor-options-panel><ytve-toolbar><ytcp-media-timestamp-input><input aria-label="Timestamp" value="0:02:00:00"></ytcp-media-timestamp-input></ytve-toolbar>', { url: "https://studio.youtube.com/video/video-1/monetization" }).window.document;
    expect(observeStudioMidrollSlots(doc)).toBeUndefined();
    expect(observeStudioMidrollSlots(new JSDOM(fixture().body.innerHTML, { url: "https://www.youtube.com/watch?v=video-1" }).window.document)).toBeUndefined();
  });
});
