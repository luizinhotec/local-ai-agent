# ROADMAP.md

## Objetivo

Este roadmap cobre apenas o repositorio principal apos o split do legado Python.

Ele nao cobre a trilha separada do `DOG MM Agent`.

Para o segundo agente, use:

- [DOG_MM_CODEX.md](/c:/dev/local-ai-agent/DOG_MM_CODEX.md)
- [AIBTC_DOG_MM_PHASE1_PACKAGE.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_PHASE1_PACKAGE.md)

Alvo do repositorio:

- workspace para `GPT/Codex + AIBTC MCP`
- setup local
- templates
- scripts
- runbooks operacionais

## Estado Atual

Estado consolidado em 2026-03-14:

- fase interna concluida
- agente registrado e operacional
- `displayName`: `Speedy Indra`
- nivel atual: `2 - Genesis`
- `claims/viral` e `heartbeat` validados
- helper local, dashboard, logs, relatorio, backup, manutencao e auditoria consolidados
- suporte operacional local fechado para a fase atual

## Trilhas Ativas

### 1. Setup de Codex

Status:

- `concluido`

Ja existe:

- `codex.cmd --version` validado
- `codex.cmd login status` validado
- `codex.cmd exec --skip-git-repo-check "What's your wallet address?"` validado

### 2. Integracao com AIBTC MCP

Status:

- `concluido`

Ja existe:

- quickstart
- guia de instalacao
- templates MCP
- script de validacao local
- fluxo real validado com `Codex`

### 3. Seguranca e Configuracao Local

Status:

- `concluido para esta fase`

Ja existe:

- checklist de segredos
- convencoes locais de configuracao
- `SETUP_STATUS.md`

Falta:

- manter seed phrase e senhas fora do versionamento

### 4. Operacao no Fluxo AIBTC

Status:

- `concluido do lado interno`

Falta:

- manter `POST /api/heartbeat` operacional
- manter historico local e manutencao recorrente
- monitorar o registry on-chain
- registrar a identidade on-chain quando o registry de `mainnet` existir
- operar o fluxo real orientado pelos guias da AIBTC

Observacao:

- o gargalo principal deixou de ser tooling local
- o gargalo principal agora e operacao recorrente e dependencia externa do registry on-chain

### 5. Trilha Futura Bitflow do Fluxo Principal

Status:

- `planejado`

Escopo:

- avaliar automacoes nao custodiais alinhadas ao ecossistema AIBTC
- mapear fluxos futuros com assinatura explicita em wallet
- manter segregacao entre wallet principal e wallet do agente

Guardrails:

- nao usar fundos principais
- nao automatizar operacoes sensiveis sem aprovacao humana
- nao alterar o baseline de seguranca do repositorio para acomodar Bitflow

Observacao de separacao:

- market making de `DOG` nao pertence a esta secao
- a trilha do `DOG MM Agent` agora vive em documentacao propria

## Prioridades Atuais

1. manter `POST /api/heartbeat` operacional
2. manter historico local confiavel das operacoes recorrentes
3. manter rotina local de manutencao, backup, relatorio e auditoria
4. acompanhar a abertura do registry on-chain em `mainnet`
5. manter configuracao local segura sem expor credenciais
6. documentar criterios de entrada para a futura trilha Bitflow do fluxo principal
7. operar a wallet principal com politica explicita de risco, reserva e troca de estrategia

## Encerramento Desta Fase

A fase interna atual esta encerrada quando:

- `codex` estiver funcional no ambiente
- o MCP da AIBTC estiver instalado e visivel no cliente
- os templates locais tiverem sido convertidos em configuracao real fora do versionamento
- existir um fluxo validado de wallet, registro e operacao
- existir um fluxo validado de manutencao, backup, relatorio e auditoria local
- existir uma trilha futura documentada para Bitflow no fluxo principal sem reduzir os guardrails atuais

Esse estado ja foi atingido.
