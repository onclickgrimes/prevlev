/** Static image container inspection, shared by browser and server. No decoding or I/O. */
export const IMAGE_LIMITS = Object.freeze({ maxBytes: 50 * 1024 * 1024, maxPixels: 32_000_000, maxDimension: 16_384 });
export const STILL_IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);

export function inspectImageBytes(input, declaredType, options = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const limits = {};
  for (const key of ['maxBytes', 'maxPixels', 'maxDimension']) {
    const value = options[key] ?? IMAGE_LIMITS[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > IMAGE_LIMITS[key]) throw new Error('Limite de imagem inválido.');
    limits[key] = value;
  }
  const type = declaredType?.toLowerCase().split(';')[0].trim();
  if (!STILL_IMAGE_TYPES.includes(type)) throw new Error('Formato não suportado. Use PNG, JPEG ou WebP estático; GIF e AVIF não são aceitos.');
  if (!bytes.byteLength || bytes.byteLength > limits.maxBytes) throw new Error(`A imagem deve ter entre 1 byte e ${limits.maxBytes} bytes.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bad = () => { throw new Error('Cabeçalho de imagem inválido ou formato incompatível com o MIME.'); };
  const tag = (offset, text) => offset + text.length <= bytes.length && Array.from(text).every((c, i) => bytes[offset + i] === c.charCodeAt(0));
  const bounds = (offset, size) => offset >= 0 && size >= 0 && offset + size <= bytes.length;
  const u24 = offset => bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536;
  const dimensions = (width, height) => {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) bad();
    if (width > limits.maxDimension || height > limits.maxDimension || width * height > limits.maxPixels) throw new Error(`Imagem excede ${limits.maxPixels / 1_000_000} megapixels (${limits.maxPixels} pixels) ou ${limits.maxDimension} pixels por lado.`);
    return { type, width, height, bytes: bytes.byteLength };
  };
  let iterations = 0;
  const check = () => { if ((iterations++ & 255) === 0) options.check?.(); };
  options.check?.();
  if (type === 'image/png') {
    if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value) || view.getUint32(8) !== 13 || !tag(12, 'IHDR')) return bad();
    const result = dimensions(view.getUint32(16), view.getUint32(20));
    let offset = 8, headers = 0, imageData = false, ended = false;
    while (bounds(offset, 12)) {
      check();
      const size = view.getUint32(offset);
      if (!bounds(offset + 8, size + 4)) return bad();
      if (tag(offset + 4, 'IHDR') && (++headers !== 1 || offset !== 8 || size !== 13)) return bad();
      if (tag(offset + 4, 'acTL') || tag(offset + 4, 'fcTL') || tag(offset + 4, 'fdAT')) throw new Error('Imagens animadas não são suportadas.');
      if (tag(offset + 4, 'IDAT')) imageData = true;
      const end = tag(offset + 4, 'IEND');
      offset += size + 12;
      if (end) { if (size !== 0) return bad(); ended = true; break; }
    }
    if (!imageData || !ended || offset !== bytes.length) return bad();
    return result;
  }
  if (type === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bad();
    let offset = 2, result, scanning = false, sawScan = false;
    while (offset < bytes.length) {
      check();
      if (scanning) {
        while (offset < bytes.length && bytes[offset] !== 0xff) {
          if ((offset & 65535) === 0) options.check?.();
          offset++;
        }
      }
      if (bytes[offset++] !== 0xff) return bad();
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      if (offset >= bytes.length) return bad();
      const marker = bytes[offset++];
      if (scanning && (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7))) continue;
      if (marker === 0xd9) return result && sawScan && offset === bytes.length ? result : bad();
      // DNL can redefine the decoded height after SOF; its resource bounds are not static.
      if (marker === 0xdc) throw new Error('JPEG com dimensões dinâmicas não é suportado.');
      scanning = false;
      if (marker === 0xda) {
        if (!result || !bounds(offset, 2) || view.getUint16(offset) < 2 || !bounds(offset, view.getUint16(offset))) return bad();
        offset += view.getUint16(offset); scanning = true; sawScan = true; continue;
      }
      if ([0x00, 0xd8, 0xd9].includes(marker)) return bad();
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (!bounds(offset, 2)) return bad();
      const size = view.getUint16(offset);
      if (size < 2 || !bounds(offset, size)) return bad();
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (result || size < 8) return bad();
        result = dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
      }
      offset += size;
    }
    return bad();
  }
  if (bytes.length < 20 || !tag(0, 'RIFF') || !tag(8, 'WEBP') || view.getUint32(4, true) + 8 !== bytes.length) return bad();
  let offset = 12, canvasWidth = 0, canvasHeight = 0, result, extended = false;
  while (bounds(offset, 8)) {
    check();
    const size = view.getUint32(offset + 4, true), start = offset + 8;
    if (!bounds(start, size + size % 2)) return bad();
    if (tag(offset, 'VP8X')) {
      if (extended || offset !== 12 || size !== 10) return bad();
      extended = true;
      if (bytes[start] & 2) throw new Error('Imagens animadas não são suportadas.');
      canvasWidth = u24(start + 4) + 1; canvasHeight = u24(start + 7) + 1;
      dimensions(canvasWidth, canvasHeight);
    }
    if (tag(offset, 'ANIM') || tag(offset, 'ANMF')) throw new Error('Imagens animadas não são suportadas.');
    if (tag(offset, 'VP8 ') || tag(offset, 'VP8L')) {
      if (result) return bad();
      if (tag(offset, 'VP8 ')) {
        if (size < 10 || (bytes[start] & 1) !== 0 || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a) return bad();
        result = dimensions(view.getUint16(start + 6, true) & 0x3fff, view.getUint16(start + 8, true) & 0x3fff);
      } else {
        if (size < 5 || bytes[start] !== 0x2f) return bad();
        const packed = view.getUint32(start + 1, true);
        result = dimensions((packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1);
      }
    }
    offset = start + size + size % 2;
  }
  if (offset !== bytes.length || !result || (extended && (result.width !== canvasWidth || result.height !== canvasHeight))) return bad();
  return result;
}
