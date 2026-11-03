import type { PageSnapshot } from "../shared/types";

const DAY = 86_400_000;
const PRESETS = [7, 14, 28, 60, 90, 180, 365] as const;

/** Query/period changes do not change the video whose publication was declared. */
function publicationContext(snapshot: PageSnapshot): string {
  try {
    const url = new URL(snapshot.url);
    const id = snapshot.videoId || /^\/video\/([^/]+)/.exec(url.pathname)?.[1] || url.searchParams.get("v");
    return id ? JSON.stringify([url.origin,id]) : JSON.stringify([url.origin,url.pathname]);
  } catch { return JSON.stringify([snapshot.url,snapshot.videoId ?? ""]); }
}

/** Calendar days in UTC, including the publication date. A period is available only after its final UTC day has ended. */
export function completedPublicationPeriod(publication: string, days: number, now = new Date()): { start: string; end: string } | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(publication) || !Number.isInteger(days) || days < 1 || !Number.isFinite(now.getTime())) return undefined;
  const start = Date.parse(`${publication}T00:00:00.000Z`);
  if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== publication) return undefined;
  const end = start + (days - 1) * DAY;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (end >= today) return undefined;
  return { start: publication, end: new Date(end).toISOString().slice(0, 10) };
}

/** Render only information explicitly captured from the visible Studio page. */
export function initStudioOverview({ snapshot }: { snapshot: () => PageSnapshot }): { render(): void; invalidateContext(): void } {
  const studio = document.querySelector<HTMLElement>("#studio");
  const start = document.querySelector<HTMLInputElement>("#period-start");
  const end = document.querySelector<HTMLInputElement>("#period-end");
  if (!studio || !start || !end) throw new Error("Controles do Studio ausentes.");
  const panel = document.createElement("div");
  panel.id = "studio-overview";
  panel.className = "card";
  panel.innerHTML = `<h2>Visão geral observada no Studio</h2>
    <p class="muted">Dados visíveis na página coletada. O período exibido é contexto observado e não comprova, por si só, que cada métrica pertence a ele.</p>
    <dl id="studio-overview-fields"></dl>
    <ul id="studio-overview-warnings"></ul>
    <p>Na calculadora, a quantidade de vídeos é informada por você; uma contagem observada não é usada como quantidade do período.</p>
    <h3>Primeiros dias após a publicação</h3>
    <p class="muted">Informe a data de publicação do vídeo. Os intervalos incluem essa data e usam dias UTC completos. Escolher um intervalo preenche apenas os campos desta tela; use “Preencher período aberto” para enviar as datas aos campos abertos no Studio.</p>
    <label>Data de publicação informada por você <input id="studio-publication-date" type="date"></label>
    <div id="studio-period-presets"></div><p id="studio-period-status" role="status"></p>`;
  studio.prepend(panel);
  const fields = panel.querySelector<HTMLDListElement>("#studio-overview-fields")!;
  const warnings = panel.querySelector<HTMLUListElement>("#studio-overview-warnings")!;
  const publication = panel.querySelector<HTMLInputElement>("#studio-publication-date")!;
  const presets = panel.querySelector<HTMLDivElement>("#studio-period-presets")!;
  const status = panel.querySelector<HTMLElement>("#studio-period-status")!;
  const periodInputs = [start,end];
  let boundContext = publicationContext(snapshot());
  function invalidateContext() {
    publication.value = "";
    for (const field of periodInputs) { field.value=""; field.dispatchEvent(new Event("input",{bubbles:true})); }
    updatePresets();
    status.textContent = "O vídeo ou contexto mudou. A publicação e o período anteriores foram descartados; informe a data deste vídeo.";
  }
  function syncContext(): boolean {
    const next = publicationContext(snapshot());
    if (next === boundContext) return false;
    boundContext = next;
    invalidateContext();
    return true;
  }
  for (const days of PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.days = String(days);
    button.textContent = `${days} dias`;
    button.addEventListener("click", () => {
      if (syncContext()) return;
      const period = completedPublicationPeriod(publication.value, days);
      if (!period) { updatePresets(); return; }
      start.value = period.start;
      end.value = period.end;
      start.dispatchEvent(new Event("input", { bubbles: true }));
      end.dispatchEvent(new Event("input", { bubbles: true }));
      status.textContent = `Intervalo ${period.start} a ${period.end} preenchido nesta tela. Use “Preencher período aberto” para enviar ao Studio.`;
    });
    presets.append(button);
  }
  function updatePresets() {
    for (const button of presets.querySelectorAll<HTMLButtonElement>("button")) {
      button.disabled = !completedPublicationPeriod(publication.value, Number(button.dataset.days));
    }
    status.textContent = publication.value ? "Intervalos indisponíveis ainda não completaram seu último dia UTC, ou a data é inválida." : "Informe a data de publicação para habilitar intervalos completos.";
  }
  publication.addEventListener("input", () => { if (!syncContext()) updatePresets(); });
  function render() {
    const changed = syncContext();
    const data = snapshot().studio;
    fields.replaceChildren();
    const row = (label: string, value: string) => {
      const term = document.createElement("dt"); term.textContent = label;
      const description = document.createElement("dd"); description.textContent = value;
      fields.append(term, description);
    };
    const source = (metric: { label: string; selector: string; raw: string } | undefined) => metric ? ` · fonte: ${metric.label} (${metric.selector}; exibido: ${metric.raw})` : " · fonte específica desconhecida";
    row("Fonte da coleta", data?.source === "studio-dom" ? "Página visível do YouTube Studio (studio-dom)" : "Desconhecida");
    row("Data da observação", data?.observedAt ?? "Desconhecida");
    row("Período exibido", data?.period ? `${data.period.label}${data.period.start && data.period.end ? ` (${data.period.start} a ${data.period.end})` : ""}${source(data.sources?.period)}` : "Desconhecido");
    row("Receita observada", data?.revenue !== undefined ? `${data.revenue}${source(data.sources?.revenue)}` : "Desconhecida");
    row("Moeda observada", data?.currency || data?.currencyCode ? `${[data.currency, data.currencyCode].filter(Boolean).join(" · ")}${source(data.sources?.currency)}` : "Desconhecida");
    row("Quantidade observada de vídeos", data?.videoCount !== undefined ? `${data.videoCount}${source(data.sources?.videoCount)} · escopo da contagem não confirmado` : "Desconhecida");
    warnings.replaceChildren(...(data?.warnings ?? []).map(message => { const item = document.createElement("li"); item.textContent = message; return item; }));
    if (!changed) updatePresets();
  }
  render();
  return { render, invalidateContext };
}
