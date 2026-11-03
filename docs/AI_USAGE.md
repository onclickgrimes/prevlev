# Journal de tentativas próprias de IA

O journal registra apenas eventos observados pelo painel Prevlev durante a sessão atual. Ele não consulta serviços, grava armazenamento, calcula tokens, saldo, custo ou cota externa. Abrir o painel não prepara tentativas. Catálogo, cópias, exportações e análises locais ficam fora da contagem. Reutilizações locais de cache têm contador separado e não são novos POSTs.

Cada tentativa conserva somente ação, ID local, instantes UTC, modelo declarado e origens declaradas. Origens são reduzidas a `URL.origin`: credenciais, caminhos, query e fragmentos não são retidos. Não são guardados prompts, saídas, mensagens de erro, dados dos vídeos, tokens ou credenciais. A implementação projeta apenas os campos de metadados permitidos; não copia o objeto de solicitação ou resposta inteiro.

As etapas são distintas:

- `prepared`: tentativa preparada no painel; nenhum POST foi observado.
- `blocked`: bloqueio antes de iniciar o POST, incluindo configuração ou validação local indisponível.
- `dispatched`: o cliente iniciou seu POST ao backend Prevlev. Isso não comprova chegada ao backend nem envio/aceitação pelo provedor.
- `response`: o backend devolveu status `ok`, `error`, `unsupported` ou `not_configured`. Esses status não comprovam cobrança, token ou sucesso de geração no provedor. Um erro também não comprova que o provedor recusou a solicitação.
- `uncertain`: o POST começou, mas não há resposta final confiável. Um envelope `prevlev:client` após o POST fica incerto. Uma resposta posterior confiável pode resolver a incerteza sem criar outra tentativa.

Os callbacks são idempotentes. Bloquear depois de um POST não reclassifica o envio como inexistente; passa a incerto. Uma resposta terminal conhecida não é substituída por eventos repetidos. Uma tentativa sem evento de despacho nunca é contabilizada como POST ou resposta do backend.

São retidos os 20 registros mais recentes (configurável somente para um limite menor). Totais conhecidos continuam após descartar detalhes antigos. Se um registro ainda pendente for descartado, isso é contado como acompanhamento encerrado; eventos posteriores daquele ID são ignorados. Esses limites impedem tratar o journal como medidor de cobrança ou auditoria integral. Limpar explicitamente remove registros e totais; não cancela solicitações. Recarregar/fechar o painel também perde o journal. IDs não são reutilizados após limpar, impedindo callbacks antigos de alterar uma tentativa nova.

Contrato de integração, sem transporte embutido:

```ts
const usage = new AiUsageJournal();
const id = usage.begin({ feature, model, backendOrigin, origin });
usage.dispatched(id); // somente no ponto exato que inicia o POST, após a validação local
usage.complete(id, { status: response.status, source: response.source });
// Sem despacho: usage.blocked(id). Após despacho sem resposta: usage.uncertain(id).
usage.cacheHit(feature); // somente ao realmente reutilizar uma saída local existente
mountAiUsage(host, usage);
```

As cinco ações aceitas são `transcript-summary`, `transcript-topics`, `transcript-script`, `comment-analysis` e `thumbnail-generation`. O host deve chamar `begin` apenas por uma tentativa explícita e `dispatched` apenas quando o POST começa; o journal não descobre esses fatos. `snapshot()` oferece cópias isoladas, `subscribe()` atualiza a visão passiva e retorna uma função para desligá-la, `clear()` limpa explicitamente. `mountAiUsage` retorna `dispose()`.

Validação: testes unitários e fixtures browser próprias cobrem transições, POST não comprovado, status de backend, resposta tardia, cache separado, retenção, limpeza durante trabalho pendente, callbacks antigos e ausência de payload/credenciais no estado. Não foi acessado provedor, conta, serviço Omni ou cliente MCP.
