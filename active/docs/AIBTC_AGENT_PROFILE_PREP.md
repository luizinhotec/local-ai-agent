# AIBTC_AGENT_PROFILE_PREP.md

## Objetivo

Este documento organiza os campos publicos do perfil do agente que podem ser preparados antes da abertura do registry de `mainnet`.

Ele nao substitui nenhum schema oficial futuro da AIBTC. Ele serve para reduzir retrabalho quando o registro ficar disponivel.

## O Que Vale Preparar Agora

Campos publicos e nao sensiveis:

- nome operacional do agente
- nome publico de exibicao
- descricao curta
- enderecos publicos do operador
- lista de capacidades
- links publicos opcionais
- `nostrPublicKey`, se voce quiser divulgar
- `x402Ref`, se voce quiser vincular

## O Que Nao Deve Entrar

- mnemonic
- senha da wallet
- assinaturas reais
- segredos de terceiros

## Template Local

Use:

- [agent-profile.example.json](/c:/dev/local-ai-agent/active/templates/aibtc/agent-profile.example.json)
- [agent-profile.draft.json](/c:/dev/local-ai-agent/active/templates/aibtc/agent-profile.draft.json)
- [agent-profile.final-suggested.json](/c:/dev/local-ai-agent/active/templates/aibtc/agent-profile.final-suggested.json)

Preencha esse template apenas com informacoes publicas.

## Sugestao de Preenchimento Minimo

- `name`: identificador curto e estavel
- `displayName`: nome publico legivel
- `description`: uma frase objetiva dizendo o que o agente faz
- `operator.stxAddress`: endereco STX da wallet dedicada
- `operator.btcAddress`: endereco BTC da wallet dedicada
- `operator.taprootAddress`: endereco Taproot da wallet dedicada
- `capabilities`: 3 a 5 capacidades publicas

## Descricao Recomendada

Se quiser um baseline simples, use uma descricao nesse formato:

`AI agent operated through Codex and AIBTC MCP on Stacks/Bitcoin mainnet, prepared for safe operator-approved automation.`

## Relacao com o Registro

Esse perfil nao registra o agente sozinho.

Ele serve para:

- facilitar o preenchimento do payload futuro
- ajudar a decidir `description`, `nostrPublicKey` e `x402Ref`
- manter uma base publica coerente para o `metadata URI`

## Proximo Passo

Depois de preencher o perfil:

- revisar [AIBTC_AGENT_IDENTITY_CHECKLIST.md](/c:/dev/local-ai-agent/active/docs/AIBTC_AGENT_IDENTITY_CHECKLIST.md)
- alinhar `description` no draft de registro
- decidir se `nostrPublicKey` e `x402Ref` serao usados
- aguardar liberacao do registry em `mainnet`
