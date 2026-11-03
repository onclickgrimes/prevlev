# Precisão e timeline local de mid-roll

O planejador distingue a grade de segundos inteiros da grade de frames com FPS declarado (24, 25, 30, 48, 50 ou 60). Este FPS pertence às posições do plano e é independente do FPS usado para analisar o arquivo PCM local.

Posições geradas por quantidade, intervalo ou estimativa PCM são quantizadas à grade indicada na UI e permanecem entre 1 segundo e duração menos 1 segundo. Início e playhead informados manualmente precisam pertencer à grade: `250.5` é preservado com 30 FPS, enquanto uma fração sem FPS ou fora da grade é recusada. Não há conversão silenciosa do playhead para `251`. Limites de duração de 480 a 7200 segundos e de 50 posições continuam em vigor.

A timeline mostra os marcadores planejados, a duração e o cursor local. Clicar em um marcador, usar anterior/próximo, o slider ou “Mover cursor local” muda somente essa prévia. “Incluir cursor local como playhead informado” é uma ação separada, que altera os parâmetros do plano e invalida a prévia de execução existente. Não há leitura de geometria, seek no player do Studio, reprodução automática, inserção ou salvamento decorrente da navegação local.

O adapter legado `HH:MM:SS` recusa posições fracionárias antes de qualquer escrita. O adapter moderno `H:MM:SS:FF` exige FPS compatível com os controles comprovados e recusa frações fora da grade ou posições que resultariam no mesmo frame. O fluxo de confirmação existente e a revisão/Salvar manuais permanecem necessários. Estes comportamentos foram verificados somente em fixtures próprias, sem ações em canal real.

Integração: `mountMidrollTools` continua retornando `getPlan()` e acrescenta `refreshTimeline()` para atualizações programáticas da duração. O plano inclui `positionPrecision`, `positionFps` e `positionResolution`; o host deve verificar divergência com qualquer FPS separado informado para o Studio antes de enviar a prévia.

Testes: `tests/midroll-advanced.test.ts`, `tests/studio-midroll.test.ts`, `tests/studio-modern.test.ts` e `tests/browser/midroll-playhead.spec.ts`.
