import type { ProfitInput } from "../core/profit";
import type { ProfitCardAdapter, ProfitCardDisplay, ProfitCardObservation, ProfitCardState } from "./profit-card";

export const PROFIT_CARD_MAX_SESSIONS = 8;
export type ProfitCardCommandType = "STUDIO_PROFIT_OBSERVE" | "STUDIO_PROFIT_SHOW" | "STUDIO_PROFIT_RESTORE" | "STUDIO_PROFIT_CANCEL";
export interface ProfitCardBridgeMessage {
  type: ProfitCardCommandType;
  session: string;
  sequence: number;
  observationId?: string;
  input?: ProfitInput;
}
export interface ProfitCardBridgeResponse {
  status: "ok" | "error";
  session?: string;
  sequence?: number;
  state?: ProfitCardState;
  observation?: ProfitCardObservation;
  display?: ProfitCardDisplay;
  error?: string;
}
export interface ProfitCardBridgeDependencies {
  doc?: Document;
  /** Tests can hold the settle boundary. Production waits for a local frame and observers. */
  settle?: () => Promise<void>;
}
const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const commands: readonly string[] = ["STUDIO_PROFIT_OBSERVE", "STUDIO_PROFIT_SHOW", "STUDIO_PROFIT_RESTORE", "STUDIO_PROFIT_CANCEL"];
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function envelope(value: unknown): ProfitCardBridgeMessage {
  if (!object(value) || typeof value.type !== "string" || !commands.includes(value.type)) throw new Error("Comando de apresentação local desconhecido.");
  if (typeof value.session !== "string" || !sessionPattern.test(value.session)) throw new Error("A apresentação exige uma sessão UUID válida.");
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) throw new Error("A apresentação exige uma sequência inteira positiva e monotônica.");
  if (value.type !== "STUDIO_PROFIT_OBSERVE" && (typeof value.observationId !== "string" || !value.observationId.trim() || value.observationId.length > 200)) throw new Error("O comando exige o observationId do recibo atual.");
  if (value.type === "STUDIO_PROFIT_SHOW" && !object(value.input)) throw new Error("Forneça os valores e as confirmações explícitas desta estimativa.");
  return { type: value.type as ProfitCardCommandType, session: value.session.toLowerCase(), sequence: value.sequence as number,
    ...(typeof value.observationId === "string" ? { observationId: value.observationId } : {}),
    ...(value.type === "STUDIO_PROFIT_SHOW" ? { input: value.input as unknown as ProfitInput } : {}),
  };
}

function settleFrame(doc: Document): Promise<void> {
  const view = doc.defaultView;
  return Promise.resolve().then(() => new Promise<void>(resolve => {
    if (!view) { resolve(); return; }
    const requestFrame = typeof view.requestAnimationFrame === "function" ? view.requestAnimationFrame.bind(view) : undefined;
    let frame: number | undefined, finished = false;
    const finish = () => {
      if (finished) return; finished = true;
      view.clearTimeout(timer); if (frame !== undefined) view.cancelAnimationFrame?.(frame); resolve();
    };
    // An inactive page can suspend animation frames. Observer delivery still settles
    // before the bounded timer; the capture transaction separately checks visibility.
    const timer = view.setTimeout(finish, requestFrame ? 250 : 0);
    if (requestFrame) frame = requestFrame(finish);
  })).then(() => undefined);
}

/** No runtime listener is installed here; the authorized content dispatcher owns routing.
 * A retired UUID cannot reclaim ownership, even with a higher sequence. Session history
 * is capped rather than evicted, so a late retired request cannot resurrect after eviction.
 */
export function createProfitCardBridge(adapter: ProfitCardAdapter, dependencies: ProfitCardBridgeDependencies = {}) {
  const sessions = new Map<string, { sequence: number; retired: boolean }>();
  let owner: string | undefined, observationId: string | undefined, disposed = false, preparingCapture = false;
  const doc = dependencies.doc ?? document, settle = dependencies.settle ?? (() => settleFrame(doc));
  const stateAfter = () => {
    const state = adapter.getState();
    if (["expired", "invalidated", "cancelled", "disposed"].includes(state.status)) observationId = undefined;
    return state;
  };
  const error = (cause: unknown, message?: ProfitCardBridgeMessage): ProfitCardBridgeResponse => ({
    status: "error", ...(message ? { session: message.session, sequence: message.sequence } : {}),
    ...(message?.session === owner ? { state: stateAfter() } : {}), error: cause instanceof Error ? cause.message : "A apresentação local foi recusada.",
  });
  return {
    async dispatch(value: unknown): Promise<ProfitCardBridgeResponse> {
      let message: ProfitCardBridgeMessage | undefined;
      try {
        message = envelope(value);
        if (disposed) throw new Error("Ponte local encerrada.");
        const session = sessions.get(message.session);
        if (session?.retired) throw new Error("Essa sessão foi substituída; solicitações atrasadas não podem reassumir o card.");
        if (session && message.sequence <= session.sequence) throw new Error("Solicitação atrasada ou repetida: sequência já processada.");
        if (message.type !== "STUDIO_PROFIT_OBSERVE" && message.session !== owner) throw new Error("Somente a sessão que observou o card pode alterar sua apresentação.");
        if (!session && sessions.size >= PROFIT_CARD_MAX_SESSIONS) throw new Error("Muitos painéis locais usaram esta página. Recarregue a aba para iniciar um novo contexto de apresentação.");
        // Reserve before any operation, including a refusal or asynchronous UI callback.
        sessions.set(message.session, { sequence: message.sequence, retired: false });
        if (preparingCapture && ["STUDIO_PROFIT_OBSERVE", "STUDIO_PROFIT_SHOW"].includes(message.type)) throw new Error("Aguarde a preparação da captura antes de mostrar outra estimativa.");
        if (message.type === "STUDIO_PROFIT_OBSERVE") {
          if (owner && owner !== message.session) sessions.get(owner)!.retired = true;
          owner = message.session; observationId = undefined;
          const observation = adapter.observe(); observationId = observation.id;
          return { status: "ok", session: message.session, sequence: message.sequence, state: stateAfter(), observation };
        }
        if (message.observationId !== observationId) throw new Error("O recibo pertence a outra observação ou foi invalidado. Leia e confirme novamente.");
        if (message.type === "STUDIO_PROFIT_SHOW") {
          const display = adapter.show(message.input!, message.observationId!);
          return { status: "ok", session: message.session, sequence: message.sequence, state: stateAfter(), display };
        }
        const state = message.type === "STUDIO_PROFIT_RESTORE" ? adapter.restore() : adapter.cancel();
        stateAfter(); return { status: "ok", session: message.session, sequence: message.sequence, state };
      } catch (cause) { return error(cause, message); }
    },
    async prepareCapture(): Promise<void> {
      if (disposed) throw new Error("Ponte local encerrada; captura não preparada.");
      if (preparingCapture) throw new Error("Aguarde a preparação atual da captura local.");
      preparingCapture = true;
      try {
        const state = adapter.restore(); stateAfter();
        if (state.removedOwnPresentation === false || adapter.getPresentationElement()) throw new Error("A apresentação local foi alterada externamente e não pôde ser removida com segurança. Captura recusada para não expor custo ou quantidade fora das máscaras.");
        await settle();
        if (disposed) throw new Error("O contexto foi encerrado durante a preparação da captura.");
        if (adapter.getPresentationElement() || adapter.getState().removedOwnPresentation === false) throw new Error("Uma apresentação de lucro permanece no card; captura recusada.");
      } finally { preparingCapture = false; }
    },
    cleanup(): void { if (!disposed) { disposed = true; owner = observationId = undefined; sessions.clear(); adapter.cleanup(); } },
  };
}

export type ProfitCardBridge = ReturnType<typeof createProfitCardBridge>;
