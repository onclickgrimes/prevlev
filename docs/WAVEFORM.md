# Estimativa visual local de waveform

O painel aceita um PNG escolhido pelo usuário (até 10 MB e 4 milhões de pixels). Não acessa canvas, áudio, canal ou conta do Studio. Abrir a tela ou escolher a imagem não inicia análise nem insere anúncios.

O usuário declara o recorte em pixels originais, linha central, altura da escala total, início e fim temporal, FPS, cores de traço/fundo, tolerância RGB, altura percentual limite e duração mínima. O recorte inicialmente cobre a imagem inteira; linha central, escala, tempos e FPS ficam vazios. Uma confirmação dos campos é exigida antes de cada análise após edições.

Cada coluna reconhecida recebe a maior distância do traço à linha central, dividida pela escala declarada. A altura do desenho não é volume RMS nem silêncio PCM. Pixels transparentes, inesperados, inválidos, fora da escala ou colunas sem traço tornam a coluna desconhecida, interrompendo qualquer intervalo. Não há preenchimento ou interpolação de colunas ausentes. Cores semelhantes demais para a tolerância declarada são recusadas.

Os tempos usam apenas o trecho e a largura declarados. Limites são arredondados para dentro à grade do FPS informado. Os centros desses intervalos são sugestões locais; a resolução continua limitada pelos pixels e pelos parâmetros não verificados. O resultado mostra cobertura, desconhecidos e método `visual-raster-estimate`. A exportação JSON preserva esses limites e o nome do arquivo local. O arquivo e o resultado não são enviados a serviços.

Análises em andamento podem ser canceladas. Qualquer edição descarta o resultado e a confirmação. Canvas protegido/indisponível falha sem tentativa alternativa, rede ou contorno. PNGs grandes são recusados pela leitura do cabeçalho antes da decodificação.

Integração: `mountWaveformTools(document, onChange)` acrescenta o painel a `#studio` e retorna `getAnalysis()`, `invalidate()` e `destroy()`. O resultado é independente do Smart PCM e não é aplicado automaticamente ao plano de mid-roll.

A geometria do waveform real do Studio não está comprovada pela evidência disponível. Portanto não há adapter automático nem alegação de runtime validado ou equivalência entre desenho e PCM. D22 permanece parcial quanto a essa integração.

Verificação local: `tests/waveform.test.ts` e `tests/browser/waveform.spec.ts` usam rasters e PNGs próprios, incluindo lacunas/desconhecidos, limites temporais, FPS, cancelamento, cabeçalho grande e canvas protegido simulado.
