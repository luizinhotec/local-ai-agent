# AIBTC_HERMETICA_CANDIDATE.md

## Objetivo

Registrar a due diligence operacional da `Hermetica hBTC` como candidata conservadora BTC-denominada para o `Speedy Indra`.

## Status Atual

Em `2026-03-17`:

- `Hermetica` foi adicionada como protocolo permitido na politica local
- a wallet principal esta liquida em `sBTC`
- nao houve migracao para `hBTC`

## Tese

`hBTC` e uma alternativa mais alinhada ao objetivo de retorno em BTC-equivalente do que migrar para `STX/stSTX`.

Pontos favoraveis:

- mantem exposicao em Bitcoin
- accrual diario e auto-composto
- docs oficiais descrevem fluxo com `sBTC` e `BTC`
- retirada permitida sem lockup fixo

## Riscos Relevantes

- dependencia do bridge `sBTC`
- dependencia operacional da propria `Hermetica`
- dependencia do `Zest` dentro da estrategia do vault
- cooldown de retirada
- risco de infraestrutura, governanca e estrategia

## Liquidez

Segundo a documentacao oficial:

- sem lockup fixo
- cooldown padrao de retirada: `72h`
- retirada expressa: `4h`, sujeita a fee e limite
- deposito alvo: `~30 min`
- retirada alvo: `~80 min`, alem do cooldown aplicavel

## O Que Ja Foi Validado

- a tese economica faz sentido como candidata melhor que deixar `sBTC` parado
- a documentacao oficial descreve o fluxo `sBTC -> hBTC`
- a politica local agora permite `Hermetica`

## O Que Ainda Nao Foi Fechado

- contrato exato de entrada no `hBTC` confirmado no workspace
- fluxo de execucao reproduzivel e testado no ambiente atual
- rotina local equivalente ao que ja existe para `Zest`
- validacao de entrada e saida ponta a ponta com tx monitoravel sem depender de UI manual nao documentada

## Regra Para Mover

So mover capital para `Hermetica` quando:

- o caminho tecnico de mint/deposit estiver claramente identificado
- o fluxo puder ser executado com wallet gerenciada de forma auditavel
- a saida/redeem estiver igualmente entendida
- o ganho esperado continuar superior ao custo e ao risco relativo de manter `sBTC` liquido

## Decisao Atual

`Hermetica` permanece como candidata prioritaria, mas ainda nao esta aprovada para execucao automatica imediata.

A posicao correta no momento continua sendo:

- manter `sBTC` liquido
- seguir investigando o caminho tecnico de entrada
- mover apenas quando a execucao estiver suficientemente solida
