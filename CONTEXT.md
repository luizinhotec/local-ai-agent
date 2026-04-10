# local-ai-agent — Contexto do Projeto

## Arquitetura
- ORION: supervisor central (runtime/orion/) — monitora bots, alerta Telegram, responde comandos
- speedy-indra: bot DeFi Stacks (runtime/speedy-indra/) — par sbtc-usdcx, heartbeat aibtc.com
- deribit-bot: bot de opções (workspace/deribit/) — BTC-PERPETUAL, produção ativa
- dog-mm: market maker (active/tools/bitflow-runtime/) — aguardando pool Bitflow DOG

## Infraestrutura
- Bots rodam no Linux: ~/projetos/local-ai-agent
- Desenvolvimento no Windows: C:\dev\local-ai-agent
- Sincronização via GitHub (cron hourly no Linux)
- Systemd: sudo systemctl restart local-ai-agent
- Start/Stop manual: bash runtime/start-all.sh / bash runtime/stop-all.sh

## Comandos úteis (Linux)
- Status geral: node runtime/orion/orion.cjs --once --dry-run
- Status speedy: node runtime/speedy-indra/agent-status.cjs
- Status deribit: node workspace/deribit/runtime/deribit-bot-summary.cjs
- Decisão deribit: node workspace/deribit/runtime/deribit-decision-preview.cjs
- Heartbeat manual: node active/tools/aibtc-heartbeat-cli.cjs
- DCA dry-run: node active/tools/bitflow-dca.cjs --dry-run
- DCA manual: node active/tools/bitflow-dca.cjs
- Logs: tail -f logs/orion.log / logs/deribit.log / logs/speedy-indra.log

## Arquivos sensíveis (não vão ao git)
- .env.local — credenciais Telegram, Deribit produção, DOG-MM wallet
- workspace/deribit/config/deribit.*.json — configs locais do Deribit
- state/ — estados de runtime dos bots

## Credenciais configuradas
- Telegram bot: @speedy_indra_alert_bot (chat ID: 5998650775)
- Deribit: produção ativa, equity ~$19, BTC-PERPETUAL
- aibtc heartbeat: wallet agent-mainnet, bc1q7maxug87p9ul7cl8yvmv6za8aqxfpfea0h6tc9
- DOG-MM wallet: SP1GNF1SGP89KT980XRTRMFKZG4H5P3CDS70Y4NRF

## Estado atual dos bots
- speedy-indra: OK, heartbeat funcionando, DRY_RUN_DEFAULT=false no .env
- deribit: PRODUÇÃO ativa, observando mercado, 0 trades executados
- dog-mm: bloqueado — Bitflow não suporta token pontis-bridge-DOG ainda
- orion: OK, Telegram funcionando, alertas ativos
- bitflow-dca: ATIVO, $5/dia → sBTC, cron 12:00 UTC, commit 385dc50
- dog-dca: aguardando pontis-bridge-DOG no Bitflow (contratos mapeados em bitflow-dca.cjs)

## Problemas conhecidos
- dog-mm: HTTP 400 Unsupported output token pontis-bridge-DOG (aguardar Bitflow)
- speedy-indra fee: feePerByte 1005 > limite 1000 (mercado congestionado)
- node path no systemd: resolvido com export PATH nvm em start-all.sh

## Fluxo de trabalho
1. Planejamos aqui (Claude.ai)
2. Claude Code executa no Windows (VS Code)
3. git push automático
4. Linux baixa via git pull (cron hourly ou manual)
5. sudo systemctl restart local-ai-agent
