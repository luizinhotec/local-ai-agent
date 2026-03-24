# AIBTC_DOG_MM_PHASE1_PRETRADE_CHECKLIST.md

## Objetivo

Condensar a validacao final antes da primeira operacao manual do `DOG MM Agent`.

## Dados Fixos da Fase 1

- agente: `DOG MM Agent`
- pool: `sBTC-DOG`
- venue: `Bitflow`
- asset base: `sBTC`
- capital total autorizado: `US$ 100`
- capital maximo por operacao: `US$ 60`
- abertura inicial alvo: ate `US$ 50`

## Checklist de Separacao

- confirmar que a wallet ativa e exclusiva do `DOG MM Agent`
- confirmar que a wallet principal nao sera usada
- confirmar que a wallet do `Speedy Indra` nao sera usada
- confirmar que o funding e segregado e experimental

## Checklist de Mercado

- confirmar que a pool selecionada continua sendo `sBTC-DOG`
- confirmar que `pool_status = true`
- confirmar que o TVL continua acima de `US$ 5.000`
- confirmar que a friccao estimada de entrada nao supera `3%`
- rodar o preflight automatico da fase `1`
- exportar o brief de execucao da fase `1`
- confirmar que nao surgiu pool `DOG` melhor e explicitamente aprovada no runbook
- confirmar se a pool `DOG` em `HODLMM` ja foi lancada antes da execucao

## Checklist de Mandato

- confirmar que nao ha leverage
- confirmar que nao ha borrowing
- confirmar que nao ha CEX envolvida
- confirmar que a operacao continua limitada a uma unica pool
- confirmar que o objetivo e observacao operacional e nao escalada de capital

## Checklist de Execucao

- registrar preco atual de `sBTC`
- registrar preco atual de `DOG`
- registrar TVL observado da pool
- registrar capital que vai entrar
- registrar capital que vai permanecer em reserva
- abrir template de log antes da transacao

## Regra de Nao Execucao

Nao executar se qualquer item abaixo ocorrer:

- wallet errada ativa
- pool errada aberta
- TVL abaixo do limite
- friccao acima do limite
- necessidade de aumentar capital para fazer o teste
- necessidade de sair do mandato aprovado

## Apos Executar

- preencher o log operacional completo
- manter janela de observacao de `24h` a `72h`
- nao ajustar antes de `24h`, salvo evento de risco
