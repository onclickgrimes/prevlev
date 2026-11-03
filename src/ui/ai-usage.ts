import { AiUsageJournal, type AiUsageEntry, type AiUsageSnapshot } from '../core/ai-usage';

const featureLabels = { 'transcript-summary': 'Resumo da transcrição', 'transcript-topics': 'Tópicos da transcrição', 'transcript-script': 'Roteiro da transcrição', 'comment-analysis': 'Análise de comentários', 'thumbnail-generation': 'Geração de thumbnail' } as const;
function stateLabel(entry: AiUsageEntry): string {
  switch (entry.state) {
    case 'prepared': return 'Preparada localmente; POST ainda não observado';
    case 'dispatched': return 'POST ao backend iniciado; aguardando resposta';
    case 'blocked': return 'Bloqueada antes de iniciar o POST';
    case 'uncertain': return 'POST iniciado; resultado final não confirmado';
    case 'response': return `Backend respondeu: ${entry.responseStatus}`;
  }
}

/** Passive local view. Only its explicit clear button changes the session journal. */
export function mountAiUsage(host: HTMLElement, journal: AiUsageJournal): { dispose(): void } {
  const doc = host.ownerDocument, panel = doc.createElement('section'); panel.id = 'ai-usage'; panel.className = 'card';
  panel.innerHTML = `<h3>Tentativas próprias nesta sessão</h3>
    <p>Registra somente ações de IA observadas por este painel. Preparar uma tentativa não envia dados. “POST iniciado” indica o início do envio ao backend Prevlev; não comprova chegada ao backend, envio ao provedor, geração, cobrança, tokens ou cota.</p>
    <p>Uma resposta ok/erro/unsupported/not_configured é o status informado pelo backend, não uma confirmação de cobrança ou do resultado no provedor. Falha de transporte após iniciar o POST fica incerta. Cache local é contado separadamente, sem nova tentativa de rede.</p>
    <p id="ai-usage-totals" role="status" aria-live="polite"></p><p id="ai-usage-retention"></p>
    <button type="button" id="ai-usage-clear">Limpar tentativas desta sessão</button>
    <p>Somente memória deste painel, sem telemetria ou persistência. Limpar ou recarregar encerra este acompanhamento; não cancela solicitações em andamento. Não são guardados prompts, resultados, mensagens de erro, tokens ou credenciais. Saldo e cota externos: desconhecidos.</p>
    <div class="table-wrap"><table><thead><tr><th>Instante UTC</th><th>Ação</th><th>Modelo declarado</th><th>Backend / origem declarados</th><th>Etapa observada</th></tr></thead><tbody id="ai-usage-rows"></tbody></table></div>`;
  host.append(panel);
  const totals = panel.querySelector<HTMLElement>('#ai-usage-totals')!, retention = panel.querySelector<HTMLElement>('#ai-usage-retention')!, rows = panel.querySelector<HTMLElement>('#ai-usage-rows')!, clear = panel.querySelector<HTMLButtonElement>('#ai-usage-clear')!;
  const cell = (text: string) => { const td = doc.createElement('td'); td.textContent = text; return td; };
  function render(snapshot: AiUsageSnapshot): void {
    const t = snapshot.totals;
    totals.textContent = `Desde ${snapshot.sessionStartedAt}: ${t.attempts} tentativas preparadas; ${t.dispatched} POSTs ao backend iniciados; ${t.blocked} bloqueadas antes do POST; respostas do backend: ok ${t.responses.ok}, erro ${t.responses.error}, unsupported ${t.responses.unsupported}, not_configured ${t.responses.not_configured}; ${t.uncertain} resultados incertos sem confirmação posterior; ${t.cacheHits} reutilizações locais de cache.`;
    retention.textContent = `${snapshot.entries.length}/${snapshot.limit} tentativas recentes retidas; ${t.evicted} registros antigos descartados. Totais conhecidos da sessão continuam após o descarte. ${t.detached} registros foram descartados ainda sem resposta final; eventos posteriores desses registros não são acompanhados. Catálogo, cópias, exportações e análises locais não contam.`;
    clear.disabled = t.attempts === 0 && t.cacheHits === 0;
    rows.replaceChildren(...snapshot.entries.map(entry => {
      const row = doc.createElement('tr'); row.dataset.attemptId = String(entry.id);
      row.append(cell(entry.createdAt), cell(featureLabels[entry.feature]), cell(entry.model ?? 'Não declarado / não retido'), cell(`Backend: ${entry.backendOrigin ?? 'não declarado'}; origem: ${entry.origin ?? 'não declarada'}`), cell(`${stateLabel(entry)}${entry.responseSource ? ` · fonte: ${entry.responseSource}` : ''}`));
      return row;
    }));
    if (!snapshot.entries.length) { const row = doc.createElement('tr'), td = cell('Nenhuma tentativa retida. Abrir este painel não inicia uma solicitação.'); td.colSpan = 5; row.append(td); rows.append(row); }
  }
  clear.addEventListener('click', () => journal.clear());
  const unsubscribe = journal.subscribe(render);
  return { dispose() { unsubscribe(); panel.remove(); } };
}
