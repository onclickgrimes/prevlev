# Privacidade e armazenamento

O Prevlev não inclui telemetria, cadastro comercial ou conexão aos servidores Nexlev. A coleta de uma página e o envio de uma análise ao backend são ações manuais na interface.

## No navegador

As configurações, a última coleta e o Swipe File ficam em `chrome.storage.local`, no perfil atual do Chrome. A coleta pode conter títulos, IDs, URLs, canais, views, datas aproximadas, inscritos quando visíveis, comentários, transcrição aberta e métricas reconhecidas do Studio. O arquivo não sincroniza a biblioteca entre dispositivos.

A origem e o token do backend também ficam no armazenamento local da extensão. Use um token exclusivo para essa instalação. Credenciais de provedores de IA devem permanecer no ambiente do servidor. Não coloque senhas de contas ou chaves de IA no campo de token da extensão.

Imagens escolhidas para compressão/prévia e frames são processados em canvas no navegador. O download de uma thumbnail acessa o CDN público do YouTube, sem enviar credenciais de conta. A leitura dos cards usa a página do YouTube já aberta e sua sessão normal, quando houver; não exige uma sessão Nexlev.

O enriquecimento de inscritos ocorre somente por solicitação explícita e consulta até dez páginas públicas de canal do YouTube por ação. Essas requisições usam `credentials: 'omit'`, recusam redirecionamentos e têm limites de tempo/tamanho; não executam scripts da página recebida. Contagens não publicadas ou não reconhecidas continuam desconhecidas. Arquivos locais de áudio escolhidos para detectar silêncios de mid-roll são decodificados no navegador via AudioContext/PCM e não são enviados.

Capturas usam a área visível da aba selecionada e podem ativá-la temporariamente. A ocultação de dados sensíveis cobre apenas campos reconhecidos. Revise a imagem antes de compartilhá-la: nomes ou outros dados fora desses campos podem continuar visíveis. Captura de vídeo pode falhar pelas restrições de origem da mídia.

## No backend escolhido

O envio manual usa dados específicos para cada operação. Relatórios e similaridade recebem os vídeos coletados e a consulta; IA de comentários recebe os comentários filtrados; IA de transcrição recebe o texto exibido; geração de imagem recebe o briefing; análise de patrocínios recebe o texto informado; histórico recebe o ID e as views observadas, quando disponíveis. Uma ação não envia automaticamente todas as categorias da coleta. O destino é a origem configurada pelo operador; é necessário conceder ao navegador acesso a essa origem. A configuração padrão permanece vazia.

O backend incluído não persiste os datasets de relatórios. O recurso `view-history` armazena observações recebidas em `DATA_DIR`; não recupera dados anteriores nem gera histórico fictício. O código não grava comentários, transcrições ou chaves em logs. Proxies, hospedagem e provedores configurados pelo operador podem ter suas próprias políticas e logs.

Quando IA estiver configurada, o backend envia ao provedor o texto/briefing necessário à ação e usa a credencial presente no ambiente do servidor. Sem configuração, responde `not_configured` e não chama um provedor. Testes usam fixtures, sem consumo pago ou contas reais.

Veja [BACKEND.md](BACKEND.md) para autenticação, CORS, limites, variáveis de ambiente e as limitações da instalação pessoal. Publicação multiusuário exige autenticação e isolamento próprios.

## Apagar e exportar

- Exporte o Swipe File em JSON antes de remover dados que queira preservar.
- Em **Conexão**, use **Apagar coleta e biblioteca locais** para remover os dados coletados e as referências deste perfil, após confirmar.
- Use **Desconectar** para apagar origem/token e remover a permissão da origem configurada.
- Apague `DATA_DIR` no servidor para remover as observações de histórico.
- Downloads já salvos são arquivos comuns e precisam ser removidos da pasta de downloads separadamente.
- Desinstalar a extensão remove o armazenamento do perfil; não remove downloads, arquivos do servidor ou dados já enviados a um provedor.

## Ações que alteram um canal

Prévia não envia alteração. A confirmação pode enviar cliques de corações ou avanço de etapa pela interface do Studio, conforme descrito no plano. Os planos têm prazo e são invalidados quando os alvos mudam. O cancelamento interrompe ações futuras, sem reverter operações já recebidas pelo YouTube. Intervalos de anúncio preenchidos ainda devem ser revisados e salvos manualmente.
