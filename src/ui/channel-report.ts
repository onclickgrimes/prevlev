import type { ManualTranscript, ReportVideo } from "../core/channel-report";
import { buildStructuredChannelReport, channelReportContext, channelReportCsv, channelReportJson, channelReportMarkdown, type StructuredChannelReport } from "../core/channel-report-content";
import { downloadChannelReport, mountReportAnnotations, renderReportGroups } from "./channel-report-content";

/** Dedicated empty section; call invalidate whenever the host collection changes. */
export function mountChannelReport(section: HTMLElement, videos: () => readonly ReportVideo[]): { invalidate: () => void; clearInputs: () => void; cleanup: () => void } {
  if (section.dataset.channelReportMounted || section.childNodes.length) throw new Error("Use uma seção vazia para o relatório local.");
  section.dataset.channelReportMounted = "true";
  section.innerHTML = `<div class="card"><h2>Relatório local da amostra</h2>
    <p>Títulos e formatos descrevem somente a coleção atual. Para WPM, informe a transcrição e a duração real do vídeo associado; nenhuma informação é verificada ou enviada.</p>
    <form class="channel-report-mechanical-form"><label>ID do vídeo <input name="videoId" maxlength="100" autocomplete="off"></label>
    <label>Transcrição fornecida <textarea name="text" rows="6" maxlength="1000000"></textarea></label>
    <label>Duração real do vídeo em segundos (aceita vírgula ou ponto decimal) <input name="duration" inputmode="decimal" autocomplete="off"></label>
    <label>Cobertura declarada para WPM <select name="coverage"><option value="" selected>Escolha a cobertura</option><option value="unknown">Desconhecida</option><option value="partial">Parcial</option><option value="complete">Completa</option></select></label>
    <p>WPM usa as palavras fornecidas divididas pela duração total. Cobertura parcial ou desconhecida não representa o ritmo do vídeo completo.</p>
    <button type="submit">Gerar relatório</button> <button type="reset">Limpar</button></form>
    <p class="channel-report-status" role="status" aria-live="polite">Nenhum relatório gerado.</p><div class="channel-report-result" hidden></div>
    <div class="channel-report-exports"><button type="button" data-channel-report-export="json" disabled>Exportar relatório JSON</button><button type="button" data-channel-report-export="csv" disabled>Exportar relatório CSV</button><button type="button" data-channel-report-export="md" disabled>Exportar relatório Markdown</button></div></div>`;
  const form = section.querySelector("form")!, status = section.querySelector<HTMLElement>('[role="status"]')!, result = section.querySelector<HTMLElement>(".channel-report-result")!;
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text: string): HTMLElementTagNameMap[K] => { const n = document.createElement(tag); n.textContent = text; return n; };
  const exportButtons = [...section.querySelectorAll<HTMLButtonElement>("[data-channel-report-export]")];
  let prepared: StructuredChannelReport | undefined, preparedInputs = "", alive = true;
  const inputStamp = () => JSON.stringify([...new FormData(form)]);
  const clearResult = () => { prepared = undefined; result.hidden = true; result.replaceChildren(); for (const button of exportButtons) button.disabled = true; };
  const changed = () => { clearResult(); status.textContent = "Dados alterados. Gere o relatório novamente."; };
  const editorContainer = document.createElement("div"); form.after(editorContainer);
  const annotations = mountReportAnnotations(editorContainer, videos, () => ({ videoId: String(new FormData(form).get("videoId") ?? "").trim(), text: String(new FormData(form).get("text") ?? ""), coverage: String(new FormData(form).get("coverage") ?? "") }), changed);
  const invalidate = () => { changed(); annotations.refresh(); };
  const submit = (event: Event) => {
    event.preventDefault(); clearResult();
    try {
      const data = new FormData(form), get = (key: string) => String(data.get(key) ?? ""), id = get("videoId").trim(), text = get("text"), rawDuration = get("duration").trim();
      const duration = /^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(rawDuration) ? Number(rawDuration.replace(",", ".")) : NaN;
      const declaredCoverage = get("coverage");
      const manual: ManualTranscript | undefined = id || text.trim() || rawDuration || declaredCoverage ? { videoId: id, text, durationSeconds: duration, coverage: declaredCoverage as ManualTranscript["coverage"] } : undefined;
      const report = buildStructuredChannelReport(videos(), annotations.entries(), manual), n = (value: number | undefined) => value === undefined ? "desconhecido" : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
      result.append(node("h3", "Amostra e origem"), node("p", `${report.scope.included} de ${report.scope.input} linhas incluídas; ${report.scope.excludedApi} API oficial, ${report.scope.excludedDuplicate} duplicatas e ${report.scope.excludedInvalidId} com ID inválido excluídas. Primeira linha elegível por ID.`), node("p", Object.entries(report.scope.sources).map(([key, count]) => `${key}: ${count}`).join(" · ")));
      result.append(node("h3", "Conteúdo e títulos observados"), node("p", `Shorts: ${report.content.shorts}; não Shorts: ${report.content.nonShorts}; formato desconhecido: ${report.content.unknownFormats}. Duração conhecida: ${report.content.knownDuration}; desconhecida: ${report.content.unknownDuration}.`), node("p", `Títulos conhecidos: ${report.titles.known}; ausentes: ${report.titles.missing}; caracteres médios: ${n(report.titles.meanCharacters)}; títulos com ?: ${report.titles.questionMarks}; com !: ${report.titles.exclamationMarks}.`));
      const list = document.createElement("ul"); for (const term of report.titles.terms) list.append(node("li", `${term.term}: ${term.titles} título(s)`));
      result.append(node("p", "Até 20 termos mecânicos por número de títulos:")); if (report.titles.terms.length) result.append(list); else result.append(node("p", "Nenhum termo disponível."));
      const t = report.transcript, coverage = { complete: "completa", partial: "parcial", unknown: "desconhecida" };
      const precise = (value: number | undefined) => value === undefined ? "desconhecido" : Number(value.toPrecision(8)).toString();
      result.append(node("h3", "Transcrição e WPM"), node("p", t.status === "available" ? `ID informado: ${t.videoId}; origem: fornecida pelo usuário; cobertura declarada: ${t.coverage ? coverage[t.coverage] : "desconhecida"}; ${n(t.words)} palavras / ${precise(t.durationSeconds)} segundos ≈ ${precise(t.wordsPerMinute)} palavras por minuto.` : `Desconhecido: ${t.reason}`));
      renderReportGroups(report, result);
      result.append(node("h3", "Limites")); const limitations = document.createElement("ul"); for (const item of report.limitations) limitations.append(node("li", item)); result.append(limitations);
      prepared = report; preparedInputs = inputStamp(); for (const button of exportButtons) button.disabled = false;
      result.hidden = false; status.textContent = "Relatório gerado em memória. Grupos sem material permanecem desconhecidos.";
    } catch (error) { status.textContent = error instanceof Error ? error.message : "Não foi possível gerar o relatório."; }
  };
  const reset = () => { clearResult(); annotations.clear(); status.textContent = "Dados e relatório em memória foram limpos."; };
  const exportReport = (event: Event) => {
    try {
      if (!prepared || prepared.structured.context !== channelReportContext(videos()) || preparedInputs !== inputStamp()) { invalidate(); throw new Error("Dados alterados. Gere o relatório novamente antes de exportar."); }
      const format = (event.currentTarget as HTMLButtonElement).dataset.channelReportExport;
      const value = format === "json" ? channelReportJson(prepared) : format === "csv" ? channelReportCsv(prepared) : channelReportMarkdown(prepared);
      downloadChannelReport(value, `prevlev-relatorio-amostra.${format}`, format === "json" ? "application/json" : format === "csv" ? "text/csv;charset=utf-8" : "text/markdown;charset=utf-8");
      status.textContent = `Relatório ${format?.toUpperCase()} exportado por sua ação. Material completo não está incluído, apenas os trechos.`;
    } catch (error) { status.textContent = error instanceof Error ? error.message : "Não foi possível exportar."; }
  };
  for (const button of exportButtons) button.addEventListener("click", exportReport);
  form.addEventListener("submit", submit); form.addEventListener("input", invalidate); form.addEventListener("change", invalidate); form.addEventListener("reset", reset);
  return { invalidate, clearInputs: () => form.reset(), cleanup: () => { if (!alive) return; alive = false; annotations.cleanup(); for (const button of exportButtons) button.removeEventListener("click", exportReport); form.removeEventListener("submit", submit); form.removeEventListener("input", invalidate); form.removeEventListener("change", invalidate); form.removeEventListener("reset", reset); section.replaceChildren(); delete section.dataset.channelReportMounted; } };
}
