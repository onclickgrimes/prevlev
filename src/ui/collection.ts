import type { PageSnapshot } from "../shared/types";

type Phase = "running" | "completed" | "stopped" | "cancelled" | "error" | "idle";
interface Progress {
  jobId: string; kind: "videos" | "comments"; phase: Phase; collectedCount: number; steps: number;
  maxItems: number; maxSteps: number; url: string; videoId?: string; reason?: string; limitations: string[];
}
interface Reply { status: string; error?: string; collection?: Progress; snapshot?: PageSnapshot; }
interface Operation { tabId: number; selection: string; epoch: number; }
interface Job extends Operation {
  jobId: string; kind: "videos" | "comments"; url: string; videoId?: string; deadline: number; cancelling: boolean;
}
interface Pending extends Operation { snapshot: PageSnapshot; }

export function initCollectionTools(deps: {
  targetTab: () => number; snapshot: () => PageSnapshot; adopt: (snapshot: PageSnapshot) => Promise<void>;
  notice: (text: string, error?: boolean) => void;
}): void {
  const parent = document.getElementById("research");
  if (!parent) return;
  const section = document.createElement("div"); section.className = "card"; section.id = "collection-tools";
  section.innerHTML = `<h2>Coleta assistida por rolagem</h2><p>Carrega apenas o que a interface nativa disponibilizar durante esta ação. A coleta tem limites e não confirma que o catálogo ou os comentários estão completos.</p><div class="form-grid"><label>Itens<select id="collection-kind"><option value="videos">Vídeos</option><option value="comments">Comentários</option></select></label><label>Máximo de itens<input id="collection-max" type="number" min="1" max="500" value="100"></label><label>Máximo de rolagens<input id="collection-steps" type="number" min="1" max="30" value="10"></label><label>Prazo (segundos)<input id="collection-timeout" type="number" min="1" max="60" value="30"></label></div><div class="actions"><button id="collection-start">Iniciar coleta limitada</button><button id="collection-cancel" disabled>Cancelar coleta</button><button id="collection-use" disabled>Usar esta coleta no painel</button></div><p id="collection-status" role="status" aria-live="polite">Nenhuma coleta assistida iniciada.</p>`;
  parent.append(section);
  const get = <T extends HTMLElement = HTMLElement>(id: string) => section.querySelector<T>(`#collection-${id}`)!;
  const tabSelect = document.getElementById("tab-select") as HTMLSelectElement | null;
  let active: Job | undefined, starting: Operation | undefined, pending: Pending | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined, epoch = 0, pageActive = true;
  const status = (text: string) => { get("status").textContent = text; };
  function controls() {
    get<HTMLButtonElement>("start").disabled = !pageActive || !!starting || !!active;
    get<HTMLButtonElement>("cancel").disabled = !pageActive || (!starting && (!active || active.cancelling));
    get<HTMLButtonElement>("use").disabled = !pageActive || !pending;
    for (const id of ["kind", "max", "steps", "timeout"]) get<HTMLInputElement>(id).disabled = !pageActive || !!starting || !!active;
  }
  function stopTimer() { if (timer !== undefined) clearTimeout(timer); timer = undefined; }
  function current(operation: Operation) {
    if (!pageActive || operation.epoch !== epoch || operation.selection !== (tabSelect?.value ?? "")) return false;
    try { return operation.tabId === deps.targetTab(); } catch { return false; }
  }
  async function send(tabId: number, message: Record<string, unknown>): Promise<Reply> {
    const reply = await chrome.tabs.sendMessage(tabId, message) as Reply;
    if (!reply || reply.status !== "ok") throw new Error(reply?.error ?? "A aba não reconheceu a coleta. Recarregue-a após atualizar a extensão.");
    return reply;
  }
  function progress(reply: Reply) {
    const p = reply.collection;
    if (!p || typeof p.jobId !== "string" || !p.jobId || !["videos", "comments"].includes(p.kind) || !["running", "completed", "stopped", "cancelled", "error", "idle"].includes(p.phase) || !Number.isInteger(p.collectedCount) || p.collectedCount < 0 || !Number.isInteger(p.steps) || p.steps < 0) throw new Error("A aba retornou progresso incompatível.");
    return p;
  }
  // Until START replies with a job ID, only the local attempt can be cancelled.
  // A discarded reply then requests cancellation specifically for that old job.
  function cancelDiscarded(tabId: number, jobId: string) {
    void chrome.tabs.sendMessage(tabId, { type: "CANCEL_COLLECTION", jobId }).catch(() => {});
  }
  function invalidate(message: string) {
    const previous = active;
    epoch++; stopTimer(); active = undefined; starting = undefined; pending = undefined;
    controls(); status(message);
    if (previous) cancelDiscarded(previous.tabId, previous.jobId);
  }
  function currentJob(job: Job) {
    if (active !== job) return false;
    if (current(job)) return true;
    invalidate("O contexto selecionado mudou; a coleta anterior não será aplicada.");
    return false;
  }
  function validateContext(job: Job, reply: Reply) {
    const p = progress(reply);
    if (p.jobId !== job.jobId || p.kind !== job.kind || p.url !== job.url || p.videoId !== job.videoId) throw new Error("O contexto da coleta mudou. O resultado não foi aplicado.");
    return p;
  }
  async function cancel(reason = "Cancelamento solicitado. A coleta parcial ficará disponível quando a aba confirmar.") {
    if (starting) {
      invalidate("Início cancelado no painel. Se a aba confirmar um trabalho, será solicitado seu cancelamento; o resultado não será aplicado.");
      return;
    }
    const job = active;
    if (!job || job.cancelling) return;
    stopTimer(); job.cancelling = true; controls();
    try {
      const reply = await send(job.tabId, { type: "CANCEL_COLLECTION", jobId: job.jobId });
      if (!currentJob(job)) return;
      status(reason); await poll(job, reply);
    } catch (error) {
      if (!currentJob(job)) return;
      active = undefined; stopTimer(); controls(); deps.notice(error instanceof Error ? error.message : String(error), true);
    }
  }
  async function poll(job: Job, initial?: Reply) {
    if (!currentJob(job)) return;
    try {
      let reply = initial ?? await send(job.tabId, { type: "COLLECTION_STATUS", jobId: job.jobId, includeResults: true });
      if (!currentJob(job) || (job.cancelling && !initial)) return;
      let p = validateContext(job, reply);
      if (p.phase !== "running" && !reply.snapshot && p.collectedCount > 0) {
        reply = await send(job.tabId, { type: "COLLECTION_STATUS", jobId: job.jobId, includeResults: true });
        if (!currentJob(job)) return;
        p = validateContext(job, reply);
      }
      status(`${p.collectedCount}/${p.maxItems} itens · ${p.steps}/${p.maxSteps} rolagens · ${p.phase}${p.reason ? ` · ${p.reason}` : ""}`);
      if (p.phase === "running") {
        if (Date.now() > job.deadline) { job.cancelling = false; await cancel("Prazo do painel atingido; cancelamento solicitado à aba."); return; }
        job.cancelling = false; controls(); timer = setTimeout(() => { void poll(job); }, 400); return;
      }
      active = undefined; stopTimer();
      if (reply.snapshot && p.collectedCount > 0 && reply.snapshot.url === job.url && reply.snapshot.videoId === job.videoId) {
        pending = { tabId: job.tabId, selection: job.selection, epoch: job.epoch, snapshot: reply.snapshot };
        status(`${get("status").textContent} · Coleta parcial/própria; clique em Usar para atualizar o painel.`);
      }
      controls();
    } catch (error) {
      if (!currentJob(job)) return;
      active = undefined; stopTimer(); controls(); deps.notice(error instanceof Error ? error.message : String(error), true);
    }
  }
  get("start").addEventListener("click", () => {
    if (!pageActive || active || starting) return;
    void (async () => {
      const maxItems = Number(get<HTMLInputElement>("max").value), maxSteps = Number(get<HTMLInputElement>("steps").value), timeoutMs = Number(get<HTMLInputElement>("timeout").value) * 1000, kind = get<HTMLSelectElement>("kind").value;
      if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 500 || !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 30 || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000 || !["videos", "comments"].includes(kind)) throw new Error("Informe limites válidos: até 500 itens, 30 rolagens e 60 segundos.");
      // Reserve the epoch and selected context before START_COLLECTION can yield.
      const attempt: Operation = { tabId: deps.targetTab(), selection: tabSelect?.value ?? "", epoch: ++epoch };
      starting = attempt; pending = undefined; controls(); status("Iniciando ação explícita na aba selecionada…");
      try {
        const reply = await send(attempt.tabId, { type: "START_COLLECTION", kind, maxItems, maxSteps, timeoutMs });
        if (starting !== attempt || !current(attempt)) {
          if (starting === attempt) invalidate("O contexto selecionado mudou; o início anterior não será aplicado.");
          if (typeof reply.collection?.jobId === "string" && reply.collection.jobId) cancelDiscarded(attempt.tabId, reply.collection.jobId);
          return;
        }
        const p = progress(reply);
        if (p.kind !== kind) throw new Error("A aba retornou outro tipo de coleta. O resultado não foi aplicado.");
        starting = undefined;
        const job: Job = { ...attempt, jobId: p.jobId, kind: p.kind, url: p.url, videoId: p.videoId, deadline: Date.now() + timeoutMs + 5000, cancelling: false };
        active = job; controls(); await poll(job, reply);
      } catch (error) {
        if (starting !== attempt) return;
        if (!current(attempt)) { invalidate("O contexto selecionado mudou; o início anterior não será aplicado."); return; }
        starting = undefined; controls(); deps.notice(error instanceof Error ? error.message : String(error), true);
      }
    })().catch(error => deps.notice(error instanceof Error ? error.message : String(error), true));
  });
  get("cancel").addEventListener("click", () => { void cancel(); });
  get("use").addEventListener("click", () => {
    void (async () => {
      const result = pending;
      if (!result) return;
      if (!current(result)) { invalidate("O contexto selecionado mudou; a coleta anterior não será aplicada."); return; }
      const next = result.snapshot, previous = deps.snapshot();
      if (previous.url === next.url && previous.videoId === next.videoId) {
        const videos = new Map(previous.videos.map(v => [v.id, v])), comments = new Map(previous.comments.map(c => [c.id, c]));
        for (const v of next.videos) videos.set(v.id, v);
        for (const c of next.comments) comments.set(c.id, c);
        await deps.adopt({ ...previous, ...next, videos: [...videos.values()], comments: [...comments.values()] });
      } else await deps.adopt(next);
      if (pending !== result || !current(result)) return;
      pending = undefined; controls(); deps.notice("Coleta assistida aplicada ao painel. Campos ausentes permanecem desconhecidos.");
    })().catch(error => deps.notice(error instanceof Error ? error.message : String(error), true));
  });
  tabSelect?.addEventListener("change", () => invalidate("A seleção de aba mudou; a coleta anterior não será aplicada. O cancelamento foi solicitado para trabalhos já confirmados."));
  window.addEventListener("pagehide", () => { pageActive = false; invalidate("O painel foi suspenso; a coleta anterior não será aplicada."); });
  window.addEventListener("pageshow", () => { pageActive = true; controls(); });
  controls();
}
