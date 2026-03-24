# AIBTC_PLATFORM_REGISTER.md

## Objetivo

Este documento cobre o registro do agente via API publica da AIBTC, separado do registry on-chain de `mainnet`.

## Estado Atual

Em 2026-03-14:

- `POST /api/register` esta publico e documentado
- o registry on-chain de identidade em `mainnet` continua ausente no endpoint `stx402`
- o MCP atual nao expõe `btc_sign_message`
- o MCP atual nao expõe `stacks_sign_message`

Consequencia pratica:

- o registro de plataforma existe
- mas o fluxo completo nao fecha apenas com as tools MCP atualmente expostas neste ambiente

## Campos do Payload

Payload esperado pela API publica:

- `stacksSignature`: obrigatorio
- `bitcoinSignature`: obrigatorio
- `description`: opcional
- `taprootAddress`: opcional
- `taprootSignature`: opcional
- `nostrPublicKey`: opcional
- `x402Ref`: opcional

Endpoint:

- `POST https://aibtc.com/api/register`

Mensagem oficial a ser assinada:

- `Bitcoin will be the currency of AIs`

## O Que Falta Para Executar Agora

Voce ainda precisa gerar fora deste MCP atual:

- assinatura da mensagem em Stacks
- assinatura da mensagem em Bitcoin

Opcionalmente:

- assinatura Taproot

## Estrategia Recomendada

1. manter a wallet dedicada pronta
2. preparar o payload local sem segredos
3. gerar as assinaturas com uma ferramenta que realmente exponha assinatura de mensagem
4. executar o `POST /api/register`
5. validar a resposta com `claimCode`, `displayName` e identificadores retornados

Ponte pratica documentada:

- [AIBTC_MESSAGE_SIGNING_BRIDGE.md](/c:/dev/local-ai-agent/active/docs/AIBTC_MESSAGE_SIGNING_BRIDGE.md)

## Template Local

Use:

- [platform-register-request.example.json](/c:/dev/local-ai-agent/active/templates/aibtc/platform-register-request.example.json)
- [platform-register-request.final-suggested.json](/c:/dev/local-ai-agent/active/templates/aibtc/platform-register-request.final-suggested.json)
- [AIBTC_REGISTER_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/AIBTC_REGISTER_RUNBOOK.md)

Nao salve assinaturas reais versionadas no repositorio.

## Resposta Esperada

A resposta publica documentada pela AIBTC inclui campos como:

- `success`
- `claimCode`
- `displayName`
- `stxAddress`
- `btcAddress`
- `ordinalAddress`
- `taprootAddress`
- `isRegistered`
- `isVerified`
- `agentFile`

## Fontes Oficiais

- https://aibtc.com/api/register
- https://aibtc.com/llms.txt

## Bloqueio Atual

Bloqueio local deste ambiente:

- o MCP atual nao tem as tools de assinatura de mensagem exigidas por `POST /api/register`

Bloqueio externo separado:

- o registry on-chain de `mainnet` segue indisponivel em `https://stx402.com/agent/registry`
