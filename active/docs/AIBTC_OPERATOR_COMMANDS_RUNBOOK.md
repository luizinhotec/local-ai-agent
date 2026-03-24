# AIBTC_OPERATOR_COMMANDS_RUNBOOK.md

## Objetivo

Este runbook existe para operar o agente por comandos curtos no chat com o Codex.

Use este documento como cola rapida para:

- consultar status
- operar wallet
- fazer `heartbeat`
- aplicar e retirar `sBTC`
- acompanhar transacoes

## Regra Basica

Sempre informe, quando fizer sentido:

- valor
- ativo: `BTC`, `sBTC` ou `STX`
- destino ou protocolo
- se quer apenas preparar ou executar

Frases uteis:

- `nao execute ainda, so prepare`
- `execute agora`
- `acompanhe ate confirmar`
- `bloqueie a wallet quando terminar`

## Agente

- `verifique o status do agente`
- `rode o heartbeat se estiver liberado`
- `mostre os alertas operacionais`
- `exporte o relatorio operacional`
- `rode o maintenance cycle`

## Wallet e Saldos

- `verifique meus saldos`
- `mostre o saldo de BTC, STX e sBTC`
- `confirme qual wallet esta ativa`
- `bloqueie a wallet agora`

## Yield Conservador

- `aplique 50000 sats de sBTC no Zest`
- `mostre minha posicao no Zest`
- `retire minha posicao do Zest`
- `prepare uma aplicacao conservadora com 100000 sats`
- `simule a estrategia mais conservadora com o saldo atual`

## Movimentacao

- `envie 10000 sats de sBTC para muneeb.btc`
- `resolva o destinatario muneeb.btc antes de enviar`
- `converta BTC para sBTC com 50000 sats`
- `me diga qual endereco usar para depositar BTC`

## Com Cuidado Extra

- `me de apenas a cotacao antes de fazer`
- `nao execute ainda, so prepare`
- `execute agora`
- `acompanhe a transacao ate confirmar`

## Exemplos Completos

- `verifique meus saldos e prepare uma aplicacao conservadora de 100000 sats`
- `aplique 50000 sats de sBTC no Zest e acompanhe ate confirmar`
- `retire toda minha posicao do Zest e confirme quando o saldo voltar para a wallet`
- `rode o heartbeat e depois me mostre o status operacional`
- `bloqueie a wallet quando terminar`

## Observacao

No estado atual do projeto:

- operacao de agente, wallet, `sBTC` e `Zest` pode ser feita por aqui
- a fase on-chain da identidade AIBTC em `mainnet` continua bloqueada externamente enquanto `networks.mainnet = null` no registry oficial
