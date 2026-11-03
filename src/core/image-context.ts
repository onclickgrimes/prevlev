import type { VideoRecord } from '../shared/types';

export type ImageContextSource = 'collection' | 'selected-tab';
export type ImageContextSurface = 'home' | 'trending' | 'subscriptions' | 'channel' | 'search' | 'other';
export interface ImageContextCapture {
  source: ImageContextSource;
  /** Host identity includes the collection revision or authorized selected tab id and URL. */
  identity: string;
  url: string;
  title?: string;
  observedAt?: string;
  videos: readonly VideoRecord[];
}
export interface BoundImageContext extends ImageContextCapture {
  surface: ImageContextSurface;
  inputCount: number;
  videos: VideoRecord[];
  label: string;
}
export const IMAGE_CONTEXT_SURFACES: Record<ImageContextSurface, string> = { home: 'Página inicial', trending: 'Em alta', subscriptions: 'Inscrições', channel: 'Canal', search: 'Busca', other: 'Outro contexto' };

/** Infer surface only from the exact observed URL, never from a requested feed label. */
export function imageContextSurface(value: string): ImageContextSurface {
  if (!value) return 'other';
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('A amostra deve preservar uma URL de contexto válida.'); }
  if (url.protocol !== 'https:' || !['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname) || url.username || url.password) throw new Error('Use uma coleta autorizada de página HTTPS do YouTube, sem credenciais na URL.');
  if (url.pathname === '/') return 'home';
  if (url.pathname === '/feed/trending') return 'trending';
  if (url.pathname === '/feed/subscriptions') return 'subscriptions';
  if (url.pathname === '/results') return 'search';
  if (/^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)(?:\/|$)/.test(url.pathname)) return 'channel';
  return 'other';
}

/** Freeze a bounded, source-specific sample. No transport, image loading or collection mutation. */
export function bindImageContext(capture: ImageContextCapture, expected: { source: ImageContextSource; identity: string }): BoundImageContext {
  if (capture.source !== expected.source || capture.identity !== expected.identity || !capture.identity || capture.identity.length > 4096) throw new Error('A fonte ou identidade da amostra mudou. Selecione e carregue novamente.');
  if (typeof capture.url !== 'string' || capture.url.length > 4096 || (capture.source === 'selected-tab' && !capture.url)) throw new Error('A coleta da aba deve preservar sua URL exata.');
  if (!Array.isArray(capture.videos) || capture.videos.length > 5000) throw new Error('Amostra inválida ou acima de 5000 registros.');
  if (capture.videos.some(video => video.source === 'youtube-data-api')) throw new Error('Dados da API oficial não podem ser usados no contexto da prévia. Escolha uma amostra local separada.');
  const surface = imageContextSurface(capture.url);
  const videos = capture.videos.filter(video => /^[A-Za-z0-9_-]{11}$/.test(video.id) && typeof video.title === 'string' && !!video.title.trim()).slice(0, 500).map(video => ({ ...video }));
  if (!videos.length) throw new Error('A fonte escolhida não contém vídeos locais elegíveis. Nenhum contexto foi inventado.');
  if (videos.some(video => ![undefined, 'youtube-dom', 'public-page', 'user-provided'].includes(video.source))) throw new Error('Origem de vídeo não reconhecida nesta amostra.');
  const title = typeof capture.title === 'string' ? capture.title.slice(0, 1000) : undefined;
  const observedAt = typeof capture.observedAt === 'string' && Number.isFinite(Date.parse(capture.observedAt)) ? capture.observedAt : undefined;
  const origin = capture.url ? `${IMAGE_CONTEXT_SURFACES[surface]} · ${capture.url}` : 'URL de contexto não informada';
  const label = capture.source === 'selected-tab' ? `Aba selecionada capturada · ${origin}` : `Coleção local congelada · contexto associado: ${origin}; não atribui uma origem única a todas as linhas`;
  return { source: capture.source, identity: capture.identity, url: capture.url, ...(title ? { title } : {}), ...(observedAt ? { observedAt } : {}), videos, surface, inputCount: capture.videos.length, label };
}

export interface ImagePreviewMetadata { channel: string; views: string; date: string; duration: string; avatar?: File; }
/** Reset restores the last Done snapshot; the initial defaults are merely its first baseline. */
export class ConfirmedImageMetadata {
  private baseline: ImagePreviewMetadata;
  constructor(initial: ImagePreviewMetadata) { this.baseline = { ...initial }; }
  confirm(value: ImagePreviewMetadata): void { this.baseline = { ...value }; }
  restore(): ImagePreviewMetadata { return { ...this.baseline }; }
}
