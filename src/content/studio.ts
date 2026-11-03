import { parseCount, parseDuration } from "../core/parse";

/** DOM adapters only. No account changes run during module initialization. */
export type StudioAction =
  | "hearts-add"
  | "hearts-remove"
  | "skip-monetization"
  | "midrolls";
export interface StudioInput {
  limit?: number;
  positions?: number[];
}
export interface StudioPlan {
  readonly id: string;
  readonly action: StudioAction;
  readonly status: "ready" | "unsupported";
  readonly targetCount: number;
  readonly slotsToCreate?: number;
  readonly positions?: readonly string[];
  readonly targets: readonly {
    control: string;
    context: string;
    value?: string;
  }[];
  readonly description: string;
  readonly warnings: readonly string[];
  readonly expiresAt: string;
}
export interface StudioExecution {
  status: "completed" | "cancelled" | "stale" | "unsupported" | "error";
  submitted: number;
  total: number;
  created?: number;
  addClicks?: number;
  message: string;
}
interface Step {
  element: HTMLElement;
  signature: string;
  value?: string;
  comment?: CommentContext;
}
interface CommentContext {
  container: HTMLElement;
  thread: HTMLElement;
  fingerprint: string;
  preview: string;
}
interface MidrollContext {
  editor: HTMLElement;
  fingerprint: string;
  addButton?: HTMLElement;
  addSignature?: string;
  positions: readonly number[];
  initialFields: HTMLInputElement[];
}
interface StoredPlan {
  publicPlan: StudioPlan;
  document: Document;
  url: string;
  expires: number;
  steps: Step[];
  guards: Step[];
  midroll?: MidrollContext;
  controller: AbortController;
  state: "pending" | "running";
}
const plans = new Map<string, StoredPlan>();
const maxActions = 50;
const ttl = 120_000;
const warnings = [
  "O layout do Studio pode mudar. Controles desconhecidos são recusados.",
  "Alterações já enviadas não são desfeitas ao cancelar.",
];

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}
function label(element: Element): string {
  return (
    element.getAttribute("aria-label") ??
    element.getAttribute("title") ??
    element.textContent ??
    ""
  ).trim();
}
function visible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [aria-hidden="true"]'))
    return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return style?.display !== "none" && style?.visibility !== "hidden";
}
function enabled(element: HTMLElement): boolean {
  return (
    visible(element) &&
    !element.hasAttribute("disabled") &&
    element.getAttribute("aria-disabled") !== "true"
  );
}
function signature(element: HTMLElement): string {
  const value =
    element.tagName === "INPUT"
      ? `${(element as HTMLInputElement).value}|${(element as HTMLInputElement).checked}`
      : "";
  return [
    element.tagName,
    element.id,
    label(element),
    element.getAttribute("aria-pressed"),
    element.getAttribute("aria-checked"),
    value,
  ].join("|");
}
function studioDocument(doc: Document): boolean {
  return doc.location.hostname === "studio.youtube.com";
}
function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
function heartState(element: HTMLElement): boolean | undefined {
  const text = normalize(label(element));
  if (
    /^(remove heart|unheart|remover coracao|retirar coracao|remove creator heart)/.test(
      text,
    )
  )
    return true;
  if (
    /^(heart|give heart|add heart|coracao|marcar com coracao|adicionar coracao)(\s|$)/.test(
      text,
    )
  ) {
    const pressed = element.getAttribute("aria-pressed");
    return pressed === "true";
  }
  return undefined;
}
function findHeartButtons(doc: Document): HTMLElement[] {
  const comments = Array.from(
    doc.querySelectorAll(
      "ytcp-comment-thread, ytcp-comment, ytcp-comment-thread-row",
    ),
  );
  const candidates = unique(
    comments.flatMap((comment) =>
      Array.from(
        comment.querySelectorAll<HTMLElement>(
          'button, ytcp-icon-button, [role="button"]',
        ),
      ),
    ),
  ).filter((button) => enabled(button) && heartState(button) !== undefined);
  // A custom button can wrap another labeled button. Never toggle the same reaction twice.
  return candidates.filter(
    (button) =>
      !candidates.some((other) => other !== button && button.contains(other)),
  );
}
function compactText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}
function commentContext(button: HTMLElement): CommentContext | undefined {
  const container = button.closest<HTMLElement>(
    "ytcp-comment, ytcp-comment-thread-row, ytcp-comment-thread",
  );
  if (!container || !visible(container)) return undefined;
  const thread =
    container.closest<HTMLElement>(
      "ytcp-comment-thread, ytcp-comment-thread-row",
    ) ?? container;
  const authorElement = container.querySelector<HTMLElement>(
    '[id="author-text"], [id="author-name"], .author-text, .author-name, [data-author]',
  );
  const textElement = container.querySelector<HTMLElement>(
    '[id="content-text"], [id="comment-text"], .comment-text, .content-text, ytcp-comment-text, [data-comment-text]',
  );
  const author = compactText(authorElement?.textContent);
  const authorUrl =
    authorElement?.getAttribute("href") ??
    authorElement?.querySelector("a")?.getAttribute("href") ??
    "";
  const text = compactText(textElement?.textContent);
  const identity = [container, thread].map((element) => [
    element.tagName,
    element.id,
    element.getAttribute("comment-id"),
    element.getAttribute("data-comment-id"),
    element.getAttribute("data-thread-id"),
  ]);
  const permalink =
    container.querySelector('a[href*="lc="]')?.getAttribute("href") ?? "";
  // An anonymous control-only row cannot identify the comment the user reviewed.
  if (!author || !text) return undefined;
  return {
    container,
    thread,
    fingerprint: JSON.stringify({
      identity,
      permalink,
      author,
      authorUrl,
      text,
    }),
    preview: `${author}: ${text}`,
  };
}
function stepIsCurrent(step: Step): boolean {
  if (!enabled(step.element) || signature(step.element) !== step.signature)
    return false;
  if (!step.comment) return true;
  const current = commentContext(step.element);
  return (
    current?.container === step.comment.container &&
    current.thread === step.comment.thread &&
    current.fingerprint === step.comment.fingerprint
  );
}

const editorSelector =
  "ytcp-ad-breaks-editor, ytcp-ad-break-editor, ytcp-video-ad-breaks-editor";
function midrollEditors(doc: Document): HTMLElement[] {
  const editors = Array.from(
    doc.querySelectorAll<HTMLElement>(editorSelector),
  ).filter(visible);
  return editors.filter(
    (editor) =>
      !editors.some((other) => other !== editor && other.contains(editor)),
  );
}
function midrollFields(editor: HTMLElement): HTMLInputElement[] {
  return Array.from(editor.querySelectorAll<HTMLInputElement>("input")).filter(
    (field) =>
      enabled(field) &&
      !field.readOnly &&
      ["text", "time"].includes(field.type) &&
      (field.type === "time" ||
        /time|horario|inicio|timestamp/.test(normalize(label(field))) ||
        /^\d{1,2}:\d{2}(?::\d{2})?$/.test(field.value || field.placeholder)),
  );
}
function addMidrollButtons(
  editor: HTMLElement,
  requireEnabled = true,
): HTMLElement[] {
  const candidates = Array.from(
    editor.querySelectorAll<HTMLElement>(
      'button, ytcp-button, [role="button"]',
    ),
  ).filter(
    (button) =>
      (requireEnabled ? enabled(button) : visible(button)) &&
      /^(insert ad slot|insert ad break|add ad slot|add ad break|inserir intervalo(?: de anuncios?)?|adicionar intervalo(?: de anuncios?)?|inserir anuncio)$/.test(
        normalize(label(button)),
      ),
  );
  return candidates.filter(
    (button) =>
      !candidates.some((other) => other !== button && button.contains(other)),
  );
}
function editorFingerprint(editor: HTMLElement): string {
  const scope =
    editor.closest(
      "ytcp-video-monetization, ytcp-video-monetization-editor, ytcp-uploads-dialog",
    ) ?? editor;
  const identity = (element: Element) => [
    element.tagName,
    element.id,
    element.getAttribute("video-id"),
    element.getAttribute("data-video-id"),
    element.getAttribute("channel-id"),
    element.getAttribute("data-channel-id"),
    element.getAttribute("aria-label"),
  ];
  const title = compactText(
    scope.querySelector("#video-title, #video-name, [data-video-title]")
      ?.textContent,
  );
  return JSON.stringify({
    editor: identity(editor),
    scope: identity(scope),
    title,
  });
}
function midrollContextIsCurrent(
  context: MidrollContext,
  doc: Document,
): boolean {
  const editors = midrollEditors(doc);
  return (
    editors.length === 1 &&
    editors[0] === context.editor &&
    editorFingerprint(context.editor) === context.fingerprint &&
    (!context.addButton ||
      (visible(context.addButton) &&
        context.editor.contains(context.addButton) &&
        signature(context.addButton) === context.addSignature &&
        addMidrollButtons(context.editor, false).length === 1))
  );
}
function timestamp(seconds: number): string {
  const rounded = Math.floor(seconds);
  return [
    Math.floor(rounded / 3600),
    Math.floor((rounded % 3600) / 60),
    rounded % 60,
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

function displayedMoney(value: string): number | undefined {
  if (/\d\s*(?:[kmb]|mil|milhao|milhão|million)\b/i.test(value))
    return parseCount(value);
  const raw = value.match(/-?\d[\d.,\s]*/)?.[0].replace(/\s/g, "");
  if (!raw) return undefined;
  const lastSeparator = Math.max(raw.lastIndexOf(","), raw.lastIndexOf("."));
  const decimalLength = lastSeparator < 0 ? 0 : raw.length - lastSeparator - 1;
  const normalized =
    lastSeparator >= 0 && decimalLength > 0 && decimalLength <= 2
      ? raw.slice(0, lastSeparator).replace(/[.,]/g, "") +
        "." +
        raw.slice(lastSeparator + 1)
      : raw.replace(/[.,]/g, "");
  const result = Number(normalized);
  return Number.isFinite(result) ? result : undefined;
}

/** Only reads rendered cards; hidden reports/private Studio APIs are not queried. */
export function readStudioMetrics(doc: Document = document): {
  revenue?: number;
  currency?: string;
  videoCount?: number;
  warnings: string[];
} {
  const result: {
    revenue?: number;
    currency?: string;
    videoCount?: number;
    warnings: string[];
  } = { warnings: [] };
  if (!studioDocument(doc)) {
    result.warnings.push("Abra o YouTube Studio para ler métricas exibidas.");
    return result;
  }
  const cards = doc.querySelectorAll<HTMLElement>(
    "yta-key-metric-card, yta-key-metric-block, [data-metric]",
  );
  for (const card of cards) {
    if (!visible(card)) continue;
    const metricLabel = normalize(
      card.getAttribute("data-metric") ??
        card.querySelector("#title, #metric-title, .metric-title, [data-label]")
          ?.textContent ??
        "",
    );
    const value = card
      .querySelector("#metric-value, #value, .metric-value, [data-value]")
      ?.textContent?.trim();
    if (!value) continue;
    const number =
      /estimated revenue|receita estimada|^revenue$|^receita$/.test(metricLabel)
        ? displayedMoney(value)
        : parseCount(value);
    if (number === undefined || !Number.isFinite(number)) continue;
    if (
      /estimated revenue|receita estimada|^revenue$|^receita$/.test(metricLabel)
    ) {
      result.revenue = number;
      result.currency = value.match(/R\$|US\$|€|£|\$/)?.[0];
    }
    if (/^videos$|video count|quantidade de videos/.test(metricLabel))
      result.videoCount = number;
  }
  if (result.revenue === undefined)
    result.warnings.push(
      "Receita não identificada em um card visível. Informe o valor manualmente na calculadora.",
    );
  result.warnings.push(
    "Somente métricas atualmente renderizadas; nenhuma consulta privada ao Studio foi feita.",
  );
  return result;
}

/** The returned plan is a short-lived preview, not an authorization to run on load. */
export function previewStudioAction(
  action: StudioAction,
  input: StudioInput = {},
  doc: Document = document,
): StudioPlan {
  const now = Date.now();
  for (const [id, stored] of plans)
    if (stored.state === "pending" && stored.expires <= now) plans.delete(id);
  const steps: Step[] = [];
  const guards: Step[] = [];
  let midroll: MidrollContext | undefined;
  const notes = [...warnings];
  let description = "";
  let unsupported = "";
  if (!studioDocument(doc))
    unsupported = "Esta ação exige uma página aberta em studio.youtube.com.";
  else if (action === "hearts-add" || action === "hearts-remove") {
    const desired = action === "hearts-add";
    const limit = Math.min(
      maxActions,
      Math.max(1, Math.floor(input.limit ?? 20)),
    );
    const targets = findHeartButtons(doc)
      .filter((button) => heartState(button) !== desired)
      .slice(0, limit);
    for (const element of targets) {
      const comment = commentContext(element);
      if (comment)
        steps.push({ element, signature: signature(element), comment });
    }
    description = `${desired ? "Dar" : "Remover"} coração em ${steps.length} comentários visíveis.`;
    notes.push(
      "Cada clique pode publicar a reação no canal. Apenas os comentários visíveis da prévia serão processados.",
    );
    if (steps.length !== targets.length)
      notes.push(
        "Comentários sem autor e texto reconhecidos foram excluídos da prévia.",
      );
    if (steps.length === 0)
      unsupported =
        "Nenhum comentário com autor, texto e botão de coração reconhecidos foi encontrado.";
  } else if (action === "skip-monetization") {
    const step = doc.querySelector<HTMLElement>(
      "ytcp-video-monetization, ytcp-video-monetization-editor, #monetization-step",
    );
    const nextButtons =
      step &&
      Array.from(
        doc.querySelectorAll<HTMLElement>(
          'ytcp-button, button, [role="button"]',
        ),
      ).filter(
        (button) =>
          enabled(button) &&
          /^(next|proximo|avancar)$/.test(normalize(label(button))),
      );
    const next = nextButtons?.length === 1 ? nextButtons[0] : undefined;
    const selected = step?.querySelector<HTMLElement>(
      '[aria-checked="true"], input[type="radio"]:checked',
    );
    if (!step || !visible(step) || !next || !selected)
      unsupported =
        "Abra a etapa Monetização, escolha a opção desejada e deixe o botão Próximo visível.";
    else {
      steps.push({ element: next, signature: signature(next) });
      guards.push({ element: selected, signature: signature(selected) });
      description =
        "Avançar uma etapa usando a escolha de monetização já selecionada.";
      notes.push(
        "Não seleciona monetização nem preenche declarações de adequação. Revise a opção selecionada antes de confirmar.",
      );
    }
  } else if (action === "midrolls") {
    const positions = input.positions ?? [];
    if (
      positions.length === 0 ||
      positions.length > maxActions ||
      positions.some(
        (value, index) =>
          !Number.isFinite(value) ||
          value < 1 ||
          (index > 0 && Math.floor(value) <= Math.floor(positions[index - 1])),
      )
    ) {
      unsupported =
        "Informe de 1 a 50 posições positivas em segundos, distintas após arredondamento e em ordem crescente.";
    } else {
      const editors = midrollEditors(doc);
      if (editors.length !== 1)
        unsupported = `Abra um único editor de intervalos reconhecido. Foram encontrados ${editors.length} editores visíveis.`;
      else {
        const editor = editors[0];
        const fields = midrollFields(editor);
        const missing = positions.length - fields.length;
        const addButtons = addMidrollButtons(editor);
        if (missing < 0)
          unsupported = `O editor contém ${fields.length} intervalos; a prévia possui ${positions.length} posições. Nenhum intervalo será apagado automaticamente.`;
        else if (missing > 0 && addButtons.length !== 1)
          unsupported = `São necessários ${missing} novos intervalos, mas não há um único botão Inserir intervalo reconhecido dentro do editor. Foram encontrados ${addButtons.length} controles elegíveis.`;
        else {
          midroll = {
            editor,
            fingerprint: editorFingerprint(editor),
            ...(missing > 0
              ? {
                  addButton: addButtons[0],
                  addSignature: signature(addButtons[0]),
                }
              : {}),
            positions: Object.freeze([...positions]),
            initialFields: fields,
          };
          steps.push(
            ...fields.map((element, index) => ({
              element,
              signature: signature(element),
              value: timestamp(positions[index]),
            })),
          );
          description = `Preencher ${positions.length} intervalos (${missing} a criar): ${positions.map(timestamp).join(", ")}.`;
          notes.push(
            "Cria somente rascunhos por controles reconhecidos e preenche os horários. Não clica em Continuar nem Salvar; revise o resultado no Studio. A entrega de anúncios não é garantida.",
          );
        }
      }
    }
  } else unsupported = "Ação de Studio desconhecida.";
  if (unsupported) notes.unshift(unsupported);
  const publicPlan: StudioPlan = Object.freeze({
    id: globalThis.crypto.randomUUID(),
    action,
    status: unsupported ? "unsupported" : "ready",
    targetCount: unsupported ? 0 : (midroll?.positions.length ?? steps.length),
    ...(midroll
      ? {
          slotsToCreate:
            midroll.positions.length - midroll.initialFields.length,
          positions: Object.freeze(midroll.positions.map(timestamp)),
        }
      : {}),
    targets: Object.freeze(
      unsupported
        ? []
        : midroll
          ? midroll.positions.map((position, index) =>
              Object.freeze({
                control:
                  index < midroll.initialFields.length
                    ? label(midroll.initialFields[index])
                    : `Criar: ${label(midroll.addButton!)}`,
                context: description,
                value: timestamp(position),
              }),
            )
          : steps.map((step) =>
              Object.freeze({
                control: label(step.element),
                context: (step.comment?.preview ?? description)
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 220),
                ...(step.value ? { value: step.value } : {}),
              }),
            ),
    ),
    description: description || unsupported,
    warnings: Object.freeze(notes),
    expiresAt: new Date(now + ttl).toISOString(),
  });
  if (!unsupported)
    plans.set(publicPlan.id, {
      publicPlan,
      document: doc,
      url: doc.location.href,
      expires: now + ttl,
      steps,
      guards,
      midroll,
      controller: new AbortController(),
      state: "pending",
    });
  return publicPlan;
}

function wait(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("cancelled"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("cancelled"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delay);
    signal.addEventListener("abort", abort, { once: true });
  });
}

class StudioContextChanged extends Error {}

function setFieldValue(
  doc: Document,
  field: HTMLInputElement,
  value: string,
): void {
  const setter = Object.getOwnPropertyDescriptor(
    doc.defaultView!.HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!setter) throw new Error("Campo sem setter de valor reconhecido.");
  setter.call(field, value);
  field.dispatchEvent(new doc.defaultView!.Event("input", { bubbles: true }));
  field.dispatchEvent(new doc.defaultView!.Event("change", { bubbles: true }));
}

async function executeMidrolls(stored: StoredPlan): Promise<StudioExecution> {
  const context = stored.midroll!;
  const doc = stored.document;
  const signal = stored.controller.signal;
  const total = context.positions.length;
  let submitted = 0;
  let created = 0;
  let addClicks = 0;
  let expected = [...context.initialFields];
  const signatures = new Map(
    expected.map((field) => [field, signature(field)]),
  );
  const result = (
    status: StudioExecution["status"],
    message: string,
  ): StudioExecution => ({
    status,
    submitted,
    total,
    created,
    addClicks,
    message,
  });
  const checkContext = () => {
    if (signal.aborted) throw new Error("cancelled");
    if (
      doc.location.href !== stored.url ||
      !midrollContextIsCurrent(context, doc)
    )
      throw new StudioContextChanged(
        "O vídeo, editor ou botão de inserir mudou. A rotina foi interrompida.",
      );
  };
  const checkFields = (allowNew = false): HTMLInputElement[] => {
    checkContext();
    const current = midrollFields(context.editor);
    const oldInCurrentOrder = current.filter((field) =>
      expected.includes(field),
    );
    if (
      oldInCurrentOrder.length !== expected.length ||
      oldInCurrentOrder.some((field, index) => field !== expected[index]) ||
      expected.some((field) => signature(field) !== signatures.get(field)) ||
      current.length < expected.length ||
      current.length > expected.length + (allowNew ? 1 : 0)
    ) {
      throw new StudioContextChanged(
        "Os campos de intervalo mudaram ou surgiram controles inesperados. Confira os rascunhos antes de continuar manualmente.",
      );
    }
    return current;
  };
  try {
    for (let index = 0; index < total; index++) {
      checkFields();
      let field = context.initialFields[index];
      if (!field) {
        const add = context.addButton;
        if (!add || !enabled(add))
          throw new StudioContextChanged(
            "O botão Inserir intervalo não está disponível. Nenhum próximo clique será enviado.",
          );
        add.click();
        addClicks++;
        const deadline = Date.now() + 1000;
        while (true) {
          const current = checkFields(true);
          const added = current.filter((item) => !expected.includes(item));
          if (added.length === 1) {
            field = added[0];
            expected = current;
            signatures.set(field, signature(field));
            created++;
            break;
          }
          if (Date.now() >= deadline)
            throw new Error(
              "O clique Inserir foi enviado, mas um único campo novo não apareceu em até 1 segundo. O estado do rascunho é incerto; confira o Studio. Nenhum próximo clique foi enviado.",
            );
          await wait(Math.min(25, deadline - Date.now()), signal);
        }
      }
      checkFields();
      setFieldValue(doc, field, timestamp(context.positions[index]));
      submitted++;
      if (
        !field.isConnected ||
        parseDuration(field.value) !== Math.floor(context.positions[index])
      )
        throw new StudioContextChanged(
          "O campo não preservou o horário preenchido. A rotina foi interrompida; confira o rascunho.",
        );
      signatures.set(field, signature(field));
      checkFields();
      if (index + 1 < total) await wait(150, signal);
    }
    return result(
      "completed",
      "Intervalos criados/preenchidos em rascunho. Revise e use Continuar/Salvar manualmente no Studio; isto não confirma aceitação do servidor nem entrega de anúncios.",
    );
  } catch (error) {
    return result(
      signal.aborted
        ? "cancelled"
        : error instanceof StudioContextChanged
          ? "stale"
          : "error",
      signal.aborted
        ? "Execução cancelada. Um clique de inserção já enviado ainda pode criar um rascunho; confira o Studio. Nenhuma ação posterior foi enviada."
        : error instanceof Error
          ? error.message
          : "Falha ao preencher intervalos.",
    );
  }
}

/** Call only from the explicit confirm action after displaying the complete preview. */
export async function executeStudioPlan(
  planId: string,
  signal?: AbortSignal,
): Promise<StudioExecution> {
  const stored = plans.get(planId);
  if (!stored)
    return {
      status: "unsupported",
      submitted: 0,
      total: 0,
      message:
        "Prévia ausente, cancelada ou já consumida. Gere uma nova prévia.",
    };
  if (stored.state === "running")
    return {
      status: "unsupported",
      submitted: 0,
      total: stored.midroll?.positions.length ?? stored.steps.length,
      message: "Esta prévia já está em execução.",
    };
  const { document: doc, steps, controller } = stored;
  const total = stored.midroll?.positions.length ?? steps.length;
  if (
    Date.now() > stored.expires ||
    doc.location.href !== stored.url ||
    [...steps, ...stored.guards].some((step) => !stepIsCurrent(step)) ||
    (stored.midroll &&
      (!midrollContextIsCurrent(stored.midroll, doc) ||
        midrollFields(stored.midroll.editor).length !==
          stored.midroll.initialFields.length ||
        midrollFields(stored.midroll.editor).some(
          (field, index) => field !== stored.midroll!.initialFields[index],
        )))
  ) {
    plans.delete(planId);
    return {
      status: "stale",
      submitted: 0,
      total,
      message:
        "A página ou os controles mudaram. Gere uma nova prévia antes de confirmar.",
    };
  }
  // Keep the record during execution so cancellation remains available.
  stored.state = "running";
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) controller.abort();
  let submitted = 0;
  try {
    if (stored.midroll) return await executeMidrolls(stored);
    for (const step of steps) {
      if (controller.signal.aborted)
        return {
          status: "cancelled",
          submitted,
          total: steps.length,
          message:
            "Execução cancelada. Comandos anteriores podem já ter sido aplicados pelo YouTube.",
        };
      if (
        doc.location.href !== stored.url ||
        !stepIsCurrent(step) ||
        stored.guards.some((guard) => !stepIsCurrent(guard))
      )
        return {
          status: "stale",
          submitted,
          total: steps.length,
          message:
            "Um controle mudou durante a execução. A rotina foi interrompida; confira o resultado no Studio.",
        };
      if (step.value !== undefined) {
        setFieldValue(doc, step.element as HTMLInputElement, step.value);
      } else step.element.click();
      submitted++;
      if (submitted < steps.length) await wait(150, controller.signal);
    }
    return {
      status: "completed",
      submitted,
      total: steps.length,
      message:
        stored.publicPlan.action === "midrolls"
          ? "Campos preenchidos. Revise e salve manualmente no Studio."
          : "Cliques enviados. Confira o estado final no Studio; o envio não confirma a aceitação do servidor.",
    };
  } catch (error) {
    return {
      status: controller.signal.aborted ? "cancelled" : "error",
      submitted,
      total: steps.length,
      message: controller.signal.aborted
        ? "Execução cancelada; confira alterações já enviadas."
        : error instanceof Error
          ? error.message
          : "Falha ao operar o controle do Studio.",
    };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    plans.delete(planId);
  }
}

export function cancelStudioPlan(planId: string): boolean {
  const stored = plans.get(planId);
  if (!stored) return false;
  stored.controller.abort();
  plans.delete(planId);
  return true;
}

/** Fills already-open native date controls; the user applies the chosen range. */
export function setStudioPeriod(
  start: string,
  end: string,
  doc: Document = document,
): { status: "ready" | "unsupported"; message: string } {
  const validDate = (date: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date;
  if (!validDate(start) || !validDate(end) || start > end)
    return {
      status: "unsupported",
      message:
        "Use datas válidas no formato AAAA-MM-DD, com início anterior ao fim.",
    };
  if (!studioDocument(doc))
    return { status: "unsupported", message: "Abra o YouTube Studio." };
  const dialogs = doc.querySelectorAll(
    'yta-date-range-dialog, yta-date-picker-dialog, yta-date-range-picker, [role="dialog"]',
  );
  const fields = unique(
    Array.from(dialogs).flatMap((dialog) =>
      Array.from(
        dialog.querySelectorAll<HTMLInputElement>('input[type="date"]'),
      ),
    ),
  ).filter((field) => enabled(field));
  if (fields.length !== 2)
    return {
      status: "unsupported",
      message:
        "Abra o seletor de período personalizado do Studio com dois campos nativos de data. Esse layout não foi reconhecido; ajuste o período manualmente.",
    };
  fields.forEach((field, index) => {
    field.value = index === 0 ? start : end;
    field.dispatchEvent(new doc.defaultView!.Event("input", { bubbles: true }));
    field.dispatchEvent(
      new doc.defaultView!.Event("change", { bubbles: true }),
    );
  });
  return {
    status: "ready",
    message: "Período preenchido. Revise e clique em Aplicar no Studio.",
  };
}

export function getStudioRedactionTargets(
  doc: Document = document,
): HTMLElement[] {
  return unique(
    Array.from(
      doc.querySelectorAll<HTMLElement>(
        "yta-key-metric-card, yta-key-metric-block, #channel-name, #channel-avatar, ytcp-avatar, [data-prevlev-sensitive]",
      ),
    ),
  ).filter(visible);
}
