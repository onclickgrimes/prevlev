import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeImageBitmap, fetchBoundedImage, imageBlobFromDataUrl, inspectImageBytes, preflightImage, readImageResponse, withImageDecodeSlot } from '../src/core/image-preflight';

function png(width = 2, height = 3): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(57), view = new DataView(bytes.buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  view.setUint32(8, 13); bytes.set(new TextEncoder().encode('IHDR'), 12);
  view.setUint32(16, width); view.setUint32(20, height); bytes[24] = 8; bytes[25] = 6;
  bytes.set(new TextEncoder().encode('IDAT'), 37); bytes.set(new TextEncoder().encode('IEND'), 49);
  return bytes;
}
function jpeg(width: number, height: number): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array([255, 216, 255, 192, 0, 8, 8, 0, 0, 0, 0, 1, 255, 218, 0, 2, 255, 217]);
  const view = new DataView(data.buffer); view.setUint16(7, height); view.setUint16(9, width); return data;
}
function webp(width: number, height: number): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(26), view = new DataView(data.buffer);
  data.set(new TextEncoder().encode('RIFF')); view.setUint32(4, 18, true); data.set(new TextEncoder().encode('WEBPVP8L'), 8);
  view.setUint32(16, 5, true); data[20] = 47; view.setUint32(21, (width - 1) | ((height - 1) << 14), true); return data;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('bounded still-image preflight before browser decoders', () => {
  it('reads PNG/JPEG/WebP dimensions, permits stricter caps and refuses MIME mismatch', () => {
    for (const [bytes, type] of [[png(), 'image/png'], [jpeg(2, 3), 'image/jpeg'], [webp(2, 3), 'image/webp']] as const) {
      expect(inspectImageBytes(bytes, type)).toMatchObject({ width: 2, height: 3, type });
      expect(() => inspectImageBytes(bytes, type, { maxPixels: 5 })).toThrow('excede');
    }
    expect(() => inspectImageBytes(png(), 'image/jpeg')).toThrow('MIME');
    for (const type of ['image/gif', 'image/avif', 'image/svg+xml']) expect(() => inspectImageBytes(png(), type)).toThrow('Formato');
  });

  it('rejects tiny oversized headers in every supported format before createImageBitmap', async () => {
    const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode);
    for (const [data, type] of [[png(8000, 8000), 'image/png'], [jpeg(8000, 8000), 'image/jpeg'], [webp(8000, 8000), 'image/webp']] as const)
      await expect(decodeImageBitmap(new Blob([data], { type }))).rejects.toThrow('32 megapixels');
    expect(decode).not.toHaveBeenCalled();
    await expect(preflightImage(new Blob([png(17000, 1)], { type: 'image/png' }))).rejects.toThrow('16384');
  });

  it('rejects animation, malformed chunk bounds, missing image data and duplicate headers', () => {
    const base = png(), animated = new Uint8Array(77);
    animated.set(base.subarray(0, 33)); new DataView(animated.buffer).setUint32(33, 8); animated.set(new TextEncoder().encode('acTL'), 37); animated.set(base.subarray(33), 53);
    expect(() => inspectImageBytes(animated, 'image/png')).toThrow('animadas');
    const malformed = png(); new DataView(malformed.buffer).setUint32(33, 0xffffffff);
    expect(() => inspectImageBytes(malformed, 'image/png')).toThrow('Cabeçalho');
    const absent = png(); absent.set(new TextEncoder().encode('text'), 37);
    expect(() => inspectImageBytes(absent, 'image/png')).toThrow('Cabeçalho');
    const duplicate = png(); duplicate.set(new TextEncoder().encode('IHDR'), 37);
    expect(() => inspectImageBytes(duplicate, 'image/png')).toThrow('Cabeçalho');
    const animatedWebp = new Uint8Array(30), view = new DataView(animatedWebp.buffer);
    animatedWebp.set(new TextEncoder().encode('RIFF')); view.setUint32(4, 22, true); animatedWebp.set(new TextEncoder().encode('WEBPVP8X'), 8); view.setUint32(16, 10, true); animatedWebp[20] = 2;
    expect(() => inspectImageBytes(animatedWebp, 'image/webp')).toThrow('animadas');
    const dynamicJpeg = new Uint8Array([...jpeg(2, 3).slice(0, -2), 255, 220, 0, 4, 31, 64, 255, 217]);
    expect(() => inspectImageBytes(dynamicJpeg, 'image/jpeg')).toThrow('dinâmicas');
    expect(() => inspectImageBytes(jpeg(2, 3).slice(0, -2), 'image/jpeg')).toThrow('Cabeçalho');
  });

  it('bounds Blob reads and base64 strings before allocating/reading decoder inputs', async () => {
    const reads = vi.spyOn(Blob.prototype, 'arrayBuffer');
    await expect(preflightImage(new Blob([png()], { type: 'image/png' }), { maxBytes: 10 })).rejects.toThrow('byte');
    expect(reads).not.toHaveBeenCalled();
    const decodeBase64 = vi.spyOn(globalThis, 'atob');
    await expect(imageBlobFromDataUrl(`data:image/png;base64,${'A'.repeat(1000)}`, { maxBytes: 64 })).rejects.toThrow('limite');
    expect(decodeBase64).not.toHaveBeenCalled();
    await expect(imageBlobFromDataUrl('data:image/png;base64,AB==')).rejects.toThrow('canônica');
    const dataUrl = `data:image/png;base64,${Buffer.from(png()).toString('base64')}`;
    expect(await preflightImage(await imageBlobFromDataUrl(dataUrl))).toMatchObject({ width: 2, height: 3 });
  });

  it('bounds streaming remote bytes regardless of content-length and checks actual dimensions', async () => {
    let cancelled = false;
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(100)); }, cancel() { cancelled = true; } });
    await expect(readImageResponse(new Response(stream, { headers: { 'content-type': 'image/png' } }), { maxBytes: 64 })).rejects.toThrow('limite');
    expect(cancelled).toBe(true);
    await expect(readImageResponse(new Response(png(8000, 8000), { headers: { 'content-type': 'image/png' } }))).rejects.toThrow('32 megapixels');
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _options?: RequestInit) => new Response(png(), { headers: { 'content-type': 'image/png' } })); vi.stubGlobal('fetch', fetcher);
    await expect(fetchBoundedImage('https://example.com/image.png')).rejects.toThrow('permitida');
    expect(fetcher).not.toHaveBeenCalled();
    const image = await fetchBoundedImage('https://i.ytimg.com/vi/fixture/default.jpg');
    expect(image.type).toBe('image/png');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error' });
  });

  it('releases a stream lock safely after aborting a pending read', async () => {
    const controller = new AbortController(); let cancelled = false;
    const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'image/png' } });
    const work = readImageResponse(response, { signal: controller.signal });
    const failed = expect(work).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await failed;
    await vi.waitFor(() => expect(response.body?.locked).toBe(false));
    expect(cancelled).toBe(true);
  });
});

describe('physical image resource gate', () => {
  it('retains a cancelled decoder slot until native completion and closes its late bitmap', async () => {
    const finishes: ((bitmap: ImageBitmap) => void)[] = [];
    const decoder = vi.fn(() => new Promise<ImageBitmap>(resolve => finishes.push(resolve))); vi.stubGlobal('createImageBitmap', decoder);
    const source = new Blob([png()], { type: 'image/png' }), controller = new AbortController();
    const first = decodeImageBitmap(source, { signal: controller.signal });
    await vi.waitFor(() => expect(decoder).toHaveBeenCalledTimes(1));
    const failed = expect(first).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await failed;
    const second = decodeImageBitmap(source);
    await new Promise(resolve => setTimeout(resolve, 10)); expect(decoder).toHaveBeenCalledTimes(1);
    const close = vi.fn(); finishes[0]({ width: 2, height: 3, close } as unknown as ImageBitmap);
    await vi.waitFor(() => expect(decoder).toHaveBeenCalledTimes(2)); expect(close).toHaveBeenCalledOnce();
    const latest = { width: 2, height: 3, close: vi.fn() } as unknown as ImageBitmap; finishes[1](latest);
    expect(await second).toBe(latest); latest.close();
  });

  it('retains timed-out physical work and bounds queued jobs without starting extra work', async () => {
    vi.useFakeTimers();
    let release: (value: string) => void = () => {};
    const first = withImageDecodeSlot(() => new Promise<string>(resolve => { release = resolve; }), { deadline: performance.now() + 10 });
    const failed = expect(first).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(11); await failed;
    const started = vi.fn(async () => 'next');
    const controllers = Array.from({ length: 8 }, () => new AbortController());
    const queued = controllers.map(controller => withImageDecodeSlot(started, { signal: controller.signal }));
    const settled = Promise.allSettled(queued);
    await expect(withImageDecodeSlot(started)).rejects.toThrow('Fila'); expect(started).not.toHaveBeenCalled();
    for (const controller of controllers) controller.abort(); await settled;
    const next = withImageDecodeSlot(started); release('old');
    expect(await next).toBe('next'); expect(started).toHaveBeenCalledOnce();
  });

  it('bounds physical Blob reads after an aborted caller while a later input waits', async () => {
    const finishes: ((bytes: ArrayBuffer) => void)[] = [];
    const read = vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(() => new Promise<ArrayBuffer>(resolve => finishes.push(resolve)));
    const source = new Blob([png()], { type: 'image/png' }), controller = new AbortController();
    const first = preflightImage(source, { signal: controller.signal });
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const failed = expect(first).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await failed;
    const next = preflightImage(source);
    await new Promise(resolve => setTimeout(resolve, 10)); expect(read).toHaveBeenCalledTimes(1);
    finishes[0](png().buffer);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2)); finishes[1](png().buffer);
    expect(await next).toMatchObject({ width: 2, height: 3 });
  });
});
