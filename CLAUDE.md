## Estado do sistema
Antes de qualquer modificação, verificar o estado atual dos bots:
- Os bots rodam no Linux em ~/projetos/local-ai-agent
- O estado real está nos arquivos: workspace/deribit/state/, active/state/dog-mm/, state/speedy-indra/
- O Orion monitora tudo e reporta via Telegram (@speedy_indra_alert_bot)
- Sempre fazer git pull antes de qualquer modificação
- Nunca commitar: .env, .env.local, .env.ps1, arquivos de state, PIDs, logs
