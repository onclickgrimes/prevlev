# Instalação local e pacotes

O pacote da extensão é gerado somente a partir do build próprio em `dist/`. Não inclui `.env`, dependências, código de testes, histórico, biblioteca pessoal ou credenciais. A versão do manifesto deve corresponder à versão do projeto. Arquivos inesperados ou links simbólicos interrompem o empacotamento.

## Usar o ZIP pronto

Baixe [prevlev-extension.zip](../packages/prevlev-extension.zip) e o [SHA-256](../packages/prevlev-extension.zip.sha256). Extraia o ZIP em uma pasta permanente. Em `chrome://extensions`, ative **Modo do desenvolvedor**, clique **Carregar sem compactação** e escolha a pasta que contém `manifest.json`. Recarregue suas abas YouTube/Studio. Atualizações exigem extrair a nova versão e recarregar a extensão/abas.

O ZIP não é uma instalação da Chrome Web Store nem altera políticas do navegador. Se o Chrome bloquear extensões de desenvolvimento, use um perfil autorizado; o Prevlev não modifica essa política. O teste neste executor não pôde carregar a extensão instalada por essa restrição.

No PowerShell, confira o hash antes de extrair:

```powershell
Get-FileHash .\prevlev-extension.zip -Algorithm SHA256
Expand-Archive .\prevlev-extension.zip -DestinationPath .\prevlev-extension
```

Compare o hash exibido com o arquivo `.sha256`. O ZIP também contém `SHA256SUMS.json` para os arquivos internos e `INSTALAR.txt`.

## Gerar a partir do código

Use Node.js 24 ou superior. No diretório do repositório:

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd run package
```

No Linux/macOS, use `npm` no lugar de `npm.cmd`. O pacote fica em `artifacts/prevlev-extension-VERSAO.zip`, acompanhado de SHA-256. Ordenação dos arquivos, cabeçalhos e timestamps do ZIP são fixos: o mesmo build gera os mesmos bytes. Isso não promete reproduzir builds com versões diferentes de dependências/Node; use o lockfile e a versão indicada. O formato ZIP não exige `zip`, PowerShell ou outro compactador externo para gerar o arquivo.

## Backend pessoal e Omni já existente

As ferramentas locais funcionam sem servidor. Para IA, histórico e sincronização manual da biblioteca, configure o backend pessoal no computador que executará o serviço:

```powershell
npm.cmd ci
Copy-Item .env.example .env
# Edite .env localmente e substitua os placeholders. Preserve .env se já existir.
npm.cmd run doctor
npm.cmd run server
```

Use `Copy-Item` somente em instalação nova; não sobrescreva uma configuração existente. Preencha `PREVLEV_TOKEN` com um token próprio, `ALLOWED_ORIGINS` com o ID exato da extensão e mantenha a chave de acesso Omni, se exigida, somente no `.env`. A origem padrão Omni é `http://127.0.0.1:7814`; o backend Prevlev usa `127.0.0.1:8787`. O serviço Omni precisa já existir; estes comandos não o instalam nem configuram contas de provedores. Veja [BACKEND.md](BACKEND.md) e [OMNIPROVIDERS.md](OMNIPROVIDERS.md).

O diagnóstico padrão verifica Node, build e configuração sem mostrar valores secretos ou abrir conexões. `npm.cmd run doctor -- --json` retorna JSON. A opção explícita `--probe-local-tcp` testa somente se portas de loopback aceitam TCP, sem HTTP, tokens, catálogo ou geração. Uma porta aberta não comprova que o serviço correto está rodando ou que existe saldo/modelo disponível. O loopback deste executor não foi tratado como a máquina do usuário.

Os scripts são Node e caminhos relativos portáveis. Os comandos PowerShell foram revisados estaticamente; a execução Windows real permanece não verificada por não haver Windows neste ambiente. Não é necessário mudar ExecutionPolicy para executar `npm.cmd`.
