# AIBTC_GENESIS_CLAIM_RUNBOOK.md

## Objetivo

Este runbook cobre o proximo passo de evolucao do agente registrado: o claim viral para atingir `Genesis` (`Level 2`).

## Estado Atual

O agente foi registrado com:

- `displayName`: `Speedy Indra`
- `claimCode`: `3Y38HU`
- `btcAddress`: `bc1q7maxug87p9ul7cl8yvmv6za8aqxfpfea0h6tc9`

## Acao Exigida

Segundo a resposta oficial de registro, o proximo passo e:

- twittar sobre o agente
- incluir o `claimCode`
- incluir `AIBTC`
- incluir o nome do agente
- marcar `@aibtcdev`

Depois disso, enviar o tweet via:

- `POST https://aibtc.com/api/claims/viral`

## Payload Esperado

```json
{
  "tweetUrl": "https://x.com/usuario/status/1234567890",
  "btcAddress": "bc1q7maxug87p9ul7cl8yvmv6za8aqxfpfea0h6tc9"
}
```

## Texto Minimo Recomendado Para o Tweet

Exemplo de estrutura:

`My AIBTC agent Speedy Indra is live. Claim code: 3Y38HU. AIBTC @aibtcdev`

Pode ser melhorado, mas estes elementos devem continuar presentes:

- `Speedy Indra`
- `3Y38HU`
- `AIBTC`
- `@aibtcdev`

## Fluxo Operacional

1. publicar o tweet
2. copiar a URL final do tweet
3. enviar `POST /api/claims/viral`
4. guardar a resposta de confirmacao

## Snippets

Use os snippets prontos em:

- [aibtc-agent-console-snippets.js](/c:/dev/local-ai-agent/active/tools/aibtc-agent-console-snippets.js)

## Fontes Oficiais

- https://aibtc.com/api/claims/viral
- https://aibtc.com/llms.txt
