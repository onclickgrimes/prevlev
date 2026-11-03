import type { RemoteResponse } from '../shared/types';

export const AI_USAGE_FEATURES = ['transcript-summary', 'transcript-topics', 'transcript-script', 'comment-analysis', 'thumbnail-generation'] as const;
export type AiUsageFeature = typeof AI_USAGE_FEATURES[number];
export type AiUsageState = 'prepared' | 'dispatched' | 'response' | 'uncertain' | 'blocked';
export type AiUsageResponseStatus = RemoteResponse['status'];
export interface AiUsageAttemptInput { feature: AiUsageFeature; model?: string; backendOrigin?: string; origin?: string; }
export interface AiUsageEntry extends AiUsageAttemptInput {
  id: number; state: AiUsageState; createdAt: string; updatedAt: string; postStarted: boolean;
  responseStatus?: AiUsageResponseStatus; responseSource?: string;
}
export interface AiUsageTotals {
  attempts: number; dispatched: number; blocked: number; uncertain: number;
  responses: Record<AiUsageResponseStatus, number>;
  cacheHits: number; cacheByFeature: Record<AiUsageFeature, number>;
  evicted: number; detached: number;
}
export interface AiUsageSnapshot { sessionStartedAt: string; limit: number; entries: AiUsageEntry[]; totals: AiUsageTotals; }
export function isAiUsageFeature(value: unknown): value is AiUsageFeature { return typeof value === 'string' && AI_USAGE_FEATURES.includes(value as AiUsageFeature); }

function originOnly(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.origin : undefined; } catch { return undefined; }
}
function modelId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]*:[a-z0-9._:@/-]{1,380}$/i.test(value) ? value : undefined;
}
function responseSource(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9:._/-]{0,119}$/i.test(value) ? value : undefined;
}
function emptyTotals(): AiUsageTotals {
  return { attempts: 0, dispatched: 0, blocked: 0, uncertain: 0, responses: { ok: 0, error: 0, unsupported: 0, not_configured: 0 }, cacheHits: 0, cacheByFeature: Object.fromEntries(AI_USAGE_FEATURES.map(feature => [feature, 0])) as Record<AiUsageFeature, number>, evicted: 0, detached: 0 };
}

/** Session-only observations of Prevlev's own actions. No transport, storage, payloads or billing inference. */
export class AiUsageJournal {
  private entries: AiUsageEntry[] = [];
  private totals = emptyTotals();
  private nextId = 1;
  private sessionStartedAt: string;
  private listeners = new Set<(snapshot: AiUsageSnapshot) => void>();
  private readonly limit: number;
  private readonly now: () => number;
  constructor(options: { limit?: number; now?: () => number } = {}) {
    const limit = options.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('O journal local guarda de 1 a 20 tentativas.');
    this.limit = limit; this.now = options.now ?? Date.now; this.sessionStartedAt = this.time();
  }
  private time(): string {
    const value = this.now();
    if (!Number.isFinite(value) || Math.abs(value) > 8.64e15) throw new Error('Instante do journal local inválido.');
    return new Date(value).toISOString();
  }
  private find(id: number): AiUsageEntry | undefined { return this.entries.find(entry => entry.id === id); }
  private emit(): void { for (const listener of this.listeners) { try { listener(this.snapshot()); } catch { /* A view cannot interfere with request execution. */ } } }
  private updated(entry: AiUsageEntry): void { entry.updatedAt = this.time(); this.emit(); }
  begin(input: AiUsageAttemptInput): number {
    if (!isAiUsageFeature(input?.feature)) throw new Error('Somente ações de IA próprias entram no journal; catálogo, análises locais, cópias e exportações não contam.');
    const createdAt = this.time(), id = this.nextId++;
    // Deliberately project only the four metadata fields; never retain a supplied payload/error.
    this.entries.unshift({ id, feature: input.feature, model: modelId(input.model), backendOrigin: originOnly(input.backendOrigin), origin: originOnly(input.origin), state: 'prepared', createdAt, updatedAt: createdAt, postStarted: false });
    this.totals.attempts++;
    if (this.entries.length > this.limit) {
      const removed = this.entries.pop()!; this.totals.evicted++;
      if (['prepared', 'dispatched', 'uncertain'].includes(removed.state)) this.totals.detached++;
    }
    this.emit(); return id;
  }
  /** Invoke exactly where Prevlev starts its POST. This does not prove backend/provider acceptance. */
  dispatched(id: number): boolean {
    const entry = this.find(id); if (!entry || entry.state !== 'prepared') return false;
    entry.postStarted = true; entry.state = 'dispatched'; this.totals.dispatched++; this.updated(entry); return true;
  }
  complete(id: number, response: Pick<RemoteResponse, 'status' | 'source'>): boolean {
    const entry = this.find(id); if (!entry || entry.state === 'response' || entry.state === 'blocked') return false;
    if (!entry.postStarted) return this.blocked(id);
    const source = responseSource(response?.source);
    if (!source || source === 'prevlev:client' || !['ok', 'error', 'unsupported', 'not_configured'].includes(response?.status)) return this.uncertain(id);
    if (entry.state === 'uncertain') this.totals.uncertain--;
    entry.state = 'response'; entry.responseStatus = response.status; entry.responseSource = source;
    this.totals.responses[response.status]++; this.updated(entry); return true;
  }
  /** No final backend response is known. A later verified response may resolve this entry. */
  uncertain(id: number): boolean {
    const entry = this.find(id); if (!entry || ['response', 'blocked', 'uncertain'].includes(entry.state)) return false;
    if (!entry.postStarted) return this.blocked(id);
    entry.state = 'uncertain'; this.totals.uncertain++; this.updated(entry); return true;
  }
  /** Never downgrade a known POST to a pre-dispatch block. */
  blocked(id: number): boolean {
    const entry = this.find(id); if (!entry || ['response', 'blocked', 'uncertain'].includes(entry.state)) return false;
    if (entry.postStarted) return this.uncertain(id);
    entry.state = 'blocked'; this.totals.blocked++; this.updated(entry); return true;
  }
  cacheHit(feature: AiUsageFeature): void {
    if (!isAiUsageFeature(feature)) throw new Error('Reutilização local deve identificar uma ação de IA própria.');
    this.totals.cacheHits++; this.totals.cacheByFeature[feature]++; this.emit();
  }
  snapshot(): AiUsageSnapshot {
    return { sessionStartedAt: this.sessionStartedAt, limit: this.limit, entries: this.entries.map(entry => ({ ...entry })), totals: { ...this.totals, responses: { ...this.totals.responses }, cacheByFeature: { ...this.totals.cacheByFeature } } };
  }
  subscribe(listener: (snapshot: AiUsageSnapshot) => void): () => void {
    this.listeners.add(listener); try { listener(this.snapshot()); } catch { /* Initial rendering is observational too. */ }
    return () => { this.listeners.delete(listener); };
  }
  clear(): void {
    this.entries = []; this.totals = emptyTotals(); this.sessionStartedAt = this.time();
    // IDs remain monotonic, so late callbacks from before clear cannot alter new attempts.
    this.emit();
  }
}
