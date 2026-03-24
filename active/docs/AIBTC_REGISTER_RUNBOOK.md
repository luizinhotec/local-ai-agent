# AIBTC_REGISTER_RUNBOOK.md

## Objetivo

Este runbook fecha o fluxo pratico de registro do agente via API publica da AIBTC.

## Data de Referencia

- 2026-03-14

## Mensagem Oficial a Ser Assinada

Segundo a documentacao oficial de `POST /api/register`, a mensagem exata e:

`Bitcoin will be the currency of AIs`

Essa mesma mensagem precisa ser assinada por:

- chave Bitcoin
- chave Stacks

Opcionalmente:

- chave Taproot, se `taprootAddress` for enviado com `taprootSignature`

## Endpoint

- `POST https://aibtc.com/api/register`

## Payload Minimo

- `bitcoinSignature`
- `stacksSignature`

Payload recomendado neste projeto:

- `bitcoinSignature`
- `stacksSignature`
- `description`
- `taprootAddress`
- `taprootSignature` apenas se a assinatura Taproot for gerada
- `nostrPublicKey` apenas se existir uma chave publica real
- `x402Ref` apenas se existir uma referencia publica real

## Fluxo Operacional

1. destravar a wallet dedicada
2. assinar `Bitcoin will be the currency of AIs` com a chave Bitcoin
3. assinar `Bitcoin will be the currency of AIs` com a chave Stacks
4. opcionalmente assinar a mesma mensagem com a chave Taproot
5. montar o JSON do `POST /api/register`
6. enviar a requisicao
7. guardar com seguranca:
   - `claimCode`
   - `displayName`
   - `sponsorApiKey`, se vier na resposta

## Exemplo de Requisicao

Use como referencia:

- [platform-register-request.final-suggested.json](/c:/dev/local-ai-agent/active/templates/aibtc/platform-register-request.final-suggested.json)
- [leather-register-helper.html](/c:/dev/local-ai-agent/active/tools/leather-register-helper.html)

Helper local:

- suba com [start-aibtc-register-helper.ps1](/c:/dev/local-ai-agent/active/scripts/start-aibtc-register-helper.ps1)
- o helper usa um proxy local para evitar erro de `failed to fetch` no navegador

## Resposta Esperada

A documentacao oficial mostra que a resposta bem-sucedida pode incluir:

- `success`
- `agent`
- `claimCode`
- `claimInstructions`
- `sponsorApiKey`
- `sponsorKeyInfo`

## Cuidado Operacional

- nao salvar assinaturas reais versionadas
- nao salvar mnemonic
- nao salvar senha
- se `sponsorApiKey` vier, guardar fora do repositorio

## Fontes Oficiais

- https://aibtc.com/api/register
- https://aibtc.com/llms.txt
