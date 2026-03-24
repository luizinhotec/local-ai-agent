# AIBTC_REGISTRATION_PREP.md

## Objetivo

Este documento prepara o repositorio para o registro do agente assim que o registry de identidade em `mainnet` estiver disponivel.

Ele separa dois momentos:

- o registro do agente via endpoints da plataforma AIBTC
- o passo futuro de identidade on-chain em `mainnet`, hoje bloqueado pela ausencia do registry

## Estado Atual

Em 2026-03-13, o fluxo local validado mostra:

- wallet ativa em `mainnet`
- integracao `Codex + AIBTC MCP` funcional
- endpoint de registry respondendo que `mainnet` ainda esta `null`

Consequencia pratica:

- ja da para preparar payload, metadata e identidade operacional
- ainda nao da para concluir o registro on-chain em `mainnet`

## Campos Oficiais do Registro da Plataforma

O endpoint oficial de registro da AIBTC aceita estes campos:

- `stacksSignature`: obrigatorio
- `bitcoinSignature`: obrigatorio
- `description`: opcional
- `taprootAddress`: opcional
- `taprootSignature`: opcional
- `nostrPublicKey`: opcional
- `x402Ref`: opcional

Observacoes:

- as assinaturas devem ser produzidas localmente pela wallet
- nenhum campo sensivel deve ser salvo no repositorio
- o endereco STX e inferido da wallet usada no fluxo de assinatura

## Passo Futuro de Identidade On-Chain

As referencias publicas da AIBTC descrevem um passo adicional de identidade on-chain com `metadata URI` e aprovacoes do operador.

No estado atual, a preparacao segura e esta:

- reservar o endereco STX operacional do agente
- preparar um `metadata URI` estavel
- manter descricao e identidade textual do agente prontas
- aguardar o contrato de registry em `mainnet`

Hoje, o valor mais seguro para planejar como `metadata URI` e:

- `https://aibtc.com/api/agents/<STX_ADDRESS>`

Isso deve ser tratado como preparacao operacional. O uso final depende da liberacao do registry em `mainnet`.

## O Que Preparar Agora

### 1. Identidade minima do agente

- endereco STX do agente
- endereco BTC do agente
- endereco BTC Taproot do agente
- nome operacional do agente
- descricao curta do agente

### 2. Payload do registro da plataforma

- `stacksSignature`
- `bitcoinSignature`
- `description`
- `taprootAddress`
- `taprootSignature`
- `nostrPublicKey`
- `x402Ref`

### 3. Prerequisitos operacionais

- algum saldo em `STX` para fees futuras
- wallet dedicada do agente
- nenhuma seed phrase no chat
- nenhuma senha em arquivos versionados

## Template Local

Use o template versionado em:

- [agent-registration-payload.example.json](/c:/dev/local-ai-agent/active/templates/aibtc/agent-registration-payload.example.json)
- [agent-profile.example.json](/c:/dev/local-ai-agent/active/templates/aibtc/agent-profile.example.json)
- [AIBTC_AGENT_PROFILE_PREP.md](/c:/dev/local-ai-agent/active/docs/AIBTC_AGENT_PROFILE_PREP.md)

Preencha esse template apenas como referencia local de campos. Nao salve assinaturas reais no repositorio.

## Checklist de Pronto Para Registro

- wallet dedicada ativa em `mainnet`
- wallet destravada quando o fluxo exigir assinatura
- saldo `STX` disponivel para fees
- descricao do agente pronta
- `taprootAddress` decidido
- `nostrPublicKey` decidido ou explicitamente omitido
- `x402Ref` decidido ou explicitamente omitido
- `metadata URI` planejado
- liberacao do registry de identidade em `mainnet`

## Fontes Oficiais

- AIBTC LLM reference: https://aibtc.com/llms.txt
- AIBTC register API: https://aibtc.com/api/register
- AIBTC identity verification API: https://aibtc.com/api/verify/%3Cstx_address%3E
- AIBTC identity API: https://aibtc.com/api/identity/%3Cstx_address%3E
- AIBTC registry endpoint: https://stx402.com/agent/registry

## Inferencias Marcadas

Estas partes sao inferencia operacional a partir das referencias publicas:

- usar `https://aibtc.com/api/agents/<STX_ADDRESS>` como alvo previsto de `metadata URI`
- tratar `Bitflow` apenas como trilha futura posterior ao registro do agente

Se a AIBTC publicar um schema explicito para metadata on-chain em `mainnet`, este documento deve ser ajustado para refletir o schema oficial.
