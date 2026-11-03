# Backend próprio opcional

O Prevlev funciona sem este processo para as ferramentas locais. Este backend é independente: não utiliza APIs, contas, licenças ou bases de dados da Nexlev. Nenhum serviço pago é chamado sem configuração explícita de um provedor de IA.

## Iniciar

Requer Node.js 24. Copie as variáveis abaixo para um arquivo `.env` local, fora do Git. Descubra o ID em `chrome://extensions` depois de carregar `dist/`.

```dotenv
BIND=127.0.0.1
PORT=8787
PREVLEV_TOKEN=escolha-um-segredo-local
ALLOWED_ORIGINS=chrome-extension://ID_EXATO_DA_EXTENSAO
DATA_DIR=./data/history
# IA opcional, via endpoint próprio ou provedor compatível configurado:
# AI_BASE_URL=http://127.0.0.1:8080/v1
# AI_MODEL=seu-modelo-de-texto
# AI_IMAGE_MODEL=seu-modelo-de-imagem
# AI_API_KEY=credencial-apenas-no-servidor
```

Execute `npm run server`. Na extensão, configure `http://127.0.0.1:8787` e o mesmo token. O navegador solicitará acesso ao host escolhido. Use HTTPS ao hospedar em outra máquina. O servidor exige `PREVLEV_TOKEN` ao escutar fora do loopback. `ALLOWED_ORIGINS` aceita origens exatas, separadas por vírgula; não aceita curingas. Sem origem configurada, a extensão recebe erro claro de CORS.

## Contrato

`GET /health` informa a versão e se os modelos de IA foram configurados. `POST /v1/analyze` recebe `Content-Type: application/json` e `Authorization: Bearer TOKEN` quando configurado:

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

Resposta: `{ "status": "ok|not_configured|unsupported|error", "source": "prevlev:dataset|prevlev:history|prevlev:ai|prevlev:backend", "data": {}, "error": "opcional", "limitations": [] }`. O contrato é compatível com `RemoteResponse` da extensão.

| Recurso                                                        | Entrada e resultado real                                                               | Limite                                                         |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `similar-videos`                                               | `videos` e `query` ou `targetId`; ranqueia títulos pelo índice de Jaccard              | Similaridade lexical apenas entre itens enviados               |
| `similar-channels`                                             | `videos` com canal e `query` ou `targetId`; compara palavras dos títulos por canal     | Não descobre novos canais na internet                          |
| `niche`, `search-analysis`                                     | `videos`, `query` opcional; termos, frequência, canais e estatísticas observadas       | Não mede saturação de todo um nicho                            |
| `channel-analytics`, `channel-report`, `combined-analytics`    | `videos`; médias, medianas, views conhecidas, cobertura e grupos                       | Não obtém receita, geografia ou dados privados de canais       |
| `view-history`                                                 | `videoId`, `views` opcional; grava observação com horário do servidor e lê série local | Sem histórico anterior ao primeiro registro; sem RPM inventado |
| `sponsorships`                                                 | `text`; destaca marcadores de publicidade para revisão                                 | Não comprova contratos nem estima valores                      |
| `comment-analysis`                                             | `comments`; análise por IA configurada                                                 | Sem provedor: `not_configured`                                 |
| `transcript-summary`, `transcript-topics`, `transcript-script` | `transcript` com texto e timestamp, ou `text`                                          | Sem provedor: `not_configured`; saída precisa de revisão       |
| `thumbnail-generation`                                         | `prompt` de até 4 mil caracteres                                                       | Sem modelo de imagem: `not_configured`; não estima CTR         |

Dados incompletos permanecem desconhecidos. Por exemplo, views ausentes não viram zero e o relatório informa `viewsCoverage`. VPH usa views acumuladas divididas pela idade do vídeo, e não tráfego da última hora. As funções de relatório e descoberta são adaptações sobre dados enviados, não paridade com o serviço de pesquisa Nexlev.

## IA e privacidade

O adaptador usa os endpoints [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create/) (`/chat/completions`) e [Image Generations](https://developers.openai.com/api/reference/resources/images/methods/generate/) (`/images/generations`) do contrato OpenAI compatível. O modelo é configurado pelo operador, sem valor padrão. Cada provedor pode ter diferenças; modelos devem aceitar os campos enviados. A geração de imagem solicita uma imagem em `1536x1024`. Nenhuma URL enviada no payload é buscada pelo servidor.

`AI_BASE_URL` é definido apenas no ambiente do servidor, exige HTTPS (HTTP permitido apenas em loopback), nega hosts Nexlev, credenciais embutidas e parâmetros de URL. `AI_API_KEY` fica no servidor; o token da extensão é outro segredo. Provedores remotos exigem chave; modelos locais podem omiti-la. Requisições de IA não seguem redirecionamentos, têm timeout de 45 segundos e saída limitada. Os testes usam respostas locais artificiais identificadas como fixtures, sem chamadas pagas ou a contas reais.

O servidor não envia telemetria. Relatórios de dataset não persistem seus vídeos. Só `view-history` persiste observações em `DATA_DIR`, com nome SHA-256 do ID e arquivo privado quando suportado pelo sistema. Apague essa pasta para remover o histórico. A chave API, comentários e transcrições nunca são gravados em logs pelo código do servidor.

Há limite de 1 MiB por requisição, 2000 vídeos por análise, 30 análises/minuto por endereço e 10000 observações por vídeo. Para hospedar publicamente, acrescente um proxy com HTTPS e limites por usuário, armazenamento e autenticação de produção. Esse processo não implementa contas, cobrança, pesquisa global ou isolamento de dados entre usuários: a instalação é pessoal.
