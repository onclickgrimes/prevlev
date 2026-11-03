import { describe, expect, it } from 'vitest';
import { AiUsageJournal, isAiUsageFeature, type AiUsageAttemptInput } from '../src/core/ai-usage';
import type { RemoteResponse } from '../src/shared/types';

const attempt = { feature: 'transcript-summary', model: 'fixture:text-model', backendOrigin: 'http://127.0.0.1:8787', origin: 'http://127.0.0.1:7814' } as const;
const journal = (limit = 20) => new AiUsageJournal({ limit, now: () => Date.parse('2026-11-03T12:00:00Z') });

describe('session-only journal of own AI attempts', () => {
  it('distinguishes preparation, POST start and each actual backend status without treating status as billing', () => {
    const usage = journal();
    for (const status of ['ok', 'error', 'unsupported', 'not_configured'] as const) {
      const id = usage.begin(attempt); expect(usage.snapshot().entries[0].state).toBe('prepared');
      expect(usage.dispatched(id)).toBe(true); expect(usage.dispatched(id)).toBe(false);
      expect(usage.complete(id, { status, source: 'prevlev:omni' })).toBe(true);
      expect(usage.complete(id, { status, source: 'prevlev:omni' })).toBe(false);
      expect(usage.uncertain(id)).toBe(false); expect(usage.blocked(id)).toBe(false);
    }
    expect(usage.snapshot().totals).toMatchObject({ attempts: 4, dispatched: 4, blocked: 0, uncertain: 0, cacheHits: 0, responses: { ok: 1, error: 1, unsupported: 1, not_configured: 1 } });
    expect(usage.snapshot().entries[2]).toMatchObject({ state: 'response', postStarted: true, responseStatus: 'error' });
  });

  it('does not count a local preflight failure as a POST or backend response', () => {
    const usage = journal(), id = usage.begin(attempt);
    expect(usage.complete(id, { status: 'not_configured', source: 'prevlev:client' })).toBe(true);
    expect(usage.dispatched(id)).toBe(false);
    expect(usage.snapshot()).toMatchObject({ entries: [{ state: 'blocked', postStarted: false }], totals: { attempts: 1, dispatched: 0, blocked: 1, uncertain: 0, responses: { ok: 0, error: 0, unsupported: 0, not_configured: 0 } } });
  });

  it('keeps transport failures uncertain after POST and resolves them only with a later backend response', () => {
    const usage = journal(), id = usage.begin(attempt); usage.dispatched(id);
    usage.complete(id, { status: 'error', source: 'prevlev:client' });
    expect(usage.snapshot().entries[0]).toMatchObject({ state: 'uncertain', postStarted: true });
    expect(usage.snapshot().totals).toMatchObject({ uncertain: 1, blocked: 0, responses: { error: 0 } });
    expect(usage.uncertain(id)).toBe(false); expect(usage.blocked(id)).toBe(false);
    expect(usage.complete(id, { status: 'ok', source: 'prevlev:omni' })).toBe(true);
    expect(usage.snapshot().totals).toMatchObject({ dispatched: 1, uncertain: 0, responses: { ok: 1 } });
  });

  it('never downgrades a started POST to blocked and treats incompatible responses as uncertain', () => {
    const usage = journal(), id = usage.begin(attempt); usage.dispatched(id); usage.blocked(id);
    expect(usage.snapshot().totals).toMatchObject({ dispatched: 1, blocked: 0, uncertain: 1 });
    const next = usage.begin(attempt); usage.dispatched(next);
    usage.complete(next, { status: '__proto__', source: 'fixture' } as unknown as Pick<RemoteResponse, 'status' | 'source'>);
    expect(usage.snapshot().entries[0].state).toBe('uncertain');
    expect(Object.keys(usage.snapshot().totals.responses)).toEqual(['ok', 'error', 'unsupported', 'not_configured']);
    const before = usage.begin(attempt); usage.uncertain(before);
    expect(usage.snapshot().entries[0].state).toBe('blocked');
  });

  it('counts cache hits separately and refuses catalog, exports or local analyses as AI attempts', () => {
    const usage = journal(); usage.cacheHit('transcript-summary'); usage.cacheHit('transcript-summary');
    expect(usage.snapshot()).toMatchObject({ entries: [], totals: { attempts: 0, dispatched: 0, cacheHits: 2, cacheByFeature: { 'transcript-summary': 2 } } });
    for (const feature of ['catalog', 'export', 'copy', 'channel-report', 'niche', 'history_list']) {
      expect(isAiUsageFeature(feature)).toBe(false);
      expect(() => usage.begin({ feature } as AiUsageAttemptInput)).toThrow('Somente ações de IA');
    }
    expect(usage.snapshot().totals.attempts).toBe(0);
  });

  it('projects metadata only and removes credentials, paths, queries and arbitrary response strings', () => {
    const usage = journal();
    const input = { ...attempt, backendOrigin: 'https://user:PRIVATE_PASSWORD@backend.example/private-path?token=PRIVATE_TOKEN#PRIVATE_FRAGMENT', origin: 'http://user:PRIVATE_OMNI@127.0.0.1:7814/private', prompt: 'PRIVATE_PROMPT', token: 'PRIVATE_AUTH', output: 'PRIVATE_OUTPUT' };
    const id = usage.begin(input); usage.dispatched(id);
    usage.complete(id, { status: 'error', source: 'prevlev:backend', error: 'PRIVATE_ERROR', data: { secret: 'PRIVATE_RESPONSE' } } as RemoteResponse);
    const snapshot = usage.snapshot();
    expect(snapshot.entries[0]).toMatchObject({ model: 'fixture:text-model', backendOrigin: 'https://backend.example', origin: 'http://127.0.0.1:7814', responseSource: 'prevlev:backend' });
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE'); expect(JSON.stringify(snapshot)).not.toContain('private-path');
    const next = usage.begin({ ...attempt, model: 'fixture:model?token=PRIVATE_KEY', origin: 'PRIVATE_NOT_A_URL' }); usage.dispatched(next);
    usage.complete(next, { status: 'ok', source: 'https://user:PRIVATE_PASSWORD@host/private?token=PRIVATE_KEY' });
    expect(JSON.stringify(usage.snapshot())).not.toContain('PRIVATE'); expect(usage.snapshot().entries[0].state).toBe('uncertain');
  });

  it('bounds retained metadata while preserving known session totals after eviction', () => {
    const usage = journal(2);
    for (let index = 0; index < 5; index++) { const id = usage.begin(attempt); usage.dispatched(id); usage.complete(id, { status: 'ok', source: 'fixture' }); }
    expect(usage.snapshot().entries.map(entry => entry.id)).toEqual([5, 4]);
    expect(usage.snapshot().totals).toMatchObject({ attempts: 5, dispatched: 5, responses: { ok: 5 }, evicted: 3, detached: 0 });
    expect(usage.complete(1, { status: 'error', source: 'fixture' })).toBe(false);
    const pending = journal(1), old = pending.begin(attempt); pending.dispatched(old); pending.begin(attempt);
    expect(pending.snapshot().totals).toMatchObject({ evicted: 1, detached: 1 }); expect(pending.complete(old, { status: 'ok', source: 'fixture' })).toBe(false);
  });

  it('clears only on explicit action and prevents late old callbacks from touching new attempts', () => {
    const usage = journal(), old = usage.begin(attempt); usage.dispatched(old); usage.cacheHit('transcript-summary'); usage.clear();
    const next = usage.begin(attempt); expect(next).toBeGreaterThan(old);
    expect(usage.complete(old, { status: 'ok', source: 'fixture' })).toBe(false); expect(usage.uncertain(old)).toBe(false);
    expect(usage.snapshot()).toMatchObject({ entries: [{ id: next, state: 'prepared' }], totals: { attempts: 1, dispatched: 0, cacheHits: 0, responses: { ok: 0 } } });
  });

  it('isolates snapshots and subscribers from journal/transport state and unsubscribes cleanly', () => {
    const usage = journal(); let notifications = 0;
    usage.subscribe(() => { throw new Error('View failure'); });
    const unsubscribe = usage.subscribe(snapshot => { notifications++; snapshot.totals.attempts = 999; snapshot.entries.length = 0; });
    const id = usage.begin(attempt); expect(usage.snapshot().entries).toHaveLength(1); expect(usage.snapshot().totals.attempts).toBe(1);
    unsubscribe(); usage.dispatched(id); expect(notifications).toBe(2);
    const snapshot = usage.snapshot(); snapshot.entries[0].model = 'changed'; snapshot.totals.responses.ok = 999;
    expect(usage.snapshot().entries[0].model).toBe('fixture:text-model'); expect(usage.snapshot().totals.responses.ok).toBe(0);
  });
});
