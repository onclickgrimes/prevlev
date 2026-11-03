# Validação da versão 0.1.0

Execução final neste executor em 3 de novembro de 2026, Node.js 24.19.0 e Chromium 154.0.8037.57.

| Verificação         | Resultado                                                                      |
| ------------------- | ------------------------------------------------------------------------------ |
| `npm run typecheck` | Aprovado                                                                       |
| `npm run lint`      | Aprovado                                                                       |
| `npm test`          | 109 testes aprovados em 9 arquivos                                             |
| `npm run build`     | Aprovado; extensão MV3 gerada em `dist/`                                       |
| `npm run test:ui`   | 4 testes aprovados; 2 testes explicitamente ignorados por política do ambiente |

Os testes unitários e de integração cobrem dados ausentes, parsing PT/EN, cálculos, exportação, proteção de CSV, canvas, URLs públicas de canal, limites de rede, autenticação/CORS do backend, ausência de chamadas pagas, mensagens da extensão, captura com mudança de aba/URL, navegação SPA e limpeza/retomada do observer.

Os quatro testes Chromium aprovados executam a interface construída e canvas real com dados de teste. Dois deles conectam `workspace.js` e `content.js` próprios através de um transporte Chrome simulado, em páginas Studio interceptadas: verificam prévia sem cliques, confirmação limitada, cancelamento, rejeição de replay e recusa após mudança de canal. Não utilizam uma conta ou canal real. Fixtures e mocks ficam exclusivamente em `tests/`, fora do pacote da extensão.

## Verificação bloqueada

Ação: carregar a extensão MV3 em um perfil de teste do Chromium do executor, para executar `tests/browser/extension.spec.ts`. Alvo: build próprio em `/workspace/prevlev/dist/`.

Motivo: `/etc/chromium/policies/managed/extensions.json` contém `ExtensionInstallBlocklist: ["*"]`. O Chromium não iniciou o service worker da extensão. A investigação identificou a política; nenhuma política foi desativada ou alterada. Estado: **bloqueado por política do ambiente**, com os dois testes marcados como ignorados e sem contá-los como aprovados. Isso não foi uma rejeição do revisor automático de aprovação.

Continua necessária a validação da extensão instalada em um Chrome que permita carregar extensões de desenvolvimento. Captura `activeTab`, clipboard e permissões opcionais dependem também do comportamento real desse navegador. Screenshots exigem invocar o ícone Prevlev na aba alvo para obter a concessão temporária; falhas têm orientação explícita. [Documentação Chrome: activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [captureVisibleTab](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab).

## Outros limites

REA foi executado pelo coordenador e orientou a especificação; o recibo integral de análise não foi materializado neste executor porque o download retornou `download failed`. O escopo e as identidades comunicadas estão em [REA.md](REA.md).

Nenhum provedor de IA pago, servidor Nexlev, extensão original, conta real ou canal real foi utilizado nas verificações. IA continua sem configuração por padrão; descoberta/relatórios usam somente os dados fornecidos, e as limitações de cada um dos 40 recursos constam em [FEATURES.md](FEATURES.md).
