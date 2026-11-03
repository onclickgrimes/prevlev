import { buildChannelReport, type ManualTranscript, type ReportVideo } from "../core/channel-report";

/** Dedicated empty section; call invalidate whenever the host collection changes. */
export function mountChannelReport(section: HTMLElement, videos: () => readonly ReportVideo[]): { invalidate: () => void; clearInputs: () => void; cleanup: () => void } {
  if (section.dataset.channelReportMounted || section.childNodes.length) throw new Error("Use uma seção vazia para o relatório local.");
  section.dataset.channelReportMounted = "true";
  section.innerHTML = `<div class="card"><h2>Relatório local da amostra</h2>
    <p>Títulos e formatos descrevem somente a coleção atual. Para WPM, informe a transcrição e a duração real do vídeo associado; nenhuma informação é verificada ou enviada.</p>
    <form><label>ID do vídeo <input name="videoId" maxlength="100" autocomplete="off"></label>
    <label>Transcrição fornecida <textarea name="text" rows="6" maxlength="1000000"></textarea></label>
    <label>Duração real do vídeo em segundos (aceita vírgula ou ponto decimal) <input name="duration" inputmode="decimal" autocomplete="off"></label>
    <label>Cobertura declarada para WPM <select name="coverage"><option value="" selected>Escolha a cobertura</option><option value="unknown">Desconhecida</option><option value="partial">Parcial</option><option value="complete">Completa</option></select></label>
    <p>WPM usa as palavras fornecidas divididas pela duração total. Cobertura parcial ou desconhecida não representa o ritmo do vídeo completo.</p>
    <button type="submit">Gerar relatório</button> <button type="reset">Limpar</button></form>
    <p role="status" aria-live="polite">Nenhum relatório gerado.</p><div class="channel-report-result" hidden></div></div>`;
  const form = section.querySelector("form")!, status = section.querySelector<HTMLElement>('[role="status"]')!, result = section.querySelector<HTMLElement>(".channel-report-result")!;
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text: string): HTMLElementTagNameMap[K] => { const n = document.createElement(tag); n.textContent = text; return n; };
  const invalidate = () => { result.hidden = true; result.replaceChildren(); status.textContent = "Dados alterados. Gere o relatório novamente."; };
  const submit = (event: Event) => {
    event.preventDefault(); result.hidden = true; result.replaceChildren();
    try {
      const data = new FormData(form), get = (key: string) => String(data.get(key) ?? ""), id = get("videoId").trim(), text = get("text"), rawDuration = get("duration").trim();
      const duration = /^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(rawDuration) ? Number(rawDuration.replace(",", ".")) : NaN;
      const declaredCoverage = get("coverage");
      const manual: ManualTranscript | undefined = id || text.trim() || rawDuration || declaredCoverage ? { videoId: id, text, durationSeconds: duration, coverage: declaredCoverage as ManualTranscript["coverage"] } : undefined;
      const report = buildChannelReport(videos(), manual), n = (value: number | undefined) => value === undefined ? "desconhecido" : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
      result.append(node("h3", "Amostra e origem"), node("p", `${report.scope.included} de ${report.scope.input} linhas incluídas; ${report.scope.excludedApi} API oficial, ${report.scope.excludedDuplicate} duplicatas e ${report.scope.excludedInvalidId} com ID inválido excluídas. Primeira linha elegível por ID.`), node("p", Object.entries(report.scope.sources).map(([key, count]) => `${key}: ${count}`).join(" · ")));
      result.append(node("h3", "Conteúdo e títulos observados"), node("p", `Shorts: ${report.content.shorts}; não Shorts: ${report.content.nonShorts}; formato desconhecido: ${report.content.unknownFormats}. Duração conhecida: ${report.content.knownDuration}; desconhecida: ${report.content.unknownDuration}.`), node("p", `Títulos conhecidos: ${report.titles.known}; ausentes: ${report.titles.missing}; caracteres médios: ${n(report.titles.meanCharacters)}; títulos com ?: ${report.titles.questionMarks}; com !: ${report.titles.exclamationMarks}.`));
      const list = document.createElement("ul"); for (const term of report.titles.terms) list.append(node("li", `${term.term}: ${term.titles} título(s)`));
      result.append(node("p", "Até 20 termos mecânicos por número de títulos:")); if (report.titles.terms.length) result.append(list); else result.append(node("p", "Nenhum termo disponível."));
      const t = report.transcript, coverage = { complete: "completa", partial: "parcial", unknown: "desconhecida" };
      const precise = (value: number | undefined) => value === undefined ? "desconhecido" : Number(value.toPrecision(8)).toString();
      result.append(node("h3", "Transcrição e WPM"), node("p", t.status === "available" ? `ID informado: ${t.videoId}; origem: fornecida pelo usuário; cobertura declarada: ${t.coverage ? coverage[t.coverage] : "desconhecida"}; ${n(t.words)} palavras / ${precise(t.durationSeconds)} segundos ≈ ${precise(t.wordsPerMinute)} palavras por minuto.` : `Desconhecido: ${t.reason}`));
      result.append(node("h3", "Limites")); const limitations = document.createElement("ul"); for (const item of report.limitations) limitations.append(node("li", item)); result.append(limitations);
      result.hidden = false; status.textContent = "Relatório gerado em memória.";
    } catch (error) { status.textContent = error instanceof Error ? error.message : "Não foi possível gerar o relatório."; }
  };
  const reset = () => { result.hidden = true; result.replaceChildren(); status.textContent = "Dados e relatório em memória foram limpos."; };
  form.addEventListener("submit", submit); form.addEventListener("input", invalidate); form.addEventListener("change", invalidate); form.addEventListener("reset", reset);
  return { invalidate, clearInputs: () => form.reset(), cleanup: () => { form.removeEventListener("submit", submit); form.removeEventListener("input", invalidate); form.removeEventListener("change", invalidate); form.removeEventListener("reset", reset); section.replaceChildren(); delete section.dataset.channelReportMounted; } };
}
