// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureFrame,
  compressImage,
  cropScreenshot,
  fitDimensions,
  loadImage,
  normalizeFilename,
  thumbnailUrls,
} from "../src/core/media";

afterEach(() => vi.restoreAllMocks());

describe("local media boundaries", () => {
  it("fits wide and tall sources without stretching or enlargement", () => {
    expect(fitDimensions(1920, 1080, 1280, 720)).toEqual({
      width: 1280,
      height: 720,
    });
    expect(fitDimensions(800, 1600, 1280, 720)).toEqual({
      width: 360,
      height: 720,
    });
    expect(fitDimensions(120, 60, 1280, 720)).toEqual({
      width: 120,
      height: 60,
    });
    expect(() => fitDimensions(0, 720, 1280, 720)).toThrow("Largura");
    expect(() => fitDimensions(10, 10, Infinity, 720)).toThrow("máxima");
  });
  it("builds public thumbnail candidates and rejects URL injection", () => {
    const urls = thumbnailUrls("dQw4w9WgXcQ");
    expect(urls[0]).toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
    );
    expect(urls).toHaveLength(5);
    expect(() => thumbnailUrls("../private")).toThrow("ID");
  });
  it("blocks remote hosts, scripts and oversized local inputs before decoding", async () => {
    await expect(loadImage("https://example.com/tracker.png")).rejects.toThrow(
      "local",
    );
    await expect(loadImage("javascript:alert(1)")).rejects.toThrow("local");
    await expect(
      loadImage(new Blob(["<svg/>"], { type: "image/svg+xml" })),
    ).rejects.toThrow("Formato");
    await expect(
      loadImage(new Blob([], { type: "image/png" })),
    ).rejects.toThrow("byte");
    await expect(
      compressImage(new Blob(["x"], { type: "image/png" }), { quality: 0 }),
    ).rejects.toThrow("Qualidade");
  });
  it("refuses a frame until the video has actual image data", async () => {
    const video = document.createElement("video");
    await expect(captureFrame(video)).rejects.toThrow("frame");
  });
  it("uses a safe downloadable basename", () => {
    expect(normalizeFilename("../../private/name?.png")).toBe(
      "_.._private_name_.png",
    );
    expect(normalizeFilename("")).toBe("prevlev.png");
  });
});

describe("visible tab crop and redaction", () => {
  it("crops at device scale and redacts matching viewport coordinates", async () => {
    const drawImage = vi.fn(),
      fillRect = vi.fn();
    const context = { drawImage, fillRect, fillStyle: "" };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (callback: BlobCallback) {
        callback(new Blob(["capture"], { type: "image/png" }));
      },
    );
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 2000;
        naturalHeight = 1200;
        crossOrigin = "";
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    try {
      const blob = await cropScreenshot(
        "data:image/png;base64,AA==",
        { x: 10, y: 20, width: 300, height: 100 },
        2,
        [{ x: 25, y: 30, width: 40, height: 20 }],
      );
      expect(blob.type).toBe("image/png");
      expect(drawImage.mock.calls[0].slice(1)).toEqual([
        20, 40, 600, 200, 0, 0, 600, 200,
      ]);
      expect(fillRect).toHaveBeenCalledWith(30, 20, 80, 40);
      await expect(
        cropScreenshot(
          "data:image/png;base64,AA==",
          { x: 1500, y: 20, width: 300, height: 100 },
          2,
        ),
      ).rejects.toThrow("fora");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
