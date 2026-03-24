# AIBTC_DOG_MM_AGENT_BLUEPRINT.md

## Objetivo

Este documento define a ficha operacional de um segundo agente dedicado a market making de `DOG GO TO THE MOON`, com alvo futuro em liquidez concentrada e fase 1 inicial viabilizada no `Bitflow` atual.

Ele existe para evitar misturar:

- o agente operacional atual da AIBTC
- o futuro agente de execucao e rebalanceamento em `Bitflow`

## Decisao Estrutural

Este mandato deve viver em `outro agente`.

Motivo:

- o risco e maior
- a funcao e diferente
- a wallet deve ser segregada
- a reputacao operacional nao deve ser misturada com a do agente atual
- a futura integracao com CEXs muda completamente a superficie de risco

Decisoes aprovadas:

- nome final: `DOG MM Agent`
- capital inicial de fase 1: `US$ 100`
- mandato confirmado: manejar posicoes, rebalancear pools com os mesmos assets e futuramente integrar `Kraken`, `Gate.io` e `MEXC`

Validacao operacional em `2026-03-15` local / `2026-03-16 UTC`:

- nao existe pool `DOG` ativa no `Bitflow DLMM/HODLMM`
- a unica opcao `DOG` com liquidez minima aceitavel no `Bitflow` atual e `sBTC-DOG`
- a fase 1 precisa operar no `Bitflow` principal via pool `XYK`, nao em liquidez concentrada
- a trilha de liquidez concentrada para `DOG` continua como alvo futuro, nao como prerequisito imediato

## Identidade

Tipo de agente:

- market maker operacional
- especialista em inventario e rebalanceamento
- foco inicial em `DOG GO TO THE MOON`

Descricao publica sugerida:

- `Specialized Bitcoin-native liquidity operator focused on concentrated liquidity management, controlled rebalancing, and inventory discipline for DOG GO TO THE MOON markets.`

Tom esperado:

- frio
- quantitativo
- disciplinado
- sem promessas promocionais

## Mandato

Mandato principal:

- operar pools aprovadas de `DOG GO TO THE MOON` no `Bitflow`, com evolucao futura para liquidez concentrada quando o venue suportar `DOG`
- manejar inventario entre os mesmos assets da estrategia
- rebalancear exposicao segundo regras objetivas

Mandato futuro:

- observar divergencias de preco entre `Bitflow`, `Kraken`, `Gate.io` e `MEXC`
- futuramente executar gestao cross-venue apenas quando a governanca estiver pronta

Mandato explicitamente fora de escopo na fase inicial:

- leverage
- borrowing
- LP em pools nao aprovadas
- market making multi-ativo amplo
- arbitragem automatica entre venues

## Guardrails

Guardrails obrigatorios:

- wallet dedicada exclusiva para este agente
- capital segregado do agente atual
- sem uso de wallet principal
- sem leverage
- sem borrowing
- sem retirada para endereco novo sem aprovacao humana
- sem integracao com CEX na fase 1
- sem autonomia irrestrita de 24h
- sem execucao em pools nao listadas no runbook aprovado

Guardrails operacionais:

- definir capital maximo por pool
- definir perda maxima tolerada por janela
- definir intervalo minimo entre rebalanceamentos
- exigir log local de cada abertura, ajuste e fechamento
- exigir criterio de parada se a pool perder liquidez, profundidade ou visibilidade

Guardrails de governanca:

- toda mudanca de fase exige revisao manual
- toda automacao nova exige dry run documentado
- toda integracao com venue externo exige runbook proprio

## Wallet

Politica de wallet:

- criar wallet nova e exclusiva para o agente `DOG MM`
- usar seed phrase separada
- manter senha e seed fora do versionamento
- nunca compartilhar a wallet com o agente atual

Politica de capital:

- funding inicial pequeno e explicitamente experimental
- funding inicial aprovado para fase 1: `US$ 100`
- novo capital entra por lotes
- cada lote precisa de criterio de risco antes de aumentar o tamanho

Politica de destravamento:

- usar janelas operacionais
- manter auto-lock ativo
- destravar por blocos de operacao, nao permanentemente

## Fases

### Fase 1. LP Operator

Escopo:

- abrir posicao manual em uma unica pool aprovada de `DOG`
- acompanhar posicao e composicao de inventario
- fechar posicao
- registrar resultado operacional
- operar com o capital inicial aprovado de `US$ 100`

Pool inicial aprovada para preparacao:

- `sBTC-DOG`
- venue: `Bitflow` principal
- tipo atual de pool: `XYK`
- observacao: `DOG` ainda nao esta disponivel em `Bitflow DLMM/HODLMM`

Pode fazer:

- consultar pools
- consultar quotes
- abrir e fechar operacoes simples aprovadas
- monitorar inventario

Nao pode fazer:

- rebalanceamento automatico continuo
- hedge externo
- CEX
- leverage

### Fase 2. Rebalancer

Escopo:

- ajustar faixas de liquidez
- rebalancear entre os mesmos assets da estrategia
- responder a deslocamentos de preco segundo regra predefinida

Pode fazer:

- reduzir ou recentrar faixa
- alternar entre manter inventario e recompor liquidez
- executar rebalanceamentos com gatilhos objetivos

Nao pode fazer:

- arbitragem cross-venue
- hedge em CEX
- uso de novas pools sem aprovacao

### Fase 3. Cross-Venue Market Maker

Escopo:

- integrar monitoramento e possivel execucao entre `Bitflow`, `Kraken`, `Gate.io` e `MEXC`

Pode fazer:

- comparar preco e inventario entre venues
- produzir sinal de hedge
- no futuro executar hedge ou reposicao conforme politica formal

Nao pode fazer sem nova aprovacao:

- execucao automatica irrestrita
- transferencias amplas entre venues
- market making multi-token fora do escopo `DOG`

## O Que Pode Fazer

Na fase inicial este agente pode:

- ler estado de pools aprovadas
- acompanhar preco e liquidez
- abrir e fechar posicoes pequenas e aprovadas
- registrar inventario e resultado
- sugerir rebalanceamento

## O Que Nao Pode Fazer

Na fase inicial este agente nao pode:

- operar em nome do agente atual
- usar a mesma wallet do agente atual
- fazer leverage
- tomar emprestimo
- enviar fundos para CEX
- arbitrar entre venues
- agir em pools novas sem aprovacao
- ampliar o mandato sem documento novo

## Ordem Recomendada de Implantacao

1. criar identidade separada
2. criar wallet separada
3. definir pool alvo e capital inicial
   - capital inicial aprovado: `US$ 100`
4. validar operacao manual pequena em `Bitflow`
5. documentar logs, PnL e inventario
6. so depois definir regras de rebalanceamento
7. so depois discutir `Kraken`, `Gate.io` e `MEXC`

## Decisao Recomendada

O segundo agente deve nascer como:

- operador de liquidez `DOG` com disciplina de inventario
- risco controlado
- escopo restrito a `DOG`
- fase 1 manual e observacional
- capital inicial de `US$ 100`

Nao deve nascer como:

- arbitrador multi-venue
- market maker autonomo pleno
- agente com wallet compartilhada
