# DOG MM State

Esta pasta guarda apenas o estado local da trilha separada do `DOG MM Agent`.

Conteudo esperado:

- status local da preparacao
- log local de eventos da trilha
- snapshots do `HODLMM/DLMM`
- registros da fase `0`
- registros da fase `1`
- input local temporario com enderecos publicos da wallet segregada
- input local temporario de funding experimental
- brief local de execucao da fase `0`
- brief local de execucao da fase `1`
- bundle consolidado de operacao

Regras:

- nao salvar mnemonic
- nao salvar senha
- nao salvar private key
- nao salvar assinatura sensivel
- nao misturar com o estado do `Speedy Indra`
- manter o input `dog-mm-wallet-public-input.json` apenas como arquivo operacional local
