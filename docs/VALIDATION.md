# Validação da versão 0.2.0

Execução final neste executor em 3 de novembro de 2026, Node.js 24.19.0 e Chromium 154.0.8037.57.

| Verificação         | Resultado                                                                      |
| ------------------- | ------------------------------------------------------------------------------ |
| `npm run typecheck` | Aprovado                                                                       |
| `npm run lint`      | Aprovado                                                                       |
| `npm test`          | 164 testes aprovados em 13 arquivos                                            |
| `npm run build`     | Aprovado; extensão MV3 gerada em `dist/`                                       |
| `npm run test:ui`   | 9 testes aprovados; 2 testes explicitamente ignorados por política do ambiente |

Os testes unitários e de integração cobrem dados ausentes, parsing PT/EN, cálculos, exportação, proteção de CSV, canvas, URLs públicas de canal, limites de rede, autenticação/CORS do backend, ausência de chamadas pagas, mensagens da extensão, captura com mudança de aba/URL, navegação SPA e limpeza/retomada do observer.

Os nove testes Chromium aprovados executam a interface construída e canvas real com dados de teste: dois de UI/imagens, quatro de Studio e três de pesquisa/timeline. Os cenários integrados conectam `workspace.js` e `content.js` próprios através de um transporte Chrome simulado em páginas interceptadas. Verificam filtros completos aplicados aos cards, baseline de outlier preservado, enriquecimento, consulta de canal sem duplicatas, monetização desconhecida, timeline, confirmação/cancelamento, criação de rascunhos mid-roll sem Salvar e rejeição de comentários reciclados mantendo o botão. Não utilizam uma conta ou canal real. Fixtures e mocks ficam exclusivamente em `tests/`, fora do pacote da extensão.

## Lacunas locais resolvidas nesta etapa

- Filtros por inscritos, duração, datas, VPH e outlier integrados no painel e DOM; limites inválidos não alteram os cards. Outlier usa referências do mesmo canal quando a identidade é conhecida e mantém a coleção de referência após filtrar.
- Painel de recentes/populares da primeira resposta HTML pública, enriquecimento de inscritos propagado aos cards e amostragem anônima de até cinco vídeos para marcadores de monetização. Não equivale a catálogo completo nem confirmação financeira.
- Timeline do player com seleção/cópia/exportação de trechos, busca, posicionamento, pausa/reprodução e captura local. O passo de 1/30 s é estimado, sem detecção do FPS.
- Mid-roll pode criar rascunhos por controle reconhecido após prévia/confirmar, esperar campo, preencher e cancelar. Não envia Continuar/Salvar.
- Corações conferem identidade, contêiner, autor e texto antes de cada clique. Capturas são medidas após ativar a aba e novamente depois do screenshot, com descarte por mudança de alvo, viewport, rolagem, revisão DOM ou máscara. Eventos intermediários de scroll/resize também invalidam a medição mesmo que as coordenadas retornem ao ponto inicial.

## Verificação bloqueada

Ação: carregar a extensão MV3 em um perfil de teste do Chromium do executor, para executar `tests/browser/extension.spec.ts`. Alvo: build próprio em `/workspace/prevlev/dist/`.

Motivo: `/etc/chromium/policies/managed/extensions.json` contém `ExtensionInstallBlocklist: ["*"]`. O Chromium não iniciou o service worker da extensão. A investigação identificou a política; nenhuma política foi desativada ou alterada. Estado: **bloqueado por política do ambiente**, com os dois testes marcados como ignorados e sem contá-los como aprovados. Isso não foi uma rejeição do revisor automático de aprovação.

Continua necessária a validação da extensão instalada em um Chrome que permita carregar extensões de desenvolvimento. Captura `activeTab`, clipboard e permissões opcionais dependem também do comportamento real desse navegador. Screenshots exigem invocar o ícone Prevlev na aba alvo para obter a concessão temporária; falhas têm orientação explícita. [Documentação Chrome: activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [captureVisibleTab](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab).

## Verificação pública e configuração ainda pendentes

Uma consulta anônima a `https://www.youtube.com/@YouTube/videos` retornou `fetch failed` neste executor. Estado: **consulta falhou; compatibilidade com a resposta pública atual não verificada**. Os parsers foram testados com fixtures de renderers antigos e modernos. Não se usou conta real. Nenhuma política do Chromium foi alterada.

A validação em runtime real precisa conferir layouts atuais, concessões Chrome, comportamento do player e aceitação dos controles do Studio. Ela não elimina as lacunas de produto: catálogo global/paginação exigem fonte e integração adicional; IA exige escolher backend, provedor e modelos; APIs privadas do Studio, receita/RPM/geografia indisponíveis, nuvem/multiusuário e MCP não estão implementados.

## Outros limites

REA foi executado pelo coordenador e orientou a especificação; o recibo integral de análise não foi materializado neste executor porque o download retornou `download failed`. O escopo e as identidades comunicadas estão em [REA.md](REA.md).

Nenhum provedor de IA pago, servidor Nexlev, extensão original, conta real ou canal real foi utilizado nas verificações. IA continua sem configuração por padrão; descoberta/relatórios usam somente os dados fornecidos, e as limitações de cada um dos 40 recursos constam em [FEATURES.md](FEATURES.md).
