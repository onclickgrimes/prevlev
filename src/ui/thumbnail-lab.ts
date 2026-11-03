import { ThumbnailLabHistory, thumbnailPrompt, thumbnailReferenceUrl, THUMBNAIL_LAB_LIMITS, type ThumbnailBrief, type ThumbnailPayload, type ThumbnailReference, type ThumbnailSelection } from "../core/thumbnail-lab";
import type { RemoteResponse } from "../shared/types";

export interface ThumbnailLabDependencies {
  selection: () => ThumbnailSelection;
  /** Existing Prevlev backend bridge; must preserve model/origin and existing busy guard. Never call Omni directly. */
  generate: (payload: ThumbnailPayload) => Promise<RemoteResponse>;
  showResult?: (response: RemoteResponse) => void;
}

/** Independent session-only lab. Merely mounting or opening the section does not query or generate. */
export function mountThumbnailLab(section: HTMLElement, deps: ThumbnailLabDependencies) {
  if (section.childNodes.length || section.dataset.thumbnailLabMounted) throw new Error("Use uma seção vazia para o Thumbnail Lab.");
  section.dataset.thumbnailLabMounted = "true";
  const doc = section.ownerDocument;
  section.innerHTML = `<div class="card"><h2>Thumbnail Lab local</h2>
    <p>Organize o briefing e referências nesta sessão. Somente o texto do briefing é enviado quando você escolhe Gerar. Abrir esta tela não consulta nem gera imagens.</p>
    <form id="thumbnail-lab-form">
      <label>Título original <input name="title" maxlength="300"></label>
      <label>Novo título proposto <input name="newTitle" maxlength="300"></label>
      <label>Roteiro / contexto <textarea name="script" maxlength="2500" rows="4"></textarea></label>
      <label>Instruções de composição <textarea name="instructions" maxlength="2500" rows="4"></textarea></label>
      <p id="thumbnail-lab-model"></p>
      <p>Contrato atual: 1 imagem, proporção 16:9 definida pelo backend. Resolução não configurável. O catálogo deve anunciar images.generate, entrada text e saída image. Modelos e origem são revalidados pelo backend.</p>
      <details><summary>Texto que será enviado</summary><pre id="thumbnail-lab-prompt"></pre></details>
      <button type="submit" id="thumbnail-lab-generate">Gerar pelo backend configurado</button>
      <button type="button" id="thumbnail-lab-stop" disabled>Parar de acompanhar</button>
    </form>
    <p id="thumbnail-lab-status" role="status" aria-live="polite">Nenhuma geração solicitada.</p>
    <h3>Referências organizadas localmente</h3>
    <p>Referências não são enviadas nem aplicadas pelo contrato atual, mesmo que o catálogo do modelo mencione entrada de imagem. URLs não são abertas; bytes dos arquivos não são lidos. Nomes, URLs e notas também ficam fora do prompt.</p>
    <div id="thumbnail-lab-reference-controls">
      <label>Grupo <select id="thumbnail-lab-ref-group"><option value="composition">Composição</option><option value="style">Estilo</option><option value="content">Conteúdo</option></select></label>
      <label>Nota local <input id="thumbnail-lab-ref-note" maxlength="500"></label>
      <label>Arquivo de referência (somente nome/tamanho) <input id="thumbnail-lab-ref-file" type="file" accept="image/png,image/jpeg,image/webp"></label>
      <label>URL de referência <input id="thumbnail-lab-ref-url" type="url" maxlength="2048"></label>
      <button id="thumbnail-lab-add-url" type="button">Guardar URL localmente</button>
    </div><ul id="thumbnail-lab-references"></ul>
    <h3>Solicitações e resultados desta sessão</h3>
    <p>Até 12 solicitações e 12 MiB de respostas em memória. Respostas antigas são descartadas quando o limite é atingido; a descrição do resultado permanece até sair do histórico. Sem saldo ou cota externos conhecidos. Fechar/recarregar perde este histórico.</p>
    <button id="thumbnail-lab-clear" type="button">Limpar briefing, referências e histórico</button>
    <ol id="thumbnail-lab-history"></ol></div>`;
  const get = <T extends HTMLElement>(id: string) => section.querySelector<T>(`#${id}`)!;
  const form = get<HTMLFormElement>("thumbnail-lab-form"), status = get("thumbnail-lab-status"), historyList = get("thumbnail-lab-history"), referencesList = get("thumbnail-lab-references"), prompt = get("thumbnail-lab-prompt");
  const generate = get<HTMLButtonElement>("thumbnail-lab-generate"), stop = get<HTMLButtonElement>("thumbnail-lab-stop"), clear = get<HTMLButtonElement>("thumbnail-lab-clear");
  const file = get<HTMLInputElement>("thumbnail-lab-ref-file"), url = get<HTMLInputElement>("thumbnail-lab-ref-url"), note = get<HTMLInputElement>("thumbnail-lab-ref-note"), group = get<HTMLSelectElement>("thumbnail-lab-ref-group");
  const history = new ThumbnailLabHistory();
  let references: ThumbnailReference[] = [], nextReferenceId = 1, running: number | undefined, disposed = false;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text: string): HTMLElementTagNameMap[K] => { const n = doc.createElement(tag); n.textContent = text; return n; };
  const brief = (): ThumbnailBrief => { const data = new FormData(form); return { title: String(data.get("title") ?? ""), newTitle: String(data.get("newTitle") ?? ""), script: String(data.get("script") ?? ""), instructions: String(data.get("instructions") ?? "") }; };
  const refreshPrompt = () => { try { prompt.textContent = thumbnailPrompt(brief()); } catch (error) { prompt.textContent = error instanceof Error ? error.message : "Briefing inválido."; } };
  const refreshSelection = () => {
    const selected = deps.selection(), m = selected.model;
    get("thumbnail-lab-model").textContent = m ? `Modelo exato: ${m.id} · origem Omni: ${selected.origin || "desconhecida"}${selected.backendOrigin ? ` · backend: ${selected.backendOrigin}` : ""}` : "Nenhum modelo selecionado. Consulte o catálogo e selecione o modelo na Conexão.";
    generate.disabled = !!running || !m?.imageSupported || !m.operations.includes("images.generate") || !m.inputModalities.includes("text") || !m.outputModalities.includes("image") || !selected.origin;
    stop.disabled = !running || history.jobs.find(job => job.id === running)?.stoppedFollowing === true;
    clear.disabled = !!running;
  };
  const renderHistory = () => {
    historyList.replaceChildren();
    const states = { sending: "Aguardando resposta", succeeded: "Resposta de imagem recebida", error: "Erro da solicitação", unsupported: "Não suportado", not_configured: "Não configurado", uncertain: "Resultado incerto" };
    for (const job of history.jobs) {
      const item = el("li", ""); item.dataset.jobId = String(job.id);
      item.append(el("h4", `#${job.id} · ${states[job.state]}`), el("p", `${job.createdAt} · modelo ${job.model} · origem ${job.origin}${job.backendOrigin ? ` · backend ${job.backendOrigin}` : ""}${job.source ? ` · resposta ${job.source}` : ""}${job.responseStatus ? ` · status recebido ${job.responseStatus}` : ""}`), el("p", job.message), el("p", `${job.references.length} referência(s) locais não enviadas.`));
      const details = doc.createElement("details"); details.append(el("summary", "Briefing da solicitação"), el("pre", job.prompt)); item.append(details);
      if (job.references.length) {
        const refs = doc.createElement("details"); refs.append(el("summary", "Referências locais desta solicitação (não enviadas)"));
        for (const ref of job.references) refs.append(el("p", `${ref.group} · ${ref.label} · ${ref.location}${ref.note ? ` · ${ref.note}` : ""}`));
        item.append(refs);
      }
      if (job.result && deps.showResult) {
        const show = el("button", "Abrir resposta retida"); show.type = "button";
        show.addEventListener("click", () => { try { deps.showResult!(job.result!); } catch (error) { status.textContent = `Resposta não exibida: ${error instanceof Error ? error.message : "formato incompatível"}`; } }); item.append(show);
      } else if (job.state === "succeeded") item.append(el("p", "Imagem não retida no limite de memória. Nenhuma nova geração será feita ao abrir este registro."));
      historyList.append(item);
    }
  };
  const renderReferences = () => {
    referencesList.replaceChildren();
    const groups = { composition: "Composição", style: "Estilo", content: "Conteúdo" };
    for (const reference of references) {
      const item = el("li", `${groups[reference.group]} · ${reference.label} · ${reference.kind === "file" ? `${reference.bytes} bytes; bytes não lidos` : reference.location}${reference.note ? ` · ${reference.note}` : ""} · não enviada`);
      const remove = el("button", "Remover referência local"); remove.type = "button"; remove.addEventListener("click", () => { references = references.filter(ref => ref.id !== reference.id); renderReferences(); }); item.append(remove); referencesList.append(item);
    }
  };
  const addReference = (value: Omit<ThumbnailReference, "id" | "group" | "note">) => {
    if (references.length >= THUMBNAIL_LAB_LIMITS.references) throw new Error("Limite de 12 referências locais. Remova uma antes de adicionar.");
    references.push({ ...value, id: String(nextReferenceId++), group: group.value as ThumbnailReference["group"], note: note.value }); renderReferences(); status.textContent = "Referência guardada somente em memória; não será enviada nem aplicada.";
  };
  const onFile = () => { try { const selected = file.files?.[0]; if (selected) { if (selected.size > 50 * 1024 * 1024 || selected.name.length > 200) throw new Error("Referência excede 50 MiB ou nome de 200 caracteres."); addReference({ kind: "file", label: selected.name, location: selected.name, bytes: selected.size }); } } catch (error) { status.textContent = error instanceof Error ? error.message : "Referência inválida."; } finally { file.value = ""; } };
  const onUrl = () => { try { const location = thumbnailReferenceUrl(url.value.trim()); addReference({ kind: "url", label: new URL(location).hostname, location }); url.value = ""; } catch (error) { status.textContent = error instanceof Error ? error.message : "URL inválida."; } };
  const onStop = () => { if (running) { history.stopFollowing(running); status.textContent = history.jobs.find(job => job.id === running)!.message; renderHistory(); refreshSelection(); } };
  const onSubmit = async (event: Event) => {
    event.preventDefault(); if (running || disposed) return;
    try {
      const { job, payload } = history.begin(brief(), references, deps.selection()); running = job.id;
      status.textContent = job.message; renderHistory(); refreshSelection();
      try {
        const response = await deps.generate(payload); history.complete(job.id, response);
      } catch (error) { history.fail(job.id, error instanceof Error ? error.message : "Falha ao acompanhar a resposta."); }
      if (!disposed) { status.textContent = job.message; renderHistory(); }
    } catch (error) { if (!disposed) status.textContent = error instanceof Error ? error.message : "Não foi possível preparar o briefing."; }
    finally { running = undefined; if (!disposed) refreshSelection(); }
  };
  const clearAll = () => { if (running) return; form.reset(); file.value = ""; url.value = ""; note.value = ""; references = []; history.clear(); renderReferences(); renderHistory(); refreshPrompt(); status.textContent = "Briefing, referências e histórico em memória foram limpos."; };
  form.addEventListener("submit", onSubmit); form.addEventListener("input", refreshPrompt); file.addEventListener("change", onFile); get("thumbnail-lab-add-url").addEventListener("click", onUrl); stop.addEventListener("click", onStop); clear.addEventListener("click", clearAll);
  refreshPrompt(); refreshSelection();
  return { refreshSelection, clear: clearAll, history, cleanup: () => { disposed = true; if (running) history.stopFollowing(running); form.removeEventListener("submit", onSubmit); form.removeEventListener("input", refreshPrompt); file.removeEventListener("change", onFile); get("thumbnail-lab-add-url").removeEventListener("click", onUrl); stop.removeEventListener("click", onStop); clear.removeEventListener("click", clearAll); section.replaceChildren(); delete section.dataset.thumbnailLabMounted; } };
}
