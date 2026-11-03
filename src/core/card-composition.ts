import { decodeImageBitmap } from './image-preflight';

/** An independent illustration generated entirely from a local image and supplied metadata. */
export type CardFormat = 'card' | 'short';
export type CardBackground = 'light' | 'dark' | 'custom' | 'transparent';
export interface CardCompositionMetadata {
  id?: string;
  title: string;
  channel?: string;
  views?: number;
  source: 'youtube-dom' | 'public-page' | 'user-provided' | 'unspecified';
}
export interface CardCompositionOptions {
  format: CardFormat;
  background: CardBackground;
  color?: string;
  scale: 1 | 2;
  metadata: CardCompositionMetadata;
}
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;
const MAX_SIDE = 8192;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function cardCompositionDimensions(format: CardFormat, scale: 1 | 2): { width: number; height: number } {
  if ((format !== 'card' && format !== 'short') || (scale !== 1 && scale !== 2)) throw new Error('Formato ou escala inválidos.');
  return format === 'card' ? { width: 640 * scale, height: 600 * scale } : { width: 440 * scale, height: 820 * scale };
}
export function validateCardComposition(image: Blob, options: CardCompositionOptions): void {
  cardCompositionDimensions(options.format, options.scale);
  if (!(image instanceof Blob) || image.size === 0 || image.size > MAX_BYTES || !TYPES.includes(image.type)) throw new Error('Use imagem local PNG, JPEG ou WebP estática de até 10 MiB.');
  if (!['light', 'dark', 'custom', 'transparent'].includes(options.background)) throw new Error('Fundo inválido.');
  if (options.background === 'custom' && !/^#[0-9a-f]{6}$/i.test(options.color ?? '')) throw new Error('Escolha uma cor de fundo válida.');
  const m = options.metadata;
  if (!m || typeof m.title !== 'string' || !m.title.trim() || m.title.length > 500 || (m.channel !== undefined && (typeof m.channel !== 'string' || m.channel.length > 120)) || (m.id !== undefined && !/^[A-Za-z0-9_-]{11}$/.test(m.id)) || (m.views !== undefined && (!Number.isSafeInteger(m.views) || m.views < 0)) || !['youtube-dom', 'public-page', 'user-provided', 'unspecified'].includes(m.source)) throw new Error('Metadados inválidos para a composição.');
}
function lines(ctx: CanvasRenderingContext2D, input: string, width: number, maximum: number): string[] {
  const words = input.trim().replace(/\s+/g, ' ').split(' '), result: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) { result.push(line); line = word; } else line = next;
    if (result.length === maximum) break;
  }
  if (result.length < maximum && line) result.push(line);
  return result.map(text => {
    let clipped = text;
    while (clipped && ctx.measureText(clipped).width > width) clipped = clipped.slice(0, -1);
    return clipped.length < text.length ? `${clipped.slice(0, -1)}…` : clipped;
  });
}

/** No URLs or network requests: preflight bounded still-image bytes before decoding. */
export async function composeCard(image: Blob, options: CardCompositionOptions): Promise<Blob> {
  validateCardComposition(image, options);
  const bitmap = await decodeImageBitmap(image, { maxBytes: MAX_BYTES, maxPixels: MAX_PIXELS, maxDimension: MAX_SIDE });
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width > MAX_SIDE || bitmap.height > MAX_SIDE || bitmap.width * bitmap.height > MAX_PIXELS) throw new Error('Imagem decodificada excede 20 megapixels ou 8192 pixels por lado.');
    const dimensions = cardCompositionDimensions(options.format, options.scale);
    const canvas = document.createElement('canvas'); canvas.width = dimensions.width; canvas.height = dimensions.height;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas 2D indisponível.');
    ctx.scale(options.scale, options.scale);
    const width = dimensions.width / options.scale, height = dimensions.height / options.scale;
    const light = options.background === 'light';
    if (options.background !== 'transparent') { ctx.fillStyle = options.background === 'custom' ? options.color! : light ? '#eeeeef' : '#101116'; ctx.fillRect(0, 0, width, height); }
    const x = 24, y = 24, w = width - 48, h = height - 48;
    ctx.fillStyle = light ? '#ffffff' : '#252631'; ctx.fillRect(x, y, w, h);
    const imageHeight = options.format === 'card' ? 333 : 600;
    const ratio = Math.max(w / bitmap.width, imageHeight / bitmap.height);
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, imageHeight); ctx.clip();
    ctx.drawImage(bitmap, x + (w - bitmap.width * ratio) / 2, y + (imageHeight - bitmap.height * ratio) / 2, bitmap.width * ratio, bitmap.height * ratio); ctx.restore();
    ctx.fillStyle = light ? '#171820' : '#f7f7fa'; ctx.font = 'bold 25px sans-serif';
    lines(ctx, options.metadata.title, w - 32, 2).forEach((line, index) => ctx.fillText(line, x + 16, y + imageHeight + 37 + index * 29));
    ctx.fillStyle = light ? '#40434c' : '#d4d4dd'; ctx.font = '16px sans-serif';
    const label = [options.metadata.channel, options.metadata.views === undefined ? undefined : `${options.metadata.views.toLocaleString('pt-BR')} views informadas`].filter(Boolean).join(' · ');
    if (label) ctx.fillText(lines(ctx, label, w - 32, 1)[0], x + 16, y + imageHeight + 106);
    ctx.font = '13px sans-serif';
    const origins = { 'youtube-dom': 'página observada', 'public-page': 'página pública', 'user-provided': 'informado pelo usuário', unspecified: 'origem não declarada' };
    ctx.fillText(`Metadados: ${origins[options.metadata.source]}${options.metadata.id ? ` · ID ${options.metadata.id}` : ''}`, x + 16, y + h - 43, w - 32);
    ctx.fillText('COMPOSIÇÃO LOCAL · IMAGEM FORNECIDA', x + 16, y + h - 22, w - 32);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Falha ao codificar PNG.')), 'image/png'));
  } finally { bitmap.close(); }
}
