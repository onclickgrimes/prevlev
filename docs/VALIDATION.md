# Validação da versão 0.3.0

Execução final neste executor em 3 de novembro de 2026, Node.js 24.19.0 e Chromium 154.0.8037.57.

| Verificação         | Resultado                                                                       |
| ------------------- | ------------------------------------------------------------------------------- |
| `npm run typecheck` | Aprovado                                                                        |
| `npm run lint`      | Aprovado                                                                        |
| `npm test`          | 220 testes aprovados em 15 arquivos                                             |
| `npm run build`     | Aprovado; extensão MV3 gerada em `dist/`                                        |
| `npm run test:ui`   | 14 testes aprovados; 2 testes explicitamente ignorados por política do ambiente |

Os testes unitários e de integração cobrem dados ausentes, parsing PT/EN, cálculos, exportação, proteção de CSV, canvas, URLs públicas de canal, limites de rede, autenticação/CORS do backend, ausência de chamadas pagas, mensagens da extensão, captura com mudança de aba/URL, navegação SPA e limpeza/retomada do observer.

Os nove cenários anteriores Chromium executam a interface construída e canvas real com dados de teste: dois de UI/imagens, quatro de Studio e três de pesquisa/timeline. Os cenários integrados conectam `workspace.js` e `content.js` próprios através de um transporte Chrome simulado em páginas interceptadas. Verificam filtros completos aplicados aos cards, baseline de outlier preservado, enriquecimento, consulta de canal sem duplicatas, monetização desconhecida, timeline, confirmação/cancelamento, criação de rascunhos mid-roll sem Salvar e rejeição de comentários reciclados mantendo o botão. Não utilizam uma conta ou canal real. Fixtures e mocks ficam exclusivamente em `tests/`, fora do pacote da extensão.

## Integração OmniProviders verificada nesta etapa

O contrato foi inspecionado somente por leitura no repositório OmniProviders, commit `cd4e6a2efd5cdd54ec9bcea274a86ed854932120`: catálogo, capacidades, autenticação, Responses JSON/SSE e artefatos. Não se executou/importou o app Omni nem se acessou o serviço em `127.0.0.1:7814` da máquina do usuário. Uma porta local deste executor não foi tratada como a instalação do usuário.

32 testes de transporte Omni simulado cobrem seleção exata/origem, revalidação do catálogo, JSON/SSE terminal, respostas incompletas, falhas, EOF, imagem não suportada, artefatos autenticados, prazos, erros e ausência de repetição. 11 testes do cliente verificam formatos/credenciais/erros seguros; cinco cenários Chromium adicionais verificam seleção/capacidades e tarefas com a UI real, com todas as requisições interceptadas. O backend Prevlev é testado em loopback com o transporte Omni substituído por fixture. Nenhuma geração real ou crédito foi consumido.

A origem padrão é `http://127.0.0.1:7814`, editável em `OMNI_BASE_URL` no servidor; o navegador só recebe o catálogo normalizado e usa a ponte Prevlev. Chaves de provedores permanecem no Omni, e a chave do sidecar, se exigida, permanece no backend. Foram também corrigidas validações do modo legado explícito para descartar texto truncado/modelo divergente e não expor erros brutos do upstream.

## Lacunas locais resolvidas nas etapas anteriores

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

A validação em runtime real precisa conferir layouts atuais, concessões Chrome, comportamento do player e aceitação dos controles do Studio. Ela não elimina as lacunas de produto: catálogo global/paginação exigem fonte e integração adicional; IA tem integração Omni implementada, mas exige iniciar/configurar a ponte na máquina do serviço e escolher um modelo disponível no catálogo; a geração real continua não verificada; APIs privadas do Studio, receita/RPM/geografia indisponíveis, nuvem/multiusuário e MCP não estão implementados.

## Outros limites

REA foi executado pelo coordenador e orientou a especificação; o recibo integral de análise não foi materializado neste executor porque o download retornou `download failed`. O escopo e as identidades comunicadas estão em [REA.md](REA.md).

Nenhum provedor de IA pago, servidor Nexlev, extensão original, conta real ou canal real foi utilizado nas verificações. IA continua sem configuração por padrão; descoberta/relatórios usam somente os dados fornecidos, e as limitações de cada um dos 40 recursos constam em [FEATURES.md](FEATURES.md).
