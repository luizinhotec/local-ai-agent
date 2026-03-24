# AIBTC_AGENT_IDENTITY_CHECKLIST.md

## Objetivo

Este checklist fecha as decisoes publicas que ainda faltam para deixar o perfil do agente pronto antes da abertura do registry de `mainnet`.

Ele cobre apenas campos publicos. Nao coloque segredos aqui.

## Campos Pendentes

### 1. Presenca publica

- `website`
- `xProfile`

Decisao:

- deixar vazio por enquanto
- preencher quando existir um canal publico estavel

### 2. Identidade opcional

- `nostrPublicKey`

Decisao:

- deixar vazio se o agente nao for expor identidade Nostr
- preencher apenas se houver chave publica dedicada ao agente

### 3. Referencia x402

- `x402Ref`

Decisao:

- deixar vazio enquanto nao houver uma referencia publica clara
- preencher apenas quando houver um identificador real para vincular

### 4. Nome publico

Campos relacionados:

- `name`
- `displayName`

Decisao:

- manter `local-ai-agent` / `Local AI Agent`
- ou substituir por uma identidade publica final antes do registro

### 5. Descricao publica

Campo:

- `description`

Estado atual:

- `AI agent operated through Codex and AIBTC MCP on Stacks and Bitcoin mainnet, prepared for safe operator-approved automation.`

Decisao:

- manter como baseline
- ou encurtar para uma versao mais orientada a produto

## Arquivos a Atualizar Quando as Decisoes Forem Tomadas

- [agent-profile.final-suggested.json](/c:/dev/local-ai-agent/active/templates/aibtc/agent-profile.final-suggested.json)
- [agent-profile.draft.json](/c:/dev/local-ai-agent/active/templates/aibtc/agent-profile.draft.json)
- [agent-registration-payload.draft.json](/c:/dev/local-ai-agent/active/templates/aibtc/agent-registration-payload.draft.json)

Baseline recomendado:

- [AIBTC_AGENT_IDENTITY_DECISION.md](/c:/dev/local-ai-agent/active/docs/AIBTC_AGENT_IDENTITY_DECISION.md)

## Guardrails

- nao adicionar mnemonic
- nao adicionar senha
- nao adicionar assinaturas reais
- nao usar links ou chaves que ainda nao sejam publicos de fato
