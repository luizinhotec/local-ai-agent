# AIBTC_AGENT_IDENTITY_DECISION.md

## Objetivo

Este documento registra a configuracao minima recomendada para deixar o agente pronto para registro sem depender de links publicos ou identidades opcionais ainda nao definidas.

## Baseline Recomendado

Use como ponto de partida:

- `name`: `local-ai-agent`
- `displayName`: `Local AI Agent`
- `description`: `AI agent operated through Codex and AIBTC MCP on Stacks and Bitcoin mainnet, prepared for safe operator-approved automation.`

Campos opcionais recomendados neste momento:

- `website`: vazio
- `xProfile`: vazio
- `nostrPublicKey`: vazio
- `x402Ref`: vazio

Motivo:

- evita inventar identidade publica prematuramente
- reduz retrabalho futuro
- mantém o agente pronto para registrar assim que `mainnet` abrir

## Arquivo Sugerido

Use este rascunho como baseline minimo:

- [agent-profile.final-suggested.json](/c:/dev/local-ai-agent/active/templates/aibtc/agent-profile.final-suggested.json)

## Quando Mudar Esse Baseline

Atualize esse perfil apenas quando houver um destes eventos:

- site publico real do agente
- perfil X publico real do agente
- chave Nostr publica dedicada ao agente
- referencia `x402` publica real
- reposicionamento do produto que exija outra descricao

## Relacao com o Registro

Esse baseline:

- nao executa o registro sozinho
- nao substitui assinaturas reais
- nao substitui o payload do endpoint de registro

Ele serve para fechar a parte publica e nao sensivel da identidade do agente.
