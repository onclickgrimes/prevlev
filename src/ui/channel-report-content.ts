import type { ReportVideo } from "../core/channel-report";
import {
  REPORT_GROUPS, MAX_REPORT_ANNOTATIONS, MAX_REPORT_DRAFT_BYTES,
  channelReportContext, channelReportTargets, parseReportDraft, serializeReportDraft, validateReportAnnotation,
  type ReportAnnotation, type StructuredChannelReport,
} from "../core/channel-report-content";

export function downloadChannelReport(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type })), link = document.createElement("a");
  link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** All material stays in memory. Source text is copied only by paste or explicit button. */
export function mountReportAnnotations(container: HTMLElement, videos: () => readonly ReportVideo[], transcript: () => { videoId: string; text: string; coverage: string }, changed: () => void) {
  const section = document.createElement("section"); section.className = "channel-report-annotations";
  section.innerHTML = `<h3>Grupos com material declarado</h3><p>Organize conteúdo, nicho, estratégia, feedback, performance declarada, tópicos, roteiro e etapas. Nada é deduzido dos títulos. Cada anotação exige alvo elegível, origem e cobertura declaradas. Um trecho literal comprova apenas presença no texto fornecido, não autenticidade ou interpretação.</p>
    <form class="channel-report-entry-form"><label>Grupo <select name="group"></select></label>
    <label>Vídeo ou canal da amostra <select name="target"><option value="">Escolha um alvo elegível</option></select></label>
    <label class="channel-report-channel-ids" hidden>IDs desse canal associados à anotação (separados por espaço ou vírgula) <textarea name="targetIds" rows="2" maxlength="10000"></textarea></label>
    <label>Anotação ou interpretação declarada <textarea name="statement" rows="3" maxlength="2000"></textarea></label>
    <label>Cobertura do material ou declaração <select name="coverage"><option value="">Escolha a cobertura</option><option value="unknown">Desconhecida</option><option value="partial">Parcial</option><option value="complete">Completa no material fornecido</option></select></label>
    <label>Base da anotação <select name="sourceKind"><option value="declaration">Declaração do usuário, sem evidência verificada</option><option value="material">Trecho de material fornecido</option><option value="transcript">Trecho de transcrição fornecida</option><option value="comments">Trecho de comentários fornecidos</option></select></label>
    <label>Origem declarada <select name="origin"><option value="user-provided">Fornecida pelo usuário</option><option value="youtube-dom">DOM do YouTube informado pelo usuário</option><option value="public-page">Página pública informada pelo usuário</option></select></label>
    <label>Referência da origem (ex.: arquivo, vídeo, comentário ou declaração própria) <input name="sourceLabel" maxlength="300"></label>
    <div class="channel-report-evidence" hidden><label>Material fornecido (até 6000 caracteres, não autenticado) <textarea name="sourceText" rows="5" maxlength="6000"></textarea></label><label>Trecho literal presente nesse material (até 600 caracteres) <textarea name="quote" rows="3" maxlength="600"></textarea></label></div>
    <p>Para canal, use somente um channelId explícito e declare os IDs associados. “Completa” refere-se ao material fornecido, sem comprovar catálogo ou análise integral do canal. Não inclua material da API oficial neste relatório derivado.</p>
    <button type="button" class="channel-report-use-transcript">Usar transcrição informada acima como material</button>
    <button type="submit" class="channel-report-save-entry">Adicionar anotação</button> <button type="reset">Limpar campos da anotação</button></form>
    <button type="button" class="channel-report-review-context" hidden>Revisar e reassociar anotações à amostra atual</button>
    <p class="channel-report-entry-status" role="status">Nenhuma anotação fornecida. Grupos sem dado ficarão desconhecidos.</p><ul class="channel-report-entry-list"></ul>
    <p>Até 32 anotações em memória. Nenhum dado é salvo automaticamente. O backup inclui o material completo informado; exports de relatório incluem apenas os trechos.</p>
    <button type="button" class="channel-report-draft-export">Baixar backup das anotações</button>
    <label>Restaurar backup JSON da mesma amostra (até 256 KiB) <input class="channel-report-draft-import" type="file" accept="application/json,.json"></label>`;
  container.append(section);
  const form = section.querySelector<HTMLFormElement>("form")!, field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const status = section.querySelector<HTMLElement>(".channel-report-entry-status")!, list = section.querySelector<HTMLUListElement>("ul")!;
  const save = section.querySelector<HTMLButtonElement>(".channel-report-save-entry")!, review = section.querySelector<HTMLButtonElement>(".channel-report-review-context")!;
  const group = field("group") as unknown as HTMLSelectElement, target = field("target") as unknown as HTMLSelectElement;
  for (const item of REPORT_GROUPS) { const option = document.createElement("option"); option.value = item.id; option.textContent = item.label; group.append(option); }
  let entries: ReportAnnotation[] = [], editing: string | undefined, context = channelReportContext(videos()), boundVideos = videos().map(video => ({ ...video })), stale = false, sequence = 0, alive = true;
  function message(error: unknown) { status.textContent = error instanceof Error ? error.message : String(error); }
  function updateFields() {
    section.querySelector<HTMLElement>(".channel-report-evidence")!.hidden = field("sourceKind").value === "declaration";
    section.querySelector<HTMLElement>(".channel-report-channel-ids")!.hidden = !target.value.startsWith("channel:");
  }
  function targets() {
    const previous = target.value, available = channelReportTargets(videos()); target.replaceChildren();
    const add = (value: string, label: string) => { const option = document.createElement("option"); option.value = value; option.textContent = label; target.append(option); };
    add("", "Escolha um alvo elegível");
    for (const video of available.videos) add(`video:${video.id}`, `${video.id} · ${typeof video.title === "string" ? video.title.slice(0, 80) : "Título desconhecido"}`);
    for (const channel of available.channels) add(`channel:${channel.id}`, `Canal ${channel.id} · ${channel.videoIds.length} IDs elegíveis`);
    target.value = previous; updateFields();
  }
  function refresh() {
    const next = channelReportContext(videos());
    if (next !== context) {
      if (entries.length) {
        stale = true; review.hidden = false; save.disabled = true;
        status.textContent = "A amostra mudou. As anotações foram preservadas, mas exigem revisão e reassociação explícita antes de preparar o relatório. Remova alvos que deixaram de ser elegíveis ou limpe os dados.";
      } else { context = next; boundVideos = videos().map(video => ({ ...video })); stale = false; review.hidden = true; save.disabled = false; }
    }
    targets();
  }
  function markChanged() { sequence++; changed(); }
  function renderEntries() {
    list.replaceChildren();
    for (const entry of entries) {
      const row = document.createElement("li"), description = document.createElement("p"), label = REPORT_GROUPS.find(group => group.id === entry.group)!.label;
      description.textContent = `${label}: ${entry.statement} · ${entry.target.kind} ${entry.target.id} · cobertura ${entry.coverage} · ${entry.source.label}`;
      const edit = document.createElement("button"); edit.type = "button"; edit.textContent = "Editar anotação";
      edit.addEventListener("click", () => {
        refresh(); editing = entry.id;
        for (const [name, value] of Object.entries({ group: entry.group, target: `${entry.target.kind}:${entry.target.id}`, targetIds: entry.target.kind === "channel" ? entry.target.videoIds.join(", ") : "", statement: entry.statement, coverage: entry.coverage, sourceKind: entry.source.kind, origin: entry.source.origin, sourceLabel: entry.source.label, sourceText: entry.source.kind === "declaration" ? "" : entry.source.text, quote: entry.source.kind === "declaration" ? "" : entry.source.quote })) field(name).value = value;
        save.textContent = "Atualizar anotação"; updateFields(); markChanged();
      });
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remover anotação";
      remove.addEventListener("click", () => { entries = entries.filter(item => item.id !== entry.id); if (editing === entry.id) form.reset(); refresh(); renderEntries(); markChanged(); });
      row.append(description, edit, remove); list.append(row);
    }
  }
  const submit = (event: Event) => {
    event.preventDefault(); refresh();
    try {
      if (stale) throw new Error("Revise a associação das anotações à amostra atual antes de editar ou adicionar.");
      if (!editing && entries.length >= MAX_REPORT_ANNOTATIONS) throw new Error(`Limite de ${MAX_REPORT_ANNOTATIONS} anotações atingido.`);
      const value = target.value, kind = value.split(":")[0], id = value.slice(kind.length + 1), sourceKind = field("sourceKind").value;
      const candidate = validateReportAnnotation({
        id: editing ?? `entry-${Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("")}`, group: field("group").value,
        target: { kind, id, ...(kind === "channel" ? { videoIds: field("targetIds").value.split(/[\s,;]+/).filter(Boolean) } : {}) },
        statement: field("statement").value, coverage: field("coverage").value,
        source: { kind: sourceKind, origin: field("origin").value, label: field("sourceLabel").value, ...(sourceKind === "declaration" ? {} : { text: field("sourceText").value, quote: field("quote").value }) },
      }, videos());
      entries = editing ? entries.map(entry => entry.id === editing ? candidate : entry) : [...entries, candidate];
      form.reset(); renderEntries(); markChanged(); status.textContent = `${entries.length} anotações em memória. Prepare o relatório para incluir os grupos declarados.`;
    } catch (error) { message(error); }
  };
  const input = () => { updateFields(); markChanged(); };
  const reset = () => { editing = undefined; save.textContent = "Adicionar anotação"; queueMicrotask(() => { if (alive) updateFields(); }); markChanged(); };
  const reviewContext = () => {
    try {
      entries = entries.map(entry => validateReportAnnotation(entry, videos())); context = channelReportContext(videos()); boundVideos = videos().map(video => ({ ...video })); stale = false; review.hidden = true; save.disabled = false;
      markChanged(); status.textContent = "Associação e cobertura reafirmadas por você na amostra atual. Prepare o relatório novamente.";
    } catch (error) { message(error); }
  };
  const useTranscript = () => {
    try {
      refresh(); if (stale) throw new Error("Revise primeiro a associação à amostra atual.");
      const supplied = transcript();
      if (!channelReportTargets(videos()).videos.some(video => video.id === supplied.videoId) || !supplied.text.trim()) throw new Error("Informe acima uma transcrição associada a um ID elegível antes de usar como material.");
      if (supplied.text.length > 6000) throw new Error("A transcrição excede 6000 caracteres. Cole manualmente um trecho delimitado e declare cobertura parcial.");
      target.value = `video:${supplied.videoId}`; field("sourceKind").value = "transcript"; field("origin").value = "user-provided"; field("sourceText").value = supplied.text; field("quote").value = "";
      field("sourceLabel").value = `Transcrição fornecida no formulário WPM para ${supplied.videoId}`; field("coverage").value = supplied.coverage;
      updateFields(); markChanged(); status.textContent = "Material copiado por sua ação. Escolha grupo, anotação e trecho literal; nenhuma análise foi executada.";
    } catch (error) { message(error); }
  };
  const backup = () => { try { downloadChannelReport(serializeReportDraft(boundVideos, entries), "prevlev-anotacoes-relatorio.json", "application/json"); } catch (error) { message(error); } };
  const importer = section.querySelector<HTMLInputElement>(".channel-report-draft-import")!;
  const importDraft = () => {
    const file = importer.files?.[0]; if (!file) return;
    importer.value = "";
    refresh(); const initialContext = channelReportContext(videos()), token = ++sequence;
    changed();
    void (async () => {
      if (file.size > MAX_REPORT_DRAFT_BYTES) throw new Error("Backup excede 256 KiB.");
      const value = await file.text();
      if (!alive || token !== sequence || initialContext !== channelReportContext(videos())) { status.textContent = "Importação descartada porque os dados ou a amostra mudaram."; return; }
      const restored = parseReportDraft(value, videos());
      entries = restored; context = initialContext; boundVideos = videos().map(video => ({ ...video })); stale = false; review.hidden = true; save.disabled = false; form.reset(); renderEntries(); markChanged();
      status.textContent = `${entries.length} anotações restauradas em memória. Prepare o relatório para revisar.`;
    })().catch(error => { if (alive && token === sequence) message(error); });
  };
  form.addEventListener("submit", submit); form.addEventListener("input", input); form.addEventListener("change", input); form.addEventListener("reset", reset);
  review.addEventListener("click", reviewContext);
  section.querySelector(".channel-report-use-transcript")!.addEventListener("click", useTranscript);
  section.querySelector(".channel-report-draft-export")!.addEventListener("click", backup); importer.addEventListener("change", importDraft);
  refresh();
  return {
    entries: () => { refresh(); if (stale) throw new Error("Amostra alterada: revise e reassocie as anotações antes de preparar o relatório."); return entries.map(entry => validateReportAnnotation(entry, videos())); },
    refresh,
    clear: () => { entries = []; stale = false; context = channelReportContext(videos()); boundVideos = videos().map(video => ({ ...video })); review.hidden = true; save.disabled = false; form.reset(); renderEntries(); status.textContent = "Anotações e material em memória foram limpos."; },
    cleanup: () => { alive = false; sequence++; section.remove(); },
  };
}

export function renderReportGroups(report: StructuredChannelReport, container: HTMLElement) {
  const paragraph = (text: string) => { const p = document.createElement("p"); p.textContent = text; return p; };
  for (const group of report.structured.groups) {
    const section = document.createElement("section"), heading = document.createElement("h3"); heading.textContent = group.label; section.dataset.reportGroup = group.id;
    section.append(heading, paragraph(group.status === "unknown" ? `Desconhecido: ${group.reason}` : `Material declarado disponível; IDs associados: ${group.coverage.referencedVideos}/${group.coverage.eligibleVideos}. A cobertura do material não foi verificada.`));
    for (const entry of group.entries) {
      section.append(paragraph(entry.statement), paragraph(`Alvo: ${entry.target.kind} ${entry.target.id}; IDs associados: ${entry.referencedVideoIds.join(", ")}; cobertura declarada: ${entry.coverage}.`), paragraph(`Origem declarada: ${entry.source.label} (${entry.source.origin}, ${entry.source.kind}). ${entry.verification === "literal-match-only" ? "Verificado apenas que o trecho aparece no material fornecido." : "Declaração do usuário sem verificação."}`));
      if (entry.source.quote) { const quote = document.createElement("blockquote"); quote.textContent = entry.source.quote; section.append(quote); }
    }
    container.append(section);
  }
  if (report.structured.rejected.length) container.append(paragraph(`${report.structured.rejected.length} anotações recusadas: ${report.structured.rejected.map(issue => `${issue.index + 1}: ${issue.reason}`).join(" · ")}`));
}
