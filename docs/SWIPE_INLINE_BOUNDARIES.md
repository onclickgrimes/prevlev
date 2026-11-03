# Imagens inline: leitura legada e novas escritas

A leitura de referências antigas continua usando `normalizeSwipeLibrary`: um campo `image` legado pode permanecer como dado inline antigo ou URL HTTPS externa, sem migração automática, criação de `asset`/IDs de pasta ou busca de imagem. `getSwipe`, a leitura da biblioteca pessoal e a exportação JSON preservam esses dados; ler/exportar não corrige, apaga ou regrava uma imagem antiga.

As importações explícitas JSON versão 2 e de listas antigas já inspecionam todos os campos `image` inline por `inspectSwipeAssetDataUrl`, mesmo quando `asset` está ausente. Essa validação existente foi preservada. Ela verifica base64 canônico, contêiner PNG/JPEG/WebP estático, MIME, bytes e dimensões antes da escrita, sem decoder, URL de imagem ou consulta externa.

O commit explícito da biblioteca pessoal agora reutiliza `parseSwipeImport(payload.items)` antes de entrar na operação serializada de gravação. Um único item inválido recusa a lista inteira, inclusive quando itens válidos aparecem antes dele. A revisão e o arquivo anteriores permanecem intactos; uma recusa não cria o diretório ausente. A mensagem pública de erro é estática e não inclui bytes inline, URLs ou caminhos privados. URLs externas continuam apenas referências não consultadas.

Uma biblioteca antiga com uma imagem inline inválida continua legível e exportável. Um novo commit/import dessa imagem é recusado até uma ação explícita do usuário corrigir ou remover o campo; não há descarte ou conversão silenciosa dos dados antigos. Uma imagem inline válida sem `asset` permanece compatível e não recebe metadados inventados.

Evidência: `tests/swipe-inline-boundary.test.ts` cobre os dois formatos JSON, PNG malformado, cabeçalho 8000×8000, MIME divergente, base64 não canônico, recusa atômica de import/commit e preservação do legado em leitura/exportação. Os testes usam apenas memória e diretórios temporários, com rede e decoders substituídos para verificar ausência de chamadas.

## Carregamento nativo do backend

O backend pessoal importa o código compartilhado diretamente no Node 24. A cadeia `swipe.ts` → `swipe-assets.ts` → `image-preflight.ts`/`observations.ts` agora usa extensões `.ts` explícitas. O parser compartilhado de contêiner permanece `.mjs`. Isso preserva o bundler do navegador e permite carregar `server/library.mjs` nativamente, sem depender da resolução especial do Vitest.

`tests/library-native-import.test.ts` executa processos Node separados com diretório temporário vazio: importar o módulo não cria dados nem inicia transporte, e o fluxo explícito read/commit/read verifica ativos JSON e recusa atômica sem decoder ou rede. Nenhum servidor HTTP, conta ou serviço real é iniciado.
