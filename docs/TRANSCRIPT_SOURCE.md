# Origem e associação explícita de transcrições

O contrato opcional `inputSource()` do painel distingue `observed-page`, `imported-file` e `edited-text`. Ele informa apenas nome base do arquivo e instante de importação, quando conhecidos, e a associação ao vídeo: `observed`, `user-declared` ou `none`. Um arquivo, seu nome, seus timestamps ou uma URL mencionada no texto não estabelecem associação a um vídeo.

Com associação `none`, o exportador ignora URL, ID e título recebidos da coleta. JSON usa `videoUrl: null` e `videoId: null`, com título “Transcrição importada: nome” ou “Transcrição editada”. CSV e Markdown conservam o estado desconhecido e explicam a origem. Uma associação explicitamente declarada pelo usuário pode incluir os metadados da coleta, mas aparece como `user-declared`; a importação não verifica que os textos pertencem a esse vídeo.

`TranscriptMetadata.inputSource` e `TranscriptAiResult.context.inputSource` preservam essa declaração limitada. JSON inclui o objeto; CSV acrescenta `inputSourceKind`, `inputFileName`, `inputImportedAt` e `videoAssociation`; Markdown identifica origem, associação e metadados de importação. Conteúdo gerado continua separado da transcrição, sem timestamps emprestados. Resultado de IA de outra fonte/associação é recusado no exportador.

São aceitos nomes base não vazios de até 200 caracteres, sem separadores de caminho, caracteres de controle ou comandos bidirecionais de apresentação. Instantes exigem calendário válido e ISO completo com fuso; são normalizados a UTC. `observed` só é válido para `observed-page`; arquivos e textos editados aceitam `none` ou `user-declared`. A página observada não recebe nome/instante de arquivo. Campos desconhecidos são recusados, sem copiar dados adicionais para a exportação.

Integração do host:

```ts
initTranscriptExtras({
  segments, text, metadata, aiContext, aiProvenance,
  inputSource: () => currentSource,
});
```

O host controla a origem atual, o carregamento do arquivo e o botão explícito de associação. Após importar, deve fornecer `imported-file` com `none`. Ao editar, deve mudar para `edited-text`, remover a associação e invalidar o resultado. A edição de textarea já descarta o cache no módulo; `invalidate()` também atualiza a indicação visual da origem. Associar manualmente não dispara IA.

O cache inclui texto, segmentos, fonte validada, associação e seleção de modelo/origens. Para `none`, a identidade e o título de uma coleta sem relação não entram na chave ou no contexto do resultado. Trocar a fonte/associação invalida reutilização e respostas tardias mesmo sem um evento de invalidação explícito. Não há rede ou geração ao importar, associar, copiar ou exportar.

Sem `inputSource()`, a API anterior permanece compatível e não acrescenta campos de origem aos exports antigos. Novos hosts devem fornecer o getter para distinguir arquivos/textos da página observada. As verificações usam arquivos e respostas próprios em fixtures, sem acesso a conta ou geração real.
