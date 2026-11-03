# Relatório estruturado local de canal · D29

O relatório mantém as contagens mecânicas de formatos/títulos e o WPM declarado já existentes. Acrescenta organização manual em oito grupos: conteúdo, nicho, estratégia, feedback, performance declarada, tópicos, roteiro e etapas. Não interpreta títulos, não chama IA e não atribui causalidade, finanças, autenticidade ou desempenho a um canal. Grupo sem material elegível permanece **desconhecido**.

Cada anotação tem grupo, alvo, declaração, cobertura e origem. O alvo precisa ser um ID de vídeo elegível da coleção ou um `channelId` explícito no formato `UC…` de uma linha elegível. Para canal, o usuário também informa os IDs locais associados; não há agrupamento por nome/handle ou aplicação automática a todos os vídeos. A cobertura por grupo conta esses IDs associados, sem alegar análise completa.

A base pode ser uma declaração própria não verificada ou trecho de material, transcrição ou comentário fornecido. Material entra por colagem manual ou pela ação **Usar transcrição informada acima como material**. O trecho precisa existir literalmente no texto fornecido. Essa checagem comprova apenas a presença do texto, sem autenticar a fonte ou validar a interpretação. Origem, associação ao alvo e cobertura continuam declaradas pelo usuário. Material da API oficial é excluído. A elegibilidade compartilha as regras do relatório mecânico: primeira linha local elegível por ID, API oficial excluída antes da deduplicação, sem combinar campos de duplicatas.

O editor permite adicionar, editar e remover anotações. Preparar o relatório é uma ação explícita. Mudanças de entrada invalidam os exports preparados. Quando a coleção muda, as anotações são preservadas em memória, mas precisam de revisão e reassociação explícita antes de preparar outro relatório; alvos que deixaram de ser elegíveis precisam ser removidos. WPM continua a exigir ID elegível, transcrição, duração positiva e cobertura declaradas; dividir o texto parcial pela duração total não representa ritmo integral do vídeo.

JSON, CSV e Markdown incluem contagens mecânicas, WPM, contexto da amostra, grupos desconhecidos, declarações, procedência, cobertura, trechos e limites. O campo de material completo fica fora do relatório. CSV neutraliza fórmulas textuais e Markdown escapa marcação fornecida. Exportar exige um relatório preparado ainda compatível com a coleção e o formulário.

O backup JSON é outra ação explícita: inclui as anotações e o material fornecido completo, com contexto exato da coleção elegível. A restauração exige essa mesma coleção, valida todas as entradas antes de substituir o rascunho e descarta leituras tardias após alteração dos dados. Não há gravação automática, armazenamento persistente, rede, credenciais ou serviço do usuário.

Limites: 32 anotações, 2000 caracteres por declaração, 300 por referência da origem, 6000 por material, 600 por trecho, backup de até 256 KiB. O backup não inclui o formulário independente de WPM. **Limpar** no formulário principal apaga WPM, anotações e relatório em memória.

API da UI preservada: `mountChannelReport(section, videos)` retorna `invalidate`, `clearInputs` e `cleanup`. O host deve chamar `invalidate` ao alterar a coleção. O novo core está em `src/core/channel-report-content.ts`; `buildChannelReport` permanece disponível com o contrato anterior.

Fixtures de validação: `tests/channel-report-content.test.ts`, `tests/channel-report-content-ui.test.ts` e `tests/browser/channel-report-content.spec.ts`. Compatibilidade com extensão instalada/conta real continua separada e não foi validada nesta etapa.
