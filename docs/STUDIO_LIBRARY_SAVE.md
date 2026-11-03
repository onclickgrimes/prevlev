# Salvar composição Studio na biblioteca · AF05/D24

`mountStudioComposition` aceita um callback opcional `saveAsset(blob, metadata, guard)`. Quando fornecido, aparece Salvar composição na biblioteca, disponível somente depois de uma composição local concluída. Abrir, aceitar pixels, renderizar, baixar ou alterar opções não salva na biblioteca automaticamente. Um título declarado é obrigatório para salvar.

A camada de UI aceita `StudioCompositionAssetReceipt`, que estende o recibo existente com `sourceUrl?: string` e `videoId?: string`. O host fornece a URL real preservada na transação e o ID somente quando conhecido. A composição continua aceitando recibos antigos para visualização/PNG; salvar uma captura sem URL no recibo é recusado. A URL nunca é extraída ou inventada a partir do `contextKey` ou de um campo declarado para arquivo local.

Para PNG escolhido pelo usuário, uma URL HTTPS da origem deve ser declarada antes de renderizar/salvar. Essa declaração não comprova origem nem ocultações. A persistência usa `source: 'user-provided'`, `provenance.kind: 'composition'`, título declarado, URL do recibo ou URL explicitamente declarada, data da composição e ID do vídeo somente se conhecido no recibo. Arquivo local não herda identidade ou origem do Studio.

O callback deve respeitar o guard dentro do bloqueio da biblioteca, como `swipeTools.saveAsset(blob, metadata, guard)` já faz. O guard inclui epoch, entrada/resultado, identidade do arquivo, opções completas, receipt e contexto síncrono. Antes de chamar o callback e depois de uma gravação confirmada, a UI consulta novamente o `validateContext` real da captura. Capturas exigem `contextKey` e `validateContext` para salvar; PNG local não consulta a aba.

Cancelar, mudar opções, substituir entrada, invalidar máscaras ou navegar torna o guard falso, impedindo persistência tardia quando o host honra o contrato. Se a biblioteca já confirmou uma gravação e uma verificação posterior detecta mudança, a UI informa a gravação e pede conferência; não afirma rollback de uma operação já concluída. Não há retry automático.

Integração do host:

```ts
mountStudioComposition(host, {
  contextKey,
  validateContext,
  saveAsset: (blob, metadata, guard) => swipeTools.saveAsset(blob, metadata, guard)
});
await tools.setCapture(png, { ...receipt, sourceUrl: verifiedTabUrl, videoId });
```

Aplicam-se os limites e o orçamento AF05; o compositor não altera canal, máscaras, origem ou bytes após a transação de captura. O host continua responsável pela captura e sua identidade real. Fixtures específicas em `tests/browser/studio-composition-assets.spec.ts`, com persistência real apenas na biblioteca local simulada e nenhum serviço externo.
