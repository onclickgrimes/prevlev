# Ativos locais e identidade de pastas · AF05/AF06

Cada referência pode conter uma imagem local PNG, JPEG ou WebP estática. Escolher arquivo não salva nem gera prévia automaticamente: Anexar/Substituir confirma a ação. Cabeçalhos, dimensões e decodificação real limitada são verificados antes de persistir. Limites: 3 MiB por arquivo, 32 megapixels/16384 pixels por lado e orçamento agregado existente de 4 MiB/5000 referências, incluindo o crescimento do base64 e todos os metadados. Uma imagem abaixo de 3 MiB ainda pode exceder o orçamento agregado; nesse caso a biblioteca anterior é preservada.

A imagem é armazenada no campo `image` existente como data URL canônico. O novo campo opcional `asset` contém `version:1`, ID estável do ativo, tipo (`file`, `capture`, `composition` ou `thumbnail`), MIME, bytes, largura/altura, data, URL HTTPS declarada da origem e, quando fornecidos, ID do vídeo e nome do arquivo. A procedência é declarada pelo chamador/usuário; ela não comprova autoria, completude ou performance. Substituir cria uma nova identidade de ativo, preservando a identidade/data de criação/notas da referência.

Prévia prefere a imagem local, sem consultar uma thumbnail externa coexistente. Imagens antigas continuam sendo lidas sem migração; novas importações JSON validam os bytes de imagens inline e metadados novos. Anexar/baixar/remover são explícitos. Cancelamento, alteração da referência ou invalidação da tela descartam trabalho pendente antes da escrita; uma edição concorrente nunca é sobrescrita pelo anexo antigo. O decoder usa a fila física comum de imagens.

JSON versão 2 continua compatível e preserva `image`, `asset` e `folderId`. CSV preserva referências e IDs de pasta; ele não inclui bytes nem procedência dos ativos. A UI apresenta essa limitação antes do uso e no resultado da exportação. JSON é o backup completo.

Renomear/mover atribui `folderId` opcional às pastas envolvidas somente nessas ações explícitas. Renomear novamente mantém o ID; IDs e dados dos itens são preservados. Não há migração ao ler nem registro de pastas vazias. Importações recusam IDs de pasta ligados a nomes conflitantes. O formato legado baseado em nome continua aceito.

A rota pessoal existente `/v1/library` preserva os campos novos e anuncia `assetSchemaVersion:1` e `folderIdentityVersion:1`. O cliente bloqueia envio de ativos/IDs a um backend que não anuncia o suporte correspondente, antes de qualquer escrita. Referências antigas sem esses campos continuam sincronizando com o contrato anterior. CAS, token/origem existentes e ações manuais permanecem; não há conta, nuvem multiusuário ou sincronização automática.

Integração para capturas/composições já verificadas pelo host:

```ts
const itemId = await swipeTools.saveAsset(blob, {
  title, url, folder, source: 'youtube-dom',
  provenance: {
    kind: 'capture', // file | capture | composition | thumbnail
    sourceUrl, videoId, fileName, createdAt
  }
}, () => resultSerial === currentResultSerial);
```

O host oferece um botão explícito e preserva a identidade/ocultação do contexto até chamar o método; este método não realiza captura. O terceiro argumento opcional confirma que a origem/resultado ainda é atual antes/depois dos awaits e dentro do mutator, após adquirir o bloqueio de escrita. Se uma referência da mesma URL já existe sem imagem, o ativo é anexado preservando seus metadados. Uma imagem já existente exige revisão e substituição explícita no item, sem sobrescrita silenciosa. O método retorna o ID novo/existente. `invalidatePreviews()` também cancela anexos pendentes antes da escrita, útil ao limpar/trocar contexto; `invalidatePendingAssets()` oferece esse cancelamento separadamente. O render interno após escrita não cancela a própria solicitação já concluída.

Fixtures: `tests/swipe-assets.test.ts`, `tests/browser/swipe-assets.spec.ts` e cenários de compatibilidade em `tests/browser/swipe-sync.spec.ts`. Sem imagem/serviço de terceiro real, conta ou cota utilizados.
