import { describe, expect, it, vi } from 'vitest';
import { cardCompositionDimensions, validateCardComposition, composeCard, type CardCompositionOptions } from '../src/core/card-composition';

const image = () => new Blob(['image'], { type: 'image/png' });
const options = (): CardCompositionOptions => ({ format: 'card', background: 'transparent', scale: 1, metadata: { id: 'abcdefghijk', title: 'Exemplo', source: 'youtube-dom', views: 0 } });

describe('local card composition', () => {
  it('bounds output dimensions for both layouts and scales', () => {
    expect(cardCompositionDimensions('card', 1)).toEqual({ width: 640, height: 600 });
    expect(cardCompositionDimensions('card', 2)).toEqual({ width: 1280, height: 1200 });
    expect(cardCompositionDimensions('short', 1)).toEqual({ width: 440, height: 820 });
    expect(cardCompositionDimensions('short', 2)).toEqual({ width: 880, height: 1640 });
    expect(() => cardCompositionDimensions('card', 3 as 1)).toThrow();
  });
  it('validates image size, metadata, and explicit background before decoding', async () => {
    expect(() => validateCardComposition(image(), options())).not.toThrow();
    expect(() => validateCardComposition(new Blob([], { type: 'image/png' }), options())).toThrow('imagem local');
    expect(() => validateCardComposition(new Blob(['x'], { type: 'image/svg+xml' }), options())).toThrow('imagem local');
    expect(() => validateCardComposition(new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'image/png' }), options())).toThrow('10 MiB');
    expect(() => validateCardComposition(image(), { ...options(), background: 'custom', color: 'red' })).toThrow('cor');
    expect(() => validateCardComposition(image(), { ...options(), metadata: { title: '', source: 'user-provided' } })).toThrow('Metadados');
    expect(() => validateCardComposition(image(), { ...options(), metadata: { title: 'x', id: 'bad', source: 'user-provided' } })).toThrow('Metadados');
    expect(() => validateCardComposition(image(), { ...options(), metadata: { title: 'x', views: -1, source: 'user-provided' } })).toThrow('Metadados');
    expect(() => validateCardComposition(image(), { ...options(), metadata: { title: 'x', source: 'youtube-data-api' as 'youtube-dom' } })).toThrow('Metadados');
    await expect(composeCard(image(), { ...options(), scale: 3 as 1 })).rejects.toThrow('escala');
  });
});

// Minimal structurally valid container; preflight must reject its dimensions before decoding.
function headerPng(width: number, height: number, animated = false): Blob {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const chunk = (name: string, data: number[]) => {
    const result = new Uint8Array(data.length + 12), view = new DataView(result.buffer);
    view.setUint32(0, data.length); result.set([...name].map(char => char.charCodeAt(0)), 4); result.set(data, 8);
    return result;
  };
  const ihdr = new Uint8Array(13), view = new DataView(ihdr.buffer);
  view.setUint32(0, width); view.setUint32(4, height); ihdr.set([8, 6, 0, 0, 0], 8);
  return new Blob([new Uint8Array(signature), chunk('IHDR', [...ihdr]), ...(animated ? [chunk('acTL', [0, 0, 0, 1, 0, 0, 0, 0])] : []), chunk('IDAT', [0]), chunk('IEND', [])], { type: 'image/png' });
}

describe('image decoding preflight', () => {
  it('never invokes a decoder for malicious dimensions, malformed headers, animation, GIF or AVIF', async () => {
    const decoder = vi.fn(); vi.stubGlobal('createImageBitmap', decoder);
    try {
      await expect(composeCard(headerPng(8193, 1), options())).rejects.toThrow('8192');
      await expect(composeCard(headerPng(100000, 1), options())).rejects.toThrow('excede');
      await expect(composeCard(headerPng(1, 1, true), options())).rejects.toThrow('animadas');
      await expect(composeCard(new Blob(['x'], { type: 'image/png' }), options())).rejects.toThrow('Cabeçalho');
      await expect(composeCard(new Blob(['x'], { type: 'image/gif' }), options())).rejects.toThrow('PNG, JPEG ou WebP');
      await expect(composeCard(new Blob(['x'], { type: 'image/avif' }), options())).rejects.toThrow('PNG, JPEG ou WebP');
      expect(decoder).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
