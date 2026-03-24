# AIBTC_DOG_MM_WALLET_SETUP_RUNBOOK.md

## Objetivo

Preparar a wallet exclusiva do `DOG MM Agent` sem qualquer dependencia da wallet principal ou da wallet do `Speedy Indra`.

## Regras Fixas

- criar wallet nova
- usar seed phrase nova
- usar senha nova
- nao reutilizar nenhum endereco do agente atual
- nao guardar seed ou senha no repositorio
- manter auto-lock ativo

## Nome Sugerido

Nome sugerido para a wallet local:

- `dog-mm-mainnet`

Motivo:

- deixa clara a separacao funcional
- reduz risco de erro operacional na hora de trocar de wallet

## Antes de Criar

- confirmar que o `DOG MM Agent` continua fora do fluxo principal
- preparar local offline para seed phrase
- preparar senha exclusiva
- fechar qualquer operacao pendente do agente principal antes de mexer em wallet

## Criacao

Objetivo minimo:

- gerar wallet nova
- validar endereco `STX`
- validar endereco `BTC`
- validar endereco `Taproot`

Checklist:

- criar wallet com nome exclusivo
- registrar seed phrase offline
- validar que a wallet foi criada em `mainnet`
- confirmar que a wallet ativa nao e a do agente principal

## Pos-Criacao

- preencher [dog-mm-agent-profile.suggested.json](/c:/dev/local-ai-agent/active/templates/aibtc/dog-mm/dog-mm-agent-profile.suggested.json) apenas com enderecos publicos
- manter seed phrase e senha fora de qualquer arquivo versionado
- testar lock e unlock antes de qualquer funding

## Funding Inicial

Funding inicial aprovado:

- `US$ 100`

Distribuicao operacional alvo:

- ate `US$ 50` para primeira abertura manual
- ate `US$ 10` de folga para friccao
- pelo menos `US$ 40` fora da posicao inicial

## Criterio de Bloqueio

Parar imediatamente se:

- a wallet ativa for a do `Speedy Indra`
- houver qualquer duvida sobre seed phrase ou endereco
- o funding vier do caixa errado
- a execucao exigir reaproveitar wallet principal

## Saida Esperada

- wallet `DOG MM` criada
- enderecos publicos validados
- lock e unlock testados
- wallet pronta para receber o lote experimental da fase 1
