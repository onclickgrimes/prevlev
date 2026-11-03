# Metadados confirmados e amostras explícitas · D09/D10

O editor de metadados da prévia guarda uma confirmação local de canal, visualizações, data, duração e avatar. Concluir confirma esses campos somente para a simulação; Redefinir restaura a última confirmação, incluindo o arquivo de avatar. Os valores iniciais são a primeira base, antes de qualquer confirmação. Nada entra na coleção, histórico ou relatórios.

A tela abre em modo ilustrativo e não lê/coleta fontes automaticamente. Para usar uma amostra, o usuário escolhe a coleção congelada ou uma aba YouTube explicitamente autorizada e clica em Usar amostra da fonte escolhida. Escolher a fonte, abrir a tela, gerar uma composição ou trocar o feed visual não inicia a coleta.

A captura mantém identidade, URL exata, superfície inferida da URL, título/horário quando fornecidos e uma cópia de até 500 linhas locais elegíveis de uma entrada de até 5000. A composição mostra até 8 cards de contexto, sem buscar suas imagens. Registros da API oficial recusam a amostra. Coleções não recebem uma origem única presumida: a URL é apresentada como contexto associado e não comprova a origem de todas as linhas. Para a aba, a superfície observada prevalece sobre o feed visual solicitado; outro contexto usa apresentação genérica. Fontes sem dados elegíveis falham sem substituir por números ou cards inventados.

A identidade atual é conferida antes/depois da captura e antes/depois da composição. Mudança da aba/fonte, cancelamento, limpeza ou substituição da coleta invalida a amostra e descarta respostas tardias. A captura não altera a coleção global.

Integração de `initImageTools(options)`:

```ts
contextIdentity: (source: 'collection' | 'selected-tab') => string | undefined;
captureContext: (request: {
  source: 'collection' | 'selected-tab';
  expectedIdentity: string;
  signal: AbortSignal;
}) => Promise<{
  source: 'collection' | 'selected-tab';
  identity: string;
  url: string;
  title?: string;
  observedAt?: string;
  videos: readonly VideoRecord[];
}>;
```

O host vincula o token da coleção a uma revisão e o token da aba ao ID/URL selecionados autorizados. A captura da aba também deve conferir a identidade atual antes/depois de ler o snapshot e respeitar o signal. O host continua chamando `imageTools.invalidateContext()` ao trocar fonte, limpar ou substituir/enriquecer a coleção. O getter legado `contextVideos` é aceito somente como coleção congelada sem URL conhecida e só é lido após a ação explícita de carregar; não autoriza uma captura de aba.

Validação: `tests/image-context.test.ts` e `tests/browser/image-context.spec.ts`, além das fixtures de segurança e composição existentes. Somente fixtures: nenhuma coleta real de canal/conta, geração paga ou modificação de serviço.
