# Captura validada → biblioteca local · AF05

`mountCapturedAsset(host, {saveAsset})` acrescenta um painel ao host sem substituir outros elementos. Retorna `offer`, `invalidate` e `dispose`.

`offer({blob, metadata, isCurrent})` recebe somente um crop que o host já validou, com URL real, associação de vídeo, máscaras/contexto aplicáveis e guard dessa origem. O painel não mede nem valida novamente o crop ou suas máscaras. Ele mostra tipo/tamanho recebidos, URL da captura declarada, URL da referência, origem, ID e data quando fornecidos. Não infere ID pela URL, não inventa origem/data e não cria uma prévia. Montar, oferecer ou editar não salva, busca, decodifica ou comprime imagens.

O título é editável. Somente **Salvar última captura na biblioteca** chama `saveAsset(blob, metadata, guard)`. A metadata preserva os campos recebidos e uma cópia da procedência, alterando apenas o título revisado. O guard combina identidade/serial da oferta, título atual e `isCurrent` do host; a implementação de persistência precisa verificá-lo antes da alteração local e antes de confirmar sucesso. O `SwipeTools.saveAsset` existente fornece esses checkpoints.

Editar título, descartar, oferecer outra captura, invalidar pelo host ou dispor o painel torna o guard pendente falso. Conclusões, falhas e `finally` antigos não alteram uma oferta ou solicitação mais recente. Uma mudança de origem bloqueia salvamento e sucesso. Após confirmação atual, o painel libera os bytes oferecidos e impede salvar a mesma oferta novamente. Descartar/invalidation não desfaz uma gravação que já tenha sido concluída.

Limites de imagem e biblioteca continuam no `saveAsset`: até 3 MiB por imagem e orçamento total de 4 MiB, incluindo base64/metadados. Uma captura válida para exibição pode exceder esse orçamento. O painel informa o erro recebido e mantém os bytes originais disponíveis; não comprime, substitui formato ou tenta novamente automaticamente.

O host deve chamar `invalidate()` ao limpar/trocar fonte, vídeo, aba ou contexto de máscara/captura. `dispose()` invalida pendências e remove apenas o painel criado; ofertas tardias após dispose são ignoradas. Nenhum arquivo, conta, serviço remoto ou credencial é alterado pelo componente.

Fixtures: `tests/captured-asset.test.ts` e `tests/browser/captured-asset.spec.ts`. Os testes verificam o contrato de guard por dependência injetada e não alegam validação de captura em conta real.
