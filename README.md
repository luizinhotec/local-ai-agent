# Local AI Agent

Repositorio principal do workspace para `GPT/Codex + AIBTC MCP`.

Este repositorio nao carrega mais o agente Python legado como codigo fonte principal. O legado foi extraido para um snapshot separado em:

- `c:\dev\local-ai-agent-python-legacy-snapshot`

Backup local usado na limpeza do repositorio principal:

- `c:\dev\local-ai-agent-principal-cleanup-backup`

## Documentos Principais

- [CODEX.md](/c:/dev/local-ai-agent/CODEX.md): arquitetura e restricoes do repositorio principal
- [ROADMAP.md](/c:/dev/local-ai-agent/ROADMAP.md): roadmap do caminho ativo
- [REPO_SPLIT_PLAN.md](/c:/dev/local-ai-agent/REPO_SPLIT_PLAN.md): plano de split e registro da extracao
- [active/README.md](/c:/dev/local-ai-agent/active/README.md): entrada do caminho principal atual
- [AIBTC_WALLET_POLICY.md](/c:/dev/local-ai-agent/active/docs/AIBTC_WALLET_POLICY.md): politica operacional da wallet e criterios de decisao

## Trilhas Separadas

Fluxo principal do repositorio:

- [CODEX.md](/c:/dev/local-ai-agent/CODEX.md)
- [ROADMAP.md](/c:/dev/local-ai-agent/ROADMAP.md)

Fluxo separado do segundo agente `DOG MM Agent`:

- [DOG_MM_CODEX.md](/c:/dev/local-ai-agent/DOG_MM_CODEX.md)
- [DOG_MM_ROADMAP.md](/c:/dev/local-ai-agent/DOG_MM_ROADMAP.md)
- [AIBTC_DOG_MM_PHASE1_PACKAGE.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_PHASE1_PACKAGE.md)

Pesquisa separada para trilha futura `Deribit`:

- [active/docs/deribit/README.md](/c:/dev/local-ai-agent/active/docs/deribit/README.md)

Regra de navegacao:

- use `CODEX.md` para tudo que pertence ao `Speedy Indra`
- use `DOG_MM_CODEX.md` para tudo que pertence ao `DOG MM Agent`
- nao misture as duas trilhas na mesma execucao operacional

## Convencao de Janelas de Contexto

Cada conversa operacional deve ter um nome de janela/contexto explicito.

Regras:

- toda nova frente de trabalho deve ser nomeada antes de continuar
- uma janela trata apenas de um projeto/agente por vez
- se o assunto mudar de agente ou projeto, abra outra janela
- nao misture operacao do `Speedy Indra` com a trilha do `DOG MM Agent`
- o nome da janela deve aparecer logo no inicio da conversa operacional

Janela atual padrao do fluxo principal:

- `Speedy Indra`

## Estrutura Atual

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
    |   |-- AIBTC_DAILY_OPS_30S.md
    |   |-- AIBTC_DAILY_OPS_CHECKLIST.md
    |   |-- AIBTC_GENESIS_CLAIM_RUNBOOK.md
    |   |-- AIBTC_HEARTBEAT_RUNBOOK.md
    |   |-- AIBTC_MESSAGE_SIGNING_BRIDGE.md
    |   |-- AIBTC_AGENT_PROFILE_PREP.md
    |   |-- AIBTC_MCP_INSTALL.md
    |   |-- AIBTC_OPS_LOG_RUNBOOK.md
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
    |       |-- AIBTC_DOG_MM_AGENT_BLUEPRINT.md
    |       |-- AIBTC_DOG_MM_AGENT_IDENTITY.md
    |       |-- AIBTC_DOG_MM_AGENT_OPERATIONS.md
    |       |-- AIBTC_DOG_MM_PHASE1_DECISION.md
    |       |-- AIBTC_DOG_MM_PHASE1_PACKAGE.md
    |       |-- AIBTC_DOG_MM_PHASE1_PRETRADE_CHECKLIST.md
    |       |-- AIBTC_DOG_MM_PHASE1_RUNBOOK.md
    |       |-- AIBTC_DOG_MM_WALLET_AND_FUNDING_CHECKLIST.md
    |       `-- AIBTC_DOG_MM_WALLET_SETUP_RUNBOOK.md
    |-- scripts/
    |   |-- check-aibtc-mainnet-registry.ps1
    |   |-- watch-aibtc-mainnet-registry.ps1
    |   |-- get-next-aibtc-heartbeat-window.ps1
    |   |-- start-aibtc-ops.ps1
    |   |-- repair-aibtc-local-state.ps1
    |   |-- backup-aibtc-local-state.ps1
    |   |-- restore-aibtc-local-state.ps1
    |   |-- export-aibtc-ops-report.ps1
    |   |-- run-aibtc-daily-check.ps1
    |   |-- run-aibtc-maintenance-cycle.ps1
    |   |-- prune-aibtc-local-state.ps1
    |   |-- watch-aibtc-ops.ps1
    |   |-- show-aibtc-ops-status.ps1
    |   |-- show-aibtc-ops-alerts.ps1
    |   |-- show-aibtc-ops-report.ps1
    |   |-- show-aibtc-ops-log.ps1
    |   |-- watch-aibtc-heartbeat-ready.ps1
    |   |-- start-aibtc-register-helper.ps1
    |   `-- validate-aibtc-env.ps1
    |-- state/
    |   `-- README.md
    `-- templates/
        |-- claude-code/
        |   |-- mcp.aibtc.example.json
        |   `-- mcp.aibtc.mainnet.example.json
        |-- aibtc/
        |   |-- agent-profile.final-suggested.json
        |   |-- agent-profile.draft.json
        |   |-- agent-profile.example.json
        |   |-- agent-registration-payload.example.json
        |   |-- platform-register-request.example.json
        |   |-- platform-register-request.final-suggested.json
        |   `-- dog-mm/
        |       |-- README.md
        |       |-- dog-mm-agent-profile.suggested.json
        |       `-- dog-mm-phase1-log-entry.template.md
        `-- codex/
            `-- mcp.aibtc.example.toml
    `-- tools/
        |-- aibtc-ops-dashboard.html
        |-- aibtc-agent-console-snippets.js
        `-- leather-register-helper.html
```

## Como Seguir

1. leia [AIBTC_QUICKSTART.md](/c:/dev/local-ai-agent/active/docs/AIBTC_QUICKSTART.md)
2. siga [AIBTC_MCP_INSTALL.md](/c:/dev/local-ai-agent/active/docs/AIBTC_MCP_INSTALL.md)
3. revise [AIBTC_SECRETS_AND_CONFIG.md](/c:/dev/local-ai-agent/active/docs/AIBTC_SECRETS_AND_CONFIG.md)
4. prepare o registro futuro em [AIBTC_REGISTRATION_PREP.md](/c:/dev/local-ai-agent/active/docs/AIBTC_REGISTRATION_PREP.md)
5. defina o perfil publico em [AIBTC_AGENT_PROFILE_PREP.md](/c:/dev/local-ai-agent/active/docs/AIBTC_AGENT_PROFILE_PREP.md)
6. feche as decisoes pendentes em [AIBTC_AGENT_IDENTITY_CHECKLIST.md](/c:/dev/local-ai-agent/active/docs/AIBTC_AGENT_IDENTITY_CHECKLIST.md)
7. revise a ponte de assinatura em [AIBTC_MESSAGE_SIGNING_BRIDGE.md](/c:/dev/local-ai-agent/active/docs/AIBTC_MESSAGE_SIGNING_BRIDGE.md)
8. revise o fluxo de API publica em [AIBTC_PLATFORM_REGISTER.md](/c:/dev/local-ai-agent/active/docs/AIBTC_PLATFORM_REGISTER.md)
9. siga o runbook final em [AIBTC_REGISTER_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/AIBTC_REGISTER_RUNBOOK.md)
10. se estiver em Windows, leia [WINDOWS_CODEX_AIBTC_SETUP.md](/c:/dev/local-ai-agent/active/docs/WINDOWS_CODEX_AIBTC_SETUP.md)
11. preencha [SETUP_STATUS.md](/c:/dev/local-ai-agent/active/SETUP_STATUS.md)
12. rode `powershell -ExecutionPolicy Bypass -File active/scripts/validate-aibtc-env.ps1`

## Estado Atual

- caminho principal do produto: `GPT/Codex + AIBTC MCP`
- legado Python: extraido para repositorio separado por snapshot
- validacao local do workspace: script ativo funcionando
- `Codex CLI` instalado e validado com `codex.cmd --version`
- `codex.cmd login status` retorna `Logged in using ChatGPT`
- `@aibtc/mcp-server` configurado no Codex em `C:\Users\pedro\.codex\config.toml`
- `codex.cmd mcp list` confirmou `aibtc` como `enabled`
- `codex.cmd exec --skip-git-repo-check "What's your wallet address?"` confirmou o fluxo MCP com `status: no_wallet` em `mainnet`
- wallet dedicada validada em `mainnet`; registro on-chain segue bloqueado enquanto o registry principal nao existir em `mainnet`
- agente registrado via `POST /api/register`
- `displayName` atual: `Speedy Indra`
- `POST /api/claims/viral` concluido com sucesso
- `POST /api/heartbeat` validado com sucesso
- proximo passo real recorrente: manter `heartbeat` e acompanhar o registry on-chain
- dashboard local disponivel para heartbeat e monitoramento operacional confiavel
- historico local de operacao disponivel em `active/state/aibtc-ops-log.jsonl`
- resumo persistido da operacao disponivel em `active/state/aibtc-ops-summary.json`
- reparo local do resumo persistido disponivel em `active/scripts/repair-aibtc-local-state.ps1`
- backup local do estado operacional disponivel em `active/scripts/backup-aibtc-local-state.ps1`
- restauracao controlada do estado operacional disponivel em `active/scripts/restore-aibtc-local-state.ps1`
- exportacao de relatorio operacional disponivel em `active/scripts/export-aibtc-ops-report.ps1`
- leitura rapida do ultimo relatorio disponivel em `active/scripts/show-aibtc-ops-report.ps1`
- helper local expoe o ultimo relatorio em `GET /api/ops-report-latest`
- helper local agora registra exportacao de relatorio e manutencoes locais no estado consolidado
- scripts diretos de exportacao, reparo e retencao agora tambem registram eventos locais, mesmo fora do dashboard
- checklist operacional diario disponivel em `active/scripts/run-aibtc-daily-check.ps1`
- leitura rapida de alertas operacionais disponivel em `active/scripts/show-aibtc-ops-alerts.ps1`
- retencao local de logs e relatorios disponivel em `active/scripts/prune-aibtc-local-state.ps1`
- backups locais do estado agora tambem entram no estado consolidado e nas recomendacoes operacionais
- restauracoes locais tambem passam a entrar na trilha operacional persistida
- helper local agora tambem executa o daily check via `POST /api/run-daily-check`
- helper local agora tambem executa o ciclo completo de manutencao via `POST /api/run-maintenance-cycle`
- helper local agora consolida alertas operacionais no `ops-status`, incluindo heartbeat, snapshot do registry, relatorio e daily check
- helper local agora tambem informa a proxima acao recomendada no `ops-status`, reaproveitada por painel, terminal e relatorio
- o daily check agora fecha com auditoria de integridade por padrao
- ciclo completo de manutencao local disponivel em `active/scripts/run-aibtc-maintenance-cycle.ps1`
- janela local do proximo heartbeat disponivel via script PowerShell
- status operacional consolidado disponivel via script PowerShell
- monitoramento recorrente em terminal disponivel via script PowerShell
- monitoramento recorrente do registry com snapshot local disponivel via script PowerShell
- watch operacional do terminal agora chama scripts locais diretamente, sem subprocessos PowerShell desnecessarios
- checklist diario de operacao disponivel na documentacao
- bootstrap operacional local disponivel via script PowerShell
- helper local agora recicla instancias antigas do proprio servidor e valida `/api/health` antes de anunciar prontidao
- bootstrap operacional pode entrar direto em monitoramento continuo com `-Watch`
- bootstrap operacional pode entrar direto em monitoramento dedicado da janela do heartbeat com `-WatchHeartbeat`
- bootstrap operacional aquece o resumo persistido da operacao assim que o helper sobe

## Separacao de Agentes

Este repositorio possui duas trilhas documentais distintas:

- `Speedy Indra`: fluxo principal, ativo e operacional
- `DOG MM Agent`: fluxo separado, ainda em blueprint e preparacao

O que fica no fluxo principal:

- heartbeat
- registro AIBTC
- operacao recorrente
- helper local
- dashboard local
- baseline de yield em `Zest`

O que fica fora do fluxo principal:

- market making de `DOG`
- wallet do `DOG MM Agent`
- runbooks de fase 1 da pool `sBTC-DOG`
- futuras integracoes com `Kraken`, `Gate.io` e `MEXC`

## Trilha `DOG MM Agent`

A trilha `DOG MM Agent` esta separada do caminho principal.

Entrada exclusiva:

- [DOG_MM_CODEX.md](/c:/dev/local-ai-agent/DOG_MM_CODEX.md)

Pacote operacional da fase 1:

- [AIBTC_DOG_MM_PHASE1_PACKAGE.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_PHASE1_PACKAGE.md)

Essa trilha:

- nao muda o baseline atual de seguranca do `Speedy Indra`
- nao reutiliza wallet principal
- nao reutiliza wallet do agente atual
- nao substitui o fluxo principal `Codex + AIBTC MCP`
