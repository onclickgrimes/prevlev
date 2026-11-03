# MCP local opcional

O Prevlev oferece um processo MCP **local por stdio e somente para leitura**. Ele fica desativado por padrão. Nenhum endpoint HTTP MCP, cadastro automático ou alteração de configuração de outros aplicativos é criado. O cliente que inicia o processo recebe acesso às observações locais do diretório escolhido; confira esse diretório antes de conectá-lo.

Instale as dependências do Prevlev com `npm ci`. Para uso manual, configure no ambiente do processo:

```text
MCP_ENABLED=true
DATA_DIR=/caminho/absoluto/prevlev/data/history
HISTORY_MAX_RECORDS=5000
```

Depois inicie `node /caminho/absoluto/prevlev/server/mcp.mjs`. Sem `MCP_ENABLED=true` exato, o comando termina com código 1, escreve uma indicação no stderr e não cria diretórios. Importar o módulo não inicia transporte ou leitura de dados, mesmo com a variável ativada.

Um cliente MCP com suporte a servidores stdio pode receber uma entrada equivalente a esta, adaptada manualmente ao formato e aos caminhos do seu aplicativo:

```json
{
  "command": "/caminho/absoluto/node",
  "args": ["/caminho/absoluto/prevlev/server/mcp.mjs"],
  "env": {
    "MCP_ENABLED": "true",
    "DATA_DIR": "/caminho/absoluto/prevlev/data/history"
  }
}
```

Não coloque chaves de IA, Omni ou YouTube nesse ambiente: estas ferramentas não as utilizam. Prefira o executável Node direto. Se usar o script npm, execute `npm --silent run mcp` no diretório do projeto; banners no stdout corrompem o protocolo. A interface reserva stdout para mensagens MCP e usa somente mensagens estáticas no stderr.

| Ferramenta | Entrada | Resultado |
| --- | --- | --- |
| `prevlev_capabilities` | `{}` | Escopo e limites reais desta implementação |
| `analyze_dataset` | `feature`, `videos`, `text`, `query`, `targetId`, `source` conforme a tarefa | Análises locais dos dados enviados |
| `history_list` | `limit` opcional | Observações locais mais recentes |
| `history_get` | `videoId` exato e `limit` opcional | Observações locais do vídeo, incluindo legado reconhecido |
| `history_export` | `videoId` e `limit` opcionais | JSON limitado; não grava arquivo |

`analyze_dataset` aceita `similar-videos`, `similar-channels`, `niche`, `search-analysis`, `channel-analytics`, `channel-report`, `combined-analytics` e `sponsorships`. São os cálculos próprios já disponíveis no backend: similaridade textual, agregações das observações e possíveis marcadores comerciais. Não representam o catálogo inteiro do YouTube, confirmação de patrocínio, receita ou previsão de desempenho. Para patrocínios envie texto; para as outras análises envie vídeos observados.

Os schemas rejeitam campos desconhecidos e limitam cada chamada a 500 vídeos, 100 mil caracteres de texto e 500 registros de histórico (100 por padrão). O histórico é lido do `DATA_DIR` configurado no processo, sem aceitar caminhos pelas ferramentas. A resposta inteira tem limite de 2 MiB. Arquivos legados que não guardavam identidade de vídeo não aparecem na listagem geral; a consulta por ID preserva o caminho de leitura compatível, e o resultado informa seus limites.

Dados explicitamente marcados como `youtube-data-api` são recusados nas análises derivadas. O servidor não busca, grava nem importa dados dessa API. Os dados aceitos são observações do navegador, páginas públicas ou material fornecido pelo usuário. A identificação de origem depende da informação preservada pelo coletor e pelo cliente; o MCP não consegue verificar externamente a procedência de material arbitrário.

Não há ferramentas de geração de IA, cota, autenticação, coleta na rede, gravação/exclusão de histórico ou alteração de canal. As anotações MCP declaram leitura e ambiente fechado; as funções também implementam esses limites. Uma conexão MCP não concede acesso à sessão do navegador.

O código usa o SDK oficial TypeScript v2 `@modelcontextprotocol/server` 2.4.0 e schemas Zod 4.2. Os testes inicializam o protocolo com o cliente oficial, listam/chamam ferramentas em memória e por stdio, usam diretórios temporários e transporte local, e verificam exclusões e ausência de chamadas externas. Nenhum aplicativo MCP do usuário é configurado pelos testes.

Fontes primárias consultadas: [guia oficial de servidor e stdio](https://modelcontextprotocol.io/docs/2026-07-28/develop/build-server), [SDK TypeScript v2](https://github.com/modelcontextprotocol/typescript-sdk) e [documentação do SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/).
