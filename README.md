# Prevlev · v0.4.0

Extensão Chrome Manifest V3 independente para pesquisar vídeos, preparar imagens e operar ferramentas assistidas no YouTube/Studio. O núcleo funciona no navegador; análises de amostra e IA usam um backend próprio opcional.

Esta versão **não declara paridade completa com Nexlev 3.12.6**. Entrega funções locais reais e adaptadores independentes, mantendo explícitos os dados ausentes, os serviços não configurados e as diferenças de cobertura. Consulte a [matriz dos 40 recursos](docs/FEATURES.md) e sua [versão JSON](docs/feature-status.json).

## Instalar no Chrome

Requisitos: Node.js 24 e npm. Em um checkout deste repositório:

```bash
npm ci
npm run check
```

O comando verifica TypeScript, ESLint, testes e gera a extensão em `dist/`. Para gerar novamente após uma mudança, execute `npm run build`.

1. Abra `chrome://extensions` e ative **Modo do desenvolvedor**.
2. Selecione **Carregar sem compactação** e escolha a pasta `dist/`.
3. Recarregue as abas do YouTube/Studio que já estavam abertas.
4. Abra uma página do YouTube. Use o painel **Prevlev · Ferramentas** ou o ícone da extensão para abrir o espaço de trabalho.
5. Escolha a aba e clique em **Coletar aba**. Role/carregue os itens desejados no YouTube antes de coletar novamente.

A coleta considera o conteúdo carregado na página: não percorre automaticamente todo o canal ou todos os comentários. Abra **Mostrar transcrição** no YouTube antes de coletar legendas. Valores desconhecidos aparecem como indisponíveis.

## O que está disponível

- Filtros completos de vídeos carregados por título/canal, views, inscritos, duração, VPH, outlier, datas e formato, com ordenação e ações explícitas para aplicar/restaurar os cards no YouTube.
- Painel de canal com recentes/populares da primeira resposta HTML pública e análise de marcadores de monetização em até cinco vídeos da amostra.
- Coleta, filtro, cópia e exportação de comentários; transcrição visível/importada com exportação TXT, VTT e Markdown.
- Timeline do player nativo com busca por trechos, seleção/cópia/exportação da transcrição, posicionamento, reprodução/pausa e captura de frame.
- Compressão proporcional de imagens, prévia de thumbnail/título, download/cópia de thumbnails públicas e captura de frame ou de áreas visíveis.
- Calculadora de lucro, leitura de métricas visíveis e ações assistidas no Studio com prévia, confirmação e cancelamento.
- Swipe File local com referências, pastas por nome e importação/exportação JSON.
- Relatório local com cobertura dos dados, médias/medianas, formatos, canais, meses de publicação, intervalo observado e exportações JSON/CSV/Markdown. Filtros preservam a referência completa de outlier.
- Histórico próprio no backend: registro manual da coleta, consulta, diferenças entre observações reais, exportação e exclusão confirmada, com limites de retenção.
- Pesquisa oficial opcional por vídeos/canais públicos, valores brutos atribuídos ao YouTube e até três páginas manuais. Dados separados da coleta local e das métricas calculadas.
- Backend opcional com similaridade lexical e integração ao OmniProviders existente, com seleção explícita de provedor/modelo.
- MCP local por stdio, desativado por padrão, com cinco ferramentas de análise e leitura do histórico, sem rede ou geração.

VPH é a média de views desde a publicação, e não as visualizações da última hora. Outlier usa pelo menos três outros vídeos comparáveis da amostra. Quando há identidade de canal conhecida, não mistura canais ou referências sem identidade; quando o alvo não tem identidade, a referência é a amostra informada. Marcadores de anúncios não confirmam que um criador recebe receita. Não são produzidos valores de RPM, geografia ou receita de canais a partir de dados ausentes.

O enriquecimento de inscritos é manual: consulta páginas públicas do YouTube de até dez canais por ação, sem credenciais, preservando como desconhecidas as contagens ausentes. A análise de silêncios para mid-roll usa um arquivo de áudio local escolhido pelo usuário; o arquivo não é enviado ao backend.

O painel de canal não pagina a coleção e ordena apenas os vídeos reconhecidos no HTML inicial. “Mais populares” significa mais views dentro dessa amostra. A timeline usa a duração disponível no player e recusa comandos se a identidade do vídeo mudar. O passo de 1/30 s é estimado; a extensão não detecta o FPS real nem promete precisão de um frame.

## Backend e IA opcionais

As ferramentas locais funcionam com a conexão vazia. Para análises remotas, siga [BACKEND.md](docs/BACKEND.md), configure seu servidor e salve a origem/token na aba **Conexão**. Cada envio parte de uma ação explícita. O servidor analisa o dataset recebido; a fonte oficial opcional oferece pesquisa pública separada e não fornece uma base global própria de analytics.

O modo padrão de IA usa o **OmniProviders já existente**: extensão → backend Prevlev em `127.0.0.1:8787` → Omni em `127.0.0.1:7814`. No Node.js 24, execute `npm ci`, `npm run build`, em uma instalação nova copie `.env.example` para `.env` (preserve o arquivo existente se já houver), preencha os placeholders localmente e inicie `npm run server`. A origem Omni é alterada somente por `OMNI_BASE_URL` no servidor; reinicie o backend após mudar `.env`. Os dois loopbacks pressupõem navegador, Prevlev e Omni na mesma máquina.

Na extensão, clique em **Consultar modelos** e escolha o provedor/modelo anunciado para a tarefa. O seletor não escolhe o primeiro modelo nem substitui uma seleção incompatível. Texto usa as capacidades Responses JSON/SSE; thumbnail só fica disponível se o catálogo anunciar geração e saída de imagem. Um catálogo acessível não comprova saldo ou geração real. O código revalida o catálogo antes de gerar e mantém indisponibilidades explícitas.

A chave existente de acesso ao serviço Omni, quando exigida, fica em `OMNI_API_KEY` apenas no ambiente do backend. Credenciais de provedores/OAuth permanecem no Omni; não vão para a extensão ou para o chat. A instalação e as fontes verificadas do contrato estão em [OMNIPROVIDERS.md](docs/OMNIPROVIDERS.md). O modo anterior permanece disponível por escolha explícita de `AI_PROVIDER=openai-compatible`, sem fallback automático entre modos.

Os testes usam fixtures, sem acessar o serviço/contas Omni do usuário nem consumir gerações ou créditos. Para hospedagem pública ainda é necessário escolher infraestrutura, HTTPS, autenticação de produção e isolamento de dados. O backend fornecido destina-se a uma instalação pessoal.

## Pesquisa oficial, relatório e histórico

A aba **Pesquisa oficial** começa sem fonte selecionada e sem consentimento. Para usá-la, o operador deve configurar `YOUTUBE_ENABLED=true` e uma chave **já existente** em `YOUTUBE_API_KEY` no `.env` do servidor; não coloque essa chave na extensão. Cada pesquisa/próxima página é manual e pode consumir cota do projeto. O fluxo limita cada página a 25 resultados e cada consulta a três páginas; cancelar impede as etapas seguintes, mas não desfaz solicitações aceitas pelo Google. Veja o contrato e os limites em [YOUTUBE.md](docs/YOUTUBE.md).

Os resultados oficiais ficam somente em memória, expiram em até 24 horas e exibem contadores brutos. Não são importados na pesquisa local, enviados para IA ou usados em VPH, outlier, histórico, somas ou médias. O relatório local permanece sobre observações da página e material fornecido pelo usuário, com origem e cobertura explícitas. A pesquisa oficial não foi chamada com uma chave real nesta execução.

Em **Relatório local**, gere uma análise da coleta inteira ou dos filtros da aba Pesquisa e exporte os dados disponíveis. Meses agrupam datas de publicação; as views são contadores observados, não o tráfego recebido naquele mês. Em **Histórico próprio**, registre manualmente até 100 vídeos por ação no backend configurado. A retenção padrão é de até 5.000 observações no total, ajustável por `HISTORY_MAX_RECORDS`; o armazenamento também tem limite de 10 MiB. Registros antigos podem sair quando o limite for atingido. Consulte/exporte/exclua antes de perder dados que queira preservar. Não há agendamento ou histórico retroativo. Veja [HISTORY.md](docs/HISTORY.md).

O MCP usa um processo separado: `MCP_ENABLED=true npm --silent run mcp`, no diretório do projeto com Node.js 24. Esse comando habilita somente o processo iniciado; não instala nem registra integração em outro aplicativo. Para um cliente MCP, use o executável Node e caminhos absolutos conforme [MCP.md](docs/MCP.md). As ferramentas não geram IA, acessam o YouTube, alteram canais ou gravam histórico.

## Ações no Studio

Nenhuma alteração de canal é iniciada ao carregar uma página. Operações de corações, monetização e intervalos exigem uma prévia com os controles reconhecidos e confirmação explícita. A prévia expira, é de uso único e é recusada se os controles mudarem. Cancelar interrompe as próximas ações, sem desfazer cliques já enviados.

O adaptador de mid-roll apresenta posições e quantidade de novos intervalos na prévia. Após confirmação, preenche os campos existentes e pode criar **rascunhos** pelo botão Inserir reconhecido dentro de um único editor, aguardando até um segundo por novo campo. Não clica em **Continuar** nem **Salvar**; revisão e salvamento ficam com o usuário. O avanço de monetização preserva a escolha já feita e não responde questionários de adequação. Períodos personalizados exigem seletor aberto com campos reconhecidos. Layouts desconhecidos resultam em mensagem de indisponibilidade. Os adaptadores foram verificados em fixtures, sem operação em canal real.

Corações são vinculados ao comentário revisado por identidade, autor e texto. Antes de cada clique, o adaptador revalida o contexto e interrompe se a interface reciclar o mesmo botão para outro comentário. Isso não confirma a aceitação do clique pelo servidor YouTube.

## Desenvolvimento e verificação

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:ui
```

Os testes cobrem cálculos e incertezas, parsing PT/EN, dados ausentes, coleta em fixtures, transcrição, exportação, limites de mídia, confirmação/cancelamento do Studio e chamadas HTTP do backend em loopback. O adaptador de IA usa fixtures e respostas simuladas identificadas somente nos testes. A aprovação dessas verificações não comprova compatibilidade com todos os layouts ou uma integração real com provedor externo.

`test:ui` requer o build em `dist/` e um Chromium disponível. Os testes de navegador em fixtures cobrem UI/canvas, Studio e pesquisa/timeline; o resultado consolidado desta versão está em [VALIDATION.md](docs/VALIDATION.md). Os cenários integrados usam os bundles próprios `workspace.js`/`content.js` com transporte Chrome simulado e URLs interceptadas, sem conta real. Os testes de extensão instalada foram explicitamente ignorados porque a política gerenciada deste ambiente contém `ExtensionInstallBlocklist=[*]`. Não houve contorno da política; esses testes não contam como aprovados.

Uma tentativa anônima de consultar `https://www.youtube.com/@YouTube/videos` retornou `fetch failed` neste ambiente. O parser público tem testes em fixtures; compatibilidade com a fonte atual, seletores reais do Studio e aceitação de ações pelo servidor continuam sem validação. A [matriz de cobertura](docs/FEATURES.md) separa implementação local, runtime pendente e configuração/trabalho de produto.

| Diretório           | Responsabilidade                                                            |
| ------------------- | --------------------------------------------------------------------------- |
| `src/core`          | Cálculos, filtros, parsing, transcrição, mídia e planejamento de intervalos |
| `src/content`       | Leitura e controles de DOM de YouTube/Studio                                |
| `src/ui`            | Popup e espaço de trabalho da extensão                                      |
| `src/shared`        | Contratos, armazenamento e cliente de backend                               |
| `src/background.ts` | Mensagens, captura da aba e envio manual ao backend                         |
| `server`            | Servidor próprio, análises do dataset e adaptador opcional de IA            |
| `tests`             | Testes unitários e integração em fixtures/loopback                          |
| `docs`              | Cobertura, backend e privacidade                                            |

Capturas ativam a aba e medem o alvo antes e depois de capturar. Mudanças detectadas em URL, viewport, rolagem, revisão do DOM, geometria ou identidade dos campos sensíveis descartam a imagem. Isso reduz capturas inconsistentes; a ocultação cobre apenas os campos reconhecidos e não garante anonimização total.

## Pendências além do runtime

Usar IA exige conectar o backend ao Omni existente e selecionar um modelo compatível. A pesquisa oficial exige a chave existente do operador e opt-in; seu runtime real permanece não verificado. O MCP exige iniciar e configurar manualmente um cliente local. Descoberta global por similaridade/nicho, insights privados do Studio, dados financeiros indisponíveis, sincronização em nuvem e autenticação multiusuário continuam pendentes. Configurar uma URL não cria essas fontes ou integrações.

## Método e limites da reconstrução

O comportamento de referência foi especificado por inspeção estática e REA CLI `rea-agents@6.7.0`. A análise focada relatada examinou 61 de 61 módulos selecionados, sem módulos ignorados, falhas de parsing ou contradições de integridade. A tentativa inicial de analisar a árvore inteira encontrou limite de heap em seis bundles. Isso não constitui cobertura integral do pacote, observação de runtime ou verificação dos servidores originais.

A implementação deste repositório usa nomes, interface, código e contratos próprios. Não publica ZIP, bundles, imagens, tokens ou outros assets proprietários da referência. Não acessa APIs Nexlev, não contorna licença/premium e não requer uma conta Nexlev.

O registro de método, identidade da referência e limite da transferência da especificação está em [docs/REA.md](docs/REA.md). O ZIP de especificação não pôde ser baixado neste executor; os números da análise REA são os comunicados pelo coordenador, sem alegação de leitura local do recibo integral.

Leia [Privacidade e armazenamento](docs/PRIVACY.md) antes de configurar um backend ou compartilhar capturas.

O resultado da execução e as verificações bloqueadas estão em [VALIDATION.md](docs/VALIDATION.md). Para os testes de navegador, use `PREVLEV_CHROMIUM_PATH` com um Chromium existente ou instale o Chromium do Playwright com `npx playwright install chromium`.
