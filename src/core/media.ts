/** Local media tools. Images and video frames are never uploaded by this module. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface CompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  type?: "image/jpeg" | "image/webp" | "image/png";
}
const MAX_PIXELS = 32_000_000;
const MAX_DIMENSION = 16_384;
const MAX_BYTES = 50 * 1024 * 1024;

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${name} deve ser um número maior que zero.`);
  return value;
}
function validateDimensions(width: number, height: number): void {
  positive(width, "Largura");
  positive(height, "Altura");
  if (
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION ||
    width * height > MAX_PIXELS
  )
    throw new Error(
      "Imagem grande demais para processar com segurança. Limite: 32 megapixels e 16384 pixels por lado.",
    );
}

/** Fit within both limits without stretching or enlarging the source. */
export function fitDimensions(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  positive(width, "Largura");
  positive(height, "Altura");
  positive(maxWidth, "Largura máxima");
  positive(maxHeight, "Altura máxima");
  const ratio = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function createCanvas(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  validateDimensions(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("O navegador não disponibilizou o canvas 2D.");
  return { canvas, context };
}
function encode(
  canvas: HTMLCanvasElement,
  type = "image/png",
  quality = 0.9,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(
                new Error("O navegador não conseguiu codificar a imagem."),
              ),
        type,
        quality,
      );
    } catch (error) {
      reject(mediaError(error));
    }
  });
}
function mediaError(error: unknown): Error {
  if (error instanceof DOMException && error.name === "SecurityError")
    return new Error(
      "O navegador bloqueou a captura por origem da mídia (canvas protegido). Use uma captura da aba ou uma imagem local.",
    );
  return error instanceof Error
    ? error
    : new Error("Falha ao processar a imagem.");
}

/** For remote images only the public YouTube thumbnail CDN is accepted. */
export function loadImage(input: Blob | string): Promise<HTMLImageElement> {
  let ownedUrl: string | undefined;
  let source: string;
  if (typeof input === "string") {
    if (/^data:image\/(?:png|jpe?g|webp);base64,/i.test(input)) source = input;
    else {
      let url: URL;
      try {
        url = new URL(input);
      } catch {
        return Promise.reject(new Error("URL de imagem inválida."));
      }
      if (
        url.protocol !== "https:" ||
        url.hostname !== "i.ytimg.com" ||
        url.username ||
        url.password
      )
        return Promise.reject(
          new Error(
            "Use uma imagem local ou uma thumbnail pública do YouTube.",
          ),
        );
      source = url.href;
    }
  } else {
    if (!/^image\/(?:png|jpeg|webp|avif|gif)$/.test(input.type))
      return Promise.reject(
        new Error(
          "Formato de imagem não suportado. Use PNG, JPEG, WebP, AVIF ou GIF.",
        ),
      );
    if (input.size === 0 || input.size > MAX_BYTES)
      return Promise.reject(
        new Error("A imagem deve ter entre 1 byte e 50 MB."),
      );
    ownedUrl = URL.createObjectURL(input);
    source = ownedUrl;
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    };
    image.crossOrigin = "anonymous";
    image.onload = () => {
      cleanup();
      try {
        validateDimensions(image.naturalWidth, image.naturalHeight);
        resolve(image);
      } catch (error) {
        reject(mediaError(error));
      }
    };
    image.onerror = () => {
      cleanup();
      reject(
        new Error(
          "Não foi possível abrir a imagem. Verifique o arquivo ou as permissões do CDN.",
        ),
      );
    };
    image.src = source;
  });
}

export async function compressImage(
  blob: Blob,
  options: CompressionOptions = {},
): Promise<Blob> {
  const {
    maxWidth = 1280,
    maxHeight = 720,
    quality = 0.85,
    type = "image/jpeg",
  } = options;
  positive(maxWidth, "Largura máxima");
  positive(maxHeight, "Altura máxima");
  if (!Number.isFinite(quality) || quality < 0.1 || quality > 1)
    throw new Error("Qualidade deve ficar entre 0,1 e 1.");
  if (!["image/jpeg", "image/webp", "image/png"].includes(type))
    throw new Error("Formato de saída não suportado.");
  const image = await loadImage(blob);
  const size = fitDimensions(
    image.naturalWidth,
    image.naturalHeight,
    maxWidth,
    maxHeight,
  );
  const { canvas, context } = createCanvas(size.width, size.height);
  if (type === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  try {
    context.drawImage(image, 0, 0, size.width, size.height);
  } catch (error) {
    throw mediaError(error);
  }
  return encode(canvas, type, quality);
}

export async function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight)
    throw new Error("Aguarde um frame do vídeo carregar antes de capturar.");
  const { canvas, context } = createCanvas(video.videoWidth, video.videoHeight);
  try {
    context.drawImage(video, 0, 0);
  } catch (error) {
    throw mediaError(error);
  }
  return encode(canvas);
}

export function thumbnailUrls(videoId: string): string[] {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId))
    throw new Error("ID de vídeo inválido.");
  return [
    "maxresdefault",
    "sddefault",
    "hqdefault",
    "mqdefault",
    "default",
  ].map((size) => `https://i.ytimg.com/vi/${videoId}/${size}.jpg`);
}

/** Public thumbnails only; no account credentials are sent. */
export async function fetchThumbnail(
  videoId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  for (const url of thumbnailUrls(videoId)) {
    let response: Response;
    try {
      response = await fetch(url, { credentials: "omit", signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      continue;
    }
    if (!response.ok) continue;
    const blob = await response.blob();
    if (
      blob.type.startsWith("image/") &&
      blob.size > 0 &&
      blob.size <= MAX_BYTES
    )
      return blob;
  }
  throw new Error("Nenhuma thumbnail pública pôde ser obtida do YouTube.");
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (let index = 0; index < words.length; index++) {
    const next = line ? `${line} ${words[index]}` : words[index];
    if (context.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = words[index];
      if (lines.length === maxLines - 1) {
        line = [line, ...words.slice(index + 1)].join(" ");
        break;
      }
    } else line = next;
  }
  if (line && lines.length < maxLines) lines.push(line);
  const last = lines.length - 1;
  if (last >= 0 && context.measureText(lines[last]).width > maxWidth) {
    let clipped = lines[last];
    while (
      clipped.length &&
      context.measureText(`${clipped}…`).width > maxWidth
    )
      clipped = clipped.slice(0, -1);
    lines[last] = `${clipped}…`;
  }
  return lines;
}

/** A static composition only; this is not an audience A/B test. */
export async function renderThumbnailPreview(
  blob: Blob,
  title: string,
  channel = "Seu canal",
): Promise<Blob> {
  const image = await loadImage(blob);
  const { canvas, context } = createCanvas(1280, 1020);
  context.fillStyle = "#111827";
  context.fillRect(0, 0, 1280, 1020);
  // Cover thumbnail preserving proportions.
  const ratio = Math.max(1280 / image.naturalWidth, 720 / image.naturalHeight);
  const width = image.naturalWidth * ratio,
    height = image.naturalHeight * ratio;
  context.save();
  context.beginPath();
  context.rect(0, 0, 1280, 720);
  context.clip();
  context.drawImage(
    image,
    (1280 - width) / 2,
    (720 - height) / 2,
    width,
    height,
  );
  context.restore();
  context.fillStyle = "#f8fafc";
  context.font = "bold 42px sans-serif";
  wrapText(context, title || "Título do vídeo", 1168, 3).forEach(
    (line, index) => context.fillText(line, 56, 790 + index * 50),
  );
  context.fillStyle = "#a8b3c7";
  context.font = "28px sans-serif";
  context.fillText(channel.slice(0, 80), 56, 965, 1168);
  context.fillStyle = "#4fd1c5";
  context.font = "bold 18px sans-serif";
  context.fillText("PREVLEV · PRÉVIA LOCAL", 930, 1000, 310);
  return encode(canvas);
}

function validateRect(rect: Rect): void {
  if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y))
    throw new Error("Posição de captura inválida.");
  positive(rect.width, "Largura da captura");
  positive(rect.height, "Altura da captura");
}

/** Crops the visible tab only. Caller must capture the same tab and viewport. */
export async function cropScreenshot(
  dataUrl: string,
  rect: Rect,
  scale = 1,
  redactions: Rect[] = [],
): Promise<Blob> {
  validateRect(rect);
  positive(scale, "Escala da captura");
  redactions.forEach(validateRect);
  if (!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(dataUrl))
    throw new Error("A captura deve ser uma imagem local válida.");
  const image = await loadImage(dataUrl);
  const left = Math.max(0, Math.round(rect.x * scale)),
    top = Math.max(0, Math.round(rect.y * scale));
  const right = Math.min(
    image.naturalWidth,
    Math.round((rect.x + rect.width) * scale),
  );
  const bottom = Math.min(
    image.naturalHeight,
    Math.round((rect.y + rect.height) * scale),
  );
  if (right <= left || bottom <= top)
    throw new Error(
      "O elemento está fora da parte visível da aba. Role a página e tente novamente.",
    );
  const width = right - left,
    height = bottom - top;
  const { canvas, context } = createCanvas(width, height);
  context.drawImage(image, left, top, width, height, 0, 0, width, height);
  context.fillStyle = "#111827";
  for (const redaction of redactions)
    context.fillRect(
      redaction.x * scale - left,
      redaction.y * scale - top,
      redaction.width * scale,
      redaction.height * scale,
    );
  return encode(canvas);
}

export async function copyImage(blob: Blob): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
    throw new Error(
      "Cópia de imagem indisponível. Baixe o arquivo ou permita acesso à área de transferência.",
    );
  let png = blob;
  if (blob.type !== "image/png") {
    const image = await loadImage(blob);
    const { canvas, context } = createCanvas(
      image.naturalWidth,
      image.naturalHeight,
    );
    context.drawImage(image, 0, 0);
    png = await encode(canvas);
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  } catch {
    throw new Error(
      "O navegador bloqueou a área de transferência. Use o botão novamente ou baixe a imagem.",
    );
  }
}

export function normalizeFilename(filename: string): string {
  const normalized = filename
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\p{Cc}/gu, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
  return normalized || "prevlev.png";
}
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = normalizeFilename(filename);
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
