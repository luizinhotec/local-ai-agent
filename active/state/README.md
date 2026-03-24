# State

Esta pasta guarda estado operacional local gerado pelo workspace principal.

Conteudo esperado:

- logs locais de operacao do agente
- resumo persistido da operacao e do ultimo heartbeat
- estado consolidado servivel pelo helper local a partir do resumo persistido
- snapshots publicos temporarios
- ultimo snapshot conhecido do registry on-chain
- relatorios operacionais exportados para auditoria local
- backups locais do estado operacional

Regras:

- nao salvar mnemonic
- nao salvar senhas
- nao salvar chaves privadas
- nao salvar assinaturas sensiveis sem necessidade
