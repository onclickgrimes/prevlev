// Shared local preflight. No provider/catalogue/transport work is performed here.
export class AiInputError extends Error {}
const invalid = (message) => { throw new AiInputError(`${message} Nenhum material parcial foi enviado.`); };
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function encoded(input) {
  const value = JSON.stringify(input);
  if (value.length > 150000) invalid("O material completo codificado excede o limite de 150 mil caracteres.");
  return value;
}
function text(item, label) {
  if (!object(item) || typeof item.text !== "string") invalid(`${label} deve conter texto real em um campo text de string.`);
  if (item.text.length > 2000) invalid(`${label} excede o limite de 2000 caracteres por item.`);
  return item.text;
}
/** Reject the complete oversized request, preserving every accepted text verbatim. */
export function encodeAiTextInput(feature, payload) {
  if (!object(payload)) invalid("Envie o material como um objeto payload.");
  if (feature === "comment-analysis") {
    if (!Array.isArray(payload.comments) || !payload.comments.length || payload.comments.length > 1000) invalid("Envie de 1 a 1000 comentários reais.");
    const input = payload.comments.map((item) => ({
      text: text(item, "Cada comentário"),
      ...(typeof item.likes === "number" && Number.isFinite(item.likes) ? { likes: item.likes } : {}),
    }));
    if (!input.some((item) => item.text.trim())) invalid("Os comentários enviados não contêm texto.");
    return encoded(input);
  }
  if (payload.text !== undefined && typeof payload.text !== "string") invalid("payload.text deve ser uma string com a transcrição real.");
  if (typeof payload.text === "string" && payload.text.length > 100000) invalid("A transcrição completa excede o limite de 100 mil caracteres de texto.");
  let transcript;
  // Validate any supplied representation, including one that is not selected.
  // Supplying full text must not mask oversized or malformed segment material.
  if (payload.transcript !== undefined) {
    if (!Array.isArray(payload.transcript) || payload.transcript.length > 5000) invalid("Envie no máximo 5000 segmentos reais da transcrição.");
    transcript = payload.transcript.map((item) => ({
      text: text(item, "Cada segmento da transcrição"),
      ...(typeof item.start === "number" && Number.isFinite(item.start) && item.start >= 0 ? { start: item.start } : {}),
    }));
    encoded(transcript);
  }
  if (typeof payload.text === "string" && payload.text.trim()) return encoded(payload.text);
  if (!transcript?.length || !transcript.some((item) => item.text.trim())) invalid("Envie texto ou segmentos reais da transcrição que contenham texto.");
  return encoded(transcript);
}
