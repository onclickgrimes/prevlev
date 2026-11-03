import type { CommentRecord, PageSnapshot } from "../shared/types";
import { selectComments, describeCommentScope, commentRows, commentsText, type CommentFilterOptions } from "../core/comments";
import { toCsv } from "../core/export";
import { downloadBlob } from "../core/media";

export function initCommentTools(deps: { snapshot: () => PageSnapshot; onAi: () => Promise<void> }): { currentComments: () => CommentRecord[]; render: () => void } {
  const section = document.getElementById("comments");
  if (!section) throw new Error("A seção de comentários não está disponível.");
  section.innerHTML = `
    <div class="card"><span class="eyebrow">COMENTÁRIOS CARREGADOS</span><h2>Filtrar comentários</h2>
      <p>Explore os comentários já coletados. Copiar e exportar usam somente o resultado atual dos filtros.</p>
      <div class="form-grid">
        <label>Texto do comentário<input id="comment-filter" placeholder="Palavra ou trecho"></label>
        <label>Autor<input id="comment-author" placeholder="Nome ou trecho do autor"></label>
        <label>Curtidas mínimas<input id="comment-likes" type="number" min="0" step="1" placeholder="Sem mínimo"></label>
        <label>Curtidas máximas<input id="comment-max-likes" type="number" min="0" step="1" placeholder="Sem máximo"></label>
        <label>Respostas mínimas<input id="comment-replies-min" type="number" min="0" step="1" placeholder="Sem mínimo"></label>
        <label>Respostas máximas<input id="comment-replies-max" type="number" min="0" step="1" placeholder="Sem máximo"></label>
        <label>Tem respostas?<select id="comment-replies-state"><option value="any">Qualquer estado</option><option value="yes">Com respostas conhecidas</option><option value="no">Sem respostas (zero conhecido)</option></select></label>
        <label>Coração do criador<select id="comment-hearted"><option value="any">Qualquer estado</option><option value="yes">Com coração conhecido</option><option value="no">Sem coração conhecido</option></select></label>
        <label>Ordenação<select id="comment-sort"><option value="default">Ordem da coleta</option><option value="likes">Mais curtidas conhecidas</option><option value="replies">Mais respostas conhecidas</option></select></label>
      </div>
      <label class="check"><input id="comment-questions" type="checkbox"> Com ? ou ？ (perguntas por pontuação)</label>
      <p id="comments-count" aria-live="polite"></p><p id="comments-error" role="status" aria-live="polite"></p>
      <div class="row"><button id="comments-copy">Copiar filtrados</button><button id="comments-export">Exportar CSV</button><button id="comments-export-json">Exportar JSON</button><button id="comments-reset">Limpar filtros</button><button id="comments-ai">Analisar filtrados com IA no backend</button></div>
      <p>A análise com IA só é solicitada pelo botão e mantém as configurações e confirmações da conexão.</p>
    </div>
    <div class="card"><h3>Escopo e confiança dos dados</h3><p id="comments-scope"></p><ul id="comments-limitations"></ul></div>
    <div id="comment-list"></div>`;
  const get = <T extends HTMLElement = HTMLElement>(id: string) => section.querySelector<T>(`#${id}`)!;
  const input = (id: string) => get<HTMLInputElement>(id).value;
  const count = (id: string) => input(id).trim() ? Number(input(id)) : undefined;
  const selected = (): CommentRecord[] => selectComments(deps.snapshot().comments, readFilter());
  const status = get("comments-error");
  let aiRunning = false;
  function readFilter(): CommentFilterOptions {
    return { query: input("comment-filter"), author: input("comment-author"), questionsOnly: get<HTMLInputElement>("comment-questions").checked, minLikes: count("comment-likes"), maxLikes: count("comment-max-likes"), minReplies: count("comment-replies-min"), maxReplies: count("comment-replies-max"), replies: input("comment-replies-state") as CommentFilterOptions["replies"], hearted: input("comment-hearted") as CommentFilterOptions["hearted"], sort: input("comment-sort") as CommentFilterOptions["sort"] };
  }
  function setStatus(message: string, error = false): void { status.textContent = message; status.classList.toggle("error", error); }
  function render(): void {
    const loaded = deps.snapshot().comments;
    try {
      const comments = selected();
      const scope = describeCommentScope(loaded, comments);
      setStatus("");
      get("comments-count").textContent = `${scope.selectedCount} de ${scope.loadedCount} comentários carregados correspondem aos filtros.`;
      get("comments-scope").textContent = `No resultado: curtidas conhecidas em ${scope.knownLikes}/${scope.selectedCount}; respostas conhecidas em ${scope.knownReplies}/${scope.selectedCount}; coração conhecido em ${scope.knownHearts}/${scope.selectedCount}; identidades locais por fingerprint: ${scope.fingerprintCount}.`;
      get("comments-limitations").replaceChildren(...scope.limitations.map(text => element("li", text)));
      get("comment-list").replaceChildren(...comments.map(comment => {
        const card = element("article"); card.className = "comment";
        card.append(element("strong", comment.author || "Autor desconhecido"), element("p", comment.text), element("small", `${known(comment.likes)} curtidas · ${known(comment.replies)} respostas · ${comment.hearted === true ? "com coração conhecido" : comment.hearted === false ? "sem coração conhecido" : "coração desconhecido"}`));
        return card;
      }));
      if (!comments.length) get("comment-list").append(element("p", "Nenhum comentário carregado corresponde ao filtro."));
      for (const id of ["comments-copy", "comments-export", "comments-export-json"]) get<HTMLButtonElement>(id).disabled = comments.length === 0;
    } catch (error) {
      get("comment-list").replaceChildren();
      get("comments-count").textContent = `Filtros inválidos; ${loaded.length} comentários continuam na coleção.`;
      get("comments-scope").textContent = "Corrija os limites para visualizar, copiar ou exportar a amostra.";
      setStatus(error instanceof Error ? error.message : "Não foi possível aplicar os filtros.", true);
      for (const id of ["comments-copy", "comments-export", "comments-export-json"]) get<HTMLButtonElement>(id).disabled = true;
    }
  }
  for (const field of section.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select")) { field.addEventListener("input", render); field.addEventListener("change", render); }
  get("comments-reset").addEventListener("click", () => {
    for (const field of section.querySelectorAll<HTMLInputElement>("input")) { field.value = ""; if (field.type === "checkbox") field.checked = false; }
    get<HTMLSelectElement>("comment-replies-state").value = "any"; get<HTMLSelectElement>("comment-hearted").value = "any"; get<HTMLSelectElement>("comment-sort").value = "default";
    render();
  });
  get("comments-copy").addEventListener("click", () => {
    void Promise.resolve().then(async () => { const comments = selected(); if (!comments.length) throw new Error("Nenhum comentário filtrado para copiar."); await navigator.clipboard.writeText(commentsText(comments)); setStatus(`${comments.length} comentários filtrados copiados.`); }).catch(error => setStatus(error instanceof Error ? error.message : "Não foi possível copiar.", true));
  });
  const exportComments = (json: boolean) => {
    try {
      const comments = selected(); if (!comments.length) throw new Error("Nenhum comentário filtrado para exportar.");
      const content = json ? JSON.stringify({ source: "loaded-comments", filters: readFilter(), scope: describeCommentScope(deps.snapshot().comments, comments), comments }, null, 2) : toCsv(commentRows(comments));
      downloadBlob(new Blob([content], { type: json ? "application/json" : "text/csv;charset=utf-8" }), `prevlev-comentarios.${json ? "json" : "csv"}`);
      setStatus(`${comments.length} comentários filtrados exportados.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Não foi possível exportar.", true); }
  };
  get("comments-export").addEventListener("click", () => exportComments(false));
  get("comments-export-json").addEventListener("click", () => exportComments(true));
  get("comments-ai").addEventListener("click", () => {
    if (aiRunning) return;
    void Promise.resolve().then(async () => {
      if (!selected().length) throw new Error("Nenhum comentário filtrado para analisar.");
      aiRunning = true; get("comments-ai").setAttribute("aria-busy", "true");
      try { await deps.onAi(); } finally { aiRunning = false; get("comments-ai").removeAttribute("aria-busy"); }
    }).catch(error => setStatus(error instanceof Error ? error.message : "Não foi possível solicitar a análise.", true));
  });
  render();
  return { currentComments: selected, render };
}
function known(value: number | undefined): string { return value === undefined ? "desconhecidas" : new Intl.NumberFormat("pt-BR").format(value); }
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; }
