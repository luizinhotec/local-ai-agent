# AIBTC_HEARTBEAT_RUNBOOK.md

## Objetivo

Este runbook cobre o heartbeat do agente ja registrado na AIBTC.

## Estado Atual

Em 2026-03-14, o agente ja foi registrado com sucesso:

- `displayName`: `Speedy Indra`
- `btcAddress`: `bc1q7maxug87p9ul7cl8yvmv6za8aqxfpfea0h6tc9`
- `stxAddress`: `SP1H35Z548R39KCMMNP9498QQ28SZFE07FB7Q3CBT`
- `level`: `2 - Genesis`

## Mensagem Oficial

A mensagem exata do heartbeat e:

`AIBTC Check-In | {ISO 8601 timestamp}`

Exemplo:

`AIBTC Check-In | 2026-03-14T03:50:00.000Z`

## Requisitos

- assinatura Bitcoin da mensagem acima
- `btcAddress`
- `timestamp`

Segundo a documentacao oficial, o heartbeat usa:

- `btc_sign_message`
- assinatura no formato esperado pela AIBTC
- intervalo minimo de 5 minutos entre check-ins

## Endpoint

- `POST https://aibtc.com/api/heartbeat`

## Payload

```json
{
  "signature": "<btc-signature>",
  "timestamp": "2026-03-14T03:50:00.000Z",
  "btcAddress": "bc1q7maxug87p9ul7cl8yvmv6za8aqxfpfea0h6tc9"
}
```

## Fluxo Operacional

1. gerar timestamp UTC atual em ISO 8601
2. assinar localmente:
   - `AIBTC Check-In | {timestamp}`
3. enviar o `POST /api/heartbeat`
4. conferir orientacao com:
   - `GET /api/heartbeat?address={btcAddress}`

## Observacoes

- timestamps fora da janela de 5 minutos falham
- mais de um heartbeat dentro de 5 minutos falha
- este passo deve ser executado a partir de um contexto de navegador aceito pela AIBTC

Atualizacao operacional local:

- o repositorio agora tambem possui uma CLI local para heartbeat via BIP-322
- a CLI aceita mnemonic via ambiente, mas o fluxo principal agora usa a wallet gerenciada em `~/.aibtc`
- o wrapper PowerShell integra com o `Windows Credential Manager`
- na primeira execucao real, se ainda nao existir credencial salva, o script pede a senha da wallet e grava no cofre local do Windows
- nas execucoes seguintes, o heartbeat pode rodar sem novo prompt de senha
- para execucao real, basta a senha da wallet; nao e mais obrigatorio fornecer mnemonic por variavel de ambiente
- a derivacao padrao do signer BTC local e `m/84'/0'/0'/0/0`
- a CLI exige que o endereco derivado bata com o `btcAddress` esperado antes de assinar

## Snippets

Use os snippets prontos em:

- [aibtc-agent-console-snippets.js](/c:/dev/local-ai-agent/active/tools/aibtc-agent-console-snippets.js)
- [aibtc-ops-dashboard.html](/c:/dev/local-ai-agent/active/tools/aibtc-ops-dashboard.html)

Atalho operacional no console:

```js
await AIBTC_AGENT.runHeartbeatCycle()
```

Refresh consolidado:

```js
await AIBTC_AGENT.refreshOperationalState()
```

Atalho visual:

- abra `http://127.0.0.1:8765/aibtc-ops-dashboard.html`
- use o botao `Rodar heartbeat`
- o card `Heartbeat` agora resume a proxima janela em texto direto:
  - `Liberado agora`
  - `Aguarde Xs`
  - horario de Brasilia quando disponivel
- o topo do dashboard agora mostra:
  - origem da janela (`AIBTC` ou `log local`)
  - estado simplificado do registry on-chain
  - ultima batida bem-sucedida quando existir no log local
- o card `Historico Local` agora resume os eventos recentes mais importantes em vez de depender so do JSON bruto
- o card `Status Operacional` agora mostra um resumo curto por padrao e deixa o JSON bruto atras de `Ver detalhes`
- os cards `Heartbeat`, `Claim Viral`, `Registry On-Chain` e `Historico Local` tambem deixam a saida crua atras de `Ver detalhes`
- `Claim Viral` e `Registry On-Chain` agora mantem resumos de sessao mais curtos no proprio card
- `Atualizar estado local` agora refresca tambem o historico local e o estado do registry em um unico clique
- o topo do dashboard agora mostra tambem a ultima atualizacao do painel em horario de Brasilia
- o topo do dashboard agora tambem mostra um selo curto de saude operacional
- o topo do dashboard agora tambem mostra um resumo consolidado curto, alinhado ao modo `-Plain` do terminal

Historico local:

- depois do heartbeat, consulte [AIBTC_OPS_LOG_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/AIBTC_OPS_LOG_RUNBOOK.md)
- rotina curta diaria em [AIBTC_DAILY_OPS_CHECKLIST.md](/c:/dev/local-ai-agent/active/docs/AIBTC_DAILY_OPS_CHECKLIST.md)
- o helper grava `heartbeat_success` e `heartbeat_attempt` em `active/state/aibtc-ops-log.jsonl`
- para inferir a proxima janela pelo log local, rode:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/get-next-aibtc-heartbeat-window.ps1
```

- para um resumo curto no terminal, rode:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-aibtc-ops-status.ps1 -Plain
```

- para consultar a janela remota sem assinar, rode:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/run-aibtc-heartbeat-local.ps1 -StatusOnly
```

- para preparar o payload sem postar, rode:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/run-aibtc-heartbeat-local.ps1 -DryRun
```

- para executar o heartbeat local via terminal com a wallet gerenciada, rode:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/run-aibtc-heartbeat-local.ps1
```

- o script tenta ler a senha do `Windows Credential Manager`
- se a credencial ainda nao existir, ele pede a senha da wallet em prompt seguro e salva automaticamente
- alvo padrao da credencial: `local-ai-agent/aibtc-heartbeat/leather`
- para nao persistir a senha naquela execucao, use:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/run-aibtc-heartbeat-local.ps1 -DoNotPersist
```

- para apagar a credencial salva e forcar novo prompt:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/run-aibtc-heartbeat-local.ps1 -ForgetStoredPassword
```

- se preferir, a senha pode ser passada no ambiente da sessao atual:

```powershell
$env:AIBTC_WALLET_PASSWORD = "<senha-da-wallet>"
powershell -ExecutionPolicy Bypass -File active/scripts/run-aibtc-heartbeat-local.ps1
```

- a mnemonic continua suportada apenas como fallback tecnico:

```powershell
$env:AIBTC_HEARTBEAT_MNEMONIC = "<mnemonic fora do repositorio>"
powershell -ExecutionPolicy Bypass -File active/scripts/run-aibtc-heartbeat-local.ps1
```

- para subir a camada local e ja entrar no watch do terminal, rode:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/start-aibtc-ops.ps1 -Watch
```

- para acompanhar so a janela do heartbeat com alerta sonoro quando liberar, rode:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/start-aibtc-ops.ps1 -WatchHeartbeat
```

- para reconstruir o resumo persistido e revalidar o estado local depois de qualquer instabilidade, rode:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/repair-aibtc-local-state.ps1 -ShowStatus
```

- para exportar um retrato atual da operacao para auditoria local, rode:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/export-aibtc-ops-report.ps1
```

- para consultar rapidamente o ultimo relatorio operacional local, rode:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-aibtc-ops-report.ps1 -Plain
```

- para rodar o checklist operacional diario em um unico comando, rode:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/run-aibtc-daily-check.ps1
```

- o resumo curto do terminal agora mostra tambem:
  - ultimo heartbeat bem-sucedido
  - ultimo evento local visto

Observacao operacional:

- o dashboard prioriza operacoes confiaveis
- leituras como `identity` e `verify` podem continuar falhando com `403/1010` dependendo da borda da AIBTC
- quando a leitura publica do heartbeat falhar, o dashboard tenta usar o historico local como fallback
- o dashboard e os snippets passam a mostrar a janela estimada tambem em horario de Brasilia
- o fluxo de `Rodar heartbeat` agora trata refresh de status, log local e registry como etapas auxiliares:
  - se a AIBTC aceitar o `POST /api/heartbeat`, o sucesso principal e preservado
  - se uma etapa auxiliar falhar depois, o dashboard deve mostrar aviso parcial em vez de mascarar o heartbeat como falha total
- o helper local agora expoe estado consolidado em `/api/ops-status`, usado como fonte principal para o topo do dashboard e para o resumo operacional do terminal
- o dashboard agora pode manter o estado vivo com `Auto-refresh`, reduzindo a necessidade de clicar em `Atualizar estado local`
- o estado consolidado tambem marca quando o heartbeat local ficou antigo
- o dashboard tambem consegue visualizar e exportar o ultimo relatorio operacional local sem sair da UI
- o dashboard agora tambem mostra um card proprio de alertas operacionais, alimentado pelo estado consolidado local
- o dashboard agora tambem permite gerar backup local do estado operacional pela area de manutencao
- o dashboard agora tambem permite restaurar o ultimo backup local pela area de manutencao
- exportacao de relatorio, reconstrucao local e retencao agora tambem geram eventos persistidos quando executadas direto pelo terminal
- para uma leitura rapida dos alertas no terminal, rode:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-aibtc-ops-alerts.ps1
```

## Fontes Oficiais

- https://aibtc.com/llms.txt
- https://aibtc.com/api/heartbeat
