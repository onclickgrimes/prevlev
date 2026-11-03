# AF05/D17 · salvar composição local como ativo

`initCardCompositionTools({snapshot, saveAsset?})` preserva a API anterior. Sem callback de persistência, o compositor continua gerando e baixando PNG; os botões de salvar/cancelar salvamento ficam ocultos. Abrir a tela, escolher arquivos, listar a coleta ou gerar uma imagem não salva ativos automaticamente.

O host pode fornecer:

```ts
saveAsset(blob, metadata, guard): unknown | Promise<unknown>
```

`blob` é o PNG gerado atual. `metadata` contém `title`, `url`, `source?` e `provenance: {kind:'composition',sourceUrl,videoId?,fileName?}`. Um vídeo selecionado preserva sua URL e origem da coleta; registros oficiais são excluídos. Metadados manuais exigem URL HTTPS declarada, sem credenciais, para salvar. Nenhuma URL é construída ou presumida. O nome original do arquivo é incluído quando tem até 200 caracteres. A composição e o download PNG continuam disponíveis quando faltar uma referência válida para salvar.

Alterar URL, imagem, metadados ou opções descarta o resultado anterior. O botão de salvar só fica habilitado para um resultado atual e uma referência válida. Cada clique inicia no máximo uma chamada; não há chamadas concorrentes nem retry automático. `false` devolvido pelo callback significa salvamento não concluído, sem mensagem de sucesso.

**O callback deve testar `guard()` imediatamente antes de persistir, depois de qualquer leitura, validação, conversão ou outro `await`.** A guarda confere serial do resultado, arquivo, campos atuais, identidade do callback, estado de cancelamento e, para metadados da coleta, `deps.snapshot()` atual contra a coleção explicitamente listada. Ela é passada como função para continuar válida durante trabalho assíncrono; não capture apenas seu valor inicial.

Cancelar, mudar contexto, invalidar a coleta ou descartar o compositor torna falsa a guarda de uma chamada pendente. Uma gravação já concluída não é desfeita pelo cancelamento. Resultados tardios não alteram a mensagem de uma seleção nova e não reiniciam o salvamento.

O módulo não importa storage ou Swipe File, não modifica workspace/dispatcher e não acessa conta ou serviço real. O coordenador injeta a implementação autorizada de persistência. Testes de DOM usam callbacks injetados; fixtures de navegador geram PNG real e verificam proveniência, cancelamento e troca de coleção sem persistência externa.
