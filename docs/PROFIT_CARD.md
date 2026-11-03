# D25 · apresentação local no card de receita

Base: `5db8c07c07c3fecf6e6152d027007210507b2b45`. Implementação preparada e validada somente em fixtures. Não houve acesso a conta/canal, geração paga ou serviço real. O módulo não salva no Studio nem altera receita, custos ou analytics de uma conta.

O único anchor nativo descoberto pelo adapter é `#TOTAL_ESTIMATED_EARNINGS-tab #metric-total`, documentado e já coberto pelo leitor de métricas. Ausência, ocultação ou ambiguidade desse anchor interrompe a operação. Moeda e período vêm da dependência de leitura atual, não de seletores novos ou de campos de data ainda em edição.

## Adapter

`createProfitCardAdapter({doc, readMetrics, now?, onState?})` em `src/content/profit-card.ts` recebe um leitor síncrono e atual do DOM, normalmente `readMetrics: () => readStudioMetrics(doc)`. Não use métricas congeladas do workspace como essa dependência.

- `observe()` lê por ação explícita e retorna um recibo `ProfitCardObservation`. Não mostra a estimativa. O recibo contém `id`, `stamp`, URL, instante/expiração, receita, código ISO da moeda, período observado e origem específica. É vinculado ao nó/parent reais, ao texto nativo e aos valores/fontes lidos. Apenas o recibo mais recente é válido, por até 120 segundos.
- `show(input: ProfitInput, observationId)` exige `calculateBoundProfit` válido, receita e moeda iguais às observadas, ambas as confirmações manuais e origem `studio-dom`. `input.collection`, `input.source.observation` e o ID fornecido devem ser o recibo atual. `input.source.description` deve ser o campo canônico devolvido no recibo.
- Para período observado/relativo, tanto `period` quanto `countPeriod` devem usar o rótulo e o ID desse recibo. Datas só são aceitas quando o leitor também fornece limites aplicados exatos e idênticos; o módulo não transforma “Últimos 28 dias” em datas presumidas.
- `restore()` remove a apresentação e preserva o recibo se ainda válido. Isso permite recalcular custos/quantidade mediante novas confirmações, sem observar outra receita. `cancel()`, `invalidate(reason?)`, expiração, mudança de contexto, `pagehide` e `cleanup()` descartam o recibo.
- `isCurrent(id)`, `getState()` e `getPresentationElement()` permitem ao host verificar contexto e preparar capturas. O host deve restaurar a apresentação e zerar confirmações ao editar custo/quantidade, e obter um novo recibo ao mudar a origem/receita/período.

A estimativa é uma caixa adjacente com Shadow DOM próprio. O texto e os estilos nativos permanecem intactos; o leitor continua obtendo receita nativa mesmo quando lucro/custos são mostrados. “Voltar à receita nativa” remove a caixa, não escreve um valor antigo sobre o DOM.

Restauração usa comparação de identidade, parent, marca própria e markup esperado. Se outro renderizador alterar a caixa, esse conteúdo é preservado e a remoção é relatada como incerta (`removedOwnPresentation:false`). Um novo recibo fica bloqueado enquanto esse conteúdo permanecer conectado. Um clone nativo não copia o conteúdo do Shadow DOM; cópias vazias exatas do host próprio são limpas. Receita, moeda, período, URL e identidade são revalidados antes de mostrar e durante a observação; um monitor local cobre navegação por `pushState` sem mutação.

## Ponte de mensagens

`createProfitCardBridge(adapter, {doc?, settle?})` em `src/content/profit-card-bridge.ts` não instala listener nem modifica o dispatcher existente. O host autorizado encaminha `dispatch(message)` e verifica a resposta `{status, session, sequence, state?, observation?, display?, error?}`.

As mensagens são:

```ts
{type:'STUDIO_PROFIT_OBSERVE', session, sequence}
{type:'STUDIO_PROFIT_SHOW', session, sequence, observationId, input}
{type:'STUDIO_PROFIT_RESTORE', session, sequence, observationId}
{type:'STUDIO_PROFIT_CANCEL', session, sequence, observationId}
```

`session` é um UUID por painel e `sequence` é um inteiro positivo crescente por sessão. Apenas OBSERVE pode assumir a propriedade da apresentação. Sessões substituídas não podem reassumir o card por uma requisição atrasada, mesmo com sequência maior. O histórico é limitado a oito UUIDs, sem evicção que ressuscite sessões antigas; uma nona sessão nova é recusada até reiniciar o contexto da página. Os demais comandos exigem o recibo pertencente ao proprietário atual. Inputs inválidos ou mensagens repetidas/atrasadas não produzem uma nova estimativa.

Fluxo do host: **Ler receita do card → carregar o recibo na calculadora e zerar confirmações → usuário confirma receita/período/quantidade/moeda → calcular → mostrar junto ao card**. Um recibo novo não reaproveita confirmações do anterior.

## Captura e privacidade

A caixa contém custos e quantidade manual, além do lucro. Antes de medir ou capturar o Studio, o dispatcher deve executar e aguardar `bridge.prepareCapture()`. Ele restaura a receita, preserva um recibo ainda válido, aguarda o quadro local/entrega de observadores e verifica novamente que não restou apresentação. Novos OBSERVE/SHOW são recusados durante essa preparação. Se a comparação de propriedade impedir a remoção ou uma apresentação reaparecer, a captura é recusada; não se presume que a máscara do valor nativo cubra a caixa adjacente.

Essa preparação complementa a transação de captura já existente. Não substitui suas guardas de URL, geometria, rolagem, máscaras e medição antes/depois. Nenhum módulo desta entrega inicia captura automaticamente.

## Validação

Os testes novos verificam cálculo vinculado, confirmações, período relativo e limites exatos, leitor ainda retornando receita, alternância/restauração, alterações nativas, nó reciclado, moeda/período/URL, expiração, cancelamento, página suspensa, propriedade alterada externamente e limpeza. A ponte tem fixtures de sequência atrasada, sessões substituídas/capacidade, recibos incorretos e preparação de captura bloqueada ou alterada durante a espera. Páginas de navegador são integralmente interceptadas; não executam Studio real.

Este aceite não comprova layout/funcionamento em uma conta real nem equivalência completa com a extensão de referência. O wiring no workspace/dispatcher e as regressões integradas pertencem ao coordenador; esta entrega altera somente módulos novos, documentação própria e seus testes.
