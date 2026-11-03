// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mountTimeline,
  refreshTimeline,
  dispatchTimeline,
  type TimelineController,
} from "../src/content/timeline";
import { captureFrame, downloadBlob } from "../src/core/media";

vi.mock("../src/core/media", () => ({
  captureFrame: vi.fn(async () => new Blob(["frame"], { type: "image/png" })),
  downloadBlob: vi.fn(),
}));
let controller: TimelineController | undefined;

function player(duration = 100): HTMLVideoElement {
  const video = document.createElement("video");
  video.className = "html5-main-video";
  Object.defineProperty(video, "duration", {
    configurable: true,
    value: duration,
  });
  Object.defineProperty(video, "paused", {
    configurable: true,
    writable: true,
    value: true,
  });
  video.play = vi.fn(async () => {
    Object.defineProperty(video, "paused", {
      configurable: true,
      writable: true,
      value: false,
    });
    video.dispatchEvent(new Event("play"));
  });
  video.pause = vi.fn(() => {
    Object.defineProperty(video, "paused", {
      configurable: true,
      writable: true,
      value: true,
    });
    video.dispatchEvent(new Event("pause"));
  });
  document.body.append(video);
  return video;
}
function transcript(): void {
  const container = document.createElement("div");
  container.innerHTML = `<ytd-transcript-segment-renderer><span class="segment-timestamp">0:05</span><span class="segment-text">Primeiro tópico</span></ytd-transcript-segment-renderer><ytd-transcript-segment-renderer><span class="segment-timestamp">0:15</span><span class="segment-text">Segundo exemplo</span></ytd-transcript-segment-renderer>`;
  document.body.append(container);
}
function field<T extends HTMLElement>(id: string): T {
  return document
    .getElementById("prevlev-timeline")!
    .shadowRoot!.getElementById(id) as T;
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});
afterEach(() => {
  controller?.cleanup();
  controller = undefined;
  vi.restoreAllMocks();
});

describe("explicit local timeline actions", () => {
  it("mounts one panel without changing position or starting playback", () => {
    const video = player();
    video.currentTime = 12;
    controller = mountTimeline();
    expect(mountTimeline()).toBe(controller);
    refreshTimeline();
    expect(document.querySelectorAll("#prevlev-timeline")).toHaveLength(1);
    expect(video.play).not.toHaveBeenCalled();
    expect(video.currentTime).toBe(12);
    expect(field("time").textContent).toBe("00:12 / 01:40");
    expect(controller.getState().limitations.join(" ")).toContain("1/30 s");
  });
  it("seeks only on controls, clamps to duration and keeps playback state", async () => {
    const video = player();
    controller = mountTimeline();
    field<HTMLInputElement>("seek").value = "37";
    field("seek").dispatchEvent(new Event("change"));
    expect(video.currentTime).toBe(37);
    expect(video.play).not.toHaveBeenCalled();
    const next = document
      .getElementById("prevlev-timeline")!
      .shadowRoot!.querySelector<HTMLButtonElement>('[data-seek="5"]')!;
    next.click();
    expect(video.currentTime).toBe(42);
    const result = await dispatchTimeline({ type: "SEEK_VIDEO", seconds: 900 });
    expect(result?.currentTime).toBe(100);
    await expect(
      dispatchTimeline({ type: "SEEK_VIDEO", seconds: "50" }),
    ).rejects.toThrow("numérica");
    await dispatchTimeline({ type: "TOGGLE_PLAYBACK" });
    expect(video.play).toHaveBeenCalledOnce();
    await dispatchTimeline({ type: "TOGGLE_PLAYBACK" });
    expect(video.pause).toHaveBeenCalledOnce();
  });
  it("disables seeking until finite metadata exists and reports blocked playback", async () => {
    const video = player(Infinity);
    video.play = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    controller = mountTimeline();
    expect(field<HTMLInputElement>("seek").disabled).toBe(true);
    expect(() => controller?.seek(10)).toThrow("duração");
    await expect(controller.togglePlayback()).rejects.toThrow("bloqueou");
    expect(await dispatchTimeline({ type: "NOT_TIMELINE" })).toBeUndefined();
  });
  it("follows replaced video elements and removes old listeners on cleanup", () => {
    const old = player();
    const remove = vi.spyOn(old, "removeEventListener");
    controller = mountTimeline();
    old.remove();
    const replacement = player(200);
    replacement.currentTime = 25;
    document.dispatchEvent(new Event("yt-navigate-finish"));
    expect(remove).toHaveBeenCalledWith("timeupdate", expect.any(Function));
    expect(controller.getState().currentTime).toBe(25);
    const removeReplacement = vi.spyOn(replacement, "removeEventListener");
    controller.cleanup();
    expect(document.getElementById("prevlev-timeline")).toBeNull();
    expect(removeReplacement).toHaveBeenCalledWith(
      "timeupdate",
      expect.any(Function),
    );
  });
  it("captures only when explicitly requested", async () => {
    const video = player();
    controller = mountTimeline();
    expect(captureFrame).not.toHaveBeenCalled();
    field<HTMLButtonElement>("frame").click();
    await vi.waitFor(() => expect(downloadBlob).toHaveBeenCalled());
    expect(captureFrame).toHaveBeenCalledWith(video);
  });
  it("rejects stale player actions before seeking or starting playback", async () => {
    const video = player();
    controller = mountTimeline();
    await expect(
      dispatchTimeline({
        type: "SEEK_VIDEO",
        seconds: 25,
        expectedVideoId: "dQw4w9WgXcQ",
      }),
    ).rejects.toThrow("mudou");
    await expect(
      dispatchTimeline({
        type: "TOGGLE_PLAYBACK",
        expectedVideoId: "dQw4w9WgXcQ",
      }),
    ).rejects.toThrow("mudou");
    expect(video.currentTime).toBe(0);
    expect(video.play).not.toHaveBeenCalled();
  });
});

describe("visible transcript actions", () => {
  it("searches text, seeks a selected segment and exports filtered VTT", () => {
    const video = player();
    transcript();
    controller = mountTimeline();
    const search = field<HTMLInputElement>("search");
    search.value = "topico";
    search.dispatchEvent(new Event("input"));
    const root = document.getElementById("prevlev-timeline")!.shadowRoot!;
    expect(root.querySelectorAll(".segment")).toHaveLength(1);
    root.querySelector<HTMLButtonElement>(".transcript-seek")!.click();
    expect(video.currentTime).toBe(5);
    field<HTMLButtonElement>("vtt").click();
    const blob = vi.mocked(downloadBlob).mock.calls[0][0];
    expect(blob.type).toBe("text/vtt;charset=utf-8");
    expect(field("status").textContent).toContain("1 trechos");
    expect(controller.getState().segments).toHaveLength(2);
  });
  it("copies only explicitly selected transcript segments", async () => {
    player();
    transcript();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    controller = mountTimeline();
    const root = document.getElementById("prevlev-timeline")!.shadowRoot!;
    const checkbox = root.querySelector<HTMLInputElement>(
      '.segment[data-segment="1"] input',
    )!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    field<HTMLButtonElement>("copy").click();
    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("Segundo exemplo"),
    );
    field<HTMLButtonElement>("txt").click();
    expect(field("status").textContent).toContain("1 trechos exportados");
  });
  it("reports unloaded transcripts without network requests", () => {
    player();
    controller = mountTimeline();
    expect(field("count").textContent).toContain("Mostrar transcrição");
    expect(field<HTMLButtonElement>("vtt").disabled).toBe(true);
  });
});
