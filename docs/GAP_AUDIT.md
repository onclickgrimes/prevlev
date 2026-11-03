# Auditoria de gaps · 40 recursos e extras

Estado atual dos 33 itens e 40 recursos: [auditoria dos escopos locais e dependências](LOCAL_SCOPE_AUDIT.md). Os checkpoints abaixo, incluindo suspensões de publicação e tarefas então abertas, são registros históricos; não representam a fila atual. Validação atual: 872 testes e 251 cenários de navegador aprovados; 2 skips por política.

Checkpoint das nove lacunas locais implementado e verificado: [escopo entregue e limites](NINE_LOCAL_GAPS.md). 686 testes automatizados e162 cenários de navegador aprovados;2 ignorados por política. Descrições históricas abaixo permanecem como registro da base, não como afirmação de ausência atual.

Checkpoint de contexto D20/D26: cache inclui backend salvo e conexão invalida resultados; troca de vídeo/aba descarta publicação e período declarados. Verificação local:630 testes e10 cenários direcionados; demais lacunas continuam abertas.

Revisão local adicional de segurança e correção: [coleta, imagens, transcrições e fontes](LOCAL_SAFETY_FOLLOWUP.md). Publicação suspensa; aceite por fixtures permanece separado do runtime real.

Base inspecionada: `e22c7bf0c7d1ccf964390ab4db159bd8d70b0b46` (v0.4.0); 2026-11-03. A auditoria é uma fila de trabalho, não declaração de paridade ou encerramento da reconstrução.

Inspeção do código próprio, UI e testes; reprodução local de AF02;33 diferenças de referência transmitidas pelo coordenador a partir de análise estática. Nenhuma execução local da extensão original ou chamada a serviço/conta/credencial.

O recibo/ZIP integral de especificação não foi lido neste executor; módulos/behaviors da referência são evidência estática relatada pelo parent, não runtime ou backend verificados.

As33 diferenças de referência estão detalhadas em [ORIGINAL_GAP_LEDGER.md](ORIGINAL_GAP_LEDGER.md); os dados estruturados ficam em [gap-audit.json](gap-audit.json) e [original-gap-ledger.json](original-gap-ledger.json).

## Checkpoint local independente

D22, D23, D25, D28 e D32 receberam implementação local e fixtures adicionais sobre `58fb1477ff333eaac7a8bdd3f6a3edc10cd67050`, sem publicação. A calculadora exige vínculo declarado; o Lab preserva limites do contrato; o guia só prepara texto; remoção só produz plano; waveform só analisa raster local declarado. Adapters/serviços reais pendentes continuam explícitos. [Detalhes](LOCAL_INDEPENDENT_PATCH.md).

## Critério de conclusão

Não considerar esgotados os gaps independentes enquanto houver item implementable_now sem aceite/verificação registrado. Um comportamento implementado pode continuar com runtime bloqueado; registrar ambos, sem esconder trabalho em needs configuration.

| Categoria | Significado |
| --- | --- |
| `implementable_now` | Código/fixtures/integração independentes podem avançar agora, sem contas, quotas, APIs privadas ou mudança de políticas. |
| `real_runtime_blocked` | Código pode ser testado em fixtures; prova no runtime real exige ambiente/ação especificamente indisponíveis ou vedados neste executor. |
| `external_credential_or_decision` | Uma decisão ou credencial existente específica do operador é necessária; não pedir ou expor segredos no chat. |
| `unavailable_legitimately` | Resultado não existe nas entradas/fontes permitidas ou o caminho é proibido; manter desconhecido/limite explícito, não fabricar. |

## Prioridade imediata

- D01–D05: transcrição moderna/virtualizada, controles nativos de mid-roll, anchors de captura e receita/moeda/período.
- AF01–AF03: identidade do título/ID copiado, VTT sem parser e fim estimado oculto, período que escreve em readonly/controle desconectado.
- Concluir também as frentes já distribuídas: coleta limitada, comentários completos, Swipe/ativos, evidências de patrocínio e pacote local.

## Os40 recursos

| # | Recurso | Gaps específicos | Categorias |
| --- | --- | --- | --- |
| 1 | Verificar monetização | AF08, RT02, UL01 | `implementable_now`, `real_runtime_blocked`, `unavailable_legitimately` |
| 2 | Ocultar Shorts | AF08, RT01 | `implementable_now`, `real_runtime_blocked` |
| 3 | Ordenar vídeos do canal por popularidade/VPH | D11, D12, D13, AF08, RT01, RT02, UL03 | `implementable_now`, `real_runtime_blocked`, `unavailable_legitimately` |
| 4 | Analytics de Shorts | D11, D13, D14, D30, D33, AF08, RT01, RT02, UL03 | `implementable_now`, `real_runtime_blocked`, `unavailable_legitimately` |
| 5 | Calculadora de lucro líquido | D05, D25, AF08, RT03 | `implementable_now`, `real_runtime_blocked` |
| 6 | Insights extras no resumo do Studio | D27, AF08, RT03, EC04, UL02, UL04 | `external_credential_or_decision`, `implementable_now`, `real_runtime_blocked`, `unavailable_legitimately` |
| 7 | Analytics com períodos personalizados | D26, AF03, AF08, RT03 | `implementable_now`, `real_runtime_blocked` |
| 8 | Filtrar/copiar comentários | AF04, AF08, RT01, RT02 | `implementable_now`, `real_runtime_blocked` |
| 9 | Copiar título/ID do vídeo | D15, AF01, AF08, RT01 | `implementable_now`, `real_runtime_blocked` |
| 10 | Ferramentas da timeline | D01, D02, D19, D20, AF08, RT01, RT04 | `implementable_now`, `real_runtime_blocked` |
| 11 | Comprimir thumbnails | D18, AF08 | `implementable_now` |
| 12 | Prévia de thumbnail e título | D06, D07, D08, D09, D10, AF08 | `implementable_now` |
| 13 | Baixar/copiar thumbnails | D15, D31, AF08, RT04 | `implementable_now`, `real_runtime_blocked` |
| 14 | Screenshot de card de vídeo | D17, AF08, RT01, RT04 | `implementable_now`, `real_runtime_blocked` |
| 15 | Screenshot de analytics | D04, D24, AF08, RT01, RT03 | `implementable_now`, `real_runtime_blocked` |
| 16 | Screenshot de desempenho do último vídeo | D04, D24, AF08, RT01, RT03 | `implementable_now`, `real_runtime_blocked` |
| 17 | Inserir anúncios mid-roll | D03, D21, D22, D23, AF08, RT03 | `implementable_now`, `real_runtime_blocked` |
| 18 | Pular etapa de monetização | AF08, RT03, UL05 | `implementable_now`, `real_runtime_blocked`, `unavailable_legitimately` |
| 19 | Dar/remover corações em lote | AF04, AF08, RT03 | `implementable_now`, `real_runtime_blocked` |
| 20 | Mostrar inscritos | D11, D12, D13, AF08, RT02 | `implementable_now`, `real_runtime_blocked` |
| 21 | Outlier score | D11, D12, D13, D33, AF08, RT02, EC04, UL03 | `external_credential_or_decision`, `implementable_now`, `real_runtime_blocked`, `unavailable_legitimately` |
| 22 | Visualizações por hora | D11, D12, D13, AF08, RT02, UL03 | `implementable_now`, `real_runtime_blocked`, `unavailable_legitimately` |
| 23 | Filtro do feed de inscrições | D11, D12, D13, D33, AF08, RT01, RT02 | `implementable_now`, `real_runtime_blocked` |
| 24 | Filtro da página inicial | D11, D12, D13, D33, AF08, RT01, RT02 | `implementable_now`, `real_runtime_blocked` |
| 25 | Filtro da busca | D11, D12, D13, D14, D33, AF08, RT01, RT02, EC02, UL03 | `external_credential_or_decision`, `implementable_now`, `real_runtime_blocked`, `unavailable_legitimately` |
| 26 | Filtro da página de canal | D11, D12, D13, D33, AF08, RT01, RT02 | `implementable_now`, `real_runtime_blocked` |
| 27 | Vídeos destacados do canal | D16, AF08, RT02, EC04 | `external_credential_or_decision`, `implementable_now`, `real_runtime_blocked` |
| 28 | Análise de termos de pesquisa | D29, D30, D33, AF08, RT02, EC04, UL03 | `external_credential_or_decision`, `implementable_now`, `real_runtime_blocked`, `unavailable_legitimately` |
| 29 | Transcrição e ações de IA | D01, D02, D19, D20, D32, AF02, AF08, EC01, RT05 | `external_credential_or_decision`, `implementable_now`, `real_runtime_blocked` |
| 30 | Swipe File | AF05, AF06, AF08, RT01, EC03 | `external_credential_or_decision`, `implementable_now`, `real_runtime_blocked` |
| 31 | Encontrar vídeos semelhantes | AF08, EC04, RT02, UL03 | `external_credential_or_decision`, `implementable_now`, `real_runtime_blocked`, `unavailable_legitimately` |
| 32 | Encontrar canais semelhantes | AF08, EC04, RT02, UL03 | `external_credential_or_decision`, `implementable_now`, `real_runtime_blocked`, `unavailable_legitimately` |
| 33 | Visão geral de nichos | D30, D33, AF08, EC04, UL03 | `external_credential_or_decision`, `implementable_now`, `unavailable_legitimately` |
| 34 | Analytics de canais | D27, D29, D30, AF08, EC04, UL02, UL03 | `external_credential_or_decision`, `implementable_now`, `unavailable_legitimately` |
| 35 | Relatório detalhado de canal | D29, D30, AF08, EC01, EC04, UL02, UL03 | `external_credential_or_decision`, `implementable_now`, `unavailable_legitimately` |
| 36 | Histórico de views/RPM | AF08, UL04 | `implementable_now`, `unavailable_legitimately` |
| 37 | Análise de patrocínios | AF07, AF08, UL02 | `implementable_now`, `unavailable_legitimately` |
| 38 | Analytics combinado de canais | D27, D29, D30, AF08, EC04, UL02, UL03 | `external_credential_or_decision`, `implementable_now`, `unavailable_legitimately` |
| 39 | Análise de comentários com IA | D20, D29, D32, AF08, EC01, RT05 | `external_credential_or_decision`, `implementable_now`, `real_runtime_blocked` |
| 40 | Geração de thumbnails com IA | D28, D32, AF08, EC01, RT05 | `external_credential_or_decision`, `implementable_now`, `real_runtime_blocked` |

Os estados anteriores de FEATURES foram preservados: esta auditoria não troca `partial` por `implemented` nem usa bloqueio de runtime para ocultar código faltante. Veja o JSON para o escopo/código/testes já existentes por recurso.

## Extras

| Extra | Disponível | Gaps |
| --- | --- | --- |
| MCP próprio e integração em clientes | Cinco tools stdio somente leitura, desligado por padrão. | D32, EC04, RT05, UL05, UL06 |
| Guia visual/detecção/compositor ChatGPT/Claude | Guia/compositor local; configuração/cópia manual, sem detecção ou conexão automática. | D32, EC04, RT05 |
| Contador de uso/cota | Journal local das tentativas próprias da sessão; cache separado. Nenhum saldo, token, cobrança ou cota externos conhecidos. | D32, UL06 |
| Similar Thumbnails/Thumbnail Lab/Niche Finder e atalhos próprios | Ferramentas próprias parciais de imagens/pesquisa/relatório; sem atalhos a serviços privados Nexlev. | D06, D07, D08, D09, D10, D28, D30, D31, EC01, EC04, UL05 |
| Exportar CSV/JSON/Markdown | Pesquisa, analytics, relatórios e transcrição exportam o material disponível, com procedência e desconhecidos explícitos. | D13, D19, D29, D30, AF02 |
| Telemetria/sincronização Nexlev | Ausentes por intenção/restrição; não devem ser recriadas como chamadas Nexlev. | UL05 |

## Achados adicionais e trabalho independente

### AF01 · Copiar título/ID usa a snapshot anterior após trocar a aba selecionada.

Categoria: `implementable_now`. Estado: `open`. Recursos: 9.

Código: [workspace.ts](../src/ui/workspace.ts) (`on(copy-title)`).

Aceite:

- Ação lê a identidade atual da aba selecionada explicitamente, ou o botão é rotulado como cópia da coleta congelada.
- Troca de aba não copia metadados de outra aba nem sobrescreve a coleção pesquisada.

### AF02 · O input aceita .vtt, mas parseTranscript retorna zero segmentos; transcriptVtt inventa +2s no fim desconhecido.

Categoria: `implementable_now`. Estado: `open`. Recursos: 29.

Código: [transcript.ts](../src/core/transcript.ts) (`parseTranscript/transcriptVtt`), [workspace.ts](../src/ui/workspace.ts) (`transcript-file/timedSegments`).

Fixture WEBVTT 00:00:03.000→00:00:04.000 produz0 segmentos; duration0/start3 exporta fim00:00:05.000. Somente código próprio foi executado.

Aceite:

- Parser VTT preserva tempos válidos sem executar marcação e informa formatos inválidos.
- Fim desconhecido usa dado real ou escolha/aviso explícito; não há estimativa silenciosa +2s.

### AF03 · Período pode preencher input readonly/desconectado após rerender e ainda retornar ready.

Categoria: `implementable_now`. Estado: `open`. Recursos: 7.

Código: [studio.ts](../src/content/studio.ts) (`setStudioPeriod`).

Aceite:

- Inputs readonly/disabled/ambíguos são recusados antes de escrever.
- Revalida URL/editor/alvos depois do primeiro evento e antes do segundo; rerender não retorna falso sucesso.

### AF04 · A UI de comentários não expõe todas as regras disponíveis (autor/respostas/coração) e só coleta o DOM presente.

Categoria: `implementable_now`. Estado: `assigned_full_comments`. Recursos: 8, 19.

Código: [metrics.ts](../src/core/metrics.ts) (`filterComments`), [workspace.ts](../src/ui/workspace.ts) (`currentComments`), [youtube.ts](../src/content/youtube.ts) (`readComments`).

Aceite:

- Regras explícitas têm UI, cópia/export do conjunto efetivo e ausência não vira0 conhecido.
- Coleta adicional é explícita, limitada, cancelável e não dá coração ao carregar ou coletar.

### AF05 · Swipe salva referências por nome de pasta; ainda falta fluxo completo de ativos locais e organização/salvamento de capturas.

Categoria: `implementable_now`. Estado: `assigned_swipe`. Recursos: 30.

Código: [storage.ts](../src/shared/storage.ts) (`SwipeItem/getSwipe/saveSwipe`), [workspace.ts](../src/ui/workspace.ts) (`renderSwipe/swipe-import`).

Aceite:

- Pastas/itens podem ser organizados com identidade estável, ativos de imagem limitados e referência à origem.
- Captura/thumbnail só é salva por ação explícita; backup preserva metadados/ativos e import valida limites/formato.

### AF06 · Sincronização manual com o backend pessoal (implementada em fixtures).

Categoria histórica: `implementable_now`. Estado atual: `partial_scope_fixture_tested`; sincronização pessoal manual implementada, runtime real pendente. Recursos: 30.

Código: [index.mjs](../server/index.mjs) (`protected routes`), [storage.ts](../src/shared/storage.ts), [workspace.ts](../src/ui/workspace.ts) (`Swipe File`).

Aceite:

- CRUD/sync pessoal explícito usa token/origem existentes e revisão para detectar conflitos, sem upload ao abrir.
- Identidades/paths/bytes/mimes são limitados; erros incertos não repetem escritas e fonte API não entra nos ativos derivados.
- Hospedagem/identidade multiusuário continua separada em EC03, sem afirmar que só falta configurar algo quando a rota ainda não existe.

### AF07 · Análise de patrocínio retorna frases por regex; faltam evidências estruturadas de marca/trecho/URL/timestamp quando presentes na entrada.

Categoria: `implementable_now`. Estado: `assigned_sponsorship_evidence`. Recursos: 37.

Código: [analysis.mjs](../server/analysis.mjs) (`sponsorships`).

Aceite:

- Cada menção identifica texto e localização realmente fornecidos, método/confiança e limitações.
- Não confirma contrato ou estima valor; não inventa marca ou timestamp ausente.

### AF08 · Pacote carregável/documentação de instalação precisam sair do build próprio com verificação de segredos/proprietário, sem publicar loja/deploy.

Categoria: `implementable_now`. Estado: `assigned_local_packaging`. Recursos: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40.

Código: [build.mjs](../scripts/build.mjs), [manifest.json](../manifest.json), [package.json](../package.json).

Aceite:

- Pacote contém apenas dist próprio e metadados esperados; testes/build/lint/typecheck aprovados no estado final.
- Não inclui ZIP/bundle/asset da referência, .env, credenciais ou fixtures como dados reais; instalação bloqueada permanece indicada.

## Bloqueios específicos e limites legítimos

### RT01 · Instalar a extensão MV3 neste Chromium.

Categoria: `real_runtime_blocked`. Estado: `blocked_known_policy`.

Alvo: tests/browser/extension.spec.ts; /etc/chromium/policies/managed/extensions.json.

Motivo: ExtensionInstallBlocklist=[*]. Dois cenários são ignorados; a política não deve ser contornada.

Próxima ação: Executar os testes de extensão instalada em um ambiente autorizado que permita extensões, sem alterar a política gerenciada aqui.

Aceite:

- Chrome IPC/permissões/storage/capture são verificados com a extensão instalada e os resultados ficam separados das fixtures.

### RT02 · Validar parsing/coleção em páginas públicas atuais do YouTube.

Categoria: `real_runtime_blocked`. Estado: `pending_not_retried`.

Alvo: https://www.youtube.com/@YouTube/videos e páginas públicas representativas de feed/busca/Shorts.

Motivo: A tentativa anônima anterior retornou fetch failed; esta auditoria proíbe chamadas externas e não executa a referência.

Próxima ação: Quando permitido, fazer leitura pública limitada e registrar resposta/limites; nunca usar endpoint privado como fallback.

Aceite:

- Anchors atuais, idioma e virtualização são observados; falha/consentimento vazio permanece desconhecido.

### RT03 · Verificar selectors e efeitos reais do Studio no canal autorizado de teste.

Categoria: `real_runtime_blocked`. Estado: `pending_no_real_channel_actions`.

Alvo: readStudioMetrics/setStudioPeriod/Studio plans/capture.

Motivo: Nenhuma sessão ou canal real foi utilizado; a tarefa atual não autoriza chamadas/ações em contas reais. Fixtures não comprovam aceitação pelo servidor.

Próxima ação: Após autorização e ambiente apropriados, validar leitura e prévias primeiro; qualquer mutação mantém ação explícita/confirmar/cancelar e revisão/Salvar manual.

Aceite:

- Seletores/periodos/moeda/FPS/identidade são confirmados; efeitos de servidor e incertezas não são inferidos de cliques.

### RT04 · Validar captura/cópia com vídeo e clipboard reais em origem permitida.

Categoria: `real_runtime_blocked`. Estado: `pending_protected_media_possible`.

Alvo: captureFrame/copyImage/clipboard/canvas e captura de aba.

Motivo: Canvas pode ficar protegido pela origem e clipboard depende de gesto/permissão. Só mídia própria/fixtures foi usada neste executor.

Próxima ação: Testar em mídia autorizada; apresentar indisponível quando houver bloqueio, sem baixar/decodificar conteúdo protegido ou alterar segurança do navegador.

Aceite:

- Falha de origem/permissão aparece claramente e não vira arquivo vazio ou confirmação de sucesso.

### RT05 · Validar integração real Omni/cliente MCP escolhidos pelo usuário.

Categoria: `real_runtime_blocked`. Estado: `pending_no_user_service_access`.

Alvo: backend Prevlev → Omni existente; processo MCP → cliente compatível.

Motivo: Serviço do usuário/contas/geração/cotas e configuração dos clientes não foram acessados; só contratos e fixtures locais foram usados.

Próxima ação: Usar a configuração escolhida em EC01/EC04 e executar apenas a ação explicitamente autorizada; nenhum teste de geração oculto ou registro automático.

Aceite:

- Conectividade/capacidade, identidade e resultado real são relatados sem confundir catálogo com saldo/sucesso.

### EC01 · Escolher backend/Omni e um modelo real disponível por tarefa.

Categoria: `external_credential_or_decision`. Estado: `external_action_required`.

Alvo: PREVLEV_TOKEN/ALLOWED_ORIGINS no backend; OMNI_BASE_URL/OMNI_API_KEY somente no servidor; seleção provider:model na UI.

Motivo: Não há seleção real nem acesso às credenciais/serviço do usuário. Imagem/referências/aspect/resolução dependem de capacidades e contrato realmente anunciados.

Próxima ação: Operador configura valores existentes localmente e escolhe o modelo; a extensão não recebe chave Omni/provedor e não cria conta/credencial.

Aceite:

- Modelo/saída/operação/origem são explícitos e revalidados; parâmetro sem contrato fica indisponível.

### EC02 · Habilitar pesquisa oficial bruta com chave existente.

Categoria: `external_credential_or_decision`. Estado: `external_action_required`.

Alvo: YOUTUBE_ENABLED=true/YOUTUBE_API_KEY no servidor; consentimento em cada ação oficial.

Motivo: A fonte está desativada por padrão e nenhuma chave real foi usada. Criar chave/projeto ou consumir cota não faz parte desta auditoria.

Próxima ação: Operador fornece chave autorizada existente e decide cada consulta manual.

Aceite:

- API fica separada da coleção/IA/relatórios/histórico; chave só no header servidor e nenhuma métrica/custo inventados.

### EC03 · Hospedagem e identidade para sincronização multiusuário.

Categoria: `external_credential_or_decision`. Estado: `external_decision_required`.

Alvo: domínio/backend acessível, identidade/isolamento, armazenamento e política de retenção/backup.

Motivo: O backend atual é pessoal. Destino de hospedagem e mecanismo de contas/isolamento não foram escolhidos ou autorizados. AF06 já oferece sincronização pessoal manual, sem hospedagem ou isolamento multiusuário.

Próxima ação: Escolher esses destinos/limites antes de hospedar ou criar recursos; não executar deploy/contas automaticamente.

Aceite:

- Isolamento e conflitos têm testes; titular aprova um destino concreto. Nenhuma alegação de cloud antes da operação real.

### EC04 · Conectar um cliente MCP/web e uma fonte legítima para populares/globais/dados privados autorizados.

Categoria: `external_credential_or_decision`. Estado: `external_decision_required`.

Alvo: cliente/transporte compatível para D32; dataset autorizado para D16/D27/D29/D30.

Motivo: Stdio local não comprova integração em ChatGPT/Claude web; coleção parcial não é base global e não contém séries privadas diárias.

Próxima ação: Escolher cliente/ponte e fornecer dados autorizados ou contrato permitido. Guia/cópia/painéis locais continuam implementáveis independentemente.

Aceite:

- O cliente e a fonte de cada resultado ficam identificados; nenhuma configuração privada é alterada nem headers/cookies interceptados.

### UL01 · Comprovar YPP/receita/monetização real de canal alheio por marcador de anúncio/música.

Categoria: `unavailable_legitimately`. Estado: `intentionally_unknown`.

Motivo: Os sinais públicos observados não comprovam participação ou pagamento ao criador.

Aceite:

- Resultado continua inferência de baixa confiança/unknown e explica presença/ausência sem veredito financeiro.

### UL02 · Receita/RPM/geografia/contrato de patrocínio de terceiros sem fonte autorizada.

Categoria: `unavailable_legitimately`. Estado: `intentionally_unknown`.

Motivo: Esses campos não existem nos dados públicos fornecidos; médias/IA não são evidência de valores privados.

Aceite:

- Campos ausentes são desconhecidos. Dados próprios fornecidos explicitamente têm origem/período/moeda identificados, sem generalização a terceiros.

### UL03 · Usar YouTube Data API para indicadores derivados ou retenção vedada pela separação de fonte adotada.

Categoria: `unavailable_legitimately`. Estado: `source_policy_enforced`.

Motivo: O projeto mantém a API bruta isolada e recusa youtube-data-api nos caminhos derivados/persistentes. Não remover o guard para fingir base global.

Aceite:

- Guard cobre HTTP/MCP/import/export/histórico; app não mescla a fonte nem calcula VPH/outlier/média sobre ela.

### UL04 · Inventar passado anterior à primeira observação, fim de transcrição desconhecido ou tráfego diário a partir de contador acumulado.

Categoria: `unavailable_legitimately`. Estado: `not_recoverable_from_absent_data`.

Motivo: O dado não foi observado. A taxa de um intervalo real não é tráfego da última hora/hoje, e não há recuperação legítima sem fonte real.

Aceite:

- Datas/contagens ausentes permanecem ausentes; fontes reais ou escolha explícita de estimativa são distinguíveis. AF02 elimina a estimativa oculta existente.

### UL05 · Copiar bundles/assets, usar APIs privadas Nexlev, contornar licença ou responder declarações de monetização automaticamente sem base verdadeira.

Categoria: `unavailable_legitimately`. Estado: `scope_prohibition`.

Motivo: As restrições explícitas da tarefa proíbem esses caminhos. Salvar/revisar manualmente no Studio foi mantido pela especificação atual; não é gap a automatizar sem prova/escopo novo.

Aceite:

- Somente implementação/ativos/contratos próprios; nenhuma chamada Nexlev ou declaração inventada.

### UL06 · Mostrar saldo/cota de Nexlev/ChatGPT/Claude/Omni como conhecido sem endpoint autorizado.

Categoria: `unavailable_legitimately`. Estado: `no_authorized_quota_contract`.

Motivo: Catálogo de capacidades e contador próprio de tentativas não provam saldo ou consumo monetário; o contrato atual não fornece essa evidência.

Aceite:

- Uso próprio é rotulado como tentativas/resultados; quota externa fica desconhecida até fonte autorizada, sem número simulado.

## Escolhas de escopo que não são gaps inventados

- Não automatizar Save/Continuar final no Studio por esta auditoria.
- Não inventar seletor de idioma: não há evidência de que a referência ofereça isso.
- Não declarar AI batching ausente: não integra a lista de diferenças comprovadas.
- Não usar o número de release/commit como critério de conclusão: tarefas implementáveis abertas continuam trabalho.

Esta auditoria não executou rede, geração, chave/cota, conta real, configuração de clientes ou a extensão original. O código novo deve preservar a separação entre fonte, fórmula, cobertura, estado de configuração e prova de runtime.
