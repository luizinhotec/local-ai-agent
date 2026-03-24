# CODEX.md

## Objetivo do Repositorio

Este repositorio existe para apoiar a operacao de um agente no fluxo recomendado pela AIBTC, priorizando:

- `Codex CLI`
- `@aibtc/mcp-server`
- configuracao local segura
- runbooks operacionais

O agente Python legado nao faz mais parte do repositorio principal.

## Estado Atual

Estado consolidado em 2026-03-14:

- `Codex` autenticado e operacional no ambiente atual
- MCP da AIBTC configurado e validado
- agente registrado com sucesso na API publica da AIBTC
- `displayName`: `Speedy Indra`
- `btcAddress`: `bc1q7maxug87p9ul7cl8yvmv6za8aqxfpfea0h6tc9`
- `stxAddress`: `SP1H35Z548R39KCMMNP9498QQ28SZFE07FB7Q3CBT`
- nivel atual: `2 - Genesis`
- `claims/viral` validado
- `heartbeat` validado
- `heartbeat` humano recorrente validado e refletido no log local
- helper local consolidado como fonte unica de verdade operacional
- dashboard, status, logs, relatorio, backup, manutencao e auditoria consolidados
- suporte operacional local fechado para a fase atual
- baseline operacional de yield conservador validado: `sBTC` aplicado no `Zest` com reserva liquida mantida na wallet

## Janela de Contexto Atual

Nome da janela operacional ativa deste fluxo:

- `Speedy Indra`

Regra:

- esta janela trata apenas do agente principal
- qualquer assunto do `DOG MM Agent` deve ir para outra janela nomeada separadamente
- toda nova conversa operacional deve comecar com um nome de contexto explicito

## Estrutura Principal

```text
local-ai-agent/
|-- CODEX.md
|-- DOG_MM_CODEX.md
|-- DOG_MM_ROADMAP.md
|-- README.md
|-- ROADMAP.md
|-- REPO_SPLIT_PLAN.md
`-- active/
    |-- README.md
    |-- SETUP_STATUS.md
    |-- config/
    |   `-- README.md
    |-- docs/
    |   |-- AIBTC_AGENT_OPERATIONS.md
    |   |-- AIBTC_AGENT_IDENTITY_DECISION.md
    |   |-- AIBTC_AGENT_IDENTITY_CHECKLIST.md
    |   |-- AIBTC_GENESIS_CLAIM_RUNBOOK.md
    |   |-- AIBTC_HEARTBEAT_RUNBOOK.md
    |   |-- AIBTC_MESSAGE_SIGNING_BRIDGE.md
    |   |-- AIBTC_AGENT_PROFILE_PREP.md
    |   |-- AIBTC_MCP_INSTALL.md
    |   |-- AIBTC_PLATFORM_REGISTER.md
    |   |-- AIBTC_QUICKSTART.md
    |   |-- AIBTC_REGISTRY_MONITOR.md
    |   |-- AIBTC_REGISTER_RUNBOOK.md
    |   |-- AIBTC_REGISTRATION_PREP.md
    |   |-- AIBTC_SECRETS_AND_CONFIG.md
    |   |-- REPOSITORY_STRATEGY.md
    |   |-- WINDOWS_CODEX_AIBTC_SETUP.md
    |   `-- dog-mm/
    |       |-- README.md
    |       `-- AIBTC_DOG_MM_AGENT_OPERATIONS.md
    |-- scripts/
    |   |-- start-aibtc-ops.ps1
    |   |-- run-aibtc-maintenance-cycle.ps1
    |   |-- show-aibtc-ops-status.ps1
    |   |-- show-aibtc-ops-log.ps1
    |   |-- watch-aibtc-mainnet-registry.ps1
    |   |-- start-aibtc-register-helper.ps1
    |   `-- validate-aibtc-env.ps1
    `-- templates/
        |-- aibtc/
        |   |-- agent-profile.final-suggested.json
        |   |-- platform-register-request.final-suggested.json
        |   |-- platform-register-request.example.json
        |   |-- agent-profile.example.json
        |   |-- agent-registration-payload.example.json
        |   `-- dog-mm/
        |       `-- README.md
        |-- claude-code/
        |   |-- mcp.aibtc.example.json
        |   `-- mcp.aibtc.mainnet.example.json
        `-- codex/
            `-- mcp.aibtc.example.toml
    `-- tools/
        |-- aibtc-ops-dashboard.html
        |-- aibtc-agent-console-snippets.js
        `-- leather-register-helper.html
```

## Diretrizes

- nao reconstruir um agente proprio do zero neste repositorio
- usar o fluxo AIBTC como caminho principal
- manter segredos fora do versionamento
- manter qualquer operacao sensivel atras de aprovacao humana
- manter wallet dedicada para o agente
- tratar `Bitflow` apenas como trilha futura, sem afrouxar os guardrails atuais
- manter a documentacao como interface principal do repositorio
- tratar o helper local como fonte primaria do estado operacional

## Decisao Sobre o Legado Python

Revisao consolidada em 2026-03-15:

- `c:\dev\local-ai-agent-python-legacy-snapshot` permanece como snapshot tecnico de referencia
- `main.py`, `aibtc_agent/core`, `aibtc_agent/llm`, `aibtc_agent/memory` e `aibtc_agent/wallet` ficam congelados como legado
- tools e integracoes read-only do legado podem inspirar utilitarios futuros, mas nao devem ser portados automaticamente
- qualquer reaproveitamento do legado deve ser seletivo, isolado e justificar alinhamento direto ao fluxo `Codex + AIBTC MCP`
- o repositorio principal nao volta a ter o agente Python como centro do produto

## Documentos de Referencia

Fluxo principal atual:

- [README.md](/c:/dev/local-ai-agent/README.md)
- [ROADMAP.md](/c:/dev/local-ai-agent/ROADMAP.md)
- [REPO_SPLIT_PLAN.md](/c:/dev/local-ai-agent/REPO_SPLIT_PLAN.md)
- [AIBTC_QUICKSTART.md](/c:/dev/local-ai-agent/active/docs/AIBTC_QUICKSTART.md)
- [AIBTC_MCP_INSTALL.md](/c:/dev/local-ai-agent/active/docs/AIBTC_MCP_INSTALL.md)
- [AIBTC_AGENT_PROFILE_PREP.md](/c:/dev/local-ai-agent/active/docs/AIBTC_AGENT_PROFILE_PREP.md)
- [AIBTC_AGENT_IDENTITY_DECISION.md](/c:/dev/local-ai-agent/active/docs/AIBTC_AGENT_IDENTITY_DECISION.md)
- [AIBTC_AGENT_IDENTITY_CHECKLIST.md](/c:/dev/local-ai-agent/active/docs/AIBTC_AGENT_IDENTITY_CHECKLIST.md)
- [AIBTC_GENESIS_CLAIM_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/AIBTC_GENESIS_CLAIM_RUNBOOK.md)
- [AIBTC_HEARTBEAT_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/AIBTC_HEARTBEAT_RUNBOOK.md)
- [AIBTC_MESSAGE_SIGNING_BRIDGE.md](/c:/dev/local-ai-agent/active/docs/AIBTC_MESSAGE_SIGNING_BRIDGE.md)
- [AIBTC_PLATFORM_REGISTER.md](/c:/dev/local-ai-agent/active/docs/AIBTC_PLATFORM_REGISTER.md)
- [AIBTC_REGISTRY_MONITOR.md](/c:/dev/local-ai-agent/active/docs/AIBTC_REGISTRY_MONITOR.md)
- [AIBTC_REGISTER_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/AIBTC_REGISTER_RUNBOOK.md)
- [AIBTC_REGISTRATION_PREP.md](/c:/dev/local-ai-agent/active/docs/AIBTC_REGISTRATION_PREP.md)
- [AIBTC_SECRETS_AND_CONFIG.md](/c:/dev/local-ai-agent/active/docs/AIBTC_SECRETS_AND_CONFIG.md)
- [AIBTC_AGENT_OPERATIONS.md](/c:/dev/local-ai-agent/active/docs/AIBTC_AGENT_OPERATIONS.md)
- [AIBTC_OPERATOR_COMMANDS_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/AIBTC_OPERATOR_COMMANDS_RUNBOOK.md)
- [WINDOWS_CODEX_AIBTC_SETUP.md](/c:/dev/local-ai-agent/active/docs/WINDOWS_CODEX_AIBTC_SETUP.md)

Trilha separada futura: `DOG MM Agent`

Observacao:

- o fluxo abaixo nao faz parte do agente principal
- use [DOG_MM_CODEX.md](/c:/dev/local-ai-agent/DOG_MM_CODEX.md) como ponto de entrada exclusivo dessa trilha

## Proximo Passo Prioritario

Executar os proximos passos reais do agente ja registrado:

- manter `POST /api/heartbeat` operacional
- manter o helper, o dashboard e o log local como apoio operacional
- manter a rotina local de manutencao, backup, relatorio e auditoria
- manter a posicao conservadora atual no `Zest` como baseline operacional ate nova decisao
- acompanhar a abertura do registry on-chain em `mainnet`
- operar manutencao recorrente sem expandir UI local alem do necessario ate a abertura do registry
