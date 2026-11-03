# Ledger de diferenças comprovadas da referência

Este ledger registra as33 diferenças transmitidas pelo coordenador. A evidência da referência é **estática e relatada pelo parent**; não foi executada a extensão original neste executor. IDs de módulos abaixo são os identificadores informados, não Evidence IDs inventados ou links para bundles publicados.

Estado Prevlev inspecionado sobre `e22c7bf0c7d1ccf964390ab4db159bd8d70b0b46` (v0.4.0). Trabalho em andamento pode resolver itens depois desse instante; registrar o aceite antes de fechar um item.

A ordem é original → Prevlev → diferença → verificação/limite. [gap-audit.json](gap-audit.json) relaciona cada item aos40 recursos e aos bloqueios de ambiente/fonte.

## Checkpoint de implementação v0.5

A base histórica abaixo continua identificada como v0.4. O código posterior amplia transcrição moderna e virtualizada, leitura de receita e seletores do Studio, presets e ordenação dupla, coleta limitada, comentários, Swipe File, patrocínios e prévias de imagem. O aceite por fixtures não prova paridade ou funcionamento em conta real. O JSON acrescenta `checkpointV05` para cada item e seus testes, preservando a descrição histórica original. As tarefas remanescentes continuam abertas no ledger; o marco não encerra o desenvolvimento.

## Marco v0.6

As entradas históricas e seus aceites abaixo permanecem abertos até revalidação. O marco adiciona: explorador de nicho sobre amostra local com cobertura e exportações (D30); comparação dHash entre imagens locais selecionadas (D31); planos de mid-roll e pré-validação de WAV local (D21–D22); visão geral observada do Studio e presets de dias UTC completos a partir de data informada (D25–D26); e categorias explícitas de ocultação com recusa quando uma categoria selecionada não é reconhecida no card (D24). O usuário continua responsável por revisar e salvar no Studio.

Esses recursos não estabelecem paridade com a referência relatada, acesso à base global, analytics privado, anonimização completa ou funcionamento em conta real. Registros da API oficial permanecem excluídos das derivações. A validação por fixtures está documentada em VALIDATION.md; o bloqueio da extensão instalada pela política do Chromium e as limitações de runtime permanecem.

## Marco v0.6.1

O compositor local de D17 gera uma ilustração de card ou Short a partir de imagem fornecida e metadados explícitos ou de vídeo da coleta. Oferece fundos claros, escuros, personalizados ou transparentes e PNG em 1×/2×. Não recompõe automaticamente cada card da página nem replica a captura do original; a diferença permanece parcial.

## Marco v0.6.2

A referência local de outlier informa modo, denominador, contagem, método, procedência e exclusões em relatórios e exportações. Presets preservam o modo escolhido. A referência continua parcial e não substitui média real de um catálogo completo; formatos desconhecidos formam grupo próprio e observações repetidas podem contar.

## Marco v0.6.3

Em D27 há um relatório diário manual, em memória, de contagens declaradas pelo usuário para um canal e um período comum. Não integra Studio nem presume que a amostra inclua todos os vídeos; desconhecidos e conflitos são exibidos. Dias completos em fusos fora de UTC usam uma espera conservadora para alterações históricas de fuso.

## Marco v0.6.5

Em D29, o relatório local acrescenta contagens mecânicas de formato e título na amostra, e WPM mediante ID elegível, transcrição, duração e cobertura declarados pelo usuário. Não verifica essas declarações nem infere tópicos, estratégia ou receita. A diferença em relação ao relatório original permanece parcial.

## D01 · P0

Referência informada: módulos `6buNu`. Recursos: 10, 29.

**Original, por análise estática reportada:** Transcrição moderna por transcript-segment-view-model e classes .ytwTranscriptSegmentViewModel*.

**Prevlev na inspeção:** Leitores atuais reconhecem ytd-transcript-segment-renderer e seletores legados/data-attributes.

**Diferença recuperável:** Adicionar os seletores modernos com extração de texto/start/duração sem executar scripts.

Categoria: `implementable_now`; runtime separado: `RT01`. Estado: `open_or_assigned_in_current_phase`.

Código: [transcript.ts](../src/core/transcript.ts), [youtube.ts](../src/content/youtube.ts), [timeline.ts](../src/content/timeline.ts).

**Aceite e testes necessários:**

- Fixture moderna produz os mesmos segmentos que a equivalente legada.
- Textos de marcação são tratados como dados; timestamps inválidos continuam ausentes.

## D02 · P0

Referência informada: módulos `jaobz/6buNu`. Recursos: 10, 29.

**Original, por análise estática reportada:** Mapa por vídeo acumula segmentos virtualizados A/B → B/C como A/B/C, preserva seleção e reseta na troca de vídeo.

**Prevlev na inspeção:** Timeline substitui segmentos pelo DOM atual e limpa a seleção quando a assinatura muda.

**Diferença recuperável:** Acumular por identidade de vídeo e chave de segmento estável, com limite e política de conflitos; preservar seleção válida.

Categoria: `implementable_now`; runtime separado: `RT01`. Estado: `open_or_assigned_in_current_phase`.

Código: [timeline.ts](../src/content/timeline.ts), [transcript.ts](../src/core/transcript.ts).

**Aceite e testes necessários:**

- A/B depois B/C preserva A/B/C e a seleção de A.
- Troca de vídeo, cleanup e limite removem os dados corretos, sem misturar vídeos.

## D03 · P0

Referência informada: módulos `iwULB/7YhuM`. Recursos: 17.

**Original, por análise estática reportada:** Editor reconhece ytve-ad-breaks-editor-options-panel, ytve-toolbar, ytcp-media-timestamp-input, #add-ad-break e H:MM:SS:FF com FPS declarado.

**Prevlev na inspeção:** Adapter usa seletores anteriores e campos nativos text/time; formato de horário em HH:MM:SS.

**Diferença recuperável:** Suportar os controles comprovados e formato com frame apenas com FPS explícito e validado; manter prévia/cancelamento/Salvar manual.

Categoria: `implementable_now`; runtime separado: `RT03`. Estado: `open_or_assigned_in_current_phase`.

Código: [studio.ts](../src/content/studio.ts), [midroll.ts](../src/core/midroll.ts).

**Aceite e testes necessários:**

- Fixture com os quatro controles comprovados gera prévia e altera apenas alvos confirmados.
- FPS ausente/inválido, frame>=FPS, contexto reciclado ou controle ambíguo interrompe a operação sem Save.

## D04 · P0

Referência informada: módulos `7WkIn/dEE9i`. Recursos: 15, 16.

**Original, por análise estática reportada:** Capturas Studio encontram .main #video-snapshot #entity-snapshot-title, #top-section, #right-side-bar e #key-metric-header.

**Prevlev na inspeção:** CAPTURE_CARD procura grupos de seletores antigos; não inclui esses anchors.

**Diferença recuperável:** Adicionar anchors do snapshot/analytics comprovados sem enfraquecer a transação de medição antes/depois e ocultação.

Categoria: `implementable_now`; runtime separado: `RT03`. Estado: `open_or_assigned_in_current_phase`.

Código: [index.ts](../src/content/index.ts), [studio.ts](../src/content/studio.ts), [background.ts](../src/background.ts).

**Aceite e testes necessários:**

- Fixture com os anchors comprovados é capturada e recortada corretamente.
- Mudança de contexto/scroll/campos entre medições descarta a imagem; ocultação sem alvo reconhecido falha de modo explícito.

## D05 · P0

Referência informada: módulos `ao1R2`. Recursos: 5.

**Original, por análise estática reportada:** Lucro lê #TOTAL_ESTIMATED_EARNINGS-tab #metric-total, moeda, período e fonte da quantidade; default1 não é contagem derivada.

**Prevlev na inspeção:** readStudioMetrics lê cards genéricos de receita/videoCount; calculadora usa quantidade manual/default1 ou videoCount sem contrato de período.

**Diferença recuperável:** Ler o anchor comprovado e apresentar moeda/período/fonte. Não ligar uma contagem geral do canal ao custo do período; exigir quantidade manual quando não houver fonte compatível.

Categoria: `implementable_now`; runtime separado: `RT03`. Estado: `open_or_assigned_in_current_phase`.

Código: [studio.ts](../src/content/studio.ts), [workspace.ts](../src/ui/workspace.ts), [metrics.ts](../src/core/metrics.ts).

**Aceite e testes necessários:**

- Receita R$/US$/decimal e período da fixture são preservados.
- Quantidade de outro período não é usada silenciosamente; default1 é identificado como valor manual/inicial, sem alegar derivação.

## D06 · P1

Referência informada: módulos `ap8jT`. Recursos: 12.

**Original, por análise estática reportada:** Tester combina N imagens/N títulos ciclicamente por max(Nimage,Ntitle), não produto cartesiano.

**Prevlev na inspeção:** Prévia atual aceita uma imagem e um título.

**Diferença recuperável:** Adicionar múltiplas imagens/títulos e ciclo comprovado em uma simulação local.

Categoria: `implementable_now`; runtime separado: `RT01`. Estado: `open_or_assigned_in_current_phase`.

Código: [media.ts](../src/core/media.ts), [workspace.ts](../src/ui/workspace.ts).

**Aceite e testes necessários:**

- 2 imagens/3 títulos produzem3 pares na ordem cíclica, não6.
- Não há teste de audiência ou chamada de IA/rede automática.

## D07 · P1

Referência informada: módulos `hbKHA`. Recursos: 12.

**Original, por análise estática reportada:** Posicionamento primeiro/aleatório e ação reshuffle no tester.

**Prevlev na inspeção:** Prévia estática sem posicionamento ou reembaralhar.

**Diferença recuperável:** Oferecer os modos e reordenar somente a simulação local.

Categoria: `implementable_now`; runtime separado: `RT01`. Estado: `open_or_assigned_in_current_phase`.

Código: [media.ts](../src/core/media.ts), [workspace.ts](../src/ui/workspace.ts).

**Aceite e testes necessários:**

- Modo primeiro é determinístico; aleatório/reshuffle altera apenas a ordem da simulação.
- Imagens, títulos e escolha do usuário são preservados após editar/voltar.

## D08 · P1

Referência informada: módulos `cJ3pQ/fUnDH`. Recursos: 12.

**Original, por análise estática reportada:** Tester oferece desktop/mobile/lista e tema claro/escuro.

**Prevlev na inspeção:** Canvas de prévia tem um layout e fundo escuro fixo.

**Diferença recuperável:** Adicionar os layouts e temas comprovados com estilos e assets próprios.

Categoria: `implementable_now`; runtime separado: `RT01`. Estado: `open_or_assigned_in_current_phase`.

Código: [media.ts](../src/core/media.ts), [workspace.ts](../src/ui/workspace.ts).

**Aceite e testes necessários:**

- Todos os layouts exportam proporções/recortes corretos sem distorcer a imagem.
- Tema altera apenas a composição e mantém contraste e título legíveis.

## D09 · P1

Referência informada: módulos `6p8QF/9BZO6`. Recursos: 12.

**Original, por análise estática reportada:** Tester permite editar avatar/nome/views/data/duração, Reset/Done e identifica a simulação.

**Prevlev na inspeção:** Somente título/canal são campos editáveis.

**Diferença recuperável:** Adicionar esses campos de simulação, reset e confirmação sem apresentar números de exemplo como analytics reais.

Categoria: `implementable_now`; runtime separado: `RT01`. Estado: `open_or_assigned_in_current_phase`.

Código: [media.ts](../src/core/media.ts), [workspace.ts](../src/ui/workspace.ts).

**Aceite e testes necessários:**

- Reset restaura o estado anterior; Done confirma somente a prévia.
- Views/data/duração simulados permanecem marcados e não entram na coleção/histórico/relatório.

## D10 · P1

Referência informada: módulos `gmsK1`. Recursos: 12.

**Original, por análise estática reportada:** Tester usa amostras autorizadas Home/Trending/Subscriptions/canal/termo.

**Prevlev na inspeção:** Prévia não utiliza contexto de amostra; pesquisa coleta uma aba separadamente.

**Diferença recuperável:** Permitir escolher apenas coleções/abas autorizadas e declarar a origem/limite da amostra usada na simulação.

Categoria: `implementable_now`; runtime separado: `RT01`. Estado: `open_or_assigned_in_current_phase`.

Código: [workspace.ts](../src/ui/workspace.ts), [youtube.ts](../src/content/youtube.ts).

**Aceite e testes necessários:**

- Escolher uma amostra não consulta endpoints privados nem envia dados a terceiros.
- Ausência de amostra não é preenchida com cards fictícios apresentados como reais.

## D11 · P1

Referência informada: módulos `lduxO`. Recursos: 3, 4, 20, 21, 22, 23, 24, 25, 26.

**Original, por análise estática reportada:** Onze presets comprovados: views24h, recentes7d, >=1M30d, >=50K views/<10K subs, >=10K/<5K90d, >=100K/10K–100K subs, maiorVPH, outlier>=5 fora de canal/<50Ksubs, >1anoVPH, ShortsVPHbusca, deep-dive longo ou >=20min no canal.

**Prevlev na inspeção:** Campos manuais existem; não há a coleção desses presets.

**Diferença recuperável:** Implementar presets nomeados por contexto, com datas relativas a um instante fixado e sem alterar o modo de outlier silenciosamente.

Categoria: `implementable_now`; runtime separado: `RT01`. Estado: `open_or_assigned_in_current_phase`.

Código: [metrics.ts](../src/core/metrics.ts), [youtube.ts](../src/content/youtube.ts), [index.ts](../src/content/index.ts), [workspace.ts](../src/ui/workspace.ts).

**Aceite e testes necessários:**

- Testes de cada preset verificam limites, contexto e dados ausentes.
- Preview/label mostra filtros efetivos; tempo e baseline são estáveis durante a aplicação.

## D12 · P1

Referência informada: módulos `cWDqB/6Geye`. Recursos: 3, 20, 21, 22, 23, 24, 25, 26.

**Original, por análise estática reportada:** Dois critérios de ordenação asc/desc/remover e razão views/inscritos fora da página de canal.

**Prevlev na inspeção:** Sort atual usa um único critério; não há razão views/subs exposta.

**Diferença recuperável:** Adicionar no máximo dois critérios estáveis e razão somente em fonte local com denominador conhecido positivo e contexto permitido.

Categoria: `implementable_now`; runtime separado: `RT01`. Estado: `open_or_assigned_in_current_phase`.

Código: [metrics.ts](../src/core/metrics.ts), [youtube.ts](../src/content/youtube.ts), [workspace.ts](../src/ui/workspace.ts).

**Aceite e testes necessários:**

- Empates seguem o segundo critério e depois a ordem estável original.
- Valores ausentes/denominador0 não viram0/Infinity; remover critério restaura a regra correta.

## D13 · P1

Referência informada: módulos `12PlF/kdMVQ/6T1YU`. Recursos: 3, 4, 20, 21, 22, 23, 24, 25, 26.

**Original, por análise estática reportada:** Grid/list/sidebar, badges, calendário/ranges rápidos, contagem/progresso/carregar mais e export CSV/JSON/MD.

**Prevlev na inspeção:** Há tabela, campos de datas, badges, contagem e CSV/JSON; coleta ainda é só DOM carregado e não há todos os layouts/ranges/export MD.

**Diferença recuperável:** Completar UI e coletor limitado por ação explícita, progresso, cancelar, motivo de parada e exportação Markdown.

Categoria: `implementable_now`; runtime separado: `RT01`. Estado: `open_or_assigned_in_current_phase`.

Código: [index.ts](../src/content/index.ts), [youtube.ts](../src/content/youtube.ts), [workspace.ts](../src/ui/workspace.ts).

**Aceite e testes necessários:**

- Load-more limita itens/tempo/tentativas, não executa ao abrir e relata limite/pausa/falha.
- Export/contagem/refiltros refletem o mesmo conjunto conhecido; layouts não duplicam IDs nem misturam fontes oficiais.

## D14 · P1

Referência informada: módulos `cZsGp`. Recursos: 4, 25.

**Original, por análise estática reportada:** Fluxos separados para Shorts de feed e de busca.

**Prevlev na inspeção:** Shorts são identificados/filtrados dentro da coleta geral.

**Diferença recuperável:** Preservar contexto feed/busca na coleção e oferecer os dois fluxos/presets sem classificar somente pela duração.

Categoria: `implementable_now`; runtime separado: `RT01`. Estado: `open_or_assigned_in_current_phase`.

Código: [youtube.ts](../src/content/youtube.ts), [index.ts](../src/content/index.ts), [workspace.ts](../src/ui/workspace.ts).

**Aceite e testes necessários:**

- Fixtures de feed e busca têm formatos e escopo distintos corretos.
- Vídeo com duração curta não é automaticamente declarado Short.

## D15 · P1

Referência informada: módulos `k2MTO`. Recursos: 9, 13.

**Original, por análise estática reportada:** Ações em cada card/Short: copiar título, ID, imagem, URL thumbnail, baixar e busca visual.

**Prevlev na inspeção:** Ações globais dependem do vídeo/snapshot atual; linhas da pesquisa têm só salvar referência.

**Diferença recuperável:** Adicionar ações por item com identidade capturada, copy/download e abertura explícita da busca visual própria/permitida.

Categoria: `implementable_now`; runtime separado: `RT01`. Estado: `open_or_assigned_in_current_phase`.

Código: [index.ts](../src/content/index.ts), [workspace.ts](../src/ui/workspace.ts), [media.ts](../src/core/media.ts).

**Aceite e testes necessários:**

- Cada ação opera sobre o ID do card clicado, inclusive Shorts e linha reciclada.
- Nenhum upload/visual search externo é iniciado ao carregar ou hover sem ação autorizada.

## D16 · P1

Referência informada: módulos `iARcq/jjldY`. Recursos: 27.

**Original, por análise estática reportada:** Quickview por hover300ms: top4 recentes/populares, fechar, exports e cancelamento por identidade; populares globais dependem da base real.

**Prevlev na inspeção:** Há painel explícito de canal com até10 itens de amostra inicial; não há hover rápido.

**Diferença recuperável:** Adicionar quickview limitado e cancelável, reutilizando amostra autorizada e rotulando ordenação da amostra. Não chamar o resultado de top global.

Categoria: `implementable_now`; runtime separado: `RT01`. Estado: `open_or_assigned_in_current_phase`.

Código: [channel-research.ts](../src/core/channel-research.ts), [workspace.ts](../src/ui/workspace.ts), [index.ts](../src/content/index.ts).

**Aceite e testes necessários:**

- Hover<300ms não consulta; mudança/fechamento cancela e ignora resposta anterior.
- Mostra até4 itens da fonte identificada e exporta somente essa amostra.

## D17 · P1

Referência informada: módulos `40qQy`. Recursos: 14.

**Original, por análise estática reportada:** Screenshot recomposto de card/Short com tema/fundo/alpha e escala2.

**Prevlev na inspeção:** Captura atual recorta pixels da aba, sem recomposição/tema/export alpha.

**Diferença recuperável:** Adicionar composição própria a partir de metadados/imagem fornecidos, separada do recorte de pixels, sem copiar assets da referência.

Categoria: `implementable_now`; runtime separado: `RT01`. Estado: `open_or_assigned_in_current_phase`.

Código: [media.ts](../src/core/media.ts), [workspace.ts](../src/ui/workspace.ts).

**Aceite e testes necessários:**

- Export PNG transparente e tema/fundo corretos; escala2 dobra dimensões sem trocar fonte/ID.
- Card/Short é identificado como composição e não certificação de analytics.

## D18 · P1

Referência informada: módulos `frwIp`. Recursos: 11.

**Original, por análise estática reportada:** Compressor limita saída a2097152 bytes, com qualidade/resolução limitadas e preserva arquivo menor; impossibilidade é explícita.

**Prevlev na inspeção:** compressImage recebe qualidade/dimensões, mas não tem meta de bytes e pode retornar maior que original.

**Diferença recuperável:** Implementar busca finita por qualidade/resolução e comparar com o original elegível, sem loop ou sucesso acima do teto.

Categoria: `implementable_now`; runtime separado: `RT01`. Estado: `open_or_assigned_in_current_phase`.

Código: [media.ts](../src/core/media.ts), [workspace.ts](../src/ui/workspace.ts).

**Aceite e testes necessários:**

- Saída cumpre2MiB e dimensões, ou informa impossibilidade de maneira explícita.
- Arquivo já elegível menor é preservado; número de iterações e memória são limitados.

## D19 · P1

Referência informada: módulos `3ztoH`. Recursos: 10, 29.

**Original, por análise estática reportada:** Transcrição exporta CSV/JSON/MD com URL/data/timestamps/resumo/tópicos/roteiro, além TXT/VTT.

**Prevlev na inspeção:** TXT/VTT/MD existem; CSV/JSON e metadados/resultados associados não estão completos.

**Diferença recuperável:** Completar exportadores com o material realmente disponível e resolver importação VTT sem perda de tempos e fim desconhecido sem estimativa oculta.

Categoria: `implementable_now`; runtime separado: `RT01`. Estado: `open_or_assigned_in_current_phase`.

Código: [transcript.ts](../src/core/transcript.ts), [workspace.ts](../src/ui/workspace.ts).

**Aceite e testes necessários:**

- Export preserva URL/data/tempos/origem sem inventar resultado de IA.
- VTT aceito como import gera segmentos; fim desconhecido é informado ou definido explicitamente, não +2s silencioso.

## D20 · P1

Referência informada: módulos `lEQz3/jaobz`. Recursos: 10, 29, 39.

**Original, por análise estática reportada:** Cópias separadas de timestamps/transcrição/roteiro/resumo/tópicos; cache, loading, voltar e invalidação por entrada.

**Prevlev na inspeção:** Há cópia de texto e saídas JSON genéricas; não há todas as cópias, cache e histórico de telas por entrada.

**Diferença recuperável:** Adicionar ações/resultados por tipo e cache limitado por vídeo+texto+modelo+origem, sem geração oculta ao voltar ou invalidar.

Categoria: `implementable_now`; runtime separado: `RT01`. Estado: `open_or_assigned_in_current_phase`.

Código: [workspace.ts](../src/ui/workspace.ts), [timeline.ts](../src/content/timeline.ts), [backend.ts](../src/shared/backend.ts).

**Aceite e testes necessários:**

- Cada cópia contém apenas a saída escolhida, sem envelope/token.
- Mudança de vídeo/entrada/modelo/origem invalida cache; falha/incomplete não é sucesso nem dispara retry.

## D21 · P2

Referência informada: módulos `cKMqy/FRpud/fVSNj/5ZJMg`. Recursos: 17.

**Original, por análise estática reportada:** Mid-roll Auto/quantidade/Custom/Smart, presets10/20/30s e1/2/3/4/5/10/15/20m, início customizado, endpoints e playhead preview.

**Prevlev na inspeção:** Planejador de intervalo mínimo60s, bordas e snap de silêncio; UI expõe duração/intervalo, sem todos os modos.

**Diferença recuperável:** Completar modos de planejamento comprovados, respeitando duração, limite de50 alvos, validação FPS/contexto e revisão manual.

Categoria: `implementable_now`; runtime separado: `RT03`. Estado: `open_or_assigned_in_current_phase`.

Código: [midroll.ts](../src/core/midroll.ts), [studio.ts](../src/content/studio.ts), [workspace.ts](../src/ui/workspace.ts).

**Aceite e testes necessários:**

- Cada modo produz somente posições válidas/limitadas; excesso é explícito, nunca silenciosamente truncado.
- Prévia mostra modo, origem/duração, posições e alvos antes de clicar; não inclui Save automático.

## D22 · P2

Referência informada: módulos `hUc7g/by3oQ`. Recursos: 17.

**Original, por análise estática reportada:** Smart lê waveform canvas com volume%, silêncio mínimo ms, FPS e estados Scanning/PlaceN/ScanAgain.

**Prevlev na inspeção:** PCM local é alternativa real já disponível; parâmetros da detecção não são todos expostos e canvas Studio não é lido.

**Diferença recuperável:** Oferecer parâmetros explícitos e adapter de waveform comprovado, distinguindo estimativa visual de PCM e falhando em canvas protegido.

Categoria: `implementable_now`; runtime separado: `RT03`. Estado: `open_or_assigned_in_current_phase`.

Código: [midroll.ts](../src/core/midroll.ts), [studio.ts](../src/content/studio.ts), [workspace.ts](../src/ui/workspace.ts).

**Aceite e testes necessários:**

- Dados conhecidos de PCM/canvas produzem os intervalos esperados conforme o método indicado.
- Canvas protegido/ausente/FPS não declarado não produz silêncio ou posição inventados; nenhum bypass.

## D23 · P2

Referência informada: módulos `gZGRb`. Recursos: 17.

**Original, por análise estática reportada:** Limpar interruptivos/todos/faixa de horário com RemoveN e prévia/confirmação específicas.

**Prevlev na inspeção:** Não há rotina de remoção de rascunhos.

**Diferença recuperável:** Adicionar plano de remoção somente para slots reconhecidos e critério explícito; status interruptivo exige sinal visível comprovado, não inferência.

Categoria: `implementable_now`; runtime separado: `RT03`. Estado: `open_or_assigned_in_current_phase`.

Código: [studio.ts](../src/content/studio.ts), [workspace.ts](../src/ui/workspace.ts).

**Aceite e testes necessários:**

- Prévia lista cada posição/critério e total; contexto reciclado/cancelamento impede próximos cliques.
- Não remove fora da faixa nem salva automaticamente; critério desconhecido fica indisponível.

## D24 · P2

Referência informada: módulos `biJpk/dvytv/hyROA/jknba`. Recursos: 15, 16.

**Original, por análise estática reportada:** Studio screenshots recompõem tema/fundo/alpha e ocultações individuais canal/receita/inscritos/views; AnalyticsOnly/VideoInfo.

**Prevlev na inspeção:** Há crop com transação forte e máscaras por seletores gerais; sem todos os modos de composição/máscaras individuais.

**Diferença recuperável:** Adicionar composição e controles individuais comprovados, preservando descarte por mudança e deixando limite de anonimização visível.

Categoria: `implementable_now`; runtime separado: `RT03`. Estado: `open_or_assigned_in_current_phase`.

Código: [media.ts](../src/core/media.ts), [studio.ts](../src/content/studio.ts), [index.ts](../src/content/index.ts), [workspace.ts](../src/ui/workspace.ts).

**Aceite e testes necessários:**

- Cada máscara cobre apenas a região escolhida na composição e os modos têm fixtures próprias.
- Nenhum alvo sensível conhecido é deixado visível por fallback; contexto alterado descarta captura.

## D25 · P2

Referência informada: módulos `8KsTl/bqJdm`. Recursos: 5.

**Original, por análise estática reportada:** Lucro usa receita/quantidade do mesmo período, alterna receita-lucro/BackToRevenue e recalcula ao mudar período com erros de origem.

**Prevlev na inspeção:** Calculadora separada oferece resultado, sem toggle no card e sem vínculo de período completo.

**Diferença recuperável:** Vincular observações de mesmo período e oferecer alternância restaurável, sem confundir valor inferido/manual com receita real.

Categoria: `implementable_now`; runtime separado: `RT03`. Estado: `open_or_assigned_in_current_phase`.

Código: [studio.ts](../src/content/studio.ts), [workspace.ts](../src/ui/workspace.ts), [metrics.ts](../src/core/metrics.ts).

**Aceite e testes necessários:**

- Mudança de período invalida o resultado antigo até obter valores compatíveis.
- Voltar restaura receita original sem perder moeda; não calcula com quantidade de outro período.

## D26 · P2

Referência informada: módulos `1TrBd/anT9e/7UyM1`. Recursos: 7.

**Original, por análise estática reportada:** Primeiros7/14/28/60/90/180/365dias com elegibilidade por idade, label/rota e datas manuais.

**Prevlev na inspeção:** Adapter só preenche dois inputs date já abertos; sem presets por idade.

**Diferença recuperável:** Adicionar cálculo de presets e adapters comprovados; respeitar readOnly, contexto e rerender após cada evento.

Categoria: `implementable_now`; runtime separado: `RT03`. Estado: `open_or_assigned_in_current_phase`.

Código: [studio.ts](../src/content/studio.ts), [workspace.ts](../src/ui/workspace.ts).

**Aceite e testes necessários:**

- Data de publicação desconhecida ou idade insuficiente não produz preset inválido.
- Troca de URL/controle ou segundo campo desconectado recusa ready; datas preenchidas têm fonte/label e Aplicar continua manual.

## D27 · P2

Referência informada: módulos `84isq/4HLbg/jV9hy/5hecq`. Recursos: 6, 34, 38.

**Original, por análise estática reportada:** ViewsToday/ponto de hoje/top vídeos diários unem dados autorizados do Studio.

**Prevlev na inspeção:** Somente receita/videoCount visíveis são lidos; analytics local usa contadores acumulados, sem série diária privada.

**Diferença recuperável:** Implementar leitura de dados já visíveis/autorizados ou entrada explícita com semântica diária. Não interceptar headers/cookies nem derivar today de contadores totais.

Categoria: `implementable_now`; runtime separado: `RT03`. Estado: `open_or_assigned_in_current_phase`.

Código: [studio.ts](../src/content/studio.ts), [analytics.ts](../src/ui/analytics.ts), [analytics.ts](../src/core/analytics.ts).

**Aceite e testes necessários:**

- Hoje só aparece com valor e período de fonte autorizada; ausência permanece desconhecida.
- Contadores acumulados não são chamados views de hoje; fonte/período cobrem qualquer join.

## D28 · P2

Referência informada: módulos `e7p0u/gfX0t`. Recursos: 40.

**Original, por análise estática reportada:** ThumbnailLab: referências arquivo/URL, título/novo título/roteiro/instruções, modelo/aspect/resolução, jobs/histórico/docs/uso.

**Prevlev na inspeção:** Há briefing e seleção de modelo/capacidade; imagem usa caminho de geração atual, sem laboratório completo.

**Diferença recuperável:** Completar organização local de referências/briefings/jobs/resultados e controles somente quando contrato real do provedor suporta; nunca simular uso de referência ou quota.

Categoria: `implementable_now`; runtime separado: `RT01`. Estado: `open_or_assigned_in_current_phase`.

Código: [workspace.ts](../src/ui/workspace.ts), [media.ts](../src/core/media.ts), [omni.mjs](../server/omni.mjs), [ai.mjs](../server/ai.mjs).

**Aceite e testes necessários:**

- Histórico identifica tarefa/modelo/origem/estado real e respeita cancelamento/resultado incerto.
- Parâmetro ou referência sem contrato anunciado não é enviado nem descrito como aplicado; nenhum job/geração inicia ao abrir.

## D29 · P3

Referência informada: módulos `2PaDL`. Recursos: 28, 34, 35, 38, 39.

**Original, por análise estática reportada:** Relatórios agrupam conteúdo/formato de títulos/nicho/estratégia/feedback/performance/tópicos/roteiro/etapas; WPM usa transcrição+duration.

**Prevlev na inspeção:** Há estatísticas de coleção e análises de texto separadas; sem todos os grupos/fases do relatório.

**Diferença recuperável:** Construir relatórios próprios com grupos e evidências de entrada; WPM somente com texto/duração/cobertura explícitos e IA opcional por modelo escolhido.

Categoria: `implementable_now`; runtime separado: `RT01`. Estado: `open_or_assigned_in_current_phase`.

Código: [analytics.ts](../src/core/analytics.ts), [analytics.ts](../src/ui/analytics.ts), [analysis.mjs](../server/analysis.mjs), [omni.mjs](../server/omni.mjs).

**Aceite e testes necessários:**

- Grupo sem dado fica desconhecido, não preenchido por inferência financeira.
- WPM não surge sem transcrição/duração; seleção de IA é explícita e relatórios oficiais API não alimentam cálculos derivados.

## D30 · P3

Referência informada: módulos `28tCZ/2526y/iuEKC/cqQFE/ikngx/s5RjM`. Recursos: 4, 28, 33, 34, 35, 38.

**Original, por análise estática reportada:** Nicho:10presets, semana/mês/3m/ano/all,6durações, chips multicanal/reset/CSVJSONMD, distribuições outlier>=2x/>=5x e métricas views/subs/uploads30/90/12m com cobertura.

**Prevlev na inspeção:** Filtros genéricos e grupos locais existem; não há toda a análise/presets/distribuições descritas.

**Diferença recuperável:** Completar o painel com métricas de amostra e presets comprovados, deixando cobertura/semântica de período claras e usando o modo de outlier identificado.

Categoria: `implementable_now`; runtime separado: `RT01`. Estado: `open_or_assigned_in_current_phase`.

Código: [analytics.ts](../src/core/analytics.ts), [metrics.ts](../src/core/metrics.ts), [analytics.ts](../src/ui/analytics.ts), [analysis.mjs](../server/analysis.mjs).

**Aceite e testes necessários:**

- Cada preset/intervalo/faixa tem fixture com bordas, zero/ausências e contexto.
- Uploads são observados na amostra; não se apresenta frequência global, tráfego mensal, saturação ou finanças como conhecidos.

## D31 · P3

Referência informada: módulos `42Orp`. Recursos: 13.

**Original, por análise estática reportada:** Busca visual de thumbnails; hash local é alternativa possível, global exige fonte legítima.

**Prevlev na inspeção:** Sem correspondência visual local; backend compara palavras dos títulos, não imagens.

**Diferença recuperável:** Implementar comparação visual local explicável entre imagens fornecidas/solicitadas explicitamente, sem chamar o score de semântica ou CTR.

Categoria: `implementable_now`; runtime separado: `RT01`. Estado: `open_or_assigned_in_current_phase`.

Código: [media.ts](../src/core/media.ts), [workspace.ts](../src/ui/workspace.ts), [analysis.mjs](../server/analysis.mjs).

**Aceite e testes necessários:**

- Imagens idênticas/proximas/diferentes têm distâncias esperadas em fixture real de canvas.
- O conjunto comparado e o método estão identificados; não se fabrica resultado global nem faz upload automático.

## D32 · P3

Referência informada: módulos `6B2HM/fGOqw/4v9SI/282vx/dUxUK`. Recursos: 29, 39, 40.

**Original, por análise estática reportada:** MCP connect/guias ChatGPT/Claude/detecção/compositor de prompts/uso e quota.

**Prevlev na inspeção:** Cinco tools stdio próprios estão prontos; faltam integração/guia visual/compositor e fonte autorizada de quota do serviço.

**Diferença recuperável:** Preparar guia/compositor próprios e detecção por ação explícita em cliente autorizado, sem registrar configurações ou enviar prompts automaticamente. Uso só de tentativas próprias, não saldo fictício.

Categoria: `implementable_now`; runtime separado: `RT01`. Estado: `open_or_assigned_in_current_phase`.

Código: [mcp.mjs](../server/mcp.mjs), [MCP.md](../docs/MCP.md), [workspace.ts](../src/ui/workspace.ts), [backend.ts](../src/shared/backend.ts).

**Aceite e testes necessários:**

- Guia identifica transporte/cliente e a configuração manual exata; nenhum arquivo de cliente é alterado.
- Prompt é rascunho/cópia até ação explícita; capacidade não é prova de cota ou geração; ausência de contrato de quota permanece desconhecida.

## D33 · P3

Referência informada: módulos `1g4SC/7mbxV`. Recursos: 4, 21, 23, 24, 25, 26, 28, 33.

**Original, por análise estática reportada:** Outlier geral = views/avgChannelViews; Shorts usa mediana com>=10positivos, senão média.

**Prevlev na inspeção:** Prevlev usa mediana de>=3 pares comparáveis e exclui o alvo. É outro indicador, embora documentado.

**Diferença recuperável:** Expor modo/base/n/procedência e adicionar os modos comprovados somente quando sua baseline existir. Preservar o modo atual como modo próprio explícito; não trocar fórmulas silenciosamente.

Categoria: `implementable_now`; runtime separado: `RT01`. Estado: `open_or_assigned_in_current_phase`.

Código: [metrics.ts](../src/core/metrics.ts), [analytics.ts](../src/core/analytics.ts), [index.ts](../src/content/index.ts), [workspace.ts](../src/ui/workspace.ts).

**Aceite e testes necessários:**

- Teste separa média, mediana>=10positivos e fallback; alvo/exclusões e fonte da baseline são declarados.
- Baseline geral desconhecida não vira média global fictícia; filtros/presets/exports preservam o modo selecionado e dados API continuam excluídos.

## Limites da comparação

- Algoritmos/bases remotas que não estão nas fontes permitidas não são recriados por resultados fictícios.
- D16 e D27–D33 têm partes implementáveis no navegador/servidor próprio e dependências reais de fonte/capacidade; distinguir as partes é obrigatório.
- Não acrescentar Save/Continuar automático, seletor de idioma ou AI batching como requisitos comprovados: não fazem parte desta evidência/escopo autorizado.
- Nenhuma alegação de geração, saldo, cota, precisão de frame ou receita é validada apenas por fixture ou catálogo.
