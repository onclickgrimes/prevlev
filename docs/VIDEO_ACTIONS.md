# Ações explícitas por item da amostra

`mountVideoActions(host, options)` monta um botão e um menu local. Abrir, focar ou passar o mouse não busca uma imagem. O módulo clona o `VideoRecord` recebido e oferece copiar título/ID, copiar a URL pública padrão da thumbnail, baixar/copiar PNG e um link explícito para Google Lens. O link externo recebe apenas a URL pública padrão do ID; não há upload ou abertura automática.

```ts
const actions = mountVideoActions(cell, {
  video: { ...record },
  isCurrent: captured =>
    datasetRevision === capturedRevision &&
    row.isConnected &&
    currentRecord.id === captured.id &&
    currentRecord.url === captured.url &&
    currentRecord.title === captured.title &&
    currentRecord.source === captured.source,
  notice,
  // Opcional: transporte autorizado que respeita o AbortSignal.
  // thumbnail: (id, signal) => fetchThumbnail(id, signal),
});
```

O host deve estar conectado quando uma ação for executada. `isCurrent` deve conferir a revisão da coleção/aba e a identidade do registro atual; apenas conferir se a linha DOM ainda existe não protege contra reciclagem. Chame `actions.dispose()` antes de substituir/remover as linhas, e `actions.close()` para cancelar uma operação mantendo o botão. O módulo também verifica se o host foi removido, se o objeto recebido mudou e se a operação ainda pertence ao menu aberto. Resultados tardios após troca de identidade, fechamento ou descarte não são publicados.

O ID deve ter 11 caracteres e corresponder a uma URL HTTPS do YouTube, sem credenciais embutidas. O campo arbitrário `thumbnail` do registro não é aberto: as ações usam a URL canônica do CDN público derivada do ID. Itens `youtube-data-api` podem copiar os metadados brutos título/ID, mas não oferecem ativos, URL de thumbnail ou Lens. Origens desconhecidas fora dos tipos locais reconhecidos também não habilitam ativos.

Somente o clique de baixar/copiar solicita bytes. O transporte padrão usa `fetchThumbnail`, sem credenciais e com limite de tempo; não consulta APIs privadas ou conta. Antes de qualquer decoder, os bytes passam pelo parser compartilhado de PNG/JPEG/WebP estático, com teto de 5 MiB, 32 megapixels e 16384 pixels por lado. GIF, AVIF, animação, MIME divergente e contêineres inválidos são recusados. Os pixels são normalizados para PNG, e a saída passa novamente pela validação, com teto de 16 MiB. A ação inteira compartilha um prazo de 15 segundos. Cancelamento não presume que trabalho já entregue ao navegador tenha sido fisicamente desfeito.

As escritas na área de transferência/download só começam após revalidar o item. Uma escrita já aceita pelo navegador não pode ser desfeita pelo módulo. Falta de suporte/permissão de clipboard é informada; o módulo não altera permissões ou configurações do usuário. Não há captura automática de card, medição de audiência ou geração de IA.

Evidência local: `tests/video-actions.test.ts` e `tests/browser/video-actions.spec.ts` verificam metadados por item, Short, recusa da API oficial, validação anterior ao decoder, PNG real e descarte de respostas tardias. Os testes usam bytes/transporte/clipboard injetados e não acessam serviços ou contas reais.
