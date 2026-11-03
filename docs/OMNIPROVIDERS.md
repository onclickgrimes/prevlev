# IA pelo OmniProviders existente

O Prevlev usa o serviço OmniProviders já instalado como ponte para os provedores. O caminho é: **extensão → backend Prevlev (`127.0.0.1:8787`) → OmniProviders (`127.0.0.1:7814`) → provedor escolhido**. A extensão não fala diretamente com o Omni nem recebe suas credenciais.

Esta integração foi implementada a partir do contrato no código-fonte e verificada com fixtures. O serviço existente, suas contas, configurações e saldo não foram acessados nesta execução. Consultar um catálogo não qualifica a geração real; a disponibilidade depende do serviço e da conta no momento da solicitação.

## Preparar o backend local

Use Node.js 24 e npm. Na raiz deste checkout, em uma instalação nova sem `.env` existente:

```bash
npm ci
npm run build
cp .env.example .env
```

Se `.env` já existe, preserve-o e acrescente/ajuste somente as variáveis necessárias. No PowerShell, use `Copy-Item .env.example .env` no lugar de `cp`. Edite o arquivo `.env` local antes de iniciar:

```dotenv
BIND=127.0.0.1
PORT=8787
PREVLEV_TOKEN=SUBSTITUA_POR_UM_TOKEN_EXCLUSIVO_LOCAL
ALLOWED_ORIGINS=chrome-extension://SUBSTITUA_PELO_ID_EXATO_DA_EXTENSAO
AI_PROVIDER=omni
OMNI_BASE_URL=http://127.0.0.1:7814
OMNI_API_KEY=
OMNI_TIMEOUT_MS=120000
```

Carregue `dist/` em `chrome://extensions` para obter o ID exato da extensão. Substitua os dois campos de exemplo: origem autorizada e token exclusivo do Prevlev. Se o Omni existente exigir autenticação, configure `OMNI_API_KEY` com sua **chave existente de acesso ao serviço Omni**, somente neste ambiente do servidor. As credenciais de provedores e OAuth continuam sob responsabilidade do Omni. Não coloque essas credenciais na extensão nem as envie no chat. Esta integração não cria chaves, contas ou fluxos de login.

Inicie somente o backend Prevlev:

```bash
npm run server
```

O script carrega `.env` com o suporte nativo do Node. Após qualquer alteração nesse arquivo, encerre o processo e execute `npm run server` novamente. Ele não inicia, importa nem reconfigura o serviço Omni existente.

Navegador, backend Prevlev e Omni precisam estar na mesma máquina para que os dois endereços `127.0.0.1` apontem para a instalação esperada. Se estiverem em máquinas diferentes, cada loopback aponta para o próprio host; configure origens alcançáveis e a proteção de transporte correspondente. O backend pessoal não oferece autenticação multiusuário ou isolamento entre contas.

## Consultar e escolher um modelo

1. Na extensão, abra **Conexão**, configure o backend `http://127.0.0.1:8787` e o mesmo `PREVLEV_TOKEN`; salve e conceda acesso a essa origem.
2. Clique explicitamente em **Consultar modelos**. A extensão consulta `GET /v1/ai/catalog` no backend Prevlev autenticado; ele consulta `GET /v1/models` no Omni configurado.
3. Confira a origem Omni exibida. Escolha o provedor e o ID completo de modelo disponibilizado para a operação desejada. O primeiro modelo não é selecionado automaticamente.
4. Use as ações de resumo, tópicos, roteiro, comentários ou thumbnail. Essa ação envia somente os dados necessários, o modelo escolhido, a opção de streaming e a origem esperada ao backend Prevlev.

O seletor considera as operações e modalidades de **saída** anunciadas. Um modelo que recebe imagens pode produzir apenas texto. O nome do provedor ou do modelo não habilita geração de imagem/vídeo; por exemplo, o contrato inspecionado do Kiro anuncia saída textual. Thumbnails ficam indisponíveis quando o catálogo não oferece `images.generate` com saída `image` e entrada compatível.

O catálogo retorna `origin`, modelos normalizados e avisos. Cada modelo inclui `id`, `provider`, `label`, `inputModalities`, `outputModalities`, `operations`, `streaming`, `textSupported` e `imageSupported`. A seleção é o ID integral `provider:model`. Modelos desconhecidos, removidos ou incompatíveis não são substituídos por outro modelo. A origem da seleção é vinculada à solicitação por `expectedOrigin`, e o servidor consulta o catálogo novamente antes de gerar.

`OMNI_BASE_URL` é editável **somente no ambiente do backend**. A extensão mostra essa origem e guarda a identidade da seleção, mas não tem um endpoint para reconfigurar o Omni. Trocar origem, provedor ou modelo exige conferir o catálogo e a seleção correspondentes. O catálogo pode envolver descoberta normal pelo serviço; não dispara uma geração de teste nem comprova saldo ou permissão de inferência.

## Contratos utilizados

| Função           | Contrato do Omni                                                         | Comportamento do Prevlev                                                                               |
| ---------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Catálogo         | `GET /v1/models`, descritores `id` e `x_omni.capabilities`               | Consulta manual pela ponte autenticada; não fabrica opções                                             |
| Texto            | `POST /v1/responses`, operação `responses`, saída textual                | Envia modelo exato, `store: false` e dados da tarefa; aceita JSON ou SSE quando suportado e escolhido  |
| Texto compatível | `POST /v1/chat/completions`, operação `chat.completions`                 | Usado apenas quando declarado pelo modelo e sem caminho Responses disponível; não é fallback após erro |
| Thumbnail        | `POST /v1/images/generations`, operação `images.generate`, saída `image` | Somente para modelo anunciado como compatível, sem presumir capacidade pelo provedor                   |
| Artefato         | `GET /v1/artifacts/{id}` autenticado                                     | Download pelo servidor, limitado à mesma origem Omni; entrega de imagem à extensão sem expor o Bearer  |

Em SSE, deltas são parciais. A saída só é aceita como concluída após `response.completed`; `response.failed`, `response.incomplete`, erro HTTP ou EOF sem conclusão não são tratados como sucesso. Não há troca automática de provedor/modelo ou nova geração oculta após erro. O adaptador não usa conversa armazenada, `previous_response_id`, ferramentas hospedadas, WebSocket ou background.

Uma imagem não exige que o Omni devolva `b64_json`: seu contrato oferece descritores de artefato. O servidor valida o destino e baixa o artefato autenticado; não coloca a chave em URLs de imagem nem permite que a extensão siga um link protegido. O caminho de thumbnail não acrescenta suporte a vídeo, áudio, login ou administração de contas.

## Credenciais e limites

| Dado                                       | Local                                                      |
| ------------------------------------------ | ---------------------------------------------------------- |
| Origem e token do backend Prevlev          | Perfil local da extensão; token exclusivo desta instalação |
| Modelo, streaming e origem da seleção      | Perfil local da extensão; sem chave Omni                   |
| `OMNI_BASE_URL`, `OMNI_API_KEY`, timeout   | Ambiente do backend Prevlev                                |
| Contas, OAuth e credenciais dos provedores | Serviço Omni existente                                     |

O padrão é `AI_PROVIDER=omni`, origem `http://127.0.0.1:7814` e timeout de 120 segundos. `OMNI_TIMEOUT_MS` aceita inteiro de 1 a 300000. O prazo é único para a análise inteira, incluindo catálogo, geração e download do artefato; o catálogo tem ainda um sublimite de dez segundos. A consulta isolada de modelos também usa no máximo dez segundos. O limite não confirma aceitação no upstream; uma geração já aceita pode consumir cota mesmo se a espera terminar. `PREVLEV_TOKEN` e `OMNI_API_KEY` são segredos distintos. O endpoint `/health` não testa a conectividade com Omni nem revela chaves.

O modo anterior continua disponível somente por escolha explícita de `AI_PROVIDER=openai-compatible`, com `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` e `AI_IMAGE_MODEL`. Nesse modo, texto só é aceito com o modelo retornado exato, uma escolha concluída em `stop`, sem chamadas de ferramentas. Uma imagem sem metadado de modelo é identificada apenas pelo modelo solicitado, sem alegar identidade verificada. Nesse modo, a rota de catálogo retorna `unsupported`; não inventa um catálogo e não consulta Omni. Consulte [BACKEND.md](BACKEND.md).

## Evidência e validação

O contrato foi lido no commit `cd4e6a2efd5cdd54ec9bcea274a86ed854932120` de `onclickgrimes/OmniProviders`. As referências abaixo apontam para o repositório de origem, que pode exigir acesso. Este repositório publica somente os fatos do contrato e uma implementação própria; não inclui o código, assets, banco de dados ou configurações do Omni.

- [Descritores, IDs e capacidades — `app/domain/models.py`, linhas 10–65](https://github.com/onclickgrimes/OmniProviders/blob/cd4e6a2efd5cdd54ec9bcea274a86ed854932120/app/domain/models.py#L10-L65).
- [Autenticação Bearer — `app/main.py`, linhas 119–129](https://github.com/onclickgrimes/OmniProviders/blob/cd4e6a2efd5cdd54ec9bcea274a86ed854932120/app/main.py#L119-L129), [catálogo — linhas 571–574](https://github.com/onclickgrimes/OmniProviders/blob/cd4e6a2efd5cdd54ec9bcea274a86ed854932120/app/main.py#L571-L574).
- [Rotas de texto e imagem — `app/main.py`, linhas 679–775](https://github.com/onclickgrimes/OmniProviders/blob/cd4e6a2efd5cdd54ec9bcea274a86ed854932120/app/main.py#L679-L775), [download autenticado — linhas 934–941](https://github.com/onclickgrimes/OmniProviders/blob/cd4e6a2efd5cdd54ec9bcea274a86ed854932120/app/main.py#L934-L941).
- [Responses JSON/SSE e modo sem armazenamento — `docs/agents/responses-streaming.md`, linhas 3–17](https://github.com/onclickgrimes/OmniProviders/blob/cd4e6a2efd5cdd54ec9bcea274a86ed854932120/docs/agents/responses-streaming.md#L3-L17), [término e erros — linhas 244–254](https://github.com/onclickgrimes/OmniProviders/blob/cd4e6a2efd5cdd54ec9bcea274a86ed854932120/docs/agents/responses-streaming.md#L244-L254).
- [Seleção por capacidades, saída e ponte sem chave no navegador — `docs/agents/reusable-model-select.md`, linhas 15–59](https://github.com/onclickgrimes/OmniProviders/blob/cd4e6a2efd5cdd54ec9bcea274a86ed854932120/docs/agents/reusable-model-select.md#L15-L59), [catálogo não qualifica inferência — linhas 76–88](https://github.com/onclickgrimes/OmniProviders/blob/cd4e6a2efd5cdd54ec9bcea274a86ed854932120/docs/agents/reusable-model-select.md#L76-L88).
- [Capacidades Kiro — `app/providers/kiro/adapter.py`, linhas 61–76](https://github.com/onclickgrimes/OmniProviders/blob/cd4e6a2efd5cdd54ec9bcea274a86ed854932120/app/providers/kiro/adapter.py#L61-L76).

Os testes desta integração usam catálogos, respostas JSON/SSE e artefatos sintéticos identificados como fixtures, sem acessar o serviço Omni do usuário ou consumir gerações/créditos. Isso verifica a ponte e suas recusas, não uma geração real. Os resultados finais e bloqueios de ambiente ficam em [VALIDATION.md](VALIDATION.md). Os limites anteriores de runtime do YouTube/Studio e da política de instalação de extensões permanecem válidos. O limite de acesso ao ZIP de especificação REA permanece registrado em [REA.md](REA.md).

## Separação dos novos recursos locais

Pesquisa oficial, relatórios locais e histórico próprio são caminhos separados da IA. Resultados marcados `youtube-data-api` ficam na visualização oficial em memória: não são enviados para Omni, convertidos em indicadores derivados, importados no histórico ou usados como dados de IA. Relatórios locais operam sobre observações do navegador/páginas públicas ou material do usuário com origem preservada. Histórico só registra ações explícitas em `DATA_DIR` e não coleta dados periodicamente.

O MCP opcional é outro processo stdio, desativado por padrão e somente para leitura; suas cinco ferramentas não chamam Omni ou outros provedores, não usam suas chaves e não geram conteúdo. Habilitar MCP no ambiente não inicia ou registra automaticamente um cliente. A configuração e as garantias específicas estão em [BACKEND.md](BACKEND.md), [YOUTUBE.md](YOUTUBE.md) e [MCP.md](MCP.md). As flags de `/health` descrevem configuração, com alcance real desconhecido até uma ação explícita; não comprovam serviços ativos, credenciais válidas, saldo ou geração bem-sucedida.
