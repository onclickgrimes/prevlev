# Checkpoint D20/D26 · vínculo de contexto

Em 3 de novembro de 2026, `npm run check` passou com **630 testes em 54 arquivos**, typecheck, lint e build. **10 cenários direcionados de navegador** passaram no build final, incluindo troca de backend com reseleção do mesmo modelo/origem e troca de vídeo descartando publicação/período. A suíte integral anterior do follow-up (124 aprovações e dois ignorados) não foi repetida neste checkpoint localizado.

O cache de transcrição inclui o backend salvo na identidade e é invalidado ao salvar/remover conexão, inclusive quando o endpoint é mantido e as credenciais podem ter mudado. A data declarada de publicação e os campos de período são limpos ao mudar vídeo/contexto da coleta ou aba selecionada. Mudanças somente de query/período no mesmo vídeo preservam a declaração. Os testes usam fixtures; nenhuma nova geração ou ação real no Studio foi executada.

As outras sete frentes da auditoria pós-publicação continuam em desenvolvimento independente; este checkpoint não declara equivalência completa.

# Validação do follow-up local de segurança

Em 3 de novembro de 2026, `npm run check` passou: **typecheck, lint, 628 testes em 54 arquivos e build**. A regressão completa final de navegador passou em **124 cenários**, com **2 ignorados** por política de instalação da extensão, sem contorno. Saída de testes exclusiva; código congelado durante esta rodada. `git diff --check`, leitura dos JSONs e auditoria dos pontos de criação de imagens passaram.

O follow-up parte do commit local `a8f22192db751b9ce52e846f6ceb756d7f8125a6`. Os testes novos verificam START_COLLECTION tardio após troca de aba/pagehide/cancelamento, ausência de corte da transcrição antes de qualquer chamada de catálogo/provedor, exclusão oficial nos helpers genéricos e ordenação estável de fontes elegíveis. As regressões de imagens verificam cabeçalhos minúsculos de 8000×8000 antes do decoder, formatos/MIME/contêiner, corpo HTTP e base64 limitados, fila física de leitura/decode, substituição/cancelamento e descarte após apagar a coleta.

A revisão encontrou e resolveu prazo reiniciado entre leitura e decode, atualização tardia de status remoto e liberação prematura de fontes ainda em decodificação. A primeira rodada automatizada encontrou duas fixtures antigas que usavam bytes fictícios como PNG; foram substituídas por fixtures de imagem reconhecíveis. A rodada final passou completa. A corrida de atualização rápida da prévia também foi reproduzida, corrigida e verificada repetidamente antes da suíte final.

Esta é implementação independente neste checkout. Não se presumiu nem recuperou o conteúdo do executor principal. Nenhum serviço real, geração paga, conta/canal, credencial ou política do usuário foi utilizado/alterado; nenhuma operação GitHub pendente foi repetida. Adapters e runtime reais continuam nos limites já registrados. [Escopo do follow-up](LOCAL_SAFETY_FOLLOWUP.md).

# Validação do patch local independente · D22/D23/D25/D28/D32

Em 3 de novembro de 2026, no checkout separado baseado em `58fb1477ff333eaac7a8bdd3f6a3edc10cd67050`, `npm run check` passou integralmente: **typecheck, lint, 517 testes automatizados em 50 arquivos e build**. A suíte completa final de navegador passou em **112 cenários**, com **2 cenários de extensão instalada ignorados** pela política gerenciada, sem contorno. Ignorados não contam como aprovados. `git diff --check` e a leitura dos JSONs de cobertura também passaram.

Os módulos novos cobrem lucro por período/moeda/origem, Thumbnail Lab em memória, guia/compositor MCP, plano local de remoção e raster visual local de waveform. As fixtures integradas verificam a navegação do workspace sem chamadas automáticas, referências não enviadas, procedência do backend salvo e invalidação ao trocar a aba. A revisão encontrou e corrigiu o registro de backend ainda não salvo e decodificações PNG simultâneas. As cinco fixtures de waveform foram repetidas por um revisor independente.

A primeira rodada integral de navegador teve 109 aprovações, dois ignorados e um erro `ENOENT` em arquivos de trace durante execução concorrente de uma suíte direcionada na mesma pasta de saída. A rodada final usou uma pasta exclusiva e passou integralmente; não foi feita alteração no recurso de transcrição para resolver esse erro de infraestrutura.

Não houve geração real, acesso ao serviço Omni do usuário, conexão de cliente MCP, conta/canal real ou alteração de política. Toggle no card real, remoção real e leitura automática de waveform Studio continuam sem adapter validado. Referências de thumbnail ficam locais pelo contrato atual. Nenhuma publicação GitHub foi executada. Veja [escopo de integração](LOCAL_INDEPENDENT_PATCH.md).

# Validação da versão 0.6.5

Em 3 de novembro de 2026, typecheck, lint e build passaram com **476 testes automatizados em 45 arquivos** (executados antes da alteração exclusiva do número da versão). A integração do relatório de conteúdo no workspace passou em **6 testes direcionados de navegador** no build final. A suíte integral anterior, da v0.6.2, teve 89 aprovados e dois ignorados pela política de extensões; não foi repetida integralmente nesta alteração localizada.

O relatório faz contagens mecânicas na amostra e WPM a partir de declarações explícitas, sem verificar transcrição, duração ou cobertura. Os testes cobrem IDs, origem oficial excluída, duplicatas, cobertura parcial, limites, invalidação da coleta e limpeza da transcrição. Nenhum serviço, conta ou dado real foi acessado. ZIP verificado com CRC e hashes de nove arquivos internos; SHA-256: `5d107ebc25905a9e6c45812605123cce4fbb3db130542485d36e1e68f795d927`.

# Validação da versão 0.6.4

Em 3 de novembro de 2026, typecheck, lint e build passaram com **470 testes automatizados em 43 arquivos**. O relatório diário, suas exportações e a integração do workspace passaram em **6 testes direcionados de navegador**. A suíte integral anterior da v0.6.2 teve 89 aprovados e dois ignorados pela política de extensões; não foi repetida integralmente nesta alteração localizada.

As exportações JSON, CSV e Markdown são ações explícitas e preservam período, origem declarada, cobertura e estados desconhecido/conflito; arquivos baixados permanecem no dispositivo. A validação cobre dados vazios, fórmula de planilha, texto Markdown, anulação por edição/reset e ausência de rede. Nenhum serviço, conta ou dado real foi acessado. ZIP verificado com CRC e hashes de nove arquivos internos; SHA-256: `5152e105b5c6360030b6900baf7f90cdae87b3bcd9038948619426f453830784`.

# Validação da versão 0.6.3

Em 3 de novembro de 2026, typecheck, lint e build passaram com **466 testes automatizados em 43 arquivos**. O relatório diário e a integração do workspace passaram em **6 testes direcionados de navegador**. A suíte completa anterior, da v0.6.2, teve 89 aprovados e dois ignorados pela política de extensões do Chromium; não foi repetida integralmente nesta alteração localizada.

O relatório usa dados declarados, não consulta Studio nem salva os valores. Testes cobrem valores desconhecidos e zero, conflitos, fuso e datas civis inexistentes ou repetidas; o limite conservador de dia completo está descrito na interface. Nenhum serviço, conta ou dado real foi acessado. ZIP verificado com CRC e hashes de nove arquivos internos; SHA-256: `7df6ab1bee05fb4be87ec3871760c1fd5f93e0ab8e36a4ca4f8a733cb5f21770`.

# Validação da versão 0.6.2

Em 3 de novembro de 2026, typecheck, lint e build passaram com **458 testes automatizados em 42 arquivos**. A suíte integral do navegador no build final teve **89 aprovados e dois ignorados** pela política gerenciada que bloqueia a extensão instalada. Uma primeira rodada identificou uma expectativa para a redação antiga de um relatório; após atualização da expectativa, a suíte foi repetida integralmente e aprovada. Nenhuma conta, serviço Omni, geração paga ou API YouTube real foi acessada.

As verificações incluem modos e bases de outlier, exclusão da API oficial, preservação do modo ao selecionar presets, formato desconhecido, duplicatas na amostra, denominadores desconhecidos, truncamento do relatório e exportação CSV com campos ausentes na primeira linha. As diferenças da referência original seguem parcialmente implementadas, sem média global inventada. ZIP verificado por CRC e hashes dos nove arquivos internos; SHA-256: `fc7877c0e7186870b22b7bd4c858bcaadaebd8843d628c80e6fec9986f268f7a`.

# Validação da versão 0.6.1

Em 3 de novembro de 2026, typecheck, lint e build passaram, com **451 testes automatizados em 41 arquivos**. O compositor e o workspace passaram em **8 testes direcionados de navegador**, cobrindo PNG real, formatos, transparência, escala, limpeza após alterar a coleta e limitação de decodificação concorrente. A rodada completa anterior da v0.6.0 teve 83 aprovados e dois testes de extensão instalada ignorados pela política gerenciada do Chromium; a v0.6.1 não repetiu essa rodada completa.

A composição usa somente imagens locais escolhidas e metadados informados ou selecionados explicitamente; registros da API oficial são excluídos. O arquivo é validado antes de decodificar. ZIP testado com CRC e hashes dos nove arquivos internos; SHA-256: `8d893b5b34e81e351b6a0519c8d8c7b9f549506f49e4b5e90eb1b067b925405d`. Não houve acesso a conta, serviço Omni, geração paga ou API real.

# Validação da versão 0.6.0

Executado em 3 de novembro de 2026 com Node.js 24 e Chromium 154: typecheck, lint e build aprovados; **448 testes automatizados em 40 arquivos e 83 testes de navegador aprovados**. Dois testes de extensão instalada foram ignorados pela política gerenciada do Chromium; não contam como aprovados. Uma rodada anterior teve dois erros de arquivos temporários por testes concorrentes; a repetição isolada passou. Nenhuma conta, serviço Omni, geração paga ou API YouTube real foi acessada.

As fixtures incluem controles do Studio, prévias concorrentes, limites de WAV, filtros e invalidação de nicho no workspace, comparação visual com validação antes da decodificação e categorias de ocultação em capturas. Isso não comprova o funcionamento nos serviços ou na extensão instalada. O ZIP foi validado com CRC e SHA-256 de seus nove arquivos internos; SHA-256 do pacote: `a01827b61f5a75187cde4a0ff7d358ef22ad6cb6dccc87be3e4497f4bbe3878f`.

A comparação com a referência parte de análise estática informada pelo coordenador; o ZIP de especificação original não foi lido neste executor. Consulte [ledger](ORIGINAL_GAP_LEDGER.md) e [auditoria](GAP_AUDIT.md) para diferenças e limites.

# Validação da versão 0.5.0

Executado em 3 de novembro de 2026 com Node.js 24 e Chromium 154: typecheck, lint e build aprovados; **426 testes automatizados em 35 arquivos e 70 testes de navegador aprovados**. Dois testes de extensão instalada foram ignorados pela política gerenciada do Chromium; não contam como aprovados. A sincronização da biblioteca e o histórico usam backend próprio temporário via relay controlado nos testes. Nenhuma conta, serviço Omni, geração paga ou API YouTube real foi acessada.

O ZIP foi validado com leitura independente, CRC e hashes dos arquivos internos. SHA-256: `aa4e28caecd122fd8bb4851be447a5d446ba798ee3a8917f535b837fec29ec88`. A análise REA e os 33 pontos da referência foram reportados pelo coordenador por inspeção estática, sem executar a extensão original neste executor. Os detalhes de escopo e pendências estão no [ledger](ORIGINAL_GAP_LEDGER.md) e na [auditoria](GAP_AUDIT.md).

A validação da versão anterior aparece abaixo para distinguir as evidências.

# Validação: histórico da versão 0.4.0

Execução neste executor em 3 de novembro de 2026, Node.js 24.19.0 e Chromium 154.0.8037.57.

| Verificação | Resultado |
| --- | --- |
| `npm run typecheck` | Aprovado |
| `npm run lint` | Aprovado |
| `npm test` | 295 testes aprovados em 20 arquivos |
| `npm run build` | Aprovado; MV3 gerada em `dist/` |
| `npm run test:ui` | 27 aprovados; 2 ignorados pela política de extensões |

## Entrega e evidências desta etapa

A versão 0.4 amplia o produto com pesquisa oficial opcional, relatório local, histórico próprio e MCP de leitura. As interfaces estão integradas ao bundle `workspace.js`, com ações funcionais; não são apenas helpers ou uma lista de recursos futuros. As fontes e limitações são separadas na [matriz dos 40 recursos](FEATURES.md).

- **Fonte oficial:** [youtube.test.ts](../tests/youtube.test.ts) verifica opt-in/chave/consentimento, host e rotas fixas, valores brutos e contadores decimais, campos ausentes, paginação, lotes, cancelamento, prazo total, limites de resposta e erros sanitizados. [official-search.spec.ts](../tests/browser/official-search.spec.ts) executa a UI construída com todas as requisições interceptadas: seleção/consentimento, três páginas manuais, até 75 resultados, precisão de contadores, texto/links seguros, separação de armazenamento/cálculos, dados ocultos, cancelamento, respostas inválidas e expiração de 24 horas.
- **Relatório local:** [analytics.test.ts](../tests/analytics.test.ts) e [analytics.spec.ts](../tests/browser/analytics.spec.ts) cobrem cobertura, formatos desconhecidos, identidades de canal, meses UTC, médias/medianas, filtros com baseline de outlier preservada, duplicatas, conflitos, estabilidade numérica e downloads reais JSON/CSV/Markdown. Registros marcados como API oficial são excluídos antes das derivações. Views agrupadas por mês são contadores dos vídeos publicados naquele mês; não são tráfego mensal.
- **Histórico:** [history.test.ts](../tests/history.test.ts) verifica arquivos temporários, escrita atômica/privada, concorrência no processo, limites/retenção, contagens ausentes/zero, observação versus gravação, regravação de coleta antiga, legado por ID, exportação, exclusão confirmada, arquivos inválidos e fontes recusadas. A rota HTTP é coberta em [backend.test.ts](../tests/backend.test.ts). A interface tem testes em [history.spec.ts](../tests/browser/history.spec.ts) contra o backend próprio em loopback e diretórios temporários, por relay HTTP do transporte de fixtures. Verifica arquivos efetivamente gravados, downloads, taxas e alteração de conexão durante confirmação, sem YouTube/Omni real.
- **MCP:** [mcp.test.ts](../tests/mcp.test.ts) usa o SDK oficial em memória e processo stdio, incluindo negociação `2026-07-28`, schemas estritos, limites, leitura de histórico sem alterar arquivos, recusa de dados oficiais e importação/inicialização desativada sem I/O. Isso verifica o protocolo local; nenhum aplicativo MCP do usuário foi registrado ou configurado.
- **Transporte e controles:** [backend-operation.test.ts](../tests/backend-operation.test.ts) verifica as duas rotas novas, origem/token, ausência de cookies/retry, cancelamento, limite de leitura, erro offline e respostas incompletas. Os testes HTTP verificam autenticação, origem, JSON/1 MiB, limite compartilhado e interrupção dos lotes oficiais quando o cliente desconecta.

A revisão independente encontrou e corrigiu derivação de dados oficiais pela rota HTTP, duplicatas inflando relatórios, horário de gravação substituindo o instante original da coleta e confirmação de exclusão antes de fixar o backend de destino. Há regressões para esses casos. O histórico também informa somente novos registros efetivamente retidos, mesmo quando uma amostra antiga sai imediatamente pelo limite de retenção.

Nenhuma chave real foi criada, fornecida ou usada na fonte oficial. Nenhuma pesquisa, cota, geração, conta real ou serviço do usuário foi acessado. Os resultados simulados estão nos testes; recursos sem configuração retornam indisponibilidade explícita no produto.

## Cobertura preservada

Os testes anteriores cobrem parsing PT/EN, cálculos e incertezas, filtros e ordenação, comentários, transcrição, exportação segura, canvas/mídia, enriquecimento público, autenticação/CORS, segurança de mensagens, screenshots transacionais, navegação SPA e limpeza/retomada de observers.

Os cenários Chromium de pesquisa/Studio conectam os bundles próprios `workspace.js` e `content.js` por transporte Chrome simulado em páginas interceptadas. Cobrem aplicação/restauração dos filtros no DOM, timeline/player, prévia/confirmação/cancelamento, criação de rascunhos mid-roll sem Salvar e rejeição de comentários reciclados mantendo o botão. Não usam canal real. Fixtures/mocks ficam em `tests/`, fora do pacote da extensão.

## OmniProviders: contrato e fixtures

O contrato foi inspecionado somente por leitura no repositório OmniProviders, commit `cd4e6a2efd5cdd54ec9bcea274a86ed854932120`: catálogo, capacidades, autenticação, Responses JSON/SSE e artefatos. Não se executou/importou o app Omni nem se acessou `127.0.0.1:7814` da máquina do usuário. Uma porta deste executor não foi tratada como a instalação do usuário.

As fixtures cobrem seleção exata/origem, revalidação do catálogo, JSON/SSE terminal, respostas incompletas, falhas, EOF, imagem não suportada, artefatos autenticados, prazos e ausência de repetição. Cinco cenários de UI verificam seleção/capacidades e tarefas com requisições interceptadas. O backend usa prazo total limitado, incluindo descoberta e operação. Nenhuma geração real ou crédito foi consumido.

A origem padrão é `http://127.0.0.1:7814`, editável por `OMNI_BASE_URL` no servidor. Chaves de provedores permanecem no Omni; a chave de acesso ao serviço, se exigida, permanece no backend. O navegador usa somente a ponte Prevlev. Consulte [OMNIPROVIDERS.md](OMNIPROVIDERS.md).

## Verificação bloqueada e runtime pendente

Ação bloqueada: carregar a extensão MV3 em perfil Chromium deste executor para executar `tests/browser/extension.spec.ts`. Alvo: build próprio `/workspace/prevlev/dist/`. Motivo: `/etc/chromium/policies/managed/extensions.json` contém `ExtensionInstallBlocklist: ["*"]`; o service worker não iniciou. Nenhuma política foi alterada ou contornada. Os dois cenários estão **ignorados**, sem contar como aprovados. Não foi rejeição do revisor automático de aprovação.

Uma tentativa de fetch nativo da página HTTPS de teste para o backend temporário em loopback foi negada pelo Chromium por acesso ao espaço de endereços local. O teste de histórico usa `route.fetch()` como relay controlado ao mesmo servidor HTTP real, preservando autenticação, rotas e arquivos. Nenhuma permissão ou política foi modificada. Esse teste não comprova o transporte nativo de uma extensão instalada.

É necessária validação em Chrome que permita a extensão: permissões opcionais, clipboard, captura `activeTab`, layouts atuais e aceitação das ações pelo YouTube/Studio. Screenshots exigem invocar o ícone na aba alvo para a concessão temporária. Referências: [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [captureVisibleTab](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab). Capturas são revalidadas e descartadas por mudanças de contexto; a ocultação cobre campos reconhecidos e não garante anonimização total.

Uma tentativa anônima anterior de consultar `https://www.youtube.com/@YouTube/videos` retornou `fetch failed`; compatibilidade com a resposta pública atual continua não verificada. A nova API oficial não foi chamada com chave real. O serviço Omni e um cliente MCP do usuário não foram acessados.

## Configuração e lacunas de produto

- Pesquisa oficial: ativar a fonte e fornecer uma chave existente autorizada somente no servidor. A UI exibe dados brutos; isso não habilita métricas derivadas ou descoberta global por similaridade/nicho.
- Histórico: iniciar o backend pessoal, escolher `DATA_DIR` e registrar observações explicitamente. Não existe histórico retroativo ou coleta agendada.
- MCP: iniciar processo stdio e conectar manualmente um cliente compatível, se desejado. Não há integração automática ou acesso à sessão do navegador.
- IA: iniciar/configurar a ponte na máquina do Omni existente e escolher um modelo anunciado com capacidades compatíveis. Conectividade e geração reais permanecem sem validação.
- Continuam pendentes insights privados do Studio, receita/RPM/geografia indisponíveis, descoberta global por similaridade, sincronização e autenticação/isolamento multiusuário. Nenhum dado financeiro ausente é fabricado.

REA foi executado pelo coordenador e orientou a especificação; o recibo integral não foi materializado neste executor porque o download falhou. A análise focada relatada cobriu 61 módulos selecionados, sem equivaler a cobertura integral/runtime/backend. Detalhes em [REA.md](REA.md).
