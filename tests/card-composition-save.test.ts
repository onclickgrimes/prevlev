// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initCardCompositionTools, type CardCompositionDependencies, type CardCompositionAssetMetadata } from '../src/ui/card-composition';
import type { PageSnapshot } from '../src/shared/types';

vi.mock('../src/core/card-composition', () => ({ composeCard: vi.fn(async () => new Blob(['composed-png'], { type: 'image/png' })) }));
vi.mock('../src/core/image-preflight', () => ({ preflightImage: vi.fn(async () => {}) }));
vi.mock('../src/ui/image-preview', () => ({ prepareImagePreview: vi.fn(async () => ({ url: 'blob:fixture', release: vi.fn() })) }));

let snapshot: PageSnapshot, tools: ReturnType<typeof initCardCompositionTools> | undefined;
const field = (id: string) => document.getElementById(`card-compose-${id}`) as HTMLInputElement;
const button = (id: string) => document.getElementById(`card-compose-${id}`) as HTMLButtonElement;
const change = (id: string, value: string) => { field(id).value = value; field(id).dispatchEvent(new Event('input', { bubbles: true })); };
function mount(saveAsset?: CardCompositionDependencies['saveAsset']) {
  tools = initCardCompositionTools({ snapshot: () => snapshot, saveAsset });
  Object.defineProperty(field('file'), 'files', { configurable: true, value: [new File(['png'], 'own.png', { type: 'image/png' })] });
  change('title', 'Meu título');
}
async function render() { button('render').click(); await vi.waitFor(() => expect(button('download').disabled).toBe(false)); }
beforeEach(() => {
  document.body.innerHTML = '<section id="card-composition"></section>';
  snapshot = { url: 'https://www.youtube.com/', title: 'Collection', videos: [{ id: 'abcdefghijk', title: 'Vídeo observado', url: 'https://www.youtube.com/watch?v=abcdefghijk', source: 'youtube-dom' }, { id: 'ABCDEFGHIJK', title: 'API', url: 'https://www.youtube.com/watch?v=ABCDEFGHIJK', source: 'youtube-data-api' }], comments: [], transcript: [], warnings: [] };
});
afterEach(() => { tools?.dispose(); tools = undefined; vi.clearAllMocks(); });

describe('explicit saving of card composition assets', () => {
  it('preserves the old API and PNG generation without a persistence callback or declared URL', async () => {
    mount(); await render(); expect(button('save').hidden).toBe(true); expect(button('download').disabled).toBe(false);
  });
  it('requires a declared HTTPS reference for manual saving while keeping PNG export available', async () => {
    const save = vi.fn(); mount(save);
    for (const url of ['', 'http://example.test/video', 'javascript:alert(1)', 'https://user:password@example.test/video']) {
      change('url', url); await render(); expect(button('save').disabled).toBe(true); expect(button('download').disabled).toBe(false);
    }
    expect(save).not.toHaveBeenCalled();
  });
  it('saves only on explicit click with actual PNG and declared manual provenance', async () => {
    const save = vi.fn(async (blob: Blob, metadata: CardCompositionAssetMetadata, guard: () => boolean) => {
      expect(blob.type).toBe('image/png'); expect(guard()).toBe(true);
      expect(metadata).toEqual({ title: 'Meu título', url: 'https://example.test/my-video', source: 'user-provided', provenance: { kind: 'composition', sourceUrl: 'https://example.test/my-video', fileName: 'own.png' } });
    });
    mount(save); change('url', 'https://example.test/my-video'); await render(); expect(save).not.toHaveBeenCalled();
    button('save').click(); await vi.waitFor(() => expect(field('status').textContent).toContain('Composição salva')); expect(save).toHaveBeenCalledOnce();
    change('url', 'https://example.test/another'); expect(button('download').disabled).toBe(true); expect(button('save').disabled).toBe(true);
  });
  it('uses the selected record URL/source/ID and excludes official API records', async () => {
    const save = vi.fn(); mount(save); change('source', 'snapshot'); button('load').click();
    expect((field('video') as unknown as HTMLSelectElement).options).toHaveLength(2);
    change('video', '0'); await render(); button('save').click(); await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][1]).toMatchObject({ url: snapshot.videos[0].url, source: 'youtube-dom', provenance: { sourceUrl: snapshot.videos[0].url, videoId: 'abcdefghijk' } });
  });
  it.each(['cancel', 'invalidate', 'dispose'] as const)('a held callback cannot persist after %s and is never retried automatically', async action => {
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; }), persisted: Blob[] = [];
    const save = vi.fn(async (blob: Blob, _metadata: CardCompositionAssetMetadata, guard: () => boolean) => { await pending; if (guard()) persisted.push(blob); });
    mount(save); change('url', 'https://example.test/my-video'); await render(); button('save').click(); await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    if (action === 'cancel') button('save-cancel').click();
    if (action === 'invalidate') tools!.invalidateSnapshot();
    if (action === 'dispose') tools!.dispose();
    release(); await pending; await Promise.resolve(); await Promise.resolve();
    expect(persisted).toHaveLength(0); expect(save).toHaveBeenCalledOnce();
    if (action !== 'dispose') expect(field('status').textContent).not.toContain('Composição salva');
  });
  it('rechecks snapshot dependencies immediately before persistence, including changes without DOM events', async () => {
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; }), persisted: Blob[] = [];
    const save = vi.fn(async (blob: Blob, _metadata: CardCompositionAssetMetadata, guard: () => boolean) => { await pending; if (guard()) persisted.push(blob); });
    mount(save); change('source', 'snapshot'); button('load').click(); change('video', '0'); await render(); button('save').click(); await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    snapshot = { ...snapshot, title: 'Outra coleta' }; release();
    await vi.waitFor(() => expect(field('status').textContent).toContain('contexto mudou')); expect(persisted).toHaveLength(0); expect(button('save').disabled).toBe(true);
  });
  it('does not save or claim success after unannounced reference edits, callback refusal or callback failure', async () => {
    const save = vi.fn(async () => false); mount(save); change('url', 'https://example.test/original'); await render();
    field('url').value = 'https://example.test/changed'; button('save').click(); expect(save).not.toHaveBeenCalled();
    change('url', 'https://example.test/original'); await render(); button('save').click(); await vi.waitFor(() => expect(field('status').textContent).toContain('não concluído'));
    save.mockRejectedValueOnce(new Error('Falha local explícita')); button('save').click(); await vi.waitFor(() => expect(field('status').textContent).toContain('Falha local explícita'));
    expect(save).toHaveBeenCalledTimes(2); expect(button('download').disabled).toBe(false);
  });
});
