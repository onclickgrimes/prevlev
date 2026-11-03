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

`GET /health` informa versão e configuração segura do adaptador, sem consultar o Omni/provedor e sem expor chaves. Configuração não prova alcance do serviço ou geração real. `GET /v1/ai/catalog` consulta o catálogo por ação explícita; exige o mesmo token e a mesma política de origem de `POST /v1/analyze`. Ambas as operações compartilham o limite de requisições. `POST /v1/analyze` recebe `Content-Type: application/json` e `Authorization: Bearer TOKEN` quando configurado:

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

Resposta: `{ "status": "ok|not_configured|unsupported|error", "source": "prevlev:dataset|prevlev:history|prevlev:ai|prevlev:omni|prevlev:backend", "data": {}, "error": "opcional", "limitations": [] }`. O contrato é compatível com `RemoteResponse` da extensão.

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

## IA pelo Omni existente

O padrão `AI_PROVIDER=omni` conecta somente o servidor Prevlev ao Omni configurado por `OMNI_BASE_URL` (padrão `http://127.0.0.1:7814`). A extensão consulta `GET /v1/ai/catalog` no seu backend e mostra a origem Omni somente para leitura. A origem só muda pelo ambiente do servidor, sem endpoint de reconfiguração remota.

O catálogo vem de `GET /v1/models` do Omni e retorna, em `RemoteResponse.data`, `origin`, `models` e `warnings`. Os modelos normalizados contêm `id`, `provider`, `label`, `inputModalities`, `outputModalities`, `operations`, `streaming`, `textSupported` e `imageSupported`. Não há catálogo estático nem seleção automática do primeiro item. A interface exige escolha do provedor e ID completo anunciado, habilitando a operação pelas capacidades de saída.

Ações de IA mantêm o contrato `POST /v1/analyze` e acrescentam ao `payload`:

- `model`: ID completo escolhido no catálogo;
- `stream`: preferência explícita, válida somente quando o modelo anuncia streaming;
- `expectedOrigin`: origem do catálogo usada para escolher o modelo;
- os dados necessários à tarefa: texto, comentários ou briefing conforme a operação.

O servidor reconsulta o catálogo antes de gerar e recusa origem alterada, seleção ausente/incompatível e operação não anunciada. Não troca modelo ou provedor silenciosamente. Texto usa `POST /v1/responses` com `store: false`, em JSON ou SSE conforme a escolha e as capacidades. Chat Completions é permitido somente quando anunciado como operação do modelo e não há caminho Responses; erro em Responses não inicia outra geração por fallback. Deltas SSE não são resultados concluídos: falha, limite ou término sem `response.completed` não viram sucesso.

Thumbnails exigem `images.generate`, saída `image` e entrada compatível. O nome Kiro ou outro provedor não comprova suporte a imagem/vídeo. Quando não há capacidade anunciada, a função permanece indisponível de forma explícita. Artefatos Omni são baixados pelo backend, com autenticação e origem restrita, antes de entregar a imagem à extensão; o Bearer não vai em URLs de mídia.

`OMNI_API_KEY` fica apenas no servidor. `OMNI_TIMEOUT_MS` aceita inteiro entre 1 e 300000, com padrão de 120000. O limite controla a espera do Prevlev, sem garantir cancelamento de trabalho já aceito pelo upstream ou reversão de cota. A consulta do catálogo não gera conteúdo nem confirma saldo/autorização de inferência. Os testes usam fixtures e não acessam serviço, contas ou configurações do usuário.

As instruções completas, a separação de credenciais e as fontes primárias do contrato estão em [OMNIPROVIDERS.md](OMNIPROVIDERS.md).

## Modo compatível anterior, por escolha explícita

Para preservar uma instalação que já usa o adaptador anterior, configure `AI_PROVIDER=openai-compatible`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` e, para imagem, `AI_IMAGE_MODEL` no ambiente do servidor. Esse modo não consulta Omni e `GET /v1/ai/catalog` retorna `unsupported`, sem fabricar descritores. Não há troca automática entre os modos.

O adaptador compatível mantém os endpoints `/chat/completions` e `/images/generations`. Modelos são definidos pelo operador, sem modelo padrão. Cada serviço pode diferir no suporte aos campos; a geração de imagem usa a configuração desse adaptador. `AI_BASE_URL` exige HTTPS, permite HTTP apenas em loopback e recusa hosts Nexlev, credenciais embutidas e parâmetros de URL. `AI_API_KEY` permanece no servidor; o token da extensão é outro segredo. Serviços remotos exigem chave; serviços locais podem omiti-la.

## Dados e limites

O servidor não envia telemetria. Relatórios de dataset não persistem seus vídeos. Somente `view-history` persiste observações em `DATA_DIR`, com nome SHA-256 do ID e arquivo privado quando suportado pelo sistema. Apague essa pasta para remover o histórico. O código Prevlev não grava chaves API, comentários ou transcrições em logs. Omni, proxy e provedores podem ter políticas próprias de registro/retenção; `store: false` no contrato Responses não equivale a desligar todos os logs desses serviços.

Há limite de 1 MiB por requisição, 2000 vídeos por análise, 30 requisições/minuto por endereço para catálogo/análises e 10000 observações por vídeo. Requests de IA não seguem redirecionamentos e têm limites de resposta. Para hospedagem pública, acrescente proxy com HTTPS, limites por usuário, armazenamento e autenticação de produção. Este processo não implementa contas, cobrança, pesquisa global ou isolamento multiusuário.
