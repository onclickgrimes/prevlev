# Fonte oficial opcional: YouTube Data API

Esta fonte pesquisa vídeos ou canais públicos por uma ponte no backend Prevlev. Ela permanece desativada por padrão e exige confirmação do usuário em cada ação. Não usa OAuth, dados privados, contas reais nem endpoints Nexlev.

## Configuração pelo operador

Use somente uma chave já existente, fornecida pelo operador, em `.env` local:

```dotenv
YOUTUBE_ENABLED=true
YOUTUBE_API_KEY=CHAVE_EXISTENTE_APENAS_NO_SERVIDOR
```

O código não cria chaves, habilita projetos, consulta saldo ou testa credenciais durante a inicialização. Sem opt-in do servidor, sem chave ou sem `apiConsent:true`, não faz chamadas ao Google. A chave segue no header `x-goog-api-key`, nunca no bundle, resposta, URL ou armazenamento do navegador, conforme as orientações de [uso de chaves](https://docs.cloud.google.com/docs/authentication/api-keys-use) e [segurança de chaves do Google](https://docs.cloud.google.com/docs/authentication/api-keys-best-practices).

O usuário confirma o envio da consulta ao Google/YouTube antes da busca. Consulte a [Política de Privacidade do Google](https://policies.google.com/privacy) e os [Termos do YouTube](https://www.youtube.com/t/terms).

## Fluxo e contrato

`searchYouTube(payload, config, fetcher, signal)` recebe os campos abaixo pela rota protegida `POST /v1/youtube/search` do backend Prevlev:

```json
{"q":"astronomia","type":"video","order":"relevance","maxResults":10,"apiConsent":true}
```

Campos opcionais: `channelId` canônico `UC...` para vídeos, `pageToken` opaco para a próxima página e `publishedAfter`/`publishedBefore` em RFC 3339. Aceita `type` vídeo/canal e as ordens `relevance`, `date` e `viewCount`; limita a 25 resultados por ação. A paginação exige outra ação explícita, sem coleta automática.

O módulo chama apenas os endpoints oficiais fixos [search.list](https://developers.google.com/youtube/v3/docs/search/list), [videos.list](https://developers.google.com/youtube/v3/docs/videos/list) e [channels.list](https://developers.google.com/youtube/v3/docs/channels/list). Faz uma pesquisa, um lote de metadados de vídeos quando necessário e um lote de canais: até três solicitações para vídeos ou duas para canais. Resultados vazios dispensam os lotes seguintes. A ordem vem da API; o módulo não calcula ranking próprio. A documentação alerta que ordenações distintas de relevância podem produzir resultados incompletos ou de tipos inesperados. A busca por data não garante os uploads mais recentes de um canal.

Resposta `RemoteResponse` com `source: "youtube-data-api"`; em sucesso, `data` contém `videos`, `channels`, `nextPageToken` quando disponível, `query`, `fetchedAt`, `requestCount` e `warnings`. Em erro, inclui somente a mensagem sanitizada, a fonte, a contagem de tentativas e o horário; nunca o corpo de erro do Google.

`OfficialVideo` e `OfficialChannel` são tipos separados dos vídeos coletados na página. Contadores oficiais são strings decimais para conservar precisão; campos ausentes são `null`. Duração fica no ISO 8601 original, sem classificação inferida de Shorts. Inscritos ocultos permanecem `null`; a [referência de canais](https://developers.google.com/youtube/v3/docs/channels#statistics) documenta o arredondamento dos inscritos públicos.

`requestCount` é o número de solicitações HTTP tentadas nesta ação. Não informa unidades gastas ou cota restante. Limites e custos dependem do método e da configuração do projeto; não são adivinhados. Nenhum teste desta implementação usa chave real, consulta cota ou executa pesquisa real.

## Isolamento dos dados

Os dados desta fonte ficam apenas na memória da visualização atual. Não são convertidos para `VideoRecord`, importados no dataset local, salvos no Swipe File, enviados para IA ou incluídos em histórico. Não alimentam VPH, outlier, RPM, somas, médias ou outros indicadores calculados do Prevlev.

As [políticas de desenvolvedor do YouTube, seção III.E.4](https://developers.google.com/youtube/terms/developer-policies) restringem métricas derivadas de dados da API e a retenção de dados sem autorização. Esta implementação usa uma separação mais restrita: exibe os valores oficiais e não os persiste. Atualizar ou fechar a visualização descarta o conjunto em memória. Os dados públicos de outras fontes continuam identificados separadamente.

## Limites técnicos

Há um prazo total de 20 segundos, incluindo pesquisa e lotes de metadados, com cancelamento e resposta máxima de 2 MiB por solicitação. URLs e parâmetros são definidos pelo módulo; payloads não escolhem host ou rota. Cookies, redirecionamentos e novas tentativas automáticas são desativados. Cancelar interrompe a espera e impede lotes seguintes; uma requisição já aceita pelo Google ainda pode consumir cota.

Erros 401/403/429 e falhas de transporte usam mensagens próprias, sem ecoar corpo, chave ou URL autenticada. Falta de estatística permanece desconhecida; falha de uma chamada não produz resultado simulado. Testes usam transporte injetado e identidades sintéticas.
