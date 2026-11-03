# Nove lacunas locais · escopo entregue

Base pública anterior: `826c2eecabc0a9198bfba9f589458d9287282cb3`. D20/D26 foram publicados primeiro em `971c26ec31f9ff4b100515bc54afaf3b4212b638`. O restante foi integrado sobre esse checkpoint preservando todos os commits anteriores. A validação funcional final usa o código de `5e0641196181a1106030d0defc778c103f86c280`; alterações posteriores desta etapa são documentação.

## D09

Reset/Done confirma e restaura metadados e avatar sem trocar a candidata selecionada quando os arquivos não mudam.

Limite: O contexto e os números editados continuam ilustrativos, sem teste de audiência.

## D10

Seleção explícita de coleção congelada ou aba autorizada, URL/superfície observada, cancelamento e guarda de contexto. A leitura GET_IMAGE_CONTEXT não grava nem substitui a coleta.

Limite: Somente a amostra DOM disponível; não carrega automaticamente cada feed nem atribui uma origem única a coleções mistas.

## D19

JSON/CSV/Markdown incluem saídas de IA válidas já disponíveis, com procedência e marcação de conteúdo gerado; exports não geram chamadas.

Limite: Saídas ausentes ou invalidadas não são inventadas; textos gerados não recebem timestamps da transcrição.

## D20

Cache vincula vídeo, entrada, modelo, origem, streaming e backend; salvar/remover conexão invalida o cache.

Limite: Validação em serviço real permanece separada dos testes de transporte/fixtures.

## D21

Precisão explícita em segundos ou frames/FPS, preservação de frações elegíveis e timeline local navegável; adapter legado recusa frações.

Limite: Cursor e timeline são locais e declarados; não afirmam seek/preview no Studio real.

## D24

Composição AnalyticsOnly/VideoInfo com moldura/tema/fundo/alpha/escala, sobre PNG local ou recorte validado. URL real, stamp, máscaras, cancelamento e contexto são revalidados antes de aceitar, compor e baixar.

Limite: O tema altera a moldura, preservando os pixels da captura; metadados são declarados. Não há reconstrução automática de widgets privados ou garantia total de anonimização.

## D26

Publicação e período declarados são descartados ao mudar vídeo, aba ou navegação; mesmo vídeo com somente query/período alterados preserva a declaração.

Limite: A data de publicação é manual; não foi validada em conta real.

## D29

Grupos estruturados manuais de conteúdo/nicho/estratégia/feedback/performance/tópicos/roteiro/etapas com alvo, fonte, cobertura, trechos, reassociação, exports e backup limitados.

Limite: Declarações e correspondência literal não verificam verdade, estratégia, contrato, causalidade ou finanças. Não há geração/análise automática desses grupos.

## D30/D33

Nichos oferece seleção explícita de modo de outlier; preserva o modo e exporta método, referência, contagens e procedência. Canal sem identidade robusta fica desconhecido, sem fallback.

Limite: Referência de amostra, não índice proprietário ou média do catálogo completo; modo é escolhido explicitamente no nicho.

## Verificação e publicação

`npm run check`: typecheck, lint, **686 testes em 60 arquivos** e build aprovados. Suíte completa de navegador: **162 aprovados e 2 ignorados** pela política gerenciada de extensões. Não houve contorno. O ZIP próprio do build foi verificado por CRC e SHA-256 interno; dez entradas, sem testes ou credenciais. Uma regressão adicional, na mesma fonte funcional, confirmou que um PNG local novo sobrevive à rejeição tardia de uma captura antiga após navegação:1 cenário direcionado aprovado. Total de aprovações de navegador verificadas:163 (162 na suíte integral+1 dirigido).

A revisão encontrou e corrigiu seleção de candidata após Reset, navegação A→B no mesmo tabId, invalidação enquanto a última medição aguardava e download com contexto alterado. Os testes de integração cobrem esses estados e a ausência de geração/coleta automática. Fonte e árvore são reconferidas antes de cada publicação, por fast-forward sem force.

Esses aceites fecham os escopos locais enumerados, não estabelecem equivalência completa com a referência. Permanecem separados: runtime da extensão instalada/Studio/Omni/MCP, evidência para remoção real e marcadores interruptivos, geometria do waveform real, datasets globais/privados e contratos de referências/parâmetros/cota dos provedores. Nenhum serviço pago ou conta/canal real foi acessado nesta validação.
