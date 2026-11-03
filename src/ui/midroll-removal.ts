import { createMidrollRemovalPlanner, type MidrollRemovalObservation, type MidrollRemovalPlan } from "../core/midroll-removal";
import { parseDuration } from "../core/parse";

interface RemovalOptions {
  observe?: () => MidrollRemovalObservation | undefined | Promise<MidrollRemovalObservation | undefined>;
  now?: () => number;
}

/** Local plan UI. No execute callback is accepted, so confirmation cannot alter Studio. */
export function mountMidrollRemoval(doc: Document = document, options: RemovalOptions = {}): { invalidate(): void } {
  const host = doc.querySelector<HTMLElement>("#studio");
  if (!host) throw new Error("Painel Studio ausente.");
  const panel = doc.createElement("section");
  panel.id = "midroll-removal";
  panel.className = "card";
  panel.innerHTML = `<h2>Planejar remoção de mid-rolls</h2>
    <p>Esta tela prepara uma lista local para revisão. Confirmar o plano não remove anúncios nem salva no Studio. A remoção no canal permanece manual.</p>
    <label>Fonte dos slots <select id="removal-source"><option value="studio">Campos reconhecidos do Studio</option><option value="manual">Observação manual informada por você</option></select></label>
    <div id="removal-manual"><label>Contexto do vídeo observado <input id="removal-context" maxlength="200" placeholder="ID ou URL do vídeo"></label>
    <label>Posições observadas, uma por linha (segundos ou HH:MM:SS)<textarea id="removal-times" rows="4" maxlength="10000"></textarea></label>
    <label><input type="checkbox" id="removal-observed"> Confirmo que estas posições foram observadas por mim neste vídeo.</label>
    <p>Declaração manual, sem verificação no Studio. Não use posições sugeridas como se fossem slots existentes.</p></div>
    <label>Critério <select id="removal-mode"><option value="all">Todos os slots observados</option><option value="range">Faixa de horário inclusiva</option><option value="interruptive" disabled>Interruptivos — marcador comprovado indisponível</option></select></label>
    <div id="removal-range" hidden><label>Início da faixa (segundos)<input id="removal-start" type="number" min="0" step="0.001"></label><label>Fim da faixa (segundos)<input id="removal-end" type="number" min="0" step="0.001"></label></div>
    <button id="removal-preview" type="button">Observar e criar prévia local</button>
    <button id="removal-cancel" type="button" disabled>Cancelar plano</button>
    <h3 id="removal-title">Nenhum plano criado</h3><p id="removal-details"></p><ol id="removal-targets"></ol><ul id="removal-limitations"></ul>
    <label>Digite a confirmação específica <input id="removal-confirmation" autocomplete="off" disabled></label>
    <p id="removal-required"></p><button id="removal-confirm" type="button" disabled>Confirmar somente plano local</button>
    <p id="removal-status" role="status">Nenhuma observação ou alteração automática ao abrir.</p>`;
  host.append(panel);
  const input = (id: string) => panel.querySelector<HTMLInputElement>(`#${id}`)!;
  const select = (id: string) => panel.querySelector<HTMLSelectElement>(`#${id}`)!;
  const text = (id: string, value: string) => { panel.querySelector<HTMLElement>(`#${id}`)!.textContent = value; };
  const source = select("removal-source"), mode = select("removal-mode"), times = panel.querySelector<HTMLTextAreaElement>("#removal-times")!;
  const preview = panel.querySelector<HTMLButtonElement>("#removal-preview")!, confirm = panel.querySelector<HTMLButtonElement>("#removal-confirm")!, cancel = panel.querySelector<HTMLButtonElement>("#removal-cancel")!;
  const now = options.now ?? Date.now, planner = createMidrollRemovalPlanner(now);
  let active: MidrollRemovalPlan | undefined, epoch = 0, expiry: ReturnType<typeof setTimeout> | undefined;
  if (!options.observe) { source.querySelector<HTMLOptionElement>('option[value="studio"]')!.disabled = true; source.value = "manual"; }
  const syncSource = () => { panel.querySelector<HTMLElement>("#removal-manual")!.hidden = source.value !== "manual"; panel.querySelector<HTMLElement>("#removal-range")!.hidden = mode.value !== "range"; };
  const lockConfirmation = () => { confirm.disabled = true; input("removal-confirmation").disabled = true; input("removal-confirmation").value = ""; cancel.disabled = true; };
  const endPending = (message: string) => {
    epoch++; planner.cancel(); active = undefined; clearTimeout(expiry); preview.disabled = false; lockConfirmation(); text("removal-status", message);
    text("removal-title", "Nenhum plano criado"); text("removal-details", ""); text("removal-required", "");
    panel.querySelector("#removal-targets")!.replaceChildren(); panel.querySelector("#removal-limitations")!.replaceChildren();
  };
  const render = (plan: MidrollRemovalPlan) => {
    text("removal-title", `Remove ${plan.count} · prévia local`);
    text("removal-details", `${plan.contextLabel} · ${plan.source === "studio-dom" ? "campos observados no Studio" : "observação manual não verificada"} · ${plan.criterion.mode === "range" ? `faixa inclusiva ${plan.criterion.startSeconds}–${plan.criterion.endSeconds} s` : "todos os slots observados"} · expira em ${plan.expiresAt}`);
    panel.querySelector("#removal-targets")!.replaceChildren(...plan.targets.map(slot => { const item = doc.createElement("li"); item.textContent = `${slot.displayedTime} (${slot.seconds} s) · ${slot.id}`; return item; }));
    panel.querySelector("#removal-limitations")!.replaceChildren(...plan.limitations.map(value => { const item = doc.createElement("li"); item.textContent = value; return item; }));
    text("removal-required", `Confirmação exigida: ${plan.confirmationText}`);
  };
  const observe = async (): Promise<MidrollRemovalObservation | undefined> => {
    if (source.value === "studio") return await options.observe?.();
    const context = input("removal-context").value.trim();
    if (!context || !input("removal-observed").checked) throw new Error("Informe o contexto e confirme manualmente a origem das posições observadas.");
    const lines = times.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!lines.length || lines.length > 500) throw new Error("Informe entre 1 e 500 posições observadas, uma por linha.");
    const slots = lines.map((line, index) => {
      const seconds = /^\d+(?:\.\d+)?$/.test(line) ? Number(line) : parseDuration(line);
      if (seconds === undefined || !Number.isFinite(seconds)) throw new Error(`Posição inválida na linha ${index + 1}.`);
      return { id: `manual-slot-${index + 1}`, seconds, displayedTime: line };
    });
    return { source: "manual-observation", contextKey: JSON.stringify([context, slots]), contextLabel: context, observedAt: new Date(now()).toISOString(), slots, limitations: ["Posições e identidade declaradas pelo usuário; não verificadas no Studio.", "Mudanças no Studio não podem ser detectadas nesta fonte manual. Revise novamente antes de qualquer remoção manual."] };
  };
  panel.addEventListener("input", event => {
    if (event.target === input("removal-confirmation")) return;
    if (event.target !== input("removal-observed")) input("removal-observed").checked = false;
    endPending("Entradas alteradas; plano anterior descartado. Crie outra prévia.");
  });
  panel.addEventListener("change", event => { if (event.target instanceof doc.defaultView!.HTMLSelectElement) { syncSource(); endPending("Fonte ou critério alterado; crie outra prévia."); } });
  preview.addEventListener("click", async () => {
    endPending("Observando slots para a prévia local…");
    const token = epoch; preview.disabled = true; cancel.disabled = false;
    try {
      const observation = await observe();
      if (token !== epoch) return;
      if (!observation) throw new Error("Slots existentes não reconhecidos. A toolbar moderna é um playhead, não uma lista de anúncios. Use observação manual explícita ou um editor legado reconhecido.");
      if (!["all", "range"].includes(mode.value)) throw new Error("Critério desconhecido. Interruptivos indisponíveis: não há marcador visível comprovado.");
      const criterion = mode.value === "range" ? { mode: "range" as const, startSeconds: input("removal-start").value === "" ? NaN : Number(input("removal-start").value), endSeconds: input("removal-end").value === "" ? NaN : Number(input("removal-end").value) } : { mode: "all" as const };
      active = planner.preview(observation, criterion); render(active); confirm.disabled = false; input("removal-confirmation").disabled = false; cancel.disabled = false;
      text("removal-status", "Prévia pronta. Confira cada alvo e digite a confirmação do vídeo e do total; isso confirmará apenas o plano local.");
      expiry = setTimeout(() => { if (token === epoch && active) { planner.get(); endPending("Plano expirado; observe novamente e gere outra prévia."); } }, 120_000);
    } catch (error) { if (token === epoch) text("removal-status", error instanceof Error ? error.message : "Não foi possível criar a prévia local."); }
    finally { if (token === epoch) { preview.disabled = false; if (!active) cancel.disabled = true; } }
  });
  confirm.addEventListener("click", async () => {
    if (!active) return;
    const reviewed = active, token = epoch; confirm.disabled = true;
    try {
      const observation = await observe();
      if (token !== epoch) return;
      if (!observation) { endPending("Contexto ou slots não reconhecidos; plano descartado. Observe novamente."); return; }
      const result = planner.confirm(reviewed.id, input("removal-confirmation").value, observation);
      if (result.status !== "confirmed-local") { endPending(result.status === "expired" ? "Plano expirado; crie outra prévia." : "Contexto ou slots alterados; plano descartado. Observe novamente."); return; }
      active = result; clearTimeout(expiry); lockConfirmation(); text("removal-title", `Remove ${result.count} · plano local confirmado`); text("removal-status", `Plano local confirmado para ${result.count} slots em ${result.contextLabel}. Nenhum anúncio foi removido e nenhum controle do Studio foi clicado.`);
    } catch (error) { if (token === epoch) { text("removal-status", error instanceof Error ? error.message : "Confirmação local recusada."); confirm.disabled = false; } }
  });
  cancel.addEventListener("click", () => endPending("Plano cancelado. Nenhum anúncio foi removido."));
  syncSource();
  return { invalidate: () => endPending("Coleta ou aba alterada; plano anterior descartado. Observe novamente antes de criar uma prévia.") };
}
