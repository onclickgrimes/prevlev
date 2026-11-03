# Método de referência e cobertura REA

Esta reconstrução foi guiada pela skill [reverse-engineer-anything](https://github.com/onclickgrimes/Codex-Clone/blob/main/.agents/skills/reverse-engineer-anything/SKILL.md), lida antes da implementação, e pela análise executada pelo coordenador da tarefa com a CLI `rea-agents@6.7.0`.

Comando de referência: `npx -y rea-agents@6.7.0 analyze-javascript-application /caminho/source --json`, com seleção focada na execução concluída. A extensão original não foi executada neste projeto.

O coordenador reportou conclusão com exit 0, 61/61 módulos selecionados analisados, nenhum módulo selecionado ignorado, nenhuma falha de parsing e nenhuma contradição de integridade. A varredura inicial da árvore inteira encontrou limite de heap em seis bundles. Portanto, a evidência é estática, selecionada e complementada pela especificação comportamental; não comprova cobertura integral, runtime ou serviços backend da referência.

Identidade da referência informada: ZIP `ddlgficaecdmmddmjmnhcmlidjokcijd.zip`, SHA-256 `8f47f908b2a113d18f95f254d71a9368245dd9cfb7e61c558e702b1e17b78cb7`, versão Nexlev 3.12.6. Esse pacote e seu código não fazem parte deste repositório.

O coordenador disponibilizou também a especificação independente `prevlev-independent-spec.zip`, versão 1, 14263 bytes, SHA-256 `d8f922d51c934ab300c79e6d97a6cf49e901d3466bba2667d52a9d1e4cfb8e06`. A transferência desse arquivo para este executor retornou `download failed`, inclusive em uma tentativa com acesso adicional. A versão integral do recibo não foi lida neste executor. Os números acima registram o resultado comunicado pelo coordenador, sem inventar Evidence IDs ou alegar verificação local desse ZIP. A implementação usou a especificação textual transmitida e a matriz própria de cobertura.

As diferenças do produto entregue estão em [FEATURES.md](FEATURES.md). O código implementa cálculos próprios, DOM adapters, ferramentas canvas e um contrato de backend próprio, sem publicar bundles/assets da referência, acessar seus servidores ou contornar licença/autenticação.
