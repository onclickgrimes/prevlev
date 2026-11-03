import { IMAGE_LIMITS, STILL_IMAGE_TYPES, inspectImageBytes, type ImageHeaderOptions, type ImageInfo } from '../shared/image-header.mjs';
export { IMAGE_LIMITS, STILL_IMAGE_TYPES, inspectImageBytes };
export type { ImageInfo };

export interface ImageWorkOptions extends Omit<ImageHeaderOptions, 'check'> {
  signal?: AbortSignal;
  /** Absolute performance.now() deadline shared by fetch, preflight and decode. */
  deadline?: number;
}
export class ImageResourceTimeout extends Error {
  constructor() { super('Tempo limite do processamento local de imagem atingido.'); this.name = 'TimeoutError'; }
}
const now = () => performance.now();
const abortError = () => new DOMException('Processamento de imagem cancelado.', 'AbortError');
function checkedOptions(options: ImageWorkOptions): ImageWorkOptions & { deadline: number; maxBytes: number } {
  const deadline = options.deadline ?? now() + 15_000;
  if (!Number.isFinite(deadline)) throw new Error('Prazo de processamento de imagem inválido.');
  const maxBytes = options.maxBytes ?? IMAGE_LIMITS.maxBytes;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > IMAGE_LIMITS.maxBytes) throw new Error('Limite de bytes de imagem inválido.');
  return { ...options, maxBytes, deadline };
}
function check(options: ImageWorkOptions): void {
  if (options.signal?.aborted) throw abortError();
  if (options.deadline !== undefined && now() >= options.deadline) throw new ImageResourceTimeout();
}
/** Reject the caller promptly; work already handed to the browser is not assumed cancelled. */
function controlled<T>(work: Promise<T>, options: ImageWorkOptions, lateDispose?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); };
    const fail = (error: unknown) => { if (settled) return; settled = true; cleanup(); reject(error); };
    const abort = () => fail(abortError());
    const timer = setTimeout(() => fail(new ImageResourceTimeout()), Math.max(0, (options.deadline ?? now() + 15_000) - now()));
    options.signal?.addEventListener('abort', abort, { once: true });
    work.then(value => {
      if (settled) { lateDispose?.(value); return; }
      try { check(options); } catch (error) { fail(error); lateDispose?.(value); return; }
      settled = true; cleanup(); resolve(value);
    }, fail);
    if (options.signal?.aborted) abort();
  });
}
function readBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  // FileReader is needed in older browser contexts, and obeys the same bounded slice.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem local.'));
    reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error('Leitura de imagem inválida.'));
    reader.readAsArrayBuffer(blob);
  });
}

/** Inspect bounded still-image bytes before creating any browser image decoder or URL. */
export async function preflightImage(blob: Blob, options: ImageWorkOptions = {}): Promise<ImageInfo> {
  const config = checkedOptions(options); check(config);
  if (!(blob instanceof Blob) || !STILL_IMAGE_TYPES.includes(blob.type as ImageInfo['type'])) throw new Error('Formato não suportado. Use PNG, JPEG ou WebP estático; GIF e AVIF não são aceitos.');
  if (!blob.size || blob.size > config.maxBytes) throw new Error(`A imagem deve ter entre 1 byte e ${config.maxBytes} bytes.`);
  // Blob reads cannot reliably be physically aborted. They share the bounded resource gate
  // with decoders, and retain their slot until the actual read settles after cancellation.
  const bytes = await withImageDecodeSlot(() => readBlobBytes(blob.slice(0, config.maxBytes + 1)), config);
  check(config);
  if (bytes.byteLength !== blob.size) throw new Error('A leitura da imagem diverge do tamanho declarado.');
  return inspectImageBytes(bytes, blob.type, { ...config, check: () => check(config) });
}

/** Bound the encoded string before base64 decoding or allocating an output byte array. */
export async function imageBlobFromDataUrl(value: string, options: ImageWorkOptions = {}): Promise<Blob> {
  const config = checkedOptions(options); check(config);
  if (typeof value !== 'string' || value.length > Math.ceil(config.maxBytes / 3) * 4 + 64) throw new Error('Imagem base64 excede o limite local de bytes.');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(value);
  if (!match || !match[2].length || match[2].length % 4 !== 0) throw new Error('Use uma imagem local base64 válida PNG, JPEG ou WebP estático.');
  const encoded = match[2], padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const byteLength = encoded.length / 4 * 3 - padding;
  if (byteLength < 1 || byteLength > config.maxBytes) throw new Error('Imagem base64 excede o limite local de bytes.');
  let binary: string;
  try { binary = atob(encoded); } catch { throw new Error('Imagem base64 inválida.'); }
  if (binary.length !== byteLength || btoa(binary) !== encoded) throw new Error('Imagem base64 inválida ou não canônica.');
  check(config);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const info = inspectImageBytes(bytes, match[1].toLowerCase(), { ...config, check: () => check(config) });
  return new Blob([bytes], { type: info.type });
}

/** Read a response as a bounded stream, then validate actual container/MIME/dimensions. */
export async function readImageResponse(response: Response, options: ImageWorkOptions = {}): Promise<Blob> {
  const config = checkedOptions(options); check(config);
  const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const length = Number(response.headers.get('content-length'));
  if (!response.ok || !STILL_IMAGE_TYPES.includes(type as ImageInfo['type']) || length > config.maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw new Error('Resposta de imagem inválida, formato não suportado ou tamanho acima do limite local.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Resposta de imagem sem fluxo de bytes.');
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0, completed = false;
  try {
    for (;;) {
      check(config);
      const next = await controlled(reader.read(), config);
      if (next.done) { completed = true; break; }
      total += next.value.byteLength;
      if (total > config.maxBytes) throw new Error('Resposta de imagem excede o limite local de bytes.');
      chunks.push(new Uint8Array(next.value));
    }
    check(config);
    const blob = new Blob(chunks, { type });
    await preflightImage(blob, config);
    return blob;
  } finally {
    if (completed) reader.releaseLock();
    else {
      // A timed-out read may still be pending: cancel first and release only after that settles.
      void reader.cancel().catch(() => {}).finally(() => { try { reader.releaseLock(); } catch { /* A broken stream may keep its lock until disposal. */ } });
    }
  }
}

export interface ImageFetchOptions extends ImageWorkOptions { allowedOrigins?: readonly string[]; headers?: HeadersInit; }
/** Only explicit HTTPS origins; no redirects or account credentials are sent. */
export async function fetchBoundedImage(input: string, options: ImageFetchOptions = {}): Promise<Blob> {
  const config = checkedOptions(options); check(config);
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('URL de imagem inválida.'); }
  const origins = options.allowedOrigins ?? ['https://i.ytimg.com'];
  if (url.username || url.password || url.protocol !== 'https:' || !origins.includes(url.origin)) throw new Error('Use uma imagem local ou uma origem de imagem explicitamente permitida.');
  const controller = new AbortController(), abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, Math.max(0, config.deadline - now()));
  try {
    check(config);
    const response = await controlled(fetch(url.href, { credentials: 'omit', redirect: 'error', signal: controller.signal, headers: options.headers }), config, value => { void value.body?.cancel().catch(() => {}); });
    return await readImageResponse(response, config);
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); controller.abort(); }
}

interface DecodeJob { start: () => void; }
const decodeQueue: DecodeJob[] = [];
let decodeActive = false;
function drainDecodeQueue(): void {
  if (decodeActive) return;
  const next = decodeQueue.shift();
  next?.start();
}

/** One physical image read/decode at a time, at most eight queued. Abort never frees an active slot early. */
export function withImageDecodeSlot<T>(start: () => Promise<T>, options: ImageWorkOptions = {}, dispose: (value: T) => void = () => {}): Promise<T> {
  let config: ReturnType<typeof checkedOptions>;
  try { config = checkedOptions(options); check(config); } catch (error) { return Promise.reject(error); }
  if (decodeQueue.length >= 8) return Promise.reject(new Error('Fila local de imagens cheia; aguarde o processamento atual.'));
  return new Promise((resolve, reject) => {
    let settled = false, started = false;
    const safelyDispose = (value: T) => { try { dispose(value); } catch { /* Disposal must not abandon the physical resource slot. */ } };
    const cleanup = () => { clearTimeout(timer); config.signal?.removeEventListener('abort', abort); };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true; cleanup();
      if (!started) { const index = decodeQueue.indexOf(job); if (index >= 0) decodeQueue.splice(index, 1); }
      reject(error);
    };
    const abort = () => fail(abortError());
    const timer = setTimeout(() => fail(new ImageResourceTimeout()), Math.max(0, config.deadline - now()));
    const job: DecodeJob = { start() {
      if (settled) { drainDecodeQueue(); return; }
      started = true; decodeActive = true;
      const work = Promise.resolve().then(() => { check(config); return start(); });
      work.then(value => {
        if (settled) { safelyDispose(value); return; }
        try { check(config); } catch (error) { fail(error); safelyDispose(value); return; }
        settled = true; cleanup(); resolve(value);
      }, fail).finally(() => { decodeActive = false; drainDecodeQueue(); });
    } };
    config.signal?.addEventListener('abort', abort, { once: true });
    decodeQueue.push(job); drainDecodeQueue();
    if (config.signal?.aborted) abort();
  });
}

/** Preflight always precedes createImageBitmap; exact or EXIF-swapped dimensions must agree. */
export async function decodeImageBitmap(blob: Blob, options: ImageWorkOptions = {}): Promise<ImageBitmap> {
  const config = checkedOptions(options), info = await preflightImage(blob, config);
  return withImageDecodeSlot(async () => {
    check(config);
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const agrees = bitmap.width === info.width && bitmap.height === info.height;
    const rotated = info.type === 'image/jpeg' && bitmap.width === info.height && bitmap.height === info.width;
    if (!agrees && !rotated) { bitmap.close(); throw new Error('Dimensões decodificadas divergem do cabeçalho da imagem.'); }
    return bitmap;
  }, config, bitmap => bitmap.close());
}
