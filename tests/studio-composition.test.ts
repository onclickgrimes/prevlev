import { describe, expect, it } from 'vitest';
import { studioCompositionDimensions, studioCompositionSourceLabel, validateStudioCaptureReceipt, validateStudioComposition, type StudioCaptureReceipt, type StudioCompositionInput, type StudioCompositionOptions } from '../src/core/studio-composition';

const receipt = (): StudioCaptureReceipt => ({ kind: 'analytics', contextKey: 'tab-1/context-A', capturedAt: '2026-11-03T04:00:00Z', redactionValidated: true, redacted: true, categories: ['revenue', 'channel'] });
const input = (): StudioCompositionInput => ({ image: new Blob(['parameters-only-fixture'], { type: 'image/png' }), source: { kind: 'validated-studio-capture', receipt: receipt() } });
const options = (): StudioCompositionOptions => ({ layout: 'analytics-only', theme: 'dark', background: 'theme', scale: 1, metadata: {} });

describe('local Studio composition contracts', () => {
  it('keeps both layouts and scale within the fixed output pixel budget', () => {
    expect(studioCompositionDimensions('analytics-only', 1)).toEqual({ width: 1120, height: 800 });
    expect(studioCompositionDimensions('video-info', 2)).toEqual({ width: 2400, height: 1560 });
    for (const layout of ['analytics-only', 'video-info'] as const) for (const scale of [1, 2] as const) { const size = studioCompositionDimensions(layout, scale); expect(size.width * size.height).toBeLessThan(4_000_000); }
    expect(() => studioCompositionDimensions('unrecognized' as 'analytics-only', 1)).toThrow();
    expect(() => studioCompositionDimensions('analytics-only', 3 as 1)).toThrow();
  });
  it('requires validated capture/redaction provenance and consistent explicit mask categories', () => {
    expect(() => validateStudioCaptureReceipt(receipt())).not.toThrow();
    expect(() => validateStudioCaptureReceipt({ ...receipt(), redacted: false, categories: [] })).not.toThrow();
    for (const changed of [{ redactionValidated: false }, { contextKey: '' }, { capturedAt: 'unknown' }, { redacted: false }, { categories: [] }, { categories: ['revenue', 'revenue'] }, { categories: ['unknown'] }]) expect(() => validateStudioCaptureReceipt({ ...receipt(), ...changed } as StudioCaptureReceipt)).toThrow('recibo');
  });
  it('rejects unsupported/oversized input and unbounded metadata or colors before a decoder can run', () => {
    expect(() => validateStudioComposition(input(), options())).not.toThrow();
    for (const image of [new Blob([], { type: 'image/png' }), new Blob(['file'], { type: 'image/jpeg' }), new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'image/png' })]) expect(() => validateStudioComposition({ ...input(), image }, options())).toThrow('PNG');
    expect(() => validateStudioComposition(input(), { ...options(), metadata: { title: 'x'.repeat(201) } })).toThrow('Metadados');
    expect(() => validateStudioComposition(input(), { ...options(), background: 'custom', color: 'url(secret)' })).toThrow('fundo');
  });
  it('labels local files and capture receipts without claiming recovered or private data', () => {
    const local = studioCompositionSourceLabel({ kind: 'user-local-png', name: 'meu-recorte.png' });
    expect(local).toContain('PNG local: meu-recorte.png'); expect(local).toContain('Ocultações não verificadas');
    const captured = studioCompositionSourceLabel(input().source); expect(captured).toContain('Recorte de analytics validado'); expect(captured).toContain('receita, canal'); expect(captured).toContain('Não garante anonimização completa');
  });
});
