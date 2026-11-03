import { parseCount } from "../core/parse";

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
  message: string;
}
interface Step {
  element: HTMLElement;
  signature: string;
  value?: string;
}
interface StoredPlan {
  publicPlan: StudioPlan;
  document: Document;
  url: string;
  expires: number;
  steps: Step[];
  guards: Step[];
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
    steps.push(
      ...targets.map((element) => ({ element, signature: signature(element) })),
    );
    description = `${desired ? "Dar" : "Remover"} coração em ${targets.length} comentários visíveis.`;
    notes.push(
      "Cada clique pode publicar a reação no canal. Apenas os comentários visíveis da prévia serão processados.",
    );
    if (targets.length === 0)
      unsupported =
        "Nenhum botão de coração elegível com estado reconhecido foi encontrado.";
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
          value <= 0 ||
          (index > 0 && value <= positions[index - 1]),
      )
    ) {
      unsupported =
        "Informe de 1 a 50 posições positivas em segundos, em ordem crescente.";
    } else {
      const editors = Array.from(
        doc.querySelectorAll(
          "ytcp-ad-breaks-editor, ytcp-ad-break-editor, ytcp-video-ad-breaks-editor, ytcp-ad-break-editor-row",
        ),
      );
      const candidates = unique(
        editors.flatMap((editor) =>
          Array.from(editor.querySelectorAll<HTMLInputElement>("input")),
        ),
      );
      const labeled = Array.from(
        doc.querySelectorAll<HTMLInputElement>("input[aria-label]"),
      ).filter((element) =>
        /^(ad slot start time|ad break time|horario do intervalo|inicio do intervalo)/.test(
          normalize(label(element)),
        ),
      );
      const fields = unique([...candidates, ...labeled]).filter(
        (field) =>
          enabled(field) &&
          !field.readOnly &&
          ["text", "time"].includes(field.type) &&
          (field.type === "time" ||
            /time|horario|inicio|timestamp/.test(normalize(label(field))) ||
            /^\d{1,2}:\d{2}(?::\d{2})?$/.test(
              field.value || field.placeholder,
            )),
      );
      if (fields.length !== positions.length)
        unsupported = `Abra o editor de anúncios e crie exatamente ${positions.length} intervalos editáveis. Foram reconhecidos ${fields.length} campos. Nenhuma alteração foi feita.`;
      else {
        steps.push(
          ...fields.map((element, index) => ({
            element,
            signature: signature(element),
            value: timestamp(positions[index]),
          })),
        );
        description = `Preencher ${positions.length} intervalos abertos: ${positions.map(timestamp).join(", ")}.`;
        notes.push(
          "Apenas preenche os campos abertos. Revise, clique em Continuar e salve no próprio Studio. A entrega de anúncios não é garantida.",
        );
      }
    }
  } else unsupported = "Ação de Studio desconhecida.";
  if (unsupported) notes.unshift(unsupported);
  const publicPlan: StudioPlan = Object.freeze({
    id: globalThis.crypto.randomUUID(),
    action,
    status: unsupported ? "unsupported" : "ready",
    targetCount: unsupported ? 0 : steps.length,
    targets: Object.freeze(
      unsupported
        ? []
        : steps.map((step) =>
            Object.freeze({
              control: label(step.element),
              context: (
                step.element.closest(
                  "ytcp-comment-thread,ytcp-comment-thread-row,ytcp-comment",
                )?.textContent ?? description
              )
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
      total: stored.steps.length,
      message: "Esta prévia já está em execução.",
    };
  const { document: doc, steps, controller } = stored;
  if (
    Date.now() > stored.expires ||
    doc.location.href !== stored.url ||
    [...steps, ...stored.guards].some(
      (step) =>
        !enabled(step.element) || signature(step.element) !== step.signature,
    )
  ) {
    plans.delete(planId);
    return {
      status: "stale",
      submitted: 0,
      total: steps.length,
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
        !enabled(step.element) ||
        signature(step.element) !== step.signature
      )
        return {
          status: "stale",
          submitted,
          total: steps.length,
          message:
            "Um controle mudou durante a execução. A rotina foi interrompida; confira o resultado no Studio.",
        };
      if (step.value !== undefined) {
        const field = step.element as HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(
          doc.defaultView!.HTMLInputElement.prototype,
          "value",
        )?.set;
        if (!setter) throw new Error("Campo sem setter de valor reconhecido.");
        setter.call(field, step.value);
        field.dispatchEvent(
          new doc.defaultView!.Event("input", { bubbles: true }),
        );
        field.dispatchEvent(
          new doc.defaultView!.Event("change", { bubbles: true }),
        );
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
