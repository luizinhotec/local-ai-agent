# Deribit Roadmap

## Objetivo

Este roadmap define a sequencia recomendada para sair de estudo e chegar a um agente funcional na `Deribit` sem pular etapas de seguranca.

## Principios

- comecar em `testnet`
- separar monitoramento de execucao
- ativar execucao real apenas apos shadow mode
- manter aprovacao humana antes de producao

## Fase 1: Observabilidade

Entregas:

- criar subconta dedicada
- criar API key read-only
- implementar cliente WebSocket com auth
- assinar canais de `ticker`, `book`, `user.portfolio`
- manter snapshot local de mercado e conta
- registrar logs tecnicos

Saida esperada:

- terminal ou CLI mostrando estado confiavel de mercado e conta

## Fase 2: Estado E Reconciliacao

Entregas:

- integrar `private/get_account_summary`
- integrar `private/get_position`
- integrar `private/get_open_orders`
- reconciliar ordens e trades com eventos privados
- persistir eventos e snapshots
- montar painel ou CLI de risco

Saida esperada:

- leitura confiavel de ordens, posicao, margem e PnL

## Fase 3: Execucao Em Testnet

Entregas:

- implementar `buy` e `sell`
- implementar `edit_by_label`
- implementar `cancel` e `cancel_all`
- implementar `close_position`
- padronizar `labels`
- ativar `kill switch`

Regras:

- ordens pequenas
- `post_only` por padrao
- `reduce_only` nas rotinas defensivas

Saida esperada:

- agente executando e reconciliando ordens pequenas em `testnet`

## Fase 4: Paper Trading Em Dados Reais

Entregas:

- rodar em `production` sem enviar ordens
- registrar sinais e decisoes
- medir latencia
- medir qualidade do snapshot
- validar limites de risco

Saida esperada:

- confirmacao de que a estrategia e a infraestrutura se comportam bem em mercado real

## Fase 5: Producao Guardada

Entregas:

- ativar execucao real com capital minimo
- limitar nocional por ordem
- limitar posicao agregada
- validar processo de desligamento seguro
- revisar logs e alertas diariamente

Saida esperada:

- agente real, mas com risco estreitamente controlado

## Entregas Tecnicas Recomendadas No Repositorio

Estrutura sugerida:

- `deribit/README.md`
- `deribit/API.md`
- `deribit/RISK.md`
- `deribit/ROADMAP.md`
- futura pasta de runtime para cliente e worker

## Decisoes Pendentes Antes De Codar

- tipo de estrategia
- capital por subconta
- perda maxima diaria
- posicao maxima
- instrumentos suportados
- primeira entrega: monitoramento ou execucao
