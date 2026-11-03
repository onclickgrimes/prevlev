# Evidências de divulgação com segmentos declarados · AF07

A leitura literal existente mantém marcas, cupons, URLs, negação, trecho original e índices UTF-16. Cada evidência agora inclui método determinístico e limites próprios, sem escore probabilístico ou confirmação de relação comercial.

O contrato de texto anterior permanece válido: `extractSponsorships({text, source})`. Sem segmentos explicitamente associados, todos os horários ficam desconhecidos. Números como `00:12` ou parâmetros de tempo em URLs não são interpretados como horário de uma evidência.

O campo opcional `transcript` recebe `videoId`, `coverage`, `source` declarado e `segments`. Cada segmento contém `start` em segundos, `text` e `duration` opcional. `prepareSponsorshipTranscript` valida o material e produz o texto exato dos segmentos unidos por uma quebra de linha. O extrator exige correspondência exata desse texto; edição posterior não mantém a associação antiga.

Cada evidência guarda referências aos segmentos cujo **texto** sobrepõe seu intervalo de caracteres. Textos repetidos são distinguidos pelas posições, sem procurar somente a primeira ocorrência. Um marcador que cruza segmentos conserva as referências separadas. Segmentos vazios não são associados. Os horários são dos segmentos completos; não há interpolação da posição de uma palavra. Duração ausente ou zero mantém o fim desconhecido.

O ID do vídeo, origem, cobertura e horários são fornecidos pelo usuário, sem autenticação ou comparação com conta/vídeo real. API oficial permanece excluída, inclusive em metadados aninhados de segmentos. Não há consulta remota, chamada de IA, escrita de histórico ou estimativa financeira.

Na interface, abrir o painel ou colar JSON não analisa nem aplica dados. **Aplicar segmentos ao texto** é uma ação explícita que substitui o texto da análise, preserva a associação e exige depois **Analisar**. Alterar texto, origem, ID, cobertura ou JSON descarta resultados e vínculos temporais. **Remover vínculo temporal** mantém apenas o texto literal. Exportar verifica novamente as entradas atuais, incluindo mudanças sem evento DOM. JSON, CSV e Markdown incluem método, limites e referências temporais declaradas; os exports anteriores continuam disponíveis.

Limites: 100 mil caracteres completos, 1000 segmentos, JSON de interface de até 1 milhão de caracteres, tempos de 0 a 604800 segundos e no máximo 200 evidências. Cada evidência mantém até 20 referências temporais e informa quantas foram omitidas; a saída alerta quando isso ocorre. Não há truncamento silencioso de texto ou substituição de tempos ausentes.

Validação local: `tests/sponsorships.test.ts`, `tests/sponsorship-timing.test.ts` e `tests/browser/sponsorships.spec.ts`. Backend HTTP e análise local reutilizam o mesmo extrator. O schema MCP existente continua somente com texto; o novo campo não foi anunciado como suportado pelo MCP. Compatibilidade em conta real não foi validada.
