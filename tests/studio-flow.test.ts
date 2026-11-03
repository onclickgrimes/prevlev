// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://studio.youtube.com/channel/UCfixture/comments"}
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Message = {
  type: string;
  action?: string;
  input?: { limit?: number; positions?: number[] };
  planId?: string;
  start?: string;
  end?: string;
};
type Listener = (
  message: Message,
  sender: chrome.runtime.MessageSender,
  reply: (response: unknown) => void,
) => boolean | undefined;
interface Result {
  status: string;
  id?: string;
  targetCount?: number;
  submitted?: number;
  error?: string;
  message?: string;
}
let listener: Listener;
const heartClicks = vi.fn();
const network = vi.fn();
const startPath = "/channel/UCfixture/comments";

async function send(message: Message): Promise<Result> {
  return new Promise((resolve) =>
    listener(message, { id: "prevlev-studio-fixture" }, (response) =>
      resolve(response as Result),
    ),
  );
}
function comments(count = 2): void {
  document.body.innerHTML = Array.from(
    { length: count },
    (_, index) =>
      `<ytcp-comment-thread><ytcp-comment data-comment-id="comment-${index}"><span id="author-text">Author ${index}</span><span id="content-text">Comment ${index}</span><button id="heart-${index}" aria-label="Heart" aria-pressed="false">Heart</button></ytcp-comment></ytcp-comment-thread>`,
  ).join("");
  document
    .querySelectorAll("button")
    .forEach((button) => button.addEventListener("click", heartClicks));
}

beforeAll(async () => {
  vi.stubGlobal("chrome", {
    runtime: {
      id: "prevlev-studio-fixture",
      onMessage: {
        addListener: (fn: Listener) => {
          listener = fn;
        },
      },
      sendMessage: vi.fn(async () => ({ status: "ok" })),
    },
    storage: {
      local: {
        get: vi.fn(async () => ({
          settings: {
            hideShorts: false,
            showMetrics: false,
            backendUrl: "",
            backendToken: "",
          },
        })),
        set: vi.fn(async () => {}),
      },
      onChanged: { addListener: vi.fn() },
    },
  });
  vi.stubGlobal("fetch", network);
  comments();
  await import("../src/content/index");
  await vi.waitFor(() =>
    expect(document.querySelector("#prevlev-controls")).not.toBeNull(),
  );
});
beforeEach(() => {
  history.replaceState(null, "", startPath);
  comments();
  heartClicks.mockClear();
});

describe("Studio workflow through the actual content-script message dispatcher", () => {
  it("never changes the channel on load, rejects execution without a preview and rejects another sender", async () => {
    expect(heartClicks).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    expect(await send({ type: "STUDIO_EXECUTE" })).toMatchObject({
      status: "error",
      error: "Uma prévia é necessária.",
    });
    expect(
      await send({ type: "STUDIO_EXECUTE", planId: "invented-plan" }),
    ).toMatchObject({ status: "unsupported" });
    const reply = vi.fn();
    expect(
      listener(
        { type: "STUDIO_PREVIEW", action: "hearts-add" },
        { id: "other-extension" },
        reply,
      ),
    ).toBe(false);
    expect(reply).not.toHaveBeenCalled();
    expect(heartClicks).not.toHaveBeenCalled();
  });
  it("previews without clicking, executes only after the explicit confirmation message, and refuses replay", async () => {
    const preview = await send({
      type: "STUDIO_PREVIEW",
      action: "hearts-add",
      input: { limit: 2 },
    });
    expect(preview).toMatchObject({ status: "ready", targetCount: 2 });
    expect(heartClicks).not.toHaveBeenCalled();
    const result = await send({ type: "STUDIO_EXECUTE", planId: preview.id });
    expect(result).toMatchObject({ status: "completed", submitted: 2 });
    expect(heartClicks).toHaveBeenCalledTimes(2);
    expect(
      await send({ type: "STUDIO_EXECUTE", planId: preview.id }),
    ).toMatchObject({ status: "unsupported" });
    expect(heartClicks).toHaveBeenCalledTimes(2);
  });
  it("invalidates the confirmed target after an SPA route change", async () => {
    const preview = await send({
      type: "STUDIO_PREVIEW",
      action: "hearts-add",
    });
    history.replaceState(null, "", "/channel/UCdifferent/comments");
    expect(
      await send({ type: "STUDIO_EXECUTE", planId: preview.id }),
    ).toMatchObject({ status: "stale", submitted: 0 });
    expect(heartClicks).not.toHaveBeenCalled();
  });
  it("invalidates detached controls even when the URL stayed the same", async () => {
    const preview = await send({
      type: "STUDIO_PREVIEW",
      action: "hearts-add",
    });
    comments();
    expect(
      await send({ type: "STUDIO_EXECUTE", planId: preview.id }),
    ).toMatchObject({ status: "stale", submitted: 0 });
    expect(heartClicks).not.toHaveBeenCalled();
  });
  it("cancels a preview without clicks, and a running batch before its second action", async () => {
    const first = await send({ type: "STUDIO_PREVIEW", action: "hearts-add" });
    expect(
      await send({ type: "STUDIO_CANCEL", planId: first.id }),
    ).toMatchObject({ status: "cancelled" });
    expect(
      await send({ type: "STUDIO_EXECUTE", planId: first.id }),
    ).toMatchObject({ status: "unsupported" });
    expect(heartClicks).not.toHaveBeenCalled();
    const second = await send({ type: "STUDIO_PREVIEW", action: "hearts-add" });
    const execution = send({ type: "STUDIO_EXECUTE", planId: second.id });
    expect(heartClicks).toHaveBeenCalledOnce();
    expect(
      await send({ type: "STUDIO_CANCEL", planId: second.id }),
    ).toMatchObject({ status: "cancelled" });
    expect(await execution).toMatchObject({
      status: "cancelled",
      submitted: 1,
    });
    expect(heartClicks).toHaveBeenCalledOnce();
  });
  it("fills midroll controls from the confirmed plan and leaves final saving to the user", async () => {
    document.body.innerHTML =
      '<ytcp-ad-breaks-editor><input aria-label="Ad slot start time" value="00:02:00"><input aria-label="Ad slot start time" value="00:04:00"></ytcp-ad-breaks-editor><button id="save">Save</button>';
    const save = vi.fn();
    document.querySelector("#save")!.addEventListener("click", save);
    const preview = await send({
      type: "STUDIO_PREVIEW",
      action: "midrolls",
      input: { positions: [180, 360] },
    });
    expect(preview).toMatchObject({ status: "ready", targetCount: 2 });
    expect(
      [...document.querySelectorAll("input")].map((input) => input.value),
    ).toEqual(["00:02:00", "00:04:00"]);
    expect(
      await send({ type: "STUDIO_EXECUTE", planId: preview.id }),
    ).toMatchObject({ status: "completed", submitted: 2 });
    expect(
      [...document.querySelectorAll("input")].map((input) => input.value),
    ).toEqual(["00:03:00", "00:06:00"]);
    expect(save).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });
  it("rejects monetization confirmation if the existing choice changed", async () => {
    document.body.innerHTML =
      '<ytcp-video-monetization><input type="radio" checked></ytcp-video-monetization><button aria-label="Next">Next</button>';
    const next = vi.fn();
    document.querySelector("button")!.addEventListener("click", next);
    const preview = await send({
      type: "STUDIO_PREVIEW",
      action: "skip-monetization",
    });
    expect(preview.status).toBe("ready");
    expect(next).not.toHaveBeenCalled();
    document.querySelector("input")!.checked = false;
    expect(
      await send({ type: "STUDIO_EXECUTE", planId: preview.id }),
    ).toMatchObject({ status: "stale", submitted: 0 });
    expect(next).not.toHaveBeenCalled();
  });
  it("keeps unknown layouts unsupported rather than reporting successful automation", async () => {
    document.body.innerHTML =
      "<div>Studio layout without recognized controls</div>";
    expect(
      await send({ type: "STUDIO_PREVIEW", action: "hearts-add" }),
    ).toMatchObject({ status: "unsupported", targetCount: 0 });
    expect(
      await send({
        type: "STUDIO_PREVIEW",
        action: "midrolls",
        input: { positions: [180] },
      }),
    ).toMatchObject({ status: "unsupported", targetCount: 0 });
    expect(
      await send({
        type: "STUDIO_PERIOD",
        start: "2026-01-01",
        end: "2026-01-31",
      }),
    ).toMatchObject({ status: "unsupported" });
    expect(network).not.toHaveBeenCalled();
  });
});
