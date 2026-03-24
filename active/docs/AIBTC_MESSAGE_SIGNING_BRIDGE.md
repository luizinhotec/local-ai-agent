# AIBTC_MESSAGE_SIGNING_BRIDGE.md

## Objetivo

Este documento registra a ponte pratica entre o fluxo de registro publico da AIBTC e a capacidade real de assinatura disponivel hoje na wallet `Leather`.

## Conclusao

O MCP atual da AIBTC neste ambiente nao expõe:

- `btc_sign_message`
- `stacks_sign_message`

Mas a `Leather` expõe ambos os fluxos de assinatura de mensagem na API da extensao:

- `signMessage` para Bitcoin
- `stx_signMessage` para Stacks

Isso cria um caminho operacional viavel para gerar as assinaturas exigidas por:

- `POST https://aibtc.com/api/register`

Mensagem oficial a ser assinada:

- `Bitcoin will be the currency of AIs`

## Assinatura Bitcoin

Metodo da Leather:

- `signMessage`

Parametros principais:

- `message`: obrigatorio
- `paymentType`: opcional, `p2wpkh` ou `p2tr`
- `network`: opcional, `mainnet` suportado
- `account`: opcional

Uso esperado neste projeto:

- gerar `bitcoinSignature`
- usar `p2wpkh` para o endereco BTC SegWit da wallet dedicada
- considerar `p2tr` apenas se for necessario preencher tambem `taprootSignature`

## Assinatura Stacks

Metodo da Leather:

- `stx_signMessage`

Parametros principais:

- `message`: obrigatorio
- `messageType`: opcional, `utf8` para texto simples
- `network`: opcional, `mainnet` suportado

Uso esperado neste projeto:

- gerar `stacksSignature`

## Fluxo Recomendado

1. manter a wallet dedicada ativa
2. preparar o payload local de registro
3. gerar `bitcoinSignature` via `signMessage`
4. gerar `stacksSignature` via `stx_signMessage`
5. opcionalmente gerar `taprootSignature` via `signMessage` com `paymentType = p2tr`
6. enviar o `POST /api/register`
7. validar a resposta da API

## Limites

Este repositorio ainda nao automatiza esse passo.

Motivo:

- a Leather assina via API de extensao/browser
- o MCP atual do Codex nao expõe as tools equivalentes

## Fontes Oficiais

- Leather `signMessage`: https://leather.io/posts/signmessage-api-method
- Leather `stx_signMessage`: https://leather.io/posts/api-stx-signmessage
- Leather API overview: https://app.leather.io/support/guide/api-overview
- AIBTC register API: https://aibtc.com/api/register
- AIBTC LLM docs: https://aibtc.com/llms.txt
