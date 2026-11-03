# Auditoria dos escopos locais e dependências restantes

Base reavaliada: `5db8c07c07c3fecf6e6152d027007210507b2b45`. Foram relidos os 33 itens do ledger, os oito achados próprios, os 40 recursos e os extras. As descrições de v0.4–v0.6.5 no ledger são históricas. Esta matriz registra o código atual e distingue aceite em fixtures de funcionamento em uma conta real. A extensão original não foi executada neste executor e seus bundles/assets não foram copiados.

A validação consolidada deste lote está em [VALIDATION.md](VALIDATION.md). Nenhuma instalação bloqueada foi contornada, nenhum canal/cliente/serviço do usuário foi alterado e nenhuma API paga foi consumida.

## Os 33 itens

| Item | Escopo local disponível e verificado por fixtures | Limite restante |
| --- | --- | --- |
| D01 | Seletores modernos e legados de transcrição, Unicode e horários desconhecidos. | Layout público atual e extensão instalada. |
| D02 | Acumulação virtualizada por vídeo, seleção, conflito, limite e cleanup. | Comportamento na página real. |
| D03 | Controles documentados, frames/FPS explícitos e recusa de horário nativo inválido antes de mutações. | Aceitação dos rascunhos no Studio real. |
| D04 | Anchors documentados de snapshot/analytics e transação de captura/ocultação. | Geometria e campos do Studio real. |
| D05 | Receita, origem, período e moeda observados; contradição símbolo/código deixa o valor desconhecido. | Não existe contagem automática comprovada do mesmo período. |
| D06 | Pareamento cíclico de imagens/títulos por máximo das quantidades. | Simulação local, sem experimento de audiência. |
| D07 | Posição primeiro/aleatória, reshuffle e preservação da candidata. | Simulação local. |
| D08 | Desktop, mobile, lista e temas com composição própria. | Não replica assets ou estilos privados da referência. |
| D09 | Metadados/avatar, Done/Reset e preservação da candidata. | Números ilustrativos não viram analytics. |
| D10 | Amostra congelada ou aba explicitamente selecionada, leitura sem substituir a coleta. | Só o DOM observado, sem catálogo/feed global automático. |
| D11 | Onze presets, contexto e limites UTC efetivos estáveis; Manual preserva filtros. | Dados ausentes continuam desconhecidos. |
| D12 | Dois critérios estáveis e razão views/inscritos somente em contexto permitido. | Não obtém denominadores ausentes. |
| D13 | Layouts próprios, datas/ranges, badges, coleta limitada/cancelável, páginas de 100 e export completo CSV/JSON/MD. | Coleção parcial observada; não equivale a todos os vídeos. |
| D14 | Preferências distintas para Shorts no feed e na busca, sem inferir formato pela duração. | Reconhecimento do DOM real. |
| D15 | Ações por card nativo e por item da amostra, imagem validada, cópias e Lens explícito; respostas antigas descartadas. | Clipboard/permissões e fontes públicas reais. |
| D16 | Hover de 300 ms, quatro recentes/populares da amostra, fechamento/cancelamento e exports. | Popularidade global exige uma fonte legítima que não está disponível. |
| D17 | Composição própria de card/Short, PNG/alpha/2× e salvamento explícito como ativo local. | Não recompõe automaticamente cada card do YouTube. |
| D18 | Busca finita de qualidade/resolução, meta padrão de 2 MiB e preservação do original elegível menor. | Impossibilidade é erro explícito; formatos protegidos não são contornados. |
| D19 | Importação estrita e atômica VTT/SRT, frações preservadas e exports com origem/associação explícitas e IA válida já disponível. | Arquivo importado não comprova associação ao vídeo. |
| D20 | Cópias por tipo, voltar/cache e invalidação por texto/vídeo/modelo/origem/backend. | Resultado real exige backend/modelo do operador. |
| D21 | Auto/quantidade/Custom/Smart, posições limitadas, FPS declarado e timeline local. | Cursor local não certifica seek ou precisão no Studio real. |
| D22 | PCM/WAV local e estimativa visual de raster com geometria/escala declaradas, falha segura em canvas protegido. | Não há evidência da geometria do waveform Studio; não inventar adapter nem equivalência PCM. |
| D23 | Plano de remoção por todos/faixa, slots observados, Remove N, confirmação, expiração e cancelamento. | Âncora de exclusão e marcador interruptivo não comprovados; nenhum executor de remoção. |
| D24 | Máscaras e captura transacional, AnalyticsOnly/VideoInfo em moldura própria e salvamento explícito com contexto. | Tema altera moldura, não widgets privados; anonimização total e runtime real não comprovados. |
| D25 | Cálculo vinculado a período/moeda/origem e recibo curto do anchor documentado; estimativa adjacente reversível sem alterar a receita nativa. | Vínculo de receita/quantidade é declarado; não certifica lucro contábil nem runtime do canal. |
| D26 | Presets elegíveis por idade e datas declaradas; proteção de readonly/rerender e invalidação ao trocar vídeo/aba. | Publicação é declaração manual e Aplicar permanece manual. |
| D27 | Relatório diário manual com canal/data/fuso/as-of, ranking, conflitos, desconhecidos e exports. | Nenhuma fonte comprovada de série diária privada do Studio. |
| D28 | Briefing, referências organizadas, histórico limitado e estados reais/incertos; abrir não gera. | Contrato disponível é texto e uma imagem 16:9; referências, resolução, aspect variável e cancelamento remoto não anunciados não são enviados. |
| D29 | Grupos manuais com evidências/trechos, cobertura, WPM declarado e backup; analytics revalida coleção/filtros antes de exportar. | Grupos não são análise semântica automática nem prova de estratégia/finanças. |
| D30 | Dez presets de nicho, períodos, seis durações, chips, cobertura, distribuições e exports. | Métricas da amostra, sem índice global/saturação/finanças. |
| D31 | Distância dHash entre imagens locais explicitamente fornecidas. | Não há busca visual global; score não significa semântica ou CTR. |
| D32 | Guia/configuração manual, cinco tools de leitura, prompts revisáveis e tentativas próprias da sessão separadas de cache. | Cliente real não registrado; quota/saldo/cobrança externos desconhecidos. |
| D33 | Fórmulas/baselines declaradas, média/mediana positiva/fallback e modo preservado em filtros/exports. | Referência da amostra, não média do catálogo inteiro ou índice proprietário. |

## Achados próprios

AF01 protege resposta atrasada de metadados, inclusive troca de aba e volta. AF02 importa legendas sem descartar cues inválidos silenciosamente e invalida leitura pendente após edição, mesmo desfeita. AF03 revalida controles de período. AF04 inclui regras completas de comentários e o contador de respostas irmão do comentário principal. AF05 acrescenta ativos limitados, procedência, IDs de pasta e fluxos explícitos de captura/composição; leitura de legado não migra dados. AF06 oferece sync pessoal manual com revisão, conflito e negociação do schema de ativos. AF07 preserva trechos, URLs, offsets e timestamps realmente fornecidos, sem inventar contrato ou posição temporal. AF08 empacota somente arquivos próprios permitidos, com hashes e verificação de conteúdo antes do ZIP.

## Relação com os 40 recursos

| Recursos | Aceite local atual | Dependência que não é resolvida por mais código de fixture |
| --- | --- | --- |
| 1 | Marcadores públicos de anúncios/música e amostra explícita de até cinco vídeos. | Marcadores não comprovam YPP, monetização oficial ou receita. |
| 2–4 | Ocultar Shorts, ordenar/filtrar cards e analytics da amostra. | Extensão instalada, DOM real e cobertura pública. |
| 5–7 | Cálculo/recibo de lucro, métricas visíveis, período e relatório diário manual. | Fonte privada diária, contagem compatível e validação Studio. |
| 8–10 | Comentários, cópias por identidade e timeline/transcrição do vídeo observado. | Permissões/player/DOM reais; passo do player é estimado quando FPS real é desconhecido. |
| 11–14 | Compressão, simulação, thumbnails e captura/composição próprias. | Clipboard/canvas/origem protegida e disponibilidade da imagem real. |
| 15–17 | Capturas Studio, ocultações, molduras e planejamento/rascunhos mid-roll reconhecidos. | Layout/aceitação Studio; geometria waveform e remoção sem anchors comprovados. |
| 18 | Não automatizado sem controle comprovado e contexto válido. | Não há autorização/evidência para inventar Save/Continuar ou pular gates. |
| 19–26 | Prévia/execução em controles reconhecidos para corações e filtros/indicadores explícitos de amostra. | Canal real não acionado; inscritos/baselines ausentes não são fabricados. |
| 27–28 | Quickview e análise de termos/nicho sobre material autorizado. | Populares globais e catálogo externo não disponíveis. |
| 29–30 | Transcrição/proveniência/IA por modelo escolhido e biblioteca de ativos com sync pessoal manual. | Omni real e hospedagem/isolamento multiusuário não configurados nem provisionados. |
| 31–32 | Similaridade lexical entre títulos dos vídeos/canais da amostra. | Descoberta global exige dados legítimos adicionais. |
| 33–35 | Nicho, analytics e relatório com evidências e cobertura. | Dados globais, privados, financeiros e semântica não fornecida. |
| 36 | Histórico manual próprio e deltas entre observações reais. | Passado não observado, receita e RPM não podem ser recuperados. |
| 37–38 | Evidências de patrocínio fornecidas e comparação de canais identificados. | Contratos/valores de patrocínio e relatórios privados conectados não disponíveis. |
| 39–40 | Ponte por catálogo/modelo exato, laboratório local e estados/incerteza. | Serviço/conta/modelo do usuário; parâmetros sem contrato e quota externos. |

## Próximas verificações externas, sem contorno

1. **Extensão instalada:** Chromium deste executor bloqueia instalações pela política gerenciada; os dois cenários permanecem separados das fixtures.
2. **YouTube público/Studio:** observar anchors, idioma, virtualização e geometria atuais em ambiente autorizado. Esta execução não fez ações em canal real ou consultas privadas.
3. **Omni/MCP:** usar o serviço já escolhido pelo operador e um cliente compatível, sem criar credenciais, alterar seu computador ou registrar configurações automaticamente. Catálogo não comprova geração ou quota.
4. **Evidência ausente:** remoção/interruptivos, geometria do waveform real, datasets globais e contratos de referência/aspect/resolução/quota exigem fontes legítimas específicas. Não existem valores substitutos inferidos.

Não foi identificada outra diferença local implementável dentro dos aceites comprovados após esta revisão e seus follow-ups. Essa conclusão é limitada ao material disponível; não declara equivalência completa com a referência e deve ser reaberta quando houver nova evidência legítima.
