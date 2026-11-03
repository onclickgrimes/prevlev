// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import {
  cancelStudioPlan,
  executeStudioPlan,
  previewStudioAction,
} from "../src/content/studio";

function fixture(initial = 0) {
  const doc = new JSDOM(
    `<!doctype html><ytcp-ad-breaks-editor data-video-id="video-1">${Array.from({ length: initial }, () => '<input aria-label="Ad slot start time" value="00:02:00">').join("")}<button id="insert" aria-label="Insert ad slot">Insert ad slot</button></ytcp-ad-breaks-editor><button id="continue">Continue</button><button id="save">Save</button>`,
    { url: "https://studio.youtube.com/video/video-1/monetization" },
  ).window.document;
  const editor = doc.querySelector<HTMLElement>("ytcp-ad-breaks-editor")!;
  const add = doc.querySelector<HTMLElement>("#insert")!;
  const append = () => {
    const field = doc.createElement("input");
    field.setAttribute("aria-label", "Ad slot start time");
    field.value = "00:00:00";
    editor.append(field);
    return field;
  };
  return { doc, editor, add, append };
}
afterEach(() => vi.useRealTimers());

describe("creating midroll draft intervals through recognized controls", () => {
  it("previews all positions and creation count without clicking", () => {
    const { doc, add } = fixture();
    const click = vi.fn();
    add.addEventListener("click", click);
    const plan = previewStudioAction(
      "midrolls",
      { positions: [180, 360] },
      doc,
    );
    expect(plan).toMatchObject({
      status: "ready",
      targetCount: 2,
      slotsToCreate: 2,
      positions: ["00:03:00", "00:06:00"],
    });
    expect(plan.targets).toHaveLength(2);
    expect(plan.targets[0]).toMatchObject({
      control: "Criar: Insert ad slot",
      value: "00:03:00",
    });
    expect(Object.isFrozen(plan.positions)).toBe(true);
    expect(click).not.toHaveBeenCalled();
  });
  it("creates and fills exactly the confirmed slots without Save or Continue", async () => {
    const { doc, add, append } = fixture();
    const addClick = vi.fn(append);
    add.addEventListener("click", addClick);
    const save = vi.fn();
    doc.querySelector("#save")!.addEventListener("click", save);
    doc.querySelector("#continue")!.addEventListener("click", save);
    const plan = previewStudioAction(
      "midrolls",
      { positions: [180, 360] },
      doc,
    );
    expect(await executeStudioPlan(plan.id)).toMatchObject({
      status: "completed",
      submitted: 2,
      total: 2,
      created: 2,
      addClicks: 2,
    });
    expect(
      [...doc.querySelectorAll("input")].map((input) => input.value),
    ).toEqual(["00:03:00", "00:06:00"]);
    expect(addClick).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
    expect((await executeStudioPlan(plan.id)).status).toBe("unsupported");
  });
  it("uses existing fields before adding the missing interval", async () => {
    const { doc, add, append } = fixture(1);
    add.addEventListener("click", append);
    const plan = previewStudioAction(
      "midrolls",
      { positions: [180, 360] },
      doc,
    );
    expect(plan.slotsToCreate).toBe(1);
    expect(await executeStudioPlan(plan.id)).toMatchObject({
      status: "completed",
      submitted: 2,
      created: 1,
      addClicks: 1,
    });
    expect(
      [...doc.querySelectorAll("input")].map((input) => input.value),
    ).toEqual(["00:03:00", "00:06:00"]);
  });
  it("requires a unique known editor and a unique Add control scoped inside it", () => {
    const { doc, editor, add } = fixture();
    editor.append(add.cloneNode(true));
    expect(
      previewStudioAction("midrolls", { positions: [180] }, doc).status,
    ).toBe("unsupported");
    editor.querySelectorAll("button").forEach((button) => button.remove());
    doc.body.append(add);
    expect(
      previewStudioAction("midrolls", { positions: [180] }, doc).status,
    ).toBe("unsupported");
    editor.append(add);
    add.setAttribute("aria-label", "Unknown action");
    expect(
      previewStudioAction("midrolls", { positions: [180] }, doc).status,
    ).toBe("unsupported");
    add.setAttribute("aria-label", "Insert ad slot");
    doc.body.append(editor.cloneNode(true));
    expect(
      previewStudioAction("midrolls", { positions: [180] }, doc).status,
    ).toBe("unsupported");
  });
  it("rejects changed video context, Add control or field before clicking", async () => {
    for (const mutate of ["context", "button", "field"]) {
      const { doc, editor, add } = fixture(1);
      const click = vi.fn();
      add.addEventListener("click", click);
      const plan = previewStudioAction(
        "midrolls",
        { positions: [180, 360] },
        doc,
      );
      if (mutate === "context") editor.dataset.videoId = "another-video";
      if (mutate === "button") add.setAttribute("aria-label", "Delete ad slot");
      if (mutate === "field") doc.querySelector("input")!.value = "00:01:00";
      expect(await executeStudioPlan(plan.id)).toMatchObject({
        status: "stale",
        submitted: 0,
      });
      expect(click).not.toHaveBeenCalled();
    }
  });
  it("stops when one Add click creates an ambiguous pair of fields", async () => {
    const { doc, add, append } = fixture();
    add.addEventListener("click", () => {
      append();
      append();
    });
    const plan = previewStudioAction(
      "midrolls",
      { positions: [180, 360] },
      doc,
    );
    expect(await executeStudioPlan(plan.id)).toMatchObject({
      status: "stale",
      submitted: 0,
      addClicks: 1,
    });
    expect(
      [...doc.querySelectorAll("input")].map((input) => input.value),
    ).toEqual(["00:00:00", "00:00:00"]);
  });
  it("times out within 1 second when a click produces no recognized field and reports uncertainty", async () => {
    vi.useFakeTimers();
    const { doc, add } = fixture();
    const click = vi.fn();
    add.addEventListener("click", click);
    const plan = previewStudioAction(
      "midrolls",
      { positions: [180, 360] },
      doc,
    );
    const execution = executeStudioPlan(plan.id);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await execution).toMatchObject({
      status: "error",
      submitted: 0,
      created: 0,
      addClicks: 1,
      message: expect.stringContaining("incerto"),
    });
    expect(click).toHaveBeenCalledOnce();
  });
  it("cancels during the wait for a new field without sending a second Add click", async () => {
    const { doc, add } = fixture();
    const click = vi.fn();
    add.addEventListener("click", click);
    const plan = previewStudioAction(
      "midrolls",
      { positions: [180, 360] },
      doc,
    );
    const execution = executeStudioPlan(plan.id);
    expect(click).toHaveBeenCalledOnce();
    expect(cancelStudioPlan(plan.id)).toBe(true);
    expect(await execution).toMatchObject({
      status: "cancelled",
      submitted: 0,
      created: 0,
      addClicks: 1,
    });
    expect(click).toHaveBeenCalledOnce();
  });
  it("cancels after filling the first new slot without creating another", async () => {
    const { doc, add, append } = fixture();
    const controller = new AbortController();
    add.addEventListener("click", () =>
      append().addEventListener("input", () => controller.abort()),
    );
    const plan = previewStudioAction(
      "midrolls",
      { positions: [180, 360] },
      doc,
    );
    expect(await executeStudioPlan(plan.id, controller.signal)).toMatchObject({
      status: "cancelled",
      submitted: 1,
      created: 1,
      addClicks: 1,
    });
    expect(doc.querySelectorAll("input")).toHaveLength(1);
  });
  it("stops if Add recycles an existing field instead of preserving the reviewed controls", async () => {
    const { doc, add, append } = fixture(1);
    add.addEventListener("click", () => {
      doc.querySelector("input")!.remove();
      append();
    });
    const plan = previewStudioAction(
      "midrolls",
      { positions: [180, 360] },
      doc,
    );
    expect(await executeStudioPlan(plan.id)).toMatchObject({
      status: "stale",
      submitted: 1,
      addClicks: 1,
    });
    expect(doc.querySelector("input")!.value).toBe("00:00:00");
  });
  it("rejects a changed channel route while waiting for a new slot", async () => {
    const { doc, add } = fixture();
    add.addEventListener("click", () =>
      doc.defaultView!.history.pushState(null, "", "/video/other/monetization"),
    );
    const plan = previewStudioAction("midrolls", { positions: [180] }, doc);
    expect(await executeStudioPlan(plan.id)).toMatchObject({
      status: "stale",
      submitted: 0,
      addClicks: 1,
    });
  });
  it("rejects more than 50 positions, duplicate rounded positions and destructive removal", () => {
    const { doc } = fixture(2);
    for (const positions of [
      Array.from({ length: 51 }, (_, index) => (index + 1) * 60),
      [180.1, 180.9],
      [0.5],
      [180],
    ])
      expect(previewStudioAction("midrolls", { positions }, doc).status).toBe(
        "unsupported",
      );
  });
});
