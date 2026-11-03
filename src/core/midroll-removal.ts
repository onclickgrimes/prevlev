/** Local review only. This module has no DOM controls or removal executor. */
export interface ObservedMidrollSlot {
  readonly id: string;
  readonly seconds: number;
  readonly displayedTime: string;
}
export interface MidrollRemovalObservation {
  readonly source: "studio-dom" | "manual-observation";
  readonly contextKey: string;
  readonly contextLabel: string;
  readonly observedAt: string;
  readonly slots: readonly ObservedMidrollSlot[];
  readonly limitations: readonly string[];
}
export type MidrollRemovalCriterion = { mode: "all" } | { mode: "range"; startSeconds: number; endSeconds: number };
export interface MidrollRemovalPlan {
  readonly id: string;
  readonly status: "preview" | "confirmed-local" | "cancelled" | "expired" | "stale";
  readonly contextLabel: string;
  readonly source: MidrollRemovalObservation["source"];
  readonly criterion: MidrollRemovalCriterion;
  readonly targets: readonly ObservedMidrollSlot[];
  readonly count: number;
  readonly confirmationText: string;
  readonly expiresAt: string;
  readonly limitations: readonly string[];
}
const TTL = 120_000;

function validateObservation(value: MidrollRemovalObservation, now: number): void {
  if (!value || !["studio-dom", "manual-observation"].includes(value.source) ||
      typeof value.contextKey !== "string" || !value.contextKey.trim() || value.contextKey.length > 100_000 ||
      typeof value.contextLabel !== "string" || !value.contextLabel.trim() || value.contextLabel.length > 500 ||
      !Array.isArray(value.slots) || value.slots.length > 500 ||
      value.slots.some(slot => !slot || typeof slot.id !== "string" || !slot.id || slot.id.length > 200 ||
        !Number.isFinite(slot.seconds) || slot.seconds < 0 || slot.seconds > 604_800 ||
        typeof slot.displayedTime !== "string" || slot.displayedTime.length > 50) ||
      new Set(value.slots.map(slot => slot.id)).size !== value.slots.length ||
      !Number.isFinite(Date.parse(value.observedAt)) || Date.parse(value.observedAt) > now + 1000 || now - Date.parse(value.observedAt) > TTL ||
      !Array.isArray(value.limitations) || value.limitations.length > 20 || value.limitations.some(item => typeof item !== "string" || item.length > 1000)) {
    throw new Error("Observação de slots inválida ou antiga; observe novamente o mesmo vídeo.");
  }
}

function fingerprint(value: MidrollRemovalObservation): string {
  return JSON.stringify([value.source, value.contextKey, value.contextLabel, value.slots.map(slot => [slot.id, slot.seconds, slot.displayedTime])]);
}

/** A confirmation finalizes a local plan; it never deletes a slot or clicks Studio. */
export function createMidrollRemovalPlanner(now: () => number = Date.now) {
  let sequence = 0;
  let current: { plan: MidrollRemovalPlan; fingerprint: string; expires: number } | undefined;
  const update = (status: MidrollRemovalPlan["status"]) => {
    if (!current) throw new Error("Não há plano de remoção em revisão.");
    current.plan = Object.freeze({ ...current.plan, status });
    return current.plan;
  };
  return {
    preview(observation: MidrollRemovalObservation, criterion: MidrollRemovalCriterion): MidrollRemovalPlan {
      current = undefined;
      const instant = now();
      validateObservation(observation, instant);
      if (!criterion || !["all", "range"].includes(criterion.mode)) throw new Error("Critério desconhecido. Interruptivos indisponíveis: não há marcador visível comprovado.");
      if (criterion.mode === "range" && (!Number.isFinite(criterion.startSeconds) || !Number.isFinite(criterion.endSeconds) || criterion.startSeconds < 0 || criterion.endSeconds < criterion.startSeconds || criterion.endSeconds > 604_800)) throw new Error("Informe uma faixa válida em segundos, com início menor ou igual ao fim.");
      const targets = observation.slots.filter(slot => criterion.mode === "all" || slot.seconds >= criterion.startSeconds && slot.seconds <= criterion.endSeconds);
      if (!targets.length) throw new Error("Nenhum slot observado corresponde ao critério escolhido.");
      if (targets.length > 50) throw new Error("O plano excede 50 slots; escolha uma faixa menor. Nenhum alvo foi truncado.");
      const expires = instant + TTL;
      const plan: MidrollRemovalPlan = Object.freeze({
        id: `midroll-removal-${++sequence}`,
        status: "preview",
        contextLabel: observation.contextLabel,
        source: observation.source,
        criterion: Object.freeze({ ...criterion }),
        targets: Object.freeze(targets.map(slot => Object.freeze({ ...slot }))),
        count: targets.length,
        confirmationText: `REMOVER ${targets.length} DE ${observation.contextLabel}`,
        expiresAt: new Date(expires).toISOString(),
        limitations: Object.freeze([...observation.limitations, "Somente plano local. Confirmar não remove anúncios, não clica em controles e não salva no Studio.", "Interruptivos indisponíveis: não há marcador visível comprovado."]),
      });
      current = { plan, fingerprint: fingerprint(observation), expires };
      return plan;
    },
    confirm(id: string, confirmation: string, observation: MidrollRemovalObservation): MidrollRemovalPlan {
      if (!current || current.plan.id !== id || current.plan.status !== "preview") throw new Error("Plano inexistente ou encerrado; gere outra prévia.");
      if (now() >= current.expires) return update("expired");
      try { validateObservation(observation, now()); } catch { return update("stale"); }
      if (fingerprint(observation) !== current.fingerprint) return update("stale");
      if (confirmation !== current.plan.confirmationText) throw new Error("A confirmação precisa corresponder exatamente ao total e ao contexto da prévia.");
      return update("confirmed-local");
    },
    cancel(): MidrollRemovalPlan | undefined {
      return current?.plan.status === "preview" ? update("cancelled") : current?.plan;
    },
    get(): MidrollRemovalPlan | undefined {
      if (current?.plan.status === "preview" && now() >= current.expires) update("expired");
      return current?.plan;
    },
  };
}
