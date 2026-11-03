# Importação de legendas sem perda silenciosa

`parseTranscriptImport(text, {fileName})` é a entrada para arquivos fornecidos pelo usuário. VTT/SRT são reconhecidos pela assinatura/conteúdo ou extensão. Qualquer bloco de fala sem horários válidos, com fim não posterior ao início, sem texto, com cues sem separação ou acima de 5000 cues cancela a importação inteira. Não há retorno parcial. NOTEs e metadados STYLE/REGION continuam separados da fala; metadados com cues misturados são recusados.

`TranscriptImportError` inclui `diagnostics: {line, code, message}[]` (até 50) e `diagnosticCount` completo. A mensagem identifica o primeiro problema e informa que nenhum trecho foi aplicado. O host deve só substituir segmentos/texto e invalidar resultados após o parser retornar com sucesso; erros preservam a entrada anterior. Corridas de leitura/limpeza/troca de vídeo continuam responsabilidade do host.

O parser tolerante `parseTranscript` permanece disponível para DOM observado e consumidores legados. A função de importação mantém a interpretação prévia dos formatos não reconhecidos como legendas. Ela não valida a associação entre um arquivo e o vídeo atual; essa procedência deve permanecer explícita na UI.

Markdown agora conserva as frações dos inícios conhecidos, por exemplo `00:00:03.125`. JSON/CSV continuam com seus tempos e procedência existentes. Nenhum fim ou resultado de IA é inventado.

Fixtures: `tests/transcript-import.test.ts` e `tests/browser/transcript-import.spec.ts`, com importação válida/inválida mista e manutenção da entrada anterior. Nenhuma consulta a serviço real.
