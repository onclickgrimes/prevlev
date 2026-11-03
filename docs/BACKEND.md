# Backend próprio opcional

O Prevlev funciona sem este processo para as ferramentas locais. Este backend é independente: não utiliza APIs, contas, licenças ou bases de dados da Nexlev. Nenhum serviço pago é chamado sem configuração explícita de um provedor de IA.

## Iniciar

Requer Node.js 24 e npm. Na raiz do checkout:

```bash
npm ci
npm run build
cp .env.example .env
```

No PowerShell, use `Copy-Item .env.example .env`. Edite `.env` localmente: substitua `PREVLEV_TOKEN` por um token exclusivo desta instalação e `ALLOWED_ORIGINS` pela origem exata mostrada em `chrome://extensions` após carregar `dist/`. O arquivo de exemplo contém somente placeholders, sem credenciais reais.

```dotenv
BIND=127.0.0.1
PORT=8787
PREVLEV_TOKEN=SUBSTITUA_POR_UM_TOKEN_EXCLUSIVO_LOCAL
ALLOWED_ORIGINS=chrome-extension://SUBSTITUA_PELO_ID_EXATO_DA_EXTENSAO
DATA_DIR=./data/history
HISTORY_MAX_RECORDS=5000
YOUTUBE_ENABLED=false
YOUTUBE_API_KEY=
MCP_ENABLED=false
AI_PROVIDER=omni
OMNI_BASE_URL=http://127.0.0.1:7814
OMNI_API_KEY=
OMNI_TIMEOUT_MS=120000
```

`OMNI_API_KEY`, quando necessário, é a chave de acesso **já existente do serviço Omni**, configurada apenas no ambiente do backend Prevlev. As credenciais dos provedores permanecem no Omni. Não coloque chaves Omni/provedor ou OAuth na extensão, em exemplos públicos ou no chat.

```bash
npm run server
```

O comando inicia o backend Prevlev e carrega `.env`; não inicia nem reconfigura o Omni. Reinicie esse processo após mudar variáveis. Na extensão, configure `http://127.0.0.1:8787` e o mesmo `PREVLEV_TOKEN`. O navegador solicitará acesso a essa origem. Para usar os dois loopbacks, navegador, backend e Omni devem estar na mesma máquina; em outra máquina, `127.0.0.1` aponta para o próprio host.

Use HTTPS ao hospedar em outra máquina. O servidor exige `PREVLEV_TOKEN` ao escutar fora do loopback. `ALLOWED_ORIGINS` aceita origens exatas separadas por vírgula, sem curingas. Sem a origem correta, a extensão recebe erro de CORS. A instalação fornecida é pessoal; hospedagem pública precisa de autenticação e isolamento de produção.

## Contrato

`GET /health` informa versão e configuração, sem testar Omni, YouTube ou provedores e sem expor chaves. Flags de configuração não comprovam conectividade, saldo, geração ou processo MCP em execução.

| Rota HTTP | Finalidade | Controle |
| --- | --- | --- |
| `GET /health` | Metadados de configuração, sem chamada externa | Sem teste de serviços |
| `GET /v1/ai/catalog` | Catálogo Omni solicitado manualmente | Token, origem exata e limite compartilhado |
| `POST /v1/analyze` | Dataset local ou ação de IA escolhida | Token, origem exata e limite compartilhado |
| `POST /v1/youtube/search` | Uma página da API oficial opcional | Mesmos controles, opt-in no servidor e `apiConsent:true` |
| `POST /v1/history` | Ações manuais de histórico próprio | Mesmos controles; exclusão exige `confirm:true` |

Todas as rotas protegidas compartilham 30 solicitações por minuto por endereço. Rotas POST recebem `Content-Type: application/json` e `Authorization: Bearer TOKEN` quando configurado. A consulta de catálogo não aceita corpo. Não há endpoint HTTP MCP nem rota para mudar credenciais/origem de provedor remotamente.

Exemplo de `POST /v1/analyze`:

```json
{
  "feature": "channel-analytics",
  "payload": {
    "videos": [
      {
        "id": "id-observado",
        "title": "Título observado",
        "channelId": "canal",
        "views": 1234,
        "isShort": false
      }
    ]
  }
}
```

Resposta: `{ "status": "ok|not_configured|unsupported|error", "source": "prevlev:dataset|prevlev:history|prevlev:ai|prevlev:omni|prevlev:backend|youtube-data-api", "data": {}, "error": "opcional", "limitations": [] }`. O contrato é compatível com `RemoteResponse` da extensão; fonte e campos distinguem a API oficial das observações locais.

| Recurso                                                        | Entrada e resultado real                                                               | Limite                                                               |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `similar-videos`                                               | `videos` e `query` ou `targetId`; ranqueia títulos pelo índice de Jaccard              | Similaridade lexical apenas entre itens enviados                     |
| `similar-channels`                                             | `videos` com canal e `query` ou `targetId`; compara palavras dos títulos por canal     | Não descobre novos canais na internet                                |
| `niche`, `search-analysis`                                     | `videos`, `query` opcional; termos, frequência, canais e estatísticas observadas       | Não mede saturação de todo um nicho                                  |
| `channel-analytics`, `channel-report`, `combined-analytics`    | `videos`; médias, medianas, views conhecidas, cobertura e grupos                       | Não obtém receita, geografia ou dados privados de canais             |
| `view-history`                                                 | `videoId`, `views` opcional; grava observação com horário do servidor e lê série local | Sem histórico anterior ao primeiro registro; sem RPM inventado       |
| `sponsorships`                                                 | `text`; destaca marcadores de publicidade para revisão                                 | Não comprova contratos nem estima valores                            |
| `comment-analysis`                                             | `comments`; análise por IA configurada                                                 | Exige provedor/modelo compatível escolhido                           |
| `transcript-summary`, `transcript-topics`, `transcript-script` | `transcript` com texto e timestamp, ou `text`                                          | Exige provedor/modelo compatível escolhido; saída precisa de revisão |
| `thumbnail-generation`                                         | `prompt` de até 4 mil caracteres                                                       | Exige capacidade de imagem anunciada; não estima CTR                 |

Dados incompletos permanecem desconhecidos. Por exemplo, views ausentes não viram zero e o relatório informa `viewsCoverage`. VPH usa views acumuladas divididas pela idade do vídeo, e não tráfego da última hora. As funções de relatório e descoberta são adaptações sobre dados enviados, não paridade com o serviço de pesquisa Nexlev.

Dados explicitamente identificados como `youtube-data-api` não podem alimentar análises derivadas ou o histórico local. A interface oficial mantém os dados separados da coleta do navegador. Essa marca deve ser preservada por clientes/importadores; o servidor não verifica externamente a procedência de material arbitrário fornecido pelo usuário.

## Pesquisa oficial opcional

Ative `YOUTUBE_ENABLED=true` e configure somente uma chave **existente e autorizada** em `YOUTUBE_API_KEY`, no servidor. Sem opt-in, chave e `apiConsent:true` na ação, nenhuma chamada ao Google é feita. A chave segue em `x-goog-api-key`, nunca no browser ou na URL. O módulo usa exclusivamente os endpoints fixos `search`, `videos` e `channels`, com até três solicitações por ação de vídeos ou duas para canais, sem nova tentativa automática. `requestCount` conta requisições tentadas, não unidades de cota ou saldo.

`POST /v1/youtube/search` recebe, por exemplo, `{"q":"astronomia","type":"video","order":"relevance","maxResults":10,"apiConsent":true}`. Aceita até 25 resultados por ação e um `pageToken` de próxima página em outra solicitação explícita. O prazo total é de 20 segundos, a resposta de cada upstream é limitada a 2 MiB e o cancelamento impede lotes seguintes; uma chamada já aceita pode ter consumido cota.

O resultado contém os valores oficiais, fontes e horários; contadores são strings decimais e ausências são `null`. Não calcula VPH, outlier, RPM, médias ou classificações próprias de Shorts a partir da API. O backend não persiste esses resultados. A visualização mantém somente dados em memória, exige paginação manual e não os mescla com relatórios, histórico, Swipe File ou IA. Consulte [YOUTUBE.md](YOUTUBE.md) para parâmetros, limites da fonte e política de dados. Sem configuração real, a pesquisa permanece indisponível de forma explícita.

## Histórico próprio

`POST /v1/history` recebe uma ação:

| `action` | Campos | Resultado |
| --- | --- | --- |
| `record` | `videos`, de 1 a 100 observações locais com contagens conhecidas | Preserva horário válido da coleta e registra separadamente o horário do servidor; não recupera o passado |
| `list` | `limit` opcional, de 1 a 500 | Lista observações indexadas, mais recentes primeiro |
| `get` | `videoId`, `limit` opcional | Lê o vídeo e o legado reconhecido desse ID |
| `export` | `videoId` opcional | Retorna JSON; não grava arquivo de exportação no servidor |
| `delete` | `videoId` opcional, `confirm:true` obrigatório | Remove o vídeo indicado ou todos os registros reconhecidos |

As fontes aceitas são `youtube-dom`, `public-page` e `user-provided`; `youtube-data-api` é excluída. Views e inscritos ausentes não viram zero. O cliente não escolhe caminho de arquivo. `observedAt` preserva o instante UTC completo, válido e não futuro informado pela coleta; `recordedAt` é o horário em que o servidor salva. Sem `observedAt`, o registro usa a hora de gravação como fallback e avisa que isso não comprova atualização da contagem. Reenviar a mesma coleta com o mesmo instante e contagens é deduplicado, sem criar crescimento aparente; não há coleta periódica ou consulta externa por essa rota. Alterações de contadores e taxas no relatório usam somente extremos efetivamente observados, preservando revisões negativas e sem interpolar lacunas.

Os registros novos ficam em `DATA_DIR/observations-v1.json`, com versão de formato, limite global de `HISTORY_MAX_RECORDS` entre 1 e 5000 e limite de 10 MiB do índice. Escritas usam arquivo temporário e troca atômica, com permissões privadas quando suportadas. Quando os limites são alcançados, registros antigos podem ser removidos; a resposta informa as remoções. O diretório é de uma instalação pessoal; não há banco multiusuário ou coordenação entre vários processos escritores.

Arquivos legados reconhecidos com nome SHA-256 do ID são preservados e continuam legíveis quando o ID é informado. Eles não formam um catálogo de IDs: listagem/exportação geral abrangem o índice novo, enquanto uma consulta/exportação por vídeo pode incluir o legado reconhecido. Arquivos corrompidos, caminhos arbitrários e arquivos desconhecidos não são sobrescritos. Exclusão geral preserva arquivos não reconhecidos. O contrato anterior `view-history` usa o mesmo armazenamento por compatibilidade. Apagar `DATA_DIR` remove os registros desse servidor, sem apagar downloads já exportados.

## MCP somente para leitura

O MCP é um **processo stdio separado**, desativado por padrão (`MCP_ENABLED=false`). Ativá-lo exige que o operador configure e inicie explicitamente o processo local; iniciar o servidor HTTP não o registra nem inicia em outros aplicativos. Não há chave de IA/YouTube no contrato MCP.

As cinco ferramentas são `prevlev_capabilities`, `analyze_dataset`, `history_list`, `history_get` e `history_export`. Não fazem rede, geração de IA, gravação/exclusão de histórico ou alteração de canal. Exportação MCP retorna até 500 registros em JSON e não cria arquivo. Dados marcados como API oficial são recusados nas análises. Consulte [MCP.md](MCP.md) para configuração manual, schemas, limites e evidências.

## IA pelo Omni existente

O padrão `AI_PROVIDER=omni` conecta somente o servidor Prevlev ao Omni configurado por `OMNI_BASE_URL` (padrão `http://127.0.0.1:7814`). A extensão consulta `GET /v1/ai/catalog` no seu backend e mostra a origem Omni somente para leitura. A origem só muda pelo ambiente do servidor, sem endpoint de reconfiguração remota.

O catálogo vem de `GET /v1/models` do Omni e retorna, em `RemoteResponse.data`, `origin`, `models` e `warnings`. Os modelos normalizados contêm `id`, `provider`, `label`, `inputModalities`, `outputModalities`, `operations`, `streaming`, `textSupported` e `imageSupported`. Não há catálogo estático nem seleção automática do primeiro item. A interface exige escolha do provedor e ID completo anunciado, habilitando a operação pelas capacidades de saída.

Ações de IA mantêm o contrato `POST /v1/analyze` e acrescentam ao `payload`:

- `model`: ID completo escolhido no catálogo;
- `stream`: preferência explícita, válida para texto somente quando o modelo anuncia streaming e operação Responses;
- `expectedOrigin`: origem do catálogo usada para escolher o modelo;
- os dados necessários à tarefa: texto, comentários ou briefing conforme a operação.

O servidor reconsulta o catálogo antes de gerar e recusa origem alterada, seleção ausente/incompatível e operação não anunciada. Não troca modelo ou provedor silenciosamente. Texto usa `POST /v1/responses` com `store: false`, em JSON ou SSE conforme a escolha e as capacidades. Chat Completions é permitido somente quando anunciado como operação do modelo e não há caminho Responses; erro em Responses não inicia outra geração por fallback. Deltas SSE não são resultados concluídos: falha, limite ou término sem `response.completed` não viram sucesso.

Thumbnails exigem `images.generate`, saída `image` e entrada compatível. O nome Kiro ou outro provedor não comprova suporte a imagem/vídeo. Quando não há capacidade anunciada, a função permanece indisponível de forma explícita. Artefatos Omni são baixados pelo backend, com autenticação e origem restrita, antes de entregar a imagem à extensão; o Bearer não vai em URLs de mídia.

`OMNI_API_KEY` fica apenas no servidor. `OMNI_TIMEOUT_MS` aceita inteiro entre 1 e 300000, com padrão de 120000. O timeout é um único orçamento para catálogo, geração e download do artefato; a etapa de catálogo também é limitada a até dez segundos. O limite controla a espera do Prevlev, sem garantir cancelamento de trabalho já aceito pelo upstream ou reversão de cota. A consulta do catálogo não gera conteúdo nem confirma saldo/autorização de inferência. Os testes usam fixtures e não acessam serviço, contas ou configurações do usuário.

As instruções completas, a separação de credenciais e as fontes primárias do contrato estão em [OMNIPROVIDERS.md](OMNIPROVIDERS.md).

## Modo compatível anterior, por escolha explícita

Para preservar uma instalação que já usa o adaptador anterior, configure `AI_PROVIDER=openai-compatible`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` e, para imagem, `AI_IMAGE_MODEL` no ambiente do servidor. Esse modo não consulta Omni e `GET /v1/ai/catalog` retorna `unsupported`, sem fabricar descritores. Não há troca automática entre os modos.

O adaptador compatível mantém os endpoints `/chat/completions` e `/images/generations`. Modelos são definidos pelo operador, sem modelo padrão. Cada serviço pode diferir no suporte aos campos; a geração de imagem usa a configuração desse adaptador. `AI_BASE_URL` exige HTTPS, permite HTTP apenas em loopback e recusa hosts Nexlev, credenciais embutidas e parâmetros de URL. `AI_API_KEY` permanece no servidor; o token da extensão é outro segredo. Serviços remotos exigem chave; serviços locais podem omiti-la.

## Dados e limites

O servidor não envia telemetria. Relatórios de dataset e a pesquisa oficial não persistem seus resultados. `/v1/history` e o contrato anterior `view-history` registram somente observações locais explícitas, conforme o formato e os limites acima. O código Prevlev não grava chaves API, comentários ou transcrições em logs. Omni, proxy e provedores podem ter políticas próprias de registro/retenção; `store: false` no contrato Responses não equivale a desligar todos os logs desses serviços.

Há limite de 1 MiB por requisição HTTP, 2000 vídeos por análise de dataset e 30 requisições/minuto por endereço compartilhadas pelas rotas protegidas. MCP e histórico têm seus próprios limites descritos acima. Solicitações externas não seguem redirecionamentos e têm limites de resposta. Testes usam dados/transportes sintéticos, arquivos temporários, loopback e stdio local; não validam chaves reais, saldo, alcance de um serviço do usuário ou operação em conta real. Para hospedagem pública, acrescente proxy com HTTPS, limites por usuário, armazenamento e autenticação de produção. Este processo não implementa contas, cobrança, aquisição irrestrita de catálogo ou isolamento multiusuário.
