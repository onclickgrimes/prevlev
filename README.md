# Prevlev

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

- Filtros e ordenação de vídeos carregados, ocultação de Shorts, contagens, VPH médio e outlier com referência explícita da amostra.
- Coleta, filtro, cópia e exportação de comentários; transcrição visível/importada com exportação TXT, VTT e Markdown.
- Compressão proporcional de imagens, prévia de thumbnail/título, download/cópia de thumbnails públicas e captura de frame ou de áreas visíveis.
- Calculadora de lucro, leitura de métricas visíveis e ações assistidas no Studio com prévia, confirmação e cancelamento.
- Swipe File local com referências, pastas por nome e importação/exportação JSON.
- Backend opcional com relatórios sobre os dados enviados, similaridade lexical, registro de observações de views e adaptador configurável de IA.

VPH é a média de views desde a publicação, e não as visualizações da última hora. Outlier usa os vídeos comparáveis da amostra. Marcadores de anúncios não confirmam que um criador recebe receita. Não são produzidos valores de RPM, geografia ou receita de canais a partir de dados ausentes.

O enriquecimento de inscritos é manual: consulta páginas públicas do YouTube de até dez canais por ação, sem credenciais, preservando como desconhecidas as contagens ausentes. A análise de silêncios para mid-roll usa um arquivo de áudio local escolhido pelo usuário; o arquivo não é enviado ao backend.

## Backend e IA opcionais

As ferramentas locais funcionam com a conexão vazia. Para usar análises remotas, siga [docs/BACKEND.md](docs/BACKEND.md), configure seu servidor e salve a origem/token na aba **Conexão**. Cada envio ao backend parte de uma ação explícita na interface.

O servidor incluído analisa apenas o dataset recebido; ele não substitui uma base global de pesquisa do YouTube. IA e geração de imagem retornam `not_configured` até que o operador escolha um provedor/modelo e forneça as próprias credenciais no servidor. A extensão nunca precisa receber a chave do provedor de IA. Os testes não consomem serviços pagos.

Para hospedagem pública ainda é necessário escolher infraestrutura, HTTPS, autenticação de produção e isolamento de dados entre usuários. O backend fornecido é destinado a uma instalação pessoal.

## Ações no Studio

Nenhuma alteração de canal é iniciada ao carregar uma página. Operações de corações, monetização e intervalos exigem uma prévia com os controles reconhecidos e confirmação explícita. A prévia expira, é de uso único e é recusada se os controles mudarem. Cancelar interrompe as próximas ações, sem desfazer cliques já enviados.

O adaptador de mid-roll preenche intervalos **já abertos**, deixando criação e salvamento para o usuário. O avanço de monetização preserva a escolha já feita e não responde questionários de adequação. Períodos personalizados exigem seletor aberto com campos reconhecidos. Layouts desconhecidos resultam em mensagem de indisponibilidade. Os adaptadores foram verificados em fixtures, sem operação em canal real.

## Desenvolvimento e verificação

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:ui
```

Os testes cobrem cálculos e incertezas, parsing PT/EN, dados ausentes, coleta em fixtures, transcrição, exportação, limites de mídia, confirmação/cancelamento do Studio e chamadas HTTP do backend em loopback. O adaptador de IA usa fixtures e respostas simuladas identificadas somente nos testes. A aprovação dessas verificações não comprova compatibilidade com todos os layouts ou uma integração real com provedor externo.

`test:ui` requer o build em `dist/` e um Chromium disponível. Quatro testes de UI passaram usando fixtures das APIs Chrome: salvar/exportar Swipe File, canvas real para imagens e integração dos bundles próprios `workspace.js`/`content.js` para prévia, confirmação, cancelamento e recusa de alvo alterado no Studio. Nos testes de Studio todas as URLs são interceptadas, sem contato com YouTube ou conta real. Os dois testes de extensão instalada foram explicitamente ignorados porque a política gerenciada deste ambiente contém `ExtensionInstallBlocklist=[*]`. Não houve contorno da política; esses testes não contam como aprovados. A verificação separada por tipo de evidência está na [matriz de cobertura](docs/FEATURES.md).

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

## Método e limites da reconstrução

O comportamento de referência foi especificado por inspeção estática e REA CLI `rea-agents@6.7.0`. A análise focada relatada examinou 61 de 61 módulos selecionados, sem módulos ignorados, falhas de parsing ou contradições de integridade. A tentativa inicial de analisar a árvore inteira encontrou limite de heap em seis bundles. Isso não constitui cobertura integral do pacote, observação de runtime ou verificação dos servidores originais.

A implementação deste repositório usa nomes, interface, código e contratos próprios. Não publica ZIP, bundles, imagens, tokens ou outros assets proprietários da referência. Não acessa APIs Nexlev, não contorna licença/premium e não requer uma conta Nexlev.

O registro de método, identidade da referência e limite da transferência da especificação está em [docs/REA.md](docs/REA.md). O ZIP de especificação não pôde ser baixado neste executor; os números da análise REA são os comunicados pelo coordenador, sem alegação de leitura local do recibo integral.

Leia [Privacidade e armazenamento](docs/PRIVACY.md) antes de configurar um backend ou compartilhar capturas.

O resultado da execução e as verificações bloqueadas estão em [VALIDATION.md](docs/VALIDATION.md). Para os testes de navegador, use `PREVLEV_CHROMIUM_PATH` com um Chromium existente ou instale o Chromium do Playwright com `npx playwright install chromium`.
