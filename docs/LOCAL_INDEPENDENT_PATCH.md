# Cinco ampliações locais independentes

Base de integração: `58fb1477ff333eaac7a8bdd3f6a3edc10cd67050`, lida da `main` pública de `onclickgrimes/prevlev`. Trabalho em checkout separado. Esta entrega não publica o código e não reproduz a operação GitHub pendente de outra tarefa. Não inclui as correções de imagem/coleta daquela tarefa.

| Gap | Comportamento entregue | Limite remanescente |
| --- | --- | --- |
| D25 | Receita, moeda, período e origem vinculados; confirmação manual de contagem e período; invalidação após edição/coleta; alternância local receita/lucro. | Toggle no card real do Studio não foi implementado. Período observado requer declaração do vínculo pelo usuário. |
| D28 | Thumbnail Lab com briefing estruturado, referências por grupo, histórico em memória de até 12 solicitações/12 MiB, reabertura de resultado sem gerar e estados incertos. Modelo, origem Omni e backend salvo são conferidos antes de enviar. | O contrato atual aceita texto e uma imagem 16:9. Arquivos, URLs e notas de referência ficam locais; resolução não é configurável. Nenhuma geração real foi feita. |
| D32 | Guia das cinco ferramentas e oito análises MCP existentes; compositor e cópia manual de configuração/prompts com caminhos explícitos. | Não detecta, registra ou conecta clientes, modifica arquivos externos ou envia prompts automaticamente. Saldo/cota externos desconhecidos. |
| D23 | Observação somente leitura dos campos legados já reconhecidos, plano todos/faixa inclusiva, Remove N, confirmação específica, cancelamento, expiração e reobservação do contexto. Alternativa manual declarada. | Não existe executor de remoção. Não clica, remove ou salva anúncios. Toolbar moderna não é uma lista de slots; interruptivos não são inferidos. |
| D22 | Análise de raster PNG local com geometria/escala/cores/tempos/FPS declarados, confirmação, progresso, cancelamento e exportação JSON. Decodificação serializada e fila só do último arquivo. | Estimativa visual distinta de PCM/RMS. Sem adapter Studio por falta de geometria comprovada, sem aplicar posições automaticamente. Canvas protegido falha sem alternativa de acesso. |

Os módulos `src/core/{profit,thumbnail-lab,mcp-guide,midroll-removal,waveform}.ts` e seus painéis em `src/ui/` estão integrados ao workspace. A única mensagem nova no content script é `STUDIO_OBSERVE_MIDROLLS`, somente leitura. A observação é vinculada à aba selecionada e revalidada antes de confirmar o plano local.

Os testes novos usam dados, transportes e páginas de fixtures. Os cenários integrados verificam também abertura sem rede, referências não enviadas, mudança do backend salvo e invalidação após troca de aba. Nenhum serviço Omni do usuário, geração paga, credencial real, cliente MCP ou canal real foi acessado. A política do Chromium não foi alterada.

A revisão encontrou e resolveu procedência incorreta do backend no histórico e decodificações PNG concorrentes. O resultado consolidado está em [VALIDATION.md](VALIDATION.md). Os gaps completos continuam parciais quando dependem de adapter, contrato ou runtime ainda não comprovados; os checkpoints estruturados preservam esses limites.

Para integração posterior, compare primeiro a base deste patch com o trabalho da tarefa principal. Os pontos com maior chance de conflito são `src/ui/workspace.ts`, `src/content/index.ts`, `src/content/studio.ts`, `workspace.html` e documentação de cobertura. Os módulos novos são independentes. Aplique o patch no checkout de integração escolhido, resolva conflitos e repita `npm run check` e `npm run test:ui`; publicar requer instrução posterior explícita.
