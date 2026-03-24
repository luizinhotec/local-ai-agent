# SETUP_STATUS.md

## Objetivo

Este arquivo existe para acompanhar o progresso real de configuracao do ambiente local no novo fluxo do repositorio.

Atualize manualmente conforme for concluindo cada passo.

## Estado Atual

Data de criacao:

- 2026-03-13

Ultima revisao manual:

- 2026-03-15

Perfil de ambiente esperado:

- Windows
- PowerShell
- Codex CLI
- AIBTC MCP

## Checklist de Setup

- [x] Validar `node -v`
- [x] Validar `npm -v`
- [x] Validar `codex.cmd --version`
- [x] Ler `active/docs/AIBTC_QUICKSTART.md`
- [x] Ler `active/docs/AIBTC_MCP_INSTALL.md`
- [x] Ler `active/docs/AIBTC_SECRETS_AND_CONFIG.md`
- [x] Ler `active/docs/WINDOWS_CODEX_AIBTC_SETUP.md`
- [x] Executar `codex.cmd mcp add aibtc --env NETWORK=mainnet -- npx @aibtc/mcp-server@latest`
- [x] Validar criacao/uso de `C:\Users\pedro\.codex\config.toml`
- [x] Validar que o Codex reconhece `aibtc` em `codex.cmd mcp list`
- [x] Validar `codex.cmd login status`
- [ ] Confirmar que nenhum segredo aparece em `git status`
- [x] Revisar runbook em `active/docs/AIBTC_AGENT_OPERATIONS.md`
- [ ] Revisar o que do legado Python ainda sera usado

## Checklist de Seguranca

- [ ] Nenhuma mnemonic foi salva no repositorio
- [ ] Nenhuma senha foi salva em arquivo versionado
- [ ] Nenhum arquivo `.local.json` foi incluido no git
- [ ] Nenhuma configuracao sensivel do `Codex` foi copiada para o repositorio
- [ ] O armazenamento real de segredos esta fora do versionamento

## Checklist de Migracao do Legado

- [x] Revisar `c:\dev\local-ai-agent-python-legacy-snapshot\README.md`
- [x] Revisar `c:\dev\local-ai-agent-python-legacy-snapshot\legacy\docs\LEGACY_MIGRATION_CHECKLIST.md`
- [x] Decidir o que congelar como legado
- [x] Decidir o que reaproveitar como utilitario
- [ ] Evitar novas expansoes no agente Python sem justificativa ligada ao fluxo AIBTC

## Observacoes Locais

Use esta secao para anotar:

- bloqueios do ambiente
- caminhos locais usados
- arquivos locais criados
- diferencas entre sua maquina e a documentacao

Observacoes atuais:

- `node -v` validado em `v24.14.0`
- `npm.cmd -v` validado em `11.9.0`
- `npm -v` direto no PowerShell falha por `ExecutionPolicy`; usar `npm.cmd` para validacao local sem alterar a policy global
- `Codex CLI` instalado e validado com `codex.cmd --version`
- `codex.cmd login status` retorna `Logged in using ChatGPT`
- `@aibtc/mcp-server` configurado no Codex com sucesso
- config MCP detectada em `C:\Users\pedro\.codex\config.toml`
- network configurada localmente: `mainnet`
- `codex.cmd mcp list` confirmou `aibtc` como `enabled`
- `codex.cmd exec --skip-git-repo-check "What's your wallet address?"` executou com sucesso
- resposta do MCP: `status = no_wallet`
- esse passo inicial de wallet ja foi concluido e nao e mais o proximo gargalo operacional
- trilha futura identificada: `Bitflow`, sem alterar o baseline atual de seguranca
- wallet dedicada nova importada com sucesso em `mainnet`
- wallet dedicada destravada e pronta para transacoes
- wallet ativa confirmada: `11ecfa52-f8c1-4e8f-a305-dedc8fd8a427` (`SP1H35Z548R39KCMMNP9498QQ28SZFE07FB7Q3CBT`)
- rascunho local de payload preparado em `active/templates/aibtc/agent-registration-payload.draft.json`
- template de perfil publico preparado em `active/templates/aibtc/agent-profile.example.json`
- rascunho publico inicial preparado em `active/templates/aibtc/agent-profile.draft.json`
- checklist de identidade publica preparado em `active/docs/AIBTC_AGENT_IDENTITY_CHECKLIST.md`
- baseline minimo recomendado preparado em `active/templates/aibtc/agent-profile.final-suggested.json`
- fluxo de registro via API publica documentado em `active/docs/AIBTC_PLATFORM_REGISTER.md`
- ponte de assinatura via Leather documentada em `active/docs/AIBTC_MESSAGE_SIGNING_BRIDGE.md`
- runbook final de registro preparado em `active/docs/AIBTC_REGISTER_RUNBOOK.md`
- helper local criado em `active/tools/leather-register-helper.html`
- helper local atualizado com proxy para evitar erro de `failed to fetch`
- agente registrado com sucesso via `POST /api/register`
- `displayName`: `Speedy Indra`
- `claimCode`: armazenar fora do repositorio
- `sponsorApiKey`: armazenar fora do repositorio
- `POST /api/claims/viral` concluido com sucesso
- nivel atual confirmado: `2 - Genesis`
- `POST /api/heartbeat` validado com sucesso
- proximo passo recorrente: manter `heartbeat`
- monitor de registry on-chain preparado em `active/scripts/check-aibtc-mainnet-registry.ps1`
- dashboard operacional preparado em `active/tools/aibtc-ops-dashboard.html`
- dashboard operacional atualizado com refresh consolidado e janela do heartbeat
- dashboard operacional ajustado para usar proxies locais nas leituras da AIBTC
- historico local de operacao preparado em `active/state/aibtc-ops-log.jsonl`
- script de consulta de log preparado em `active/scripts/show-aibtc-ops-log.ps1`
- script de janela local do heartbeat preparado em `active/scripts/get-next-aibtc-heartbeat-window.ps1`
- script de status operacional consolidado preparado em `active/scripts/show-aibtc-ops-status.ps1`
- dashboard e snippets ajustados para exibir a proxima janela do heartbeat tambem em horario de Brasilia
- bootstrap local endurecido para reciclar helper antigo e validar saude antes de seguir
- `heartbeat_success` confirmado no log local apos validacao humana recorrente
- helper local consolidado como fonte unica de verdade operacional via `api/ops-status`
- relatorio operacional latest consolidado em `active/state/reports/aibtc-ops-report-latest.json`
- auditoria de integridade local validada sem divergencias
- ciclo completo de manutencao local validado em `active/scripts/run-aibtc-maintenance-cycle.ps1`
- registro on-chain segue bloqueado enquanto o registry de `mainnet` permanecer indisponivel
- `show-aibtc-ops-status.ps1 -Plain` validado em 2026-03-15 com `alertas: nenhum`
- estado operacional atual: `heartbeat liberado agora`
- ultimo heartbeat ok registrado localmente: `2026-03-14 15:50:09`
- ultimo snapshot do registry registrado localmente: `2026-03-15 00:25:22`
- baseline operacional de yield definido em 2026-03-15: `99953 suppliedShares` de `sBTC` no `Zest`, sem borrowing e com reserva liquida separada na wallet
- politica operacional da wallet documentada em `active/docs/AIBTC_WALLET_POLICY.md`
- baseline operacional de yield: sem borrowing, sem leverage e com reserva liquida intencional
- `git status` nao pode ser validado neste workspace porque `c:\dev\local-ai-agent` nao esta inicializado como repositorio Git
- legado Python revisado em `c:\dev\local-ai-agent-python-legacy-snapshot`
- decisao: `main.py`, `aibtc_agent/core`, `aibtc_agent/llm`, `aibtc_agent/memory` e `aibtc_agent/wallet` ficam congelados como legado
- decisao: `aibtc_agent/tools` e integracoes read-only antigas servem apenas como referencia conceitual; nao serao portadas automaticamente para o repositorio atual
- decisao: qualquer reaproveitamento futuro do legado deve acontecer apenas de forma seletiva, como utilitario isolado e alinhado ao fluxo `Codex + AIBTC MCP`
