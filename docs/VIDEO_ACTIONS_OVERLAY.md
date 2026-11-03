# Ações por item no painel da página

O painel “Pesquisa avançada e amostra” monta `mountVideoActions` para cada artigo da página atual, depois de excluir registros da API oficial pelos filtros de pesquisa. O menu mantém as ações explícitas descritas em [VIDEO_ACTIONS.md](VIDEO_ACTIONS.md). Montar, atualizar ou paginar a amostra não consulta thumbnails nem inicia coleta.

Cada atualização descarta os controllers anteriores antes de substituir os artigos. A troca de página, os filtros e a atualização da coleta cancelam operações pendentes; o descarte do overlay também limpa todos os controllers. A guarda verifica a revisão do render, a URL de contexto e a presença de ID, URL, título e fonte equivalentes no conjunto filtrado atual. Uma mudança ainda não renderizada no contexto ou no item também invalida o resultado tardio.

O título do artigo usa `data-prevlev-research-video-title`, distinguindo o link do vídeo do link explícito de busca visual dentro do menu. Paginação e exportação continuam usando o mesmo conjunto observado; os controles de página não iniciam ações de imagem.

Evidências locais: `tests/research-overlay-actions.test.ts`, `tests/browser/research-overlay-actions.spec.ts` e a regressão de controles/paginação em `tests/browser/research-overlay-controls.spec.ts`. Os cenários de imagem interceptam todo o transporte e verificam descarte antes do decoder/download; nenhum serviço ou conta real é usado.
