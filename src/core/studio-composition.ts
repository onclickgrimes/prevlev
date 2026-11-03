import { decodeImageBitmap, withImageDecodeSlot, type ImageWorkOptions } from './image-preflight';

export type StudioCompositionLayout = 'analytics-only' | 'video-info';
export type StudioCompositionTheme = 'light' | 'dark';
export type StudioCompositionBackground = 'theme' | 'custom' | 'transparent';
export type StudioCompositionRedactionCategory = 'channel' | 'revenue' | 'subscribers' | 'views' | 'video-info';
export interface StudioCaptureReceipt {
  kind: 'analytics' | 'latest-performance';
  contextKey: string;
  capturedAt: string;
  /** Supplied only after the existing screenshot transaction and chosen masks pass. */
  redactionValidated: true;
  redacted: boolean;
  categories: readonly StudioCompositionRedactionCategory[];
}
export type StudioCompositionSource =
  | { kind: 'validated-studio-capture'; receipt: StudioCaptureReceipt }
  | { kind: 'user-local-png'; name: string };
export interface StudioCompositionInput { image: Blob; source: StudioCompositionSource; }
export interface StudioCompositionOptions {
  layout: StudioCompositionLayout;
  theme: StudioCompositionTheme;
  background: StudioCompositionBackground;
  color?: string;
  scale: 1 | 2;
  metadata: { title?: string; period?: string; note?: string };
}
export const STUDIO_COMPOSITION_LIMITS = Object.freeze({ maxBytes: 10 * 1024 * 1024, maxPixels: 20_000_000, maxDimension: 8192, durationMs: 15000 });
const categories: readonly StudioCompositionRedactionCategory[] = ['channel', 'revenue', 'subscribers', 'views', 'video-info'];

export function studioCompositionDimensions(layout: StudioCompositionLayout, scale: 1 | 2): { width: number; height: number } {
  if (!['analytics-only', 'video-info'].includes(layout) || ![1, 2].includes(scale)) throw new Error('Layout ou escala de composição inválidos.');
  return layout === 'analytics-only' ? { width: 1120 * scale, height: 800 * scale } : { width: 1200 * scale, height: 780 * scale };
}
export function validateStudioCaptureReceipt(receipt: StudioCaptureReceipt): void {
  if (!receipt || !['analytics', 'latest-performance'].includes(receipt.kind) || typeof receipt.contextKey !== 'string' || !receipt.contextKey.trim() || receipt.contextKey.length > 4000 ||
      typeof receipt.capturedAt !== 'string' || receipt.capturedAt.length > 64 || !Number.isFinite(Date.parse(receipt.capturedAt)) || receipt.redactionValidated !== true ||
      typeof receipt.redacted !== 'boolean' || !Array.isArray(receipt.categories) || receipt.categories.length > categories.length || new Set(receipt.categories).size !== receipt.categories.length ||
      receipt.categories.some(category => !categories.includes(category)) || receipt.redacted !== (receipt.categories.length > 0)) throw new Error('A composição exige recibo da captura e das ocultações validadas na transação original.');
}
export function validateStudioComposition(input: StudioCompositionInput, options: StudioCompositionOptions): void {
  studioCompositionDimensions(options.layout, options.scale);
  if (!(input?.image instanceof Blob) || input.image.type !== 'image/png' || !input.image.size || input.image.size > STUDIO_COMPOSITION_LIMITS.maxBytes) throw new Error('Use um PNG local ou recorte validado de até 10 MiB.');
  if (!['light', 'dark'].includes(options.theme) || !['theme', 'custom', 'transparent'].includes(options.background) || options.background === 'custom' && !/^#[0-9a-f]{6}$/i.test(options.color ?? '')) throw new Error('Tema ou fundo de composição inválidos.');
  if (!options.metadata || Object.entries({ title: 200, period: 120, note: 400 }).some(([key, limit]) => { const value = options.metadata[key as keyof StudioCompositionOptions['metadata']]; return value !== undefined && (typeof value !== 'string' || value.length > limit); })) throw new Error('Metadados declarados acima do limite da composição.');
  if (input.source?.kind === 'validated-studio-capture') validateStudioCaptureReceipt(input.source.receipt);
  else if (input.source?.kind !== 'user-local-png' || typeof input.source.name !== 'string' || !input.source.name.trim() || input.source.name.length > 200) throw new Error('Informe a origem dos pixels da composição.');
}
export function studioCompositionSourceLabel(source: StudioCompositionSource): string {
  if (source.kind === 'user-local-png') return `PNG local: ${source.name}. Ocultações não verificadas; revise os pixels antes de compartilhar.`;
  const receipt = source.receipt;
  const labels: Record<StudioCompositionRedactionCategory, string> = { channel: 'canal', revenue: 'receita', subscribers: 'inscritos', views: 'visualizações', 'video-info': 'informações do vídeo' };
  return `Recorte ${receipt.kind === 'analytics' ? 'de analytics' : 'do último vídeo'} validado em ${receipt.capturedAt}. ${receipt.redacted ? `Ocultações declaradas pela transação: ${receipt.categories.map(category => labels[category]).join(', ')}.` : 'Captura sem ocultações selecionadas.'} Não garante anonimização completa.`;
}

function check(work: ImageWorkOptions): void {
  work.signal?.throwIfAborted();
  if (work.deadline !== undefined && performance.now() >= work.deadline) throw new Error('Prazo da composição local atingido.');
}
function textLines(ctx: CanvasRenderingContext2D, value: string, width: number, maxLines: number): string[] {
  const words = value.trim().replace(/\s+/g, ' ').split(' '), lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(next).width > width) { lines.push(current); current = word; } else current = next;
    if (lines.length >= maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  return lines.map(line => { let clipped = line; while (clipped && ctx.measureText(clipped).width > width) clipped = clipped.slice(0, -1); return clipped.length < line.length ? `${clipped.slice(0, -1)}…` : clipped; });
}
function write(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, maxLines: number, leading: number): void {
  textLines(ctx, value, width, maxLines).forEach((line, index) => ctx.fillText(line, x, y + index * leading));
}

/** Own layout around supplied pixels. It cannot recover hidden data or restyle captured pixels. */
export async function composeStudioCapture(input: StudioCompositionInput, options: StudioCompositionOptions, work: ImageWorkOptions = {}): Promise<Blob> {
  validateStudioComposition(input, options);
  const operation = { ...work, deadline: work.deadline ?? performance.now() + STUDIO_COMPOSITION_LIMITS.durationMs,
    maxBytes: Math.min(work.maxBytes ?? STUDIO_COMPOSITION_LIMITS.maxBytes, STUDIO_COMPOSITION_LIMITS.maxBytes),
    maxPixels: Math.min(work.maxPixels ?? STUDIO_COMPOSITION_LIMITS.maxPixels, STUDIO_COMPOSITION_LIMITS.maxPixels),
    maxDimension: Math.min(work.maxDimension ?? STUDIO_COMPOSITION_LIMITS.maxDimension, STUDIO_COMPOSITION_LIMITS.maxDimension) };
  check(operation);
  const bitmap = await decodeImageBitmap(input.image, operation);
  try {
    check(operation);
    const dimensions = studioCompositionDimensions(options.layout, options.scale), width = dimensions.width / options.scale, height = dimensions.height / options.scale;
    const canvas = document.createElement('canvas'); canvas.width = dimensions.width; canvas.height = dimensions.height;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas 2D indisponível para a composição.');
    ctx.scale(options.scale, options.scale);
    const light = options.theme === 'light', foreground = light ? '#17202e' : '#f1f5fb', muted = light ? '#4b596d' : '#b4c2d8', panel = light ? '#ffffff' : '#202b3c';
    if (options.background !== 'transparent') { ctx.fillStyle = options.background === 'custom' ? options.color! : light ? '#e9edf3' : '#101725'; ctx.fillRect(0, 0, width, height); }
    ctx.fillStyle = panel; ctx.fillRect(24, 24, width - 48, height - 48);
    ctx.fillStyle = muted; ctx.font = 'bold 14px sans-serif'; ctx.fillText('COMPOSIÇÃO LOCAL · PIXELS FORNECIDOS', 48, 56);
    ctx.fillStyle = foreground; ctx.font = 'bold 27px sans-serif'; ctx.fillText(options.layout === 'analytics-only' ? 'AnalyticsOnly · recorte fornecido' : 'VideoInfo · contexto declarado', 48, 96);
    ctx.fillStyle = muted; ctx.font = '15px sans-serif'; ctx.fillText('A moldura usa o tema escolhido; os pixels mantêm a aparência capturada.', 48, 124);
    const box = options.layout === 'analytics-only' ? { x: 48, y: 148, width: width - 96, height: 486 } : { x: 430, y: 148, width: width - 478, height: 464 };
    ctx.fillStyle = light ? '#edf1f6' : '#111a28'; ctx.fillRect(box.x, box.y, box.width, box.height);
    const ratio = Math.min(box.width / bitmap.width, box.height / bitmap.height);
    ctx.drawImage(bitmap, box.x + (box.width - bitmap.width * ratio) / 2, box.y + (box.height - bitmap.height * ratio) / 2, bitmap.width * ratio, bitmap.height * ratio);
    ctx.fillStyle = foreground;
    if (options.layout === 'video-info') {
      ctx.font = 'bold 16px sans-serif'; ctx.fillText('Título / identificação declarados', 48, 173);
      ctx.font = '23px sans-serif'; write(ctx, options.metadata.title?.trim() || 'Não informado', 48, 208, 344, 3, 28);
      ctx.font = 'bold 16px sans-serif'; ctx.fillText('Período declarado', 48, 325);
      ctx.font = '19px sans-serif'; write(ctx, options.metadata.period?.trim() || 'Não informado', 48, 355, 344, 2, 24);
      ctx.font = 'bold 16px sans-serif'; ctx.fillText('Nota declarada', 48, 435);
      ctx.font = '17px sans-serif'; write(ctx, options.metadata.note?.trim() || 'Não informada', 48, 465, 344, 5, 23);
    } else {
      ctx.font = '17px sans-serif'; write(ctx, [options.metadata.title?.trim() && `Identificação declarada: ${options.metadata.title.trim()}`, options.metadata.period?.trim() && `Período declarado: ${options.metadata.period.trim()}`].filter(Boolean).join(' · ') || 'Nenhum título ou período declarado.', 48, 662, width - 96, 2, 23);
    }
    ctx.fillStyle = muted; ctx.font = '13px sans-serif';
    write(ctx, studioCompositionSourceLabel(input.source), 48, height - 78, width - 96, 2, 17);
    ctx.fillText('Os pixels não comprovam cobertura completa, dados privados ausentes ou desempenho futuro.', 48, height - 35, width - 96);
    check(operation);
    const result = await withImageDecodeSlot(() => new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Falha ao codificar PNG da composição.')), 'image/png')), operation);
    check(operation);
    if (result.type !== 'image/png' || result.size > STUDIO_COMPOSITION_LIMITS.maxBytes) throw new Error('O PNG composto excede o limite de saída.');
    return result;
  } finally { bitmap.close(); }
}
