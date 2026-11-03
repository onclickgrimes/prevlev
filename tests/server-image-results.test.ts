import { describe, expect, it, vi } from "vitest";
import { analyzeAi } from "../server/ai.mjs";
import { directProviderImageDescriptor, imageDescriptorFromBase64, imageDescriptorFromBytes, SERVER_IMAGE_MAX_BYTES } from "../server/image-results.mjs";

// Tiny original fixtures. Only byte inspection and injected transports run here.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZkAAAAASUVORK5CYII=", "base64");
const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJVAA//Z", "base64");
const webp = Buffer.from("UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v02aAA=", "base64");
const image = () => ({ b64_json: png.toString("base64") });
const config = { aiProvider: "openai-compatible" as const, aiBaseUrl: "http://localhost:9000/v1", aiImageModel: "fixture:image" };

function changedPng(width: number, height: number) {
  const bytes = Buffer.from(png); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  // Give the modified header its correct CRC; rejection must come from declared dimensions.
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(12, 29)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29);
  return bytes;
}
function json(body: unknown) { return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }); }

describe("backend image byte preflight", () => {
  it("returns a checked inline descriptor for actual PNG, JPEG and WebP containers", () => {
    for (const [bytes, mime] of [[png, "image/png"], [jpeg, "image/jpeg"], [webp, "image/webp"]] as const) {
      expect(imageDescriptorFromBytes(bytes, mime)).toEqual({ base64: bytes.toString("base64"), mime });
      expect(imageDescriptorFromBase64(bytes.toString("base64"))).toEqual({ base64: bytes.toString("base64"), mime });
    }
    expect(imageDescriptorFromBytes(new Uint8Array(png), " IMAGE/PNG ").mime).toBe("image/png");
  });

  it("refuses tiny dimension bombs before an image descriptor is returned", () => {
    const bomb = changedPng(8000, 8000);
    expect(bomb.byteLength).toBeLessThan(100);
    expect(() => imageDescriptorFromBytes(bomb, "image/png")).toThrow("32 milhões");
    expect(() => imageDescriptorFromBase64(bomb.toString("base64"))).toThrow("32 milhões");
    expect(() => imageDescriptorFromBytes(changedPng(16385, 1), "image/png")).toThrow("16384");
  });

  it("refuses MIME conflicts, unsupported signatures and truncated or malformed containers", () => {
    for (const [bytes, mime] of [[png, "image/jpeg"], [jpeg, "image/webp"], [webp, "image/png"], [png, "image/gif"], [png.subarray(0, 24), "image/png"], [Buffer.from("PRIVATE_RESPONSE_BODY"), "image/png"]] as const) {
      expect(() => imageDescriptorFromBytes(bytes, mime)).toThrow();
    }
    const brokenWebp = Buffer.from(webp); brokenWebp.writeUInt32LE(100000, 4);
    expect(() => imageDescriptorFromBytes(brokenWebp, "image/webp")).toThrow();
    const animatedPng = Buffer.concat([png.subarray(0, 33), Buffer.from([0, 0, 0, 8]), Buffer.from("acTL"), Buffer.alloc(12), png.subarray(33)]);
    expect(() => imageDescriptorFromBytes(animatedPng, "image/png")).toThrow();
    try { imageDescriptorFromBytes(Buffer.from("PRIVATE_RESPONSE_BODY"), "image/png"); } catch (error) { expect(String(error)).not.toContain("PRIVATE_RESPONSE_BODY"); }
  });

  it("enforces decoded and encoded byte caps and canonical Base64 before container inspection", () => {
    expect(() => imageDescriptorFromBytes(new Uint8Array(SERVER_IMAGE_MAX_BYTES + 1), "image/png")).toThrow("16 MiB");
    const tooLarge = "A".repeat(4 * Math.ceil((SERVER_IMAGE_MAX_BYTES + 1) / 3));
    expect(() => imageDescriptorFromBase64(tooLarge)).toThrow("16 MiB");
    for (const value of ["", "A", "====", "A===", "AA=A", "AAA=\n", "data:image/png;base64," + png.toString("base64"), "AAB="]) expect(() => imageDescriptorFromBase64(value)).toThrow();
    expect(() => imageDescriptorFromBytes(new Uint8Array(), "image/png")).toThrow("vazia");
  });

  it("requires one inline result with consistent MIME metadata and refuses every URL representation", () => {
    expect(directProviderImageDescriptor({ data: [image()] })).toEqual({ base64: png.toString("base64"), mime: "image/png" });
    expect(directProviderImageDescriptor({ data: [{ b64_json: jpeg.toString("base64"), mime_type: "image/jpeg", mime: "IMAGE/JPEG" }] }).mime).toBe("image/jpeg");
    for (const data of [[], [image(), image()], [null], [{}], [{ b64_json: png.toString("base64"), mime_type: "image/jpeg" }], [{ ...image(), mime_type: "image/png", mime: "image/webp" }]]) expect(() => directProviderImageDescriptor({ data })).toThrow();
    for (const url of ["https://provider.test/generated.png", "https://user:secret@provider.test/image.png", "http://127.0.0.1/private", "http://169.254.169.254/latest", "file:///private"]) {
      expect(() => directProviderImageDescriptor({ data: [{ url }] })).toThrow("URL não suportada");
      expect(() => directProviderImageDescriptor({ data: [{ ...image(), url }] })).toThrow("URL não suportada");
    }
  });
});

describe("direct image generation response integration", () => {
  it("returns checked bytes, preserves exact model evidence, and never forwards provider URLs", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ model: "fixture:image", data: [image()] }));
    expect(await analyzeAi("thumbnail-generation", { prompt: "Fixture local" }, config, fetcher)).toMatchObject({ status: "ok", data: { model: "fixture:image", modelVerified: true, images: [{ base64: png.toString("base64"), mime: "image/png" }] } });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "POST", redirect: "error", credentials: "omit" });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ n: 1, model: "fixture:image" });
  });

  it("rejects oversized dimensions, invalid bytes, multiple results and URL-only results without follow-up fetch", async () => {
    for (const data of [[{ b64_json: changedPng(8000, 8000).toString("base64") }], [{ b64_json: Buffer.from("not image bytes").toString("base64") }], [image(), image()], [{ url: "http://169.254.169.254/private" }]]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ model: "fixture:image", data }));
      await expect(analyzeAi("thumbnail-generation", { prompt: "Fixture local" }, config, fetcher)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });
});
