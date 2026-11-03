// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import {
  cancelStudioPlan,
  executeStudioPlan,
  getStudioRedactionTargets,
  previewStudioAction,
  readStudioMetrics,
  setStudioPeriod,
} from "../src/content/studio";

const fixture = (
  html: string,
  url = "https://studio.youtube.com/channel/UCfixture/comments",
) => new JSDOM(html, { url }).window.document;
const hearts = (count = 2) =>
  fixture(
    Array.from(
      { length: count },
      (_, index) =>
        `<ytcp-comment-thread><ytcp-comment data-comment-id="comment-${index}"><span id="author-text">Author ${index}</span><span id="content-text">Comment ${index}</span><button aria-label="Heart" id="heart-${index}" aria-pressed="false">Heart</button></ytcp-comment></ytcp-comment-thread>`,
    ).join(""),
  );

describe("safe Studio adapter", () => {
  beforeEach(() => vi.useRealTimers());
  it("reads only known rendered metric cards", () => {
    const doc = fixture(
      '<yta-key-metric-card><span id="title">Receita estimada</span><b id="metric-value">R$ 1.234,56</b></yta-key-metric-card><yta-key-metric-card hidden><span id="title">Revenue</span><b id="metric-value">$999999</b></yta-key-metric-card><p>Revenue $999999</p>',
    );
    expect(readStudioMetrics(doc)).toMatchObject({
      revenue: 1234.56,
      currency: "R$",
    });
    expect(
      readStudioMetrics(fixture("<p>Revenue $999</p>")).revenue,
    ).toBeUndefined();
  });
  it("does not click while creating a preview, excludes hidden and disabled controls", async () => {
    const doc = hearts();
    doc.querySelector("#heart-1")!.setAttribute("disabled", "");
    const click = vi.fn();
    doc.querySelector("#heart-0")!.addEventListener("click", click);
    const plan = previewStudioAction("hearts-add", {}, doc);
    expect(plan.status).toBe("ready");
    expect(plan.targetCount).toBe(1);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(click).not.toHaveBeenCalled();
    const result = await executeStudioPlan(plan.id);
    expect(result).toMatchObject({ status: "completed", submitted: 1 });
    expect(click).toHaveBeenCalledOnce();
    expect((await executeStudioPlan(plan.id)).status).toBe("unsupported");
  });
  it("rejects stale or changed targets before any click", async () => {
    const doc = hearts(1);
    const click = vi.fn();
    doc.querySelector("button")!.addEventListener("click", click);
    const plan = previewStudioAction("hearts-add", {}, doc);
    doc.querySelector("button")!.setAttribute("aria-pressed", "true");
    expect((await executeStudioPlan(plan.id)).status).toBe("stale");
    expect(click).not.toHaveBeenCalled();
  });
  it("rejects a recycled comment row while preserving the same heart button", async () => {
    for (const changed of ["author", "text", "identity", "container"]) {
      const doc = hearts(1);
      const button = doc.querySelector<HTMLElement>("button")!;
      const click = vi.fn();
      button.addEventListener("click", click);
      const plan = previewStudioAction("hearts-add", {}, doc);
      expect(plan.status).toBe("ready");
      if (changed === "author")
        doc.querySelector("#author-text")!.textContent = "Another author";
      if (changed === "text")
        doc.querySelector('[id="content-text"]')!.textContent =
          "A different comment";
      if (changed === "identity")
        doc.querySelector<HTMLElement>("ytcp-comment")!.dataset.commentId =
          "another-comment";
      if (changed === "container") {
        const replacement = doc
          .querySelector("ytcp-comment")!
          .cloneNode(true) as HTMLElement;
        replacement.querySelector("button")!.replaceWith(button);
        doc.querySelector("ytcp-comment")!.replaceWith(replacement);
      }
      expect(doc.querySelector("button")).toBe(button);
      expect(await executeStudioPlan(plan.id)).toMatchObject({
        status: "stale",
        submitted: 0,
      });
      expect(click).not.toHaveBeenCalled();
    }
  });
  it("rechecks comment text before every click during a running batch", async () => {
    const doc = hearts(2);
    const first = doc.querySelector<HTMLElement>("#heart-0")!;
    const second = doc.querySelector<HTMLElement>("#heart-1")!;
    const click = vi.fn();
    second.addEventListener("click", click);
    first.addEventListener("click", () => {
      second
        .closest("ytcp-comment")!
        .querySelector('[id="content-text"]')!.textContent =
        "Recycled into another comment";
    });
    const plan = previewStudioAction("hearts-add", {}, doc);
    expect(await executeStudioPlan(plan.id)).toMatchObject({
      status: "stale",
      submitted: 1,
    });
    expect(click).not.toHaveBeenCalled();
  });
  it("refuses heart controls without an identifiable author and comment text", () => {
    expect(
      previewStudioAction(
        "hearts-add",
        {},
        fixture(
          '<ytcp-comment><button aria-label="Heart">Heart</button></ytcp-comment>',
        ),
      ).status,
    ).toBe("unsupported");
  });
  it("does not replay a cancelled plan and refuses other hosts", async () => {
    const plan = previewStudioAction("hearts-add", {}, hearts(1));
    expect(cancelStudioPlan(plan.id)).toBe(true);
    expect((await executeStudioPlan(plan.id)).status).toBe("unsupported");
    expect(
      previewStudioAction(
        "hearts-add",
        {},
        fixture('<button aria-label="Heart"></button>', "https://evil.example"),
      ).status,
    ).toBe("unsupported");
  });
  it("cancels between actions and caps the batch", async () => {
    const doc = hearts(60);
    const controller = new AbortController();
    const plan = previewStudioAction("hearts-add", { limit: 999 }, doc);
    expect(plan.targetCount).toBe(50);
    doc
      .querySelector("button")!
      .addEventListener("click", () => controller.abort());
    const result = await executeStudioPlan(plan.id, controller.signal);
    expect(result.status).toBe("cancelled");
    expect(result.submitted).toBe(1);
  });
  it("removes only currently hearted comments with recognized labels", () => {
    const doc = fixture(
      '<ytcp-comment data-comment-id="fixture-comment"><span id="author-text">Fixture author</span><span id="content-text">Fixture comment text</span><button aria-label="Remove heart">Remove</button><button aria-label="Heart" aria-pressed="false">Heart</button><button aria-label="Like">Like</button></ytcp-comment>',
    );
    expect(previewStudioAction("hearts-remove", {}, doc).targetCount).toBe(1);
  });
  it("requires an existing monetization choice and advances only once", async () => {
    const doc = fixture(
      '<ytcp-video-monetization><input type="radio" checked></ytcp-video-monetization><button aria-label="Next">Next</button>',
    );
    const click = vi.fn();
    doc.querySelector("button")!.addEventListener("click", click);
    const plan = previewStudioAction("skip-monetization", {}, doc);
    expect(plan.status).toBe("ready");
    expect(click).not.toHaveBeenCalled();
    await executeStudioPlan(plan.id);
    expect(click).toHaveBeenCalledOnce();
    expect(
      previewStudioAction(
        "skip-monetization",
        {},
        fixture("<button>Next</button>"),
      ).status,
    ).toBe("unsupported");
  });
  it("rejects a monetization choice that changed after the preview", async () => {
    const doc = fixture(
      '<ytcp-video-monetization><input type="radio" checked></ytcp-video-monetization><button aria-label="Next">Next</button>',
    );
    const plan = previewStudioAction("skip-monetization", {}, doc);
    doc.querySelector("input")!.checked = false;
    expect((await executeStudioPlan(plan.id)).status).toBe("stale");
  });
  it("does not double-count nested heart controls", () => {
    const doc = fixture(
      '<ytcp-comment data-comment-id="fixture-comment"><span id="author-text">Fixture author</span><span id="content-text">Fixture comment text</span><ytcp-icon-button aria-label="Heart"><button aria-label="Heart">Heart</button></ytcp-icon-button></ytcp-comment>',
    );
    expect(previewStudioAction("hearts-add", {}, doc).targetCount).toBe(1);
  });
  it("fills exactly the previewed open midroll fields without save clicks", async () => {
    const doc = fixture(
      '<ytcp-ad-breaks-editor><input aria-label="Ad slot start time" value="00:02:00"><input aria-label="Ad slot start time" value="00:04:00"></ytcp-ad-breaks-editor><button>Save</button>',
    );
    const save = vi.fn();
    doc.querySelector("button")!.addEventListener("click", save);
    expect(
      previewStudioAction("midrolls", { positions: [120] }, doc).status,
    ).toBe("unsupported");
    const plan = previewStudioAction(
      "midrolls",
      { positions: [180, 360] },
      doc,
    );
    const result = await executeStudioPlan(plan.id);
    expect(result).toMatchObject({ status: "completed", submitted: 2 });
    expect(
      [...doc.querySelectorAll("input")].map((field) => field.value),
    ).toEqual(["00:03:00", "00:06:00"]);
    expect(save).not.toHaveBeenCalled();
  });
  it("fills native dates in an open dialog and returns unsupported on unknown layouts", () => {
    const doc = fixture(
      '<div role="dialog"><input type="date"><input type="date"></div>',
    );
    expect(setStudioPeriod("2026-01-01", "2026-02-01", doc).status).toBe(
      "ready",
    );
    expect(doc.querySelector("input")!.value).toBe("2026-01-01");
    expect(setStudioPeriod("2026-05-01", "2026-02-01", doc).status).toBe(
      "unsupported",
    );
    expect(setStudioPeriod("2026-02-31", "2026-03-15", doc).status).toBe(
      "unsupported",
    );
    expect(
      setStudioPeriod("2026-01-01", "2026-02-01", fixture("")).status,
    ).toBe("unsupported");
  });
  it("returns only visible sensitive card elements for screenshot redaction", () => {
    const doc = fixture(
      '<yta-key-metric-card></yta-key-metric-card><ytcp-avatar hidden></ytcp-avatar><div id="channel-name">Name</div>',
    );
    expect(getStudioRedactionTargets(doc)).toHaveLength(2);
  });
});
