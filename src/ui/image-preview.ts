import { preflightImage, withImageDecodeSlot } from "../core/image-preflight";

export interface ImagePreviewOptions { signal?: AbortSignal; deadline?: number; maxBytes?: number; maxPixels?: number; maxDimension?: number }
export interface ImagePreview { url: string; release(): void }

/** Header limits precede browser decode; only a validated, revocable local URL reaches img.src. */
export async function prepareImagePreview(image: HTMLImageElement, blob: Blob, options: ImagePreviewOptions = {}): Promise<ImagePreview> {
  const config = { ...options, deadline: options.deadline ?? performance.now() + 15000 };
  const info = await preflightImage(blob, config);
  let url: string | undefined, released = false, decoding = false;
  const clearSource = () => {
    if (url) {
      if (image.getAttribute("src") === url) image.removeAttribute("src");
      URL.revokeObjectURL(url);
    }
  };
  const release = () => {
    if (released) return;
    released = true;
    config.signal?.removeEventListener("abort", release);
    // Callers append only after this function resolves. Keep a private decoder's
    // source alive until physical decode settles; removing it mid-decode can
    // leave Chromium's decode Promise unresolved and stall the resource gate.
    if (!decoding) clearSource();
  };
  config.signal?.addEventListener("abort", release, { once: true });
  try {
    await withImageDecodeSlot(async () => {
      if (released || config.signal?.aborted) throw new DOMException("Prévia cancelada.", "AbortError");
      decoding = true;
      try {
        url = URL.createObjectURL(blob);
        image.src = url;
        await image.decode();
        const { naturalWidth: width, naturalHeight: height } = image;
        if (!width || !height || width > (config.maxDimension ?? 16384) || height > (config.maxDimension ?? 16384) || width * height > (config.maxPixels ?? 32_000_000)) throw new Error("Dimensões decodificadas excedem o limite da prévia local.");
        if (!(width === info.width && height === info.height) && !(info.type === "image/jpeg" && width === info.height && height === info.width)) throw new Error("Dimensões decodificadas divergem do cabeçalho da prévia.");
        return image;
      } finally { decoding = false; if (released) clearSource(); }
    }, config, () => release());
    if (released || config.signal?.aborted || !url) throw new DOMException("Prévia cancelada.", "AbortError");
    return { url, release };
  } catch (error) { release(); throw error; }
}
