import { describe, expect, it } from 'vitest';
import { bindImageContext, ConfirmedImageMetadata, imageContextSurface, type ImageContextCapture } from '../src/core/image-context';

const sample = (): ImageContextCapture => ({ source: 'selected-tab', identity: 'tab:7:https://www.youtube.com/results?search_query=local', url: 'https://www.youtube.com/results?search_query=local', title: 'Busca observada', observedAt: '2026-11-03T06:00:00Z', videos: [{ id: 'abcdefghijk', title: 'Vídeo observado', url: 'https://www.youtube.com/watch?v=abcdefghijk', views: 12, source: 'youtube-dom' }] });
describe('confirmed local preview metadata', () => {
  it('restores last Done including the exact avatar instead of reverting each time to defaults', () => {
    const first = new File(['A'], 'avatar-A.png', { type: 'image/png' }), second = new File(['B'], 'avatar-B.png', { type: 'image/png' });
    const initial = { channel: 'Seu canal', views: 'Exemplo', date: 'Exemplo', duration: '10:00' }, baseline = new ConfirmedImageMetadata(initial);
    expect(baseline.restore()).toEqual(initial);
    const confirmed = { channel: 'Canal A', views: '100 views simuladas', date: 'Data A simulada', duration: '01:23', avatar: first }; baseline.confirm(confirmed);
    const editing = { ...confirmed, channel: 'Canal B', avatar: second }; expect(editing.avatar).toBe(second);
    confirmed.channel = 'Objeto alterado depois de Done'; const restored = baseline.restore(); expect(restored.channel).toBe('Canal A'); expect(restored.avatar).toBe(first);
    restored.views = 'Não altera a confirmação'; expect(baseline.restore().views).toBe('100 views simuladas');
  });
});
describe('bound source samples for local image previews', () => {
  it('infers the five observed surfaces from actual URLs without trusting a requested visual feed', () => {
    expect(imageContextSurface('https://www.youtube.com/')).toBe('home'); expect(imageContextSurface('https://www.youtube.com/feed/trending')).toBe('trending');
    expect(imageContextSurface('https://www.youtube.com/feed/subscriptions')).toBe('subscriptions'); expect(imageContextSurface('https://www.youtube.com/@local/videos')).toBe('channel');
    expect(imageContextSurface('https://www.youtube.com/results?search_query=local')).toBe('search'); expect(imageContextSurface('https://www.youtube.com/watch?v=abcdefghijk')).toBe('other');
  });
  it('freezes actual URL, source, rows and identity without modifying the supplied collection', () => {
    const capture = sample(), bound = bindImageContext(capture, capture); capture.videos[0].title = 'Alteração posterior';
    expect(bound.url).toBe('https://www.youtube.com/results?search_query=local'); expect(bound.surface).toBe('search'); expect(bound.videos[0].title).toBe('Vídeo observado'); expect(bound.label).toContain('Aba selecionada');
    const collection = bindImageContext({ ...sample(), source: 'collection' }, { source: 'collection', identity: capture.identity }); expect(collection.label).toContain('não atribui uma origem única');
  });
  it('refuses wrong source/identity, official API records, absent selected-tab URL and unsupported origins', () => {
    const capture = sample();
    expect(() => bindImageContext(capture, { ...capture, identity: 'tab:8' })).toThrow(/identidade/);
    expect(() => bindImageContext(capture, { ...capture, source: 'collection' })).toThrow(/fonte/);
    expect(() => bindImageContext({ ...capture, videos: [{ ...capture.videos[0], source: 'youtube-data-api' }] }, capture)).toThrow(/API oficial/);
    expect(() => bindImageContext({ ...capture, url: '' }, capture)).toThrow(/URL exata/);
    expect(() => bindImageContext({ ...capture, url: 'https://example.test/' }, capture)).toThrow(/YouTube/);
  });
  it('bounds copied samples and reports empty or noneligible samples without inventing context', () => {
    const capture = sample();
    expect(() => bindImageContext({ ...capture, videos: [] }, capture)).toThrow(/Nenhum contexto foi inventado/);
    expect(() => bindImageContext({ ...capture, videos: [{ ...capture.videos[0], id: 'invalid' }] }, capture)).toThrow(/elegíveis/);
    const many = bindImageContext({ ...capture, videos: Array.from({ length: 501 }, () => ({ ...capture.videos[0] })) }, capture); expect(many.videos).toHaveLength(500); expect(many.inputCount).toBe(501);
  });
});
