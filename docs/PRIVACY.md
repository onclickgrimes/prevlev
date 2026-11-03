# Privacidade e armazenamento

O Prevlev não inclui telemetria, cadastro comercial ou conexão aos servidores Nexlev. A coleta de uma página e o envio de uma análise ao backend são ações manuais na interface.

## No navegador

As configurações, a última coleta e o Swipe File ficam em `chrome.storage.local`, no perfil atual do Chrome. A coleta pode conter títulos, IDs, URLs, canais, views, datas aproximadas, inscritos quando visíveis, comentários, transcrição aberta e métricas reconhecidas do Studio. O arquivo não sincroniza a biblioteca entre dispositivos.

A origem e o token do backend também ficam no armazenamento local da extensão. Use um token exclusivo para essa instalação. A seleção de modelo de IA, preferência de streaming e origem do catálogo ficam nesse perfil, sem chave de acesso Omni. `OMNI_API_KEY` permanece somente no ambiente do backend Prevlev; credenciais de provedores e OAuth continuam no serviço Omni existente. Não coloque senhas de contas ou chaves Omni/provedor no campo de token da extensão.

Imagens escolhidas para compressão/prévia e frames são processados em canvas no navegador. O download de uma thumbnail acessa o CDN público do YouTube, sem enviar credenciais de conta. A leitura dos cards usa a página do YouTube já aberta e sua sessão normal, quando houver; não exige uma sessão Nexlev.

O enriquecimento de inscritos ocorre somente por solicitação explícita e consulta até dez páginas públicas de canal do YouTube por ação. Essas requisições usam `credentials: 'omit'`, recusam redirecionamentos e têm limites de tempo/tamanho; não executam scripts da página recebida. Contagens não publicadas ou não reconhecidas continuam desconhecidas. Arquivos locais de áudio escolhidos para detectar silêncios de mid-roll são decodificados no navegador via AudioContext/PCM e não são enviados.

O painel de canal consulta a primeira resposta HTML pública de `/videos` e lê JSON literal, sem executar scripts recebidos ou usar API privada. Não pagina o catálogo. A análise de monetização consulta no máximo cinco páginas públicas de vídeos por ação e retorna inferência de baixa confiança, incluindo desconhecido quando não há evidência utilizável. Essas consultas também omitem credenciais. A consulta pública anônima tentada neste ambiente falhou, portanto a compatibilidade com a fonte atual não foi confirmada.

A timeline atua no player nativo da aba selecionada após comandos explícitos. Busca, seleção, cópia e exportação usam os trechos da transcrição já carregados. Não envia o áudio/vídeo ao backend. Comandos do painel revalidam a identidade do vídeo antes de posicionar ou reproduzir/pausar; o passo de 1/30 s é estimado.

Capturas usam a área visível e podem ativar temporariamente a aba selecionada. A transação mede o alvo após ativar a aba e novamente depois da captura. Se URL, viewport/rolagem, revisão do DOM, geometria ou identidade dos campos sensíveis mudarem, descarta a imagem. A ocultação cobre apenas campos reconhecidos e não garante anonimização total. Revise antes de compartilhar: nomes ou outros dados fora desses campos podem continuar visíveis. Captura de vídeo pode falhar pelas restrições de origem da mídia.

## No backend escolhido

O envio manual usa dados específicos para cada operação. Relatórios e similaridade recebem os vídeos coletados e a consulta; IA de comentários recebe os comentários filtrados; IA de transcrição recebe o texto exibido; geração de imagem recebe o briefing; análise de patrocínios recebe o texto informado; histórico recebe o ID e as views observadas, quando disponíveis. Uma ação não envia automaticamente todas as categorias da coleta. O destino é a origem configurada pelo operador; é necessário conceder ao navegador acesso a essa origem. A configuração padrão permanece vazia.

O backend incluído não persiste os datasets de relatórios. O recurso `view-history` armazena observações recebidas em `DATA_DIR`; não recupera dados anteriores nem gera histórico fictício. O código não grava comentários, transcrições ou chaves em logs. Proxies, hospedagem e provedores configurados pelo operador podem ter suas próprias políticas e logs.

No modo padrão `AI_PROVIDER=omni`, o envio de IA segue extensão → backend Prevlev → serviço Omni existente → provedor selecionado. A extensão acessa somente a origem do backend Prevlev, com seu token próprio. A origem Omni vem de `OMNI_BASE_URL` no ambiente do servidor e aparece na UI somente para leitura; não há endpoint para alterar remotamente a configuração do Omni. A chave existente de acesso ao serviço, se exigida, fica em `OMNI_API_KEY` no servidor e não é enviada ao navegador.

**Consultar modelos** é uma ação explícita: o backend consulta o catálogo Omni, devolvendo somente os descritores normalizados necessários à escolha e avisos. Isso pode envolver a descoberta normal de modelos pelo serviço, mas não gera conteúdo nem confirma saldo/permissão de inferência. A seleção é vinculada à origem consultada. Para gerar, o servidor revalida o modelo e envia apenas o texto/comentários/briefing necessários à tarefa. Não assume capacidades pelo nome do provedor nem troca para outro modelo após erro.

Texto usa Responses sem armazenamento de conversa (`store: false`), conforme o contrato Omni; isso não desliga automaticamente seu recorder, logs de proxy ou políticas do provedor. SSE incompleto ou com erro não é apresentado como resultado final. Imagens exigem operação e saída anunciadas e são obtidas pelo backend como artefatos autenticados da mesma origem Omni. A chave não é anexada a links de mídia. Uma geração já aceita pelo provedor pode consumir cota mesmo se o cliente deixar de esperar.

Sem seleção/configuração compatível, a função retorna indisponibilidade explícita; nenhum resultado fictício é apresentado como real. O modo anterior `AI_PROVIDER=openai-compatible` só é usado por configuração expressa e mantém suas chaves no servidor. Não há fallback entre esse modo e Omni. Os testes usam fixtures, sem acessar serviço, contas ou configurações do usuário e sem consumir gerações ou créditos. O código-fonte do contrato foi lido; o serviço existente não foi acessado nesta execução. Veja [OMNIPROVIDERS.md](OMNIPROVIDERS.md).

Veja [BACKEND.md](BACKEND.md) para autenticação, CORS, limites, variáveis de ambiente e as limitações da instalação pessoal. Publicação multiusuário exige autenticação e isolamento próprios.

## Apagar e exportar

- Exporte o Swipe File em JSON antes de remover dados que queira preservar.
- Em **Conexão**, use **Apagar coleta e biblioteca locais** para remover os dados coletados e as referências deste perfil, após confirmar.
- Use **Desconectar** para apagar origem/token e remover a permissão da origem configurada.
- Apague `DATA_DIR` no servidor para remover as observações de histórico.
- Downloads já salvos são arquivos comuns e precisam ser removidos da pasta de downloads separadamente.
- Desinstalar a extensão remove o armazenamento do perfil; não remove downloads, arquivos do servidor ou dados já enviados a um provedor.

## Ações que alteram um canal

Prévia não envia alteração. A confirmação pode enviar cliques de corações, avanço de etapa ou criação/preenchimento de rascunhos mid-roll pela interface do Studio, conforme descrito no plano. Os planos têm prazo e são invalidados quando os alvos mudam. Corações revalidam identidade, autor e texto do comentário antes de cada clique, incluindo botões reciclados para outro comentário. Mid-roll exige editor e botão Inserir reconhecidos, informa os novos rascunhos na prévia e não clica em Continuar/Salvar. O cancelamento interrompe ações futuras, sem reverter operações já recebidas pelo YouTube. Intervalos criados ou preenchidos ainda devem ser revisados e salvos manualmente. Todos esses fluxos foram verificados em fixtures, sem operação em canal real.
