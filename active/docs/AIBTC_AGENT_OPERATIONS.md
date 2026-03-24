# AIBTC_AGENT_OPERATIONS.md

## Objetivo

Este documento organiza o fluxo operacional alvo do agente no ecossistema AIBTC.

Este documento cobre apenas o fluxo principal do `Speedy Indra`.

Ele nao cobre a trilha separada do `DOG MM Agent`.

Ele nao substitui a documentacao oficial. Ele serve para:

- transformar a documentacao da AIBTC em checklist operacional local
- deixar claro o que falta no repositorio
- evitar que o fluxo real fique escondido atras do legado Python

Referencias oficiais:

- https://aibtc.com/guide/mcp
- https://aibtc.com/llms.txt
- https://aibtc.com/api/claims/viral
- https://aibtc.com/api/heartbeat

## Fluxo Operacional Alvo

O fluxo desejado, em alto nivel, e:

1. preparar o ambiente do Codex
2. conectar o MCP da AIBTC
3. preparar wallet com seguranca
4. registrar o agente no ecossistema
5. validar heartbeat e estado operacional
6. acompanhar manutencao e diagnostico

## Checklist de Setup

- `Codex CLI` instalado
- `Node.js` e `npm` disponiveis
- MCP da AIBTC configurado
- login do Codex concluido
- acesso aos guias oficiais confirmado
- workspace local organizado

## Checklist de Wallet

Antes de qualquer etapa de wallet:

- validar se o ambiente e de teste ou producao
- registrar onde as credenciais ficam armazenadas
- garantir que nada sensivel sera commitado
- exigir aprovacao humana para qualquer acao critica
- usar wallet dedicada para o agente, separada da wallet principal

## Checklist de Registro do Agente

Perguntas que precisam estar respondidas antes da operacao:

- qual identidade do agente sera usada
- qual ambiente sera usado
- como o registro sera validado
- como o estado do agente sera acompanhado depois

Material de preparacao:

- [AIBTC_REGISTRATION_PREP.md](/c:/dev/local-ai-agent/active/docs/AIBTC_REGISTRATION_PREP.md)
- [AIBTC_PLATFORM_REGISTER.md](/c:/dev/local-ai-agent/active/docs/AIBTC_PLATFORM_REGISTER.md)

## Checklist de Heartbeat e Operacao

- confirmar que o agente esta visivel no ambiente esperado
- confirmar que os recursos do MCP estao disponiveis
- documentar sinais de falha
- documentar sinais de funcionamento normal

Runbooks operacionais:

- [AIBTC_GENESIS_CLAIM_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/AIBTC_GENESIS_CLAIM_RUNBOOK.md)
- [AIBTC_DAILY_OPS_30S.md](/c:/dev/local-ai-agent/active/docs/AIBTC_DAILY_OPS_30S.md)
- [AIBTC_WALLET_POLICY.md](/c:/dev/local-ai-agent/active/docs/AIBTC_WALLET_POLICY.md)
- [AIBTC_HEARTBEAT_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/AIBTC_HEARTBEAT_RUNBOOK.md)
- [AIBTC_OPS_LOG_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/AIBTC_OPS_LOG_RUNBOOK.md)
- [AIBTC_REGISTRY_MONITOR.md](/c:/dev/local-ai-agent/active/docs/AIBTC_REGISTRY_MONITOR.md)

Atalho operacional:

- [start-aibtc-ops.ps1](/c:/dev/local-ai-agent/active/scripts/start-aibtc-ops.ps1)
- [start-aibtc-register-helper.ps1](/c:/dev/local-ai-agent/active/scripts/start-aibtc-register-helper.ps1)
- [watch-aibtc-ops.ps1](/c:/dev/local-ai-agent/active/scripts/watch-aibtc-ops.ps1)
- [watch-aibtc-heartbeat-ready.ps1](/c:/dev/local-ai-agent/active/scripts/watch-aibtc-heartbeat-ready.ps1)
- [repair-aibtc-local-state.ps1](/c:/dev/local-ai-agent/active/scripts/repair-aibtc-local-state.ps1)
- [backup-aibtc-local-state.ps1](/c:/dev/local-ai-agent/active/scripts/backup-aibtc-local-state.ps1)
- [restore-aibtc-local-state.ps1](/c:/dev/local-ai-agent/active/scripts/restore-aibtc-local-state.ps1)
- [export-aibtc-ops-report.ps1](/c:/dev/local-ai-agent/active/scripts/export-aibtc-ops-report.ps1)
- [show-aibtc-ops-report.ps1](/c:/dev/local-ai-agent/active/scripts/show-aibtc-ops-report.ps1)
- [show-aibtc-ops-alerts.ps1](/c:/dev/local-ai-agent/active/scripts/show-aibtc-ops-alerts.ps1)
- [show-aibtc-position-status.ps1](/c:/dev/local-ai-agent/active/scripts/show-aibtc-position-status.ps1)
- [run-aibtc-heartbeat-local.ps1](/c:/dev/local-ai-agent/active/scripts/run-aibtc-heartbeat-local.ps1)
  - usa a wallet gerenciada `~/.aibtc` por padrao e integra com o `Windows Credential Manager` para reutilizar a senha local
- [run-aibtc-daily-check.ps1](/c:/dev/local-ai-agent/active/scripts/run-aibtc-daily-check.ps1)
- [run-aibtc-maintenance-cycle.ps1](/c:/dev/local-ai-agent/active/scripts/run-aibtc-maintenance-cycle.ps1)
- [prune-aibtc-local-state.ps1](/c:/dev/local-ai-agent/active/scripts/prune-aibtc-local-state.ps1)

Comportamento atual do bootstrap local:

- recicla a instancia antiga do helper quando ela mesma esta presa na porta configurada
- reutiliza o helper se ele ja estiver saudavel na porta configurada
- aceita `start-aibtc-register-helper.ps1 -ForceRestart` para recarregar codigo local sem matar processo manualmente
- valida a saude do helper antes de anunciar que a camada local esta pronta
- destaca o dashboard como URL principal de operacao
- pode entrar direto em monitoramento continuo com `start-aibtc-ops.ps1 -Watch`
- o watch operacional usa scripts locais diretamente, reduzindo fragilidade de subprocessos PowerShell
- o bootstrap operacional aquece o estado consolidado em `/api/ops-status` assim que o helper sobe
- o diagnostico do ultimo heartbeat passa a ficar disponivel no terminal e no dashboard sem depender apenas do log cru
- o helper local agora expoe estado consolidado em `/api/ops-status`, reduzindo divergencia entre dashboard e terminal
- o estado consolidado agora tambem informa frescor do heartbeat e do snapshot do registry
- o bootstrap pode abrir um monitor dedicado da janela do heartbeat com `start-aibtc-ops.ps1 -WatchHeartbeat`
- o helper local tambem consegue reconstruir o resumo consolidado a partir do log via `repair-aibtc-local-state.ps1`
- o estado operacional atual tambem pode ser exportado em relatorio com `export-aibtc-ops-report.ps1`
- o ultimo relatorio operacional local tambem pode ser consultado direto pelo terminal com `show-aibtc-ops-report.ps1`
- o helper local expoe o ultimo relatorio via `/api/ops-report-latest` e consegue exportar um novo via `/api/export-ops-report`
- exportacoes de relatorio agora viram eventos locais persistidos e aparecem no estado consolidado
- a rotina diaria pode ser concentrada em `run-aibtc-daily-check.ps1`
- o helper local tambem consegue executar a rotina diaria via `/api/run-daily-check`
- o helper local tambem consegue executar o ciclo completo de manutencao via `/api/run-maintenance-cycle`
- a retencao local de logs e relatorios pode ser controlada com `prune-aibtc-local-state.ps1`
- reparo e retencao locais agora tambem viram eventos persistidos e alimentam o resumo operacional do helper
- os scripts diretos de exportacao, reparo e retencao agora registram esses eventos mesmo quando executados pelo terminal, sem depender do dashboard
- o daily check agora tambem vira evento persistido e entra no estado consolidado local
- o daily check agora fecha com auditoria de integridade por padrao
- o estado consolidado agora tambem computa alertas operacionais e o dashboard exibe esses alertas em card proprio
- o estado consolidado agora tambem aponta a proxima acao recomendada, reduzindo ambiguidade no uso diario
- o estado consolidado agora tambem acompanha backup local do estado operacional e pode alertar quando esse backup estiver ausente ou antigo
- restauracao controlada do estado local agora tambem faz parte da camada operacional do helper e do dashboard
- o estado consolidado agora tambem acompanha o ultimo ciclo completo de manutencao local
- o helper local agora tambem acompanha um monitor minimo de posicao do `Speedy Indra`
- o monitor de posicao usa saldos publicos via `Hiro` para `sBTC` livre e `STX` de gas
- o baseline e os pisos locais ficam em [speedy-indra-position-monitor.json](/c:/dev/local-ai-agent/active/config/speedy-indra-position-monitor.json)
- a politica operacional da wallet fica em [AIBTC_WALLET_POLICY.md](/c:/dev/local-ai-agent/active/docs/AIBTC_WALLET_POLICY.md) e os thresholds consumidos pelo helper ficam no config local do monitor
- a confirmacao de `suppliedShares`, `borrowed` e `healthFactor` ainda e tratada como confirmacao local, nao como leitura automatica on-chain no helper

## Diagnostico

Sempre registrar:

- qual configuracao MCP foi usada
- qual ambiente estava ativo
- qual carteira ou identidade foi usada
- qual passo falhou
- qual documento oficial embasou a operacao

## Proximas Entregas Desejadas Neste Repositorio

- guia pratico de setup do Codex
- guia pratico de setup do `@aibtc/mcp-server`
- templates versionados sem credenciais
- area clara para segredos fora do versionamento
- runbooks detalhados por etapa do fluxo AIBTC
- trilha futura documentada para automacoes Bitflow sem custodia

## Estado Ja Validado Neste Ambiente

- `codex.cmd --version` ok
- `codex.cmd login status` retornando `Logged in using ChatGPT`
- `codex.cmd mcp list` retornando `aibtc` como `enabled`
- `codex.cmd exec --skip-git-repo-check "What's your wallet address?"` executado com sucesso
- MCP retornando `status: no_wallet` em `mainnet`
- wallet dedicada criada, importada e destravada em `mainnet`
- agente registrado via API publica com `displayName = Speedy Indra`
- `claims/viral` concluido com sucesso
- nivel atual validado: `2 - Genesis`
- `heartbeat` concluido com sucesso
- proximo passo recorrente: `heartbeat`
- historico local de operacao preparado para diagnostico rapido
- baseline de yield conservador validado no `Zest`: posicao aberta em `sBTC` com reserva liquida separada na wallet
- baseline atual de yield: `99953 suppliedShares` no `Zest`, `0` borrowed e reserva liquida local separada na wallet
- reserva minima local do monitor de posicao: `5000 sats` livres de `sBTC` e `5 STX` para gas
- registro on-chain em `mainnet` segue bloqueado pela ausencia do registry principal

## Trilha Futura Bitflow

Bitflow entra neste repositorio apenas como trilha futura de operacao e automacao nao custodial.

No estado atual:

- nao muda o fluxo principal `Codex + AIBTC MCP`
- nao reduz a exigencia de aprovacao humana para acoes sensiveis
- nao autoriza uso de wallet principal
- nao elimina a necessidade de wallet dedicada do agente

Separacao:

- market making de `DOG` foi movido para [DOG_MM_CODEX.md](/c:/dev/local-ai-agent/DOG_MM_CODEX.md)
- a fase 1 do `DOG MM Agent` foi movida para [AIBTC_DOG_MM_PHASE1_PACKAGE.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_PHASE1_PACKAGE.md)
