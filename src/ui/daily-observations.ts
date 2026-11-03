import { buildDailyReport, dailyReportCsv, dailyReportJson, dailyReportMarkdown, type DailyEntry, type DailyInput, type DailyReport } from "../core/daily-observations";
import { downloadBlob } from "../core/media";

/** Call with a dedicated empty section. Returns cleanup; no network or storage is used. */
export function mountDailyObservations(section: HTMLElement): () => void {
  if (section.dataset.dailyMounted) throw new Error("As observações diárias já foram montadas neste elemento.");
  section.dataset.dailyMounted = "true";
  section.innerHTML = `<div class="card"><h2>Observações diárias informadas por você</h2>
    <p>Informe contagens do período escolhido. Os valores são fornecidos por você e não são verificados. O relatório fica nesta página até você exportá-lo; não consulta contas nem envia dados.</p>
    <p>Arquivos exportados ficam no dispositivo após limpar ou fechar esta página e podem conter identidade do canal, descrição da fonte e contagens privadas.</p>
    <form id="daily-form"><label>Identidade do canal <input name="channelId" required maxlength="100" autocomplete="off"></label>
    <label>Data do período <input name="date" type="date" required></label>
    <label>Fuso IANA <input name="timeZone" required placeholder="America/Sao_Paulo" autocomplete="off"></label>
    <label>Período <select name="completion"><option value="partial">Parcial</option><option value="complete">Dia completo</option></select></label>
    <label>Parcial: instante de referência UTC <input name="asOf" placeholder="2026-11-03T12:00:00Z" autocomplete="off"></label>
    <p>Para um período parcial, informe o mesmo instante de referência para todos os valores, em UTC com segundos e Z. Para dia completo, a liberação aguarda 48 horas após 00:00 UTC da data informada (24 horas para UTC), pois um dia pode se repetir em mudanças de fuso.</p>
    <label>Descrição informada da fonte (opcional) <input name="sourceDescription" maxlength="200" autocomplete="off"></label>
    <label>Views do canal no período (vazio = desconhecido) <input name="channelViews" inputmode="numeric" autocomplete="off"></label>
    <label>Vídeos, uma linha por ID: <code>ID,views</code>. Deixe views vazias quando desconhecidas. <textarea name="videos" rows="6" placeholder="video_a,120&#10;video_b,0&#10;video_c,"></textarea></label>
    <button type="submit">Gerar relatório</button> <button type="reset">Limpar</button></form>
    <p id="daily-status" role="status" aria-live="polite">Nenhum relatório gerado.</p><div class="row"><button id="daily-json" type="button" disabled>Exportar JSON</button><button id="daily-csv" type="button" disabled>Exportar CSV</button><button id="daily-markdown" type="button" disabled>Exportar Markdown</button></div><div id="daily-result" hidden></div></div>`;
  const form = section.querySelector<HTMLFormElement>("#daily-form")!;
  const status = section.querySelector<HTMLElement>("#daily-status")!;
  const result = section.querySelector<HTMLElement>("#daily-result")!;
  const formats = ["json", "csv", "markdown"] as const;
  const exports = formats.map(format => section.querySelector<HTMLButtonElement>(`#daily-${format}`)!);
  let report: DailyReport | undefined;
  const clearReport = () => { report = undefined; result.hidden = true; result.replaceChildren(); for (const button of exports) button.disabled = true; };
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text: string): HTMLElementTagNameMap[K] => { const node = document.createElement(tag); node.textContent = text; return node; };
  const parseCount = (value: string): number | undefined => {
    const trimmed = value.trim(); if (!trimmed) return undefined;
    if (!/^\d+$/.test(trimmed)) throw new Error("Views devem ser inteiros não negativos ou ficar vazias.");
    const parsed = Number(trimmed); if (!Number.isSafeInteger(parsed)) throw new Error("Contagem fora do intervalo seguro."); return parsed;
  };
  const invalidate = () => { clearReport(); status.textContent = "Dados alterados. Gere o relatório novamente."; };
  const submit = (event: Event) => {
    event.preventDefault(); clearReport();
    try {
      const data = new FormData(form), value = (key: string) => String(data.get(key) ?? "").trim();
      const raw = value("videos"), videos: DailyEntry[] = raw ? raw.split(/\r?\n/).map(line => {
        const parts = line.split(","); if (parts.length !== 2) throw new Error("Use uma linha por vídeo no formato ID,views; deixe views vazias se desconhecidas.");
        return { videoId: parts[0].trim(), views: parseCount(parts[1]) };
      }) : [];
      const completion = value("completion") as DailyInput["completion"];
      const next = buildDailyReport({ channelId: value("channelId"), date: value("date"), timeZone: value("timeZone"), completion, asOf: value("asOf") || undefined, sourceDescription: value("sourceDescription") || undefined, channelViews: parseCount(value("channelViews")), videos });
      const report = next;
      const fmt = (n: number | undefined) => n === undefined ? "desconhecido" : new Intl.NumberFormat("pt-BR").format(n);
      result.append(element("p", `Canal: ${report.channelId} · Data: ${report.date} · Fuso: ${report.timeZone} · ${report.completion === "partial" ? `parcial até ${report.asOf} UTC` : "dia completo"}.`));
      result.append(element("p", `Origem: fornecido pelo usuário${report.sourceDescription ? `; descrição informada: ${report.sourceDescription}` : ""}. A origem e os valores não foram verificados.`));
      result.append(element("p", `Views do canal no período: ${fmt(report.channelViews)}.`));
      result.append(element("p", `Vídeos informados: ${report.coverage.uniqueVideos}; contagens conhecidas: ${report.coverage.known}; desconhecidas: ${report.coverage.unknown}; conflitos: ${report.coverage.conflicts}. A lista cobre apenas vídeos informados.`));
      result.append(element("h3", "Vídeos informados por views no período"));
      const list = document.createElement("ol"); for (const row of report.ranking) list.append(element("li", `${row.videoId}: ${fmt(row.views)}${row.occurrences > 1 ? ` (${row.occurrences} linhas idênticas)` : ""}`));
      if (report.ranking.length) result.append(list); else result.append(element("p", "Nenhuma contagem de vídeo conhecida e sem conflito."));
      const unresolved = report.videos.filter(row => row.views === undefined);
      if (unresolved.length) { result.append(element("h3", "Vídeos sem valor utilizável")); const items = document.createElement("ul"); for (const row of unresolved) items.append(element("li", `${row.videoId}: ${row.conflict ? "conflito entre linhas; revise os valores" : "desconhecido"}`)); result.append(items); }
      result.hidden = false; status.textContent = "Relatório gerado em memória a partir das informações fornecidas.";
      currentReport(next);
    } catch (error) { status.textContent = error instanceof Error ? error.message : "Não foi possível gerar o relatório."; }
  };
  const currentReport = (value: DailyReport) => { report = value; for (const button of exports) button.disabled = false; };
  const onExport = (format: typeof formats[number]) => () => {
    if (!report) return;
    const text = format === "json" ? dailyReportJson(report) : format === "csv" ? dailyReportCsv(report) : dailyReportMarkdown(report);
    const type = format === "json" ? "application/json" : format === "csv" ? "text/csv;charset=utf-8" : "text/markdown;charset=utf-8";
    downloadBlob(new Blob([text], { type }), `prevlev-observacoes-diarias.${format === "markdown" ? "md" : format}`);
    status.textContent = "Download solicitado. O arquivo permanece no dispositivo após limpar esta página.";
  };
  const exportHandlers = formats.map(format => onExport(format));
  exports.forEach((button, index) => button.addEventListener("click", exportHandlers[index]));
  const reset = () => { clearReport(); status.textContent = "Formulário e relatório visível foram limpos; arquivos exportados permanecem no dispositivo."; };
  form.addEventListener("submit", submit); form.addEventListener("input", invalidate); form.addEventListener("change", invalidate); form.addEventListener("reset", reset);
  return () => { clearReport(); exports.forEach((button, index) => button.removeEventListener("click", exportHandlers[index])); form.removeEventListener("submit", submit); form.removeEventListener("input", invalidate); form.removeEventListener("change", invalidate); form.removeEventListener("reset", reset); section.replaceChildren(); delete section.dataset.dailyMounted; };
}
