import { inspectImageBytes } from "../src/shared/image-header.mjs";

export const SERVER_IMAGE_MAX_BYTES = 16 * 1024 * 1024;
const MAX_BASE64_LENGTH = 4 * Math.ceil(SERVER_IMAGE_MAX_BYTES / 3);
const MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Results are data, never instructions to fetch a new provider-selected URL. */
export class ImageResultError extends Error {}

function imageMime(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  throw new ImageResultError("O resultado não contém um PNG, JPEG ou WebP reconhecido.");
}

function declaredMime(value) {
  if (typeof value !== "string" || !MIME_TYPES.has(value.trim().toLowerCase())) throw new ImageResultError("O resultado anuncia um MIME de imagem não suportado.");
  return value.trim().toLowerCase();
}

/** Check bytes, actual container and declared MIME before returning any descriptor. */
export function imageDescriptorFromBytes(value, mime) {
  if (!(value instanceof Uint8Array) || value.byteLength < 1 || value.byteLength > SERVER_IMAGE_MAX_BYTES) throw new ImageResultError("A imagem está vazia ou excede 16 MiB.");
  const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  const type = mime === undefined ? imageMime(bytes) : declaredMime(mime);
  try { inspectImageBytes(bytes, type, { maxBytes: SERVER_IMAGE_MAX_BYTES, maxPixels: 32_000_000, maxDimension: 16384 }); }
  catch { throw new ImageResultError("Imagem recusada: contêiner ou MIME inválido, animação não suportada ou dimensões acima de 32 milhões de pixels/16384 por lado."); }
  return { base64: bytes.toString("base64"), mime: type };
}

/** Reject noncanonical encoding and oversize data before allocating decoded bytes. */
export function imageDescriptorFromBase64(value, mime) {
  if (typeof value !== "string" || !value || value.length > MAX_BASE64_LENGTH || value.length % 4 !== 0) throw new ImageResultError("Base64 de imagem vazio, inválido ou acima de 16 MiB.");
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  if (value.length / 4 * 3 - padding > SERVER_IMAGE_MAX_BYTES || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new ImageResultError("Base64 de imagem inválido ou acima de 16 MiB.");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new ImageResultError("Base64 de imagem não canônico; o resultado foi descartado.");
  return imageDescriptorFromBytes(bytes, mime);
}

/** The direct adapter requests n:1 and accepts exactly one inlined, validated result. */
export function directProviderImageDescriptor(result) {
  if (!Array.isArray(result?.data) || result.data.length !== 1) throw new ImageResultError("O provedor deve retornar exatamente uma imagem; nenhum resultado foi truncado.");
  const image = result.data[0];
  if (!image || typeof image !== "object" || Array.isArray(image)) throw new ImageResultError("O provedor não retornou uma estrutura de imagem compatível.");
  if (image.url != null) throw new ImageResultError("Resposta de imagem por URL não suportada neste adaptador. Configure um provedor que retorne b64_json; nenhuma URL foi buscada ou encaminhada ao navegador.");
  const mime = image.mime_type === undefined ? image.mime : image.mime_type;
  if (image.mime !== undefined && image.mime_type !== undefined && declaredMime(image.mime) !== declaredMime(image.mime_type)) throw new ImageResultError("Metadados MIME de imagem conflitantes; o resultado foi descartado.");
  return imageDescriptorFromBase64(image.b64_json, mime);
}
