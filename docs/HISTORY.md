# Histórico local de observações

O histórico registra amostras que o usuário manda salvar no backend pessoal Prevlev. Ele não consulta o YouTube, não recupera views de datas anteriores e não estima receita ou RPM. Abrir uma página, coletar cards ou consultar o histórico não registra automaticamente uma amostra.

O serviço usa o mesmo backend local, token e política de origem configurados em [BACKEND.md](BACKEND.md). `DATA_DIR` escolhe a pasta no ambiente do servidor. `HISTORY_MAX_RECORDS` é um inteiro de 1 a 5000, com padrão 5000. Não há serviço externo ou infraestrutura adicional.

## Operações

`POST /v1/history` recebe JSON autenticado. Todas as ações são explícitas:

| `action` | Campos | Resultado |
| --- | --- | --- |
| `record` | `videos`, de 1 a 100 itens | Registra amostras com contagem conhecida; informa gravados, duplicados, omitidos e removidos por retenção |
| `list` | `videoId` opcional, `limit` opcional | Lista registros recentes, por padrão 100 e no máximo 500 |
| `get` | `videoId`, `limit` opcional | Consulta o vídeo, combinando registros novos e o arquivo antigo reconhecido, se houver |
| `export` | `videoId` opcional | Retorna registros JSON; a interface pode baixar o arquivo, sem receber caminhos internos |
| `delete` | `videoId` opcional e `confirm: true` | Remove o vídeo solicitado ou todo o histórico reconhecido |

O envelope segue `RemoteResponse`, com `source: "prevlev:history"`. Leituras retornam `data.records` e `data.total`, em ordem da observação mais recente. O limite de leitura não fabrica nem completa registros; `total` informa quantos existem antes do corte.

Uma amostra tem `id` aleatório, `videoId`, título, URL pública, metadados opcionais de canal, `observedAt` em UTC e `views` e/ou `subscribers` quando conhecidos. Quando a coleta informa um `observedAt` UTC completo, válido e não futuro, esse instante é preservado. `recordedAt` marca separadamente a gravação no servidor. Sem instante de coleta, `observedAt` usa a hora de gravação e não comprova que o contador estava atualizado naquele momento. Zero é preservado quando foi informado. Contagens ausentes continuam ausentes, e um vídeo sem nenhuma contagem não gera registro.

As fontes aceitas são `youtube-dom`, `public-page` e `user-provided`. A ausência de etiqueta é tratada como dado fornecido pelo usuário; isso não comprova a origem. Registros marcados `youtube-data-api` são omitidos integralmente. Um lote composto só por essa fonte é recusado sem gravar arquivo; um lote misto informa quantos itens dessa fonte foram omitidos. As métricas oficiais mantidas em memória pela integração de pesquisa não se tornam histórico persistente.

## Armazenamento e retenção

Os registros novos ficam em `DATA_DIR/observations-v1.json`, num envelope de versão 1. O arquivo contém no máximo o limite configurado e 10 MiB. Ao atingir esses limites, as observações mais antigas são removidas; a resposta de gravação informa `evicted`. Exportar os dados antes de atingir a retenção preserva uma cópia independente.

Uma mesma amostra do mesmo vídeo, com o mesmo instante observado e as mesmas contagens, é deduplicada. A mesma contagem em um horário posterior é outra observação: isso permite mostrar um período sem crescimento sem inventar dados intermediários.

As gravações usam arquivo temporário exclusivo com permissão `0600`, sincronização e renomeação atômica, quando suportadas pelo sistema. O processo serializa as operações por pasta, evitando perda de atualizações concorrentes dentro dessa instância. Isso não é um bloqueio distribuído entre vários processos: use uma instância de backend para cada pasta. Leitura/importação do módulo não cria diretórios ou arquivos.

Arquivos são limitados antes do parsing e validados antes de sobrescrever. JSON inválido, versões desconhecidas, contagens inválidas e links simbólicos recusados não são transformados em um histórico vazio. Os erros públicos usam mensagens estáticas, sem revelar caminhos ou conteúdo privado.

## Compatibilidade com o histórico antigo

A análise `view-history` continua disponível com `videoId` e `views` opcional. Ela mantém o formato `data.observations`, sem alterar os demais relatórios de dataset. Novos registros usam o armazenamento versionado.

Os arquivos antigos com nome SHA-256 do ID do vídeo e conteúdo de observações são preservados. Como não continham o ID internamente, não são varridos para construir um catálogo de vídeos: a leitura pelo `videoId` reconhece e combina o arquivo correspondente. A lista geral e a exportação geral incluem o índice novo; para exportar amostras antigas, informe o ID do vídeo. Esses limites aparecem nas respostas.

Excluir um vídeo remove também seu arquivo antigo válido. Excluir tudo remove o armazenamento novo e os arquivos antigos reconhecidos e validados. Outros arquivos, formatos inválidos ou arquivos que não puderam ser removidos são preservados e informados como omitidos; o processo não apaga arquivos arbitrários da pasta.

## Consulta local por MCP

`server/history.mjs` oferece `readHistory({videoId?, limit?}, {dataDir, historyMaxRecords?})` para consumidores locais somente de leitura. Esse helper não cria amostras, não remove arquivos, não faz consultas de rede e limita a saída a 500 registros por chamada. Ele pode consultar amostras antigas quando recebe o ID do vídeo. A exportação MCP que usa esse helper deve informar que sua saída é limitada; a exportação completa fica na ação explícita de histórico da UI/backend.

O acesso e a habilitação do servidor MCP opcional são separados. Consultar um histórico local não autoriza geração de IA, acesso a contas, ações no Studio ou uso de chaves de provedor.

## Validação

Os testes usam pastas temporárias e fixtures para gravações concorrentes, retenção, deduplicação, contagens ausentes/zero, exclusão confirmada, preservação de arquivos antigos, rejeição de dados oficiais e leitura de arquivos inválidos ou grandes. Não utilizam um canal real, conta, API YouTube ou serviço Omni. A verificação consolidada fica em [VALIDATION.md](VALIDATION.md).
