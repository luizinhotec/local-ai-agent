# BLSM

## Skill

- **Nome:** `bitflow-liquidity-strategy-manager`
- **Objetivo:** expandir a skill de gestao de liquidez concentrada para suportar as estrategias pre-configuradas da Bitflow HODLMM: `spot`, `curve` e `bid_ask`.

## Objetivo Funcional

A skill deve permitir abrir, monitorar, comparar e manter posicoes LP usando diferentes distribuicoes de liquidez (`Spot`, `Curve`, `Bid-Ask`), buscando maximizar a geracao de taxas liquidas e controlar o custo de reposicionamento.

## Modos de Estrategia

- `strategy_shape=spot`
- `strategy_shape=curve`
- `strategy_shape=bid_ask`

## Capacidades

1. Ler pool e posicao atual.
2. Identificar a estrategia configurada.
3. Detectar se a posicao esta `in-range` ou `out-of-range`.
4. Calcular necessidade de `recenter`.
5. Simular `remove + reopen` mantendo o mesmo `shape`.
6. Comparar `shapes` em `dry-run`.
7. Estimar fees brutas, custos e retorno liquido.
8. Decidir entre `HOLD`, `WATCH`, `RECENTER` ou `BLOCK`.
9. Persistir telemetria por estrategia.

## Metricas

- `in_range_ratio`
- `active_liquidity_ratio`
- `rebalance_count`
- `estimated_fee_capture_usd`
- `estimated_recenter_cost_usd`
- `estimated_net_return_usd`
- `strategy_shape`
- `recommended_action`

## Regras

- `Spot` como baseline inicial.
- `Curve` como modo mais concentrado.
- `Bid-Ask` como modo avancado.
- Nao rebalancear apenas por pequeno movimento de preco.
- So executar se o beneficio liquido esperado superar o custo.
- Respeitar `cooldown` e limite diario.

## Arquitetura da Skill

### 1. Camadas

- **Pool Reader:** le estado da pool, preco atual, bins/faixas ativas, liquidez ativa e contexto necessario para decisao.
- **Position Reader:** le a posicao atual do usuario, composicao, range efetivo, shape configurado e telemetria acumulada.
- **Strategy Engine:** aplica a logica de `spot`, `curve` e `bid_ask` para avaliar distribuicao, concentracao e necessidade de recenter.
- **Recenter Simulator:** estima cenarios de `remove + reopen`, incluindo custos, nova faixa, nova distribuicao e retorno esperado.
- **Decision Engine:** transforma sinais em uma acao recomendada: `HOLD`, `WATCH`, `RECENTER` ou `BLOCK`.
- **Telemetry Store:** persiste estado, contadores, custos estimados e historico por estrategia.
- **Command Layer:** expoe comandos de `status-only`, `dry-run`, comparacao de estrategias e eventual execucao.

### 2. Fluxo

1. Ler pool e posicao.
2. Identificar `strategy_shape` atual.
3. Avaliar `in-range`, atividade e degradacao da eficiencia.
4. Simular manutencao da estrategia atual.
5. Opcionalmente comparar com outros `shapes`.
6. Estimar fees, custos e retorno liquido.
7. Aplicar regras de risco, `cooldown` e limite diario.
8. Emitir recomendacao e persistir telemetria.

### 3. Modulos sugeridos

- `pool_context`
- `position_state`
- `strategy_shapes`
- `recenter_policy`
- `simulator`
- `decision_policy`
- `telemetry`
- `commands`

## Schema de State

```json
{
  "version": 1,
  "pool_id": "string",
  "position_id": "string",
  "wallet_address": "string",
  "strategy_shape": "spot | curve | bid_ask",
  "status": {
    "is_in_range": true,
    "in_range_ratio": 0.0,
    "active_liquidity_ratio": 0.0,
    "recommended_action": "HOLD | WATCH | RECENTER | BLOCK",
    "reason_code": "string"
  },
  "pricing": {
    "current_price": 0.0,
    "reference_price": 0.0,
    "deviation_pct": 0.0
  },
  "economics": {
    "estimated_fee_capture_usd": 0.0,
    "estimated_recenter_cost_usd": 0.0,
    "estimated_net_return_usd": 0.0
  },
  "operations": {
    "rebalance_count": 0,
    "daily_rebalance_count": 0,
    "last_rebalance_at": "ISO-8601",
    "cooldown_until": "ISO-8601"
  },
  "limits": {
    "min_net_benefit_usd": 0.0,
    "max_daily_rebalances": 0,
    "min_price_move_pct": 0.0
  },
  "telemetry": {
    "shape_history": [],
    "action_history": [],
    "simulation_history": []
  }
}
```

## Suporte a `strategy_shape`

### `spot`

- Baseline inicial da skill.
- Distribuicao mais simples e previsivel.
- Usada como referencia para comparar custo/beneficio das demais.

### `curve`

- Modo mais concentrado.
- Prioriza maior captura de fees quando o preco permanece proximo da zona alvo.
- Tende a exigir mais cuidado com `out-of-range` e custo de reposicionamento.

### `bid_ask`

- Modo avancado.
- Permite uma distribuicao mais assimetrica ou orientada ao comportamento de compra/venda.
- Exige simulacao mais rigorosa antes de qualquer recenter.

## Comando `status-only`

Objetivo: inspecionar o estado atual sem propor mudanca operacional agressiva.

### Entrada esperada

```json
{
  "command": "status-only",
  "pool_id": "string",
  "position_id": "string"
}
```

### Saida esperada

```json
{
  "pool_id": "string",
  "position_id": "string",
  "strategy_shape": "spot",
  "is_in_range": true,
  "in_range_ratio": 0.91,
  "active_liquidity_ratio": 0.84,
  "estimated_fee_capture_usd": 12.4,
  "estimated_recenter_cost_usd": 3.1,
  "estimated_net_return_usd": 9.3,
  "recommended_action": "WATCH"
}
```

## Comando `dry-run`

Objetivo: simular `remove + reopen` mantendo o mesmo `shape`, sem executar.

### Entrada esperada

```json
{
  "command": "dry-run",
  "pool_id": "string",
  "position_id": "string",
  "strategy_shape": "curve"
}
```

### Saida esperada

```json
{
  "current_shape": "curve",
  "simulated_shape": "curve",
  "action": "RECENTER",
  "estimated_fee_capture_usd": 18.7,
  "estimated_recenter_cost_usd": 5.2,
  "estimated_net_return_usd": 13.5,
  "passes_cooldown": true,
  "passes_daily_limit": true,
  "should_execute": true
}
```

## Comparacao de Estrategias em JSON

Objetivo: comparar `spot`, `curve` e `bid_ask` em modo analitico, sem execucao.

```json
{
  "command": "compare-shapes",
  "pool_id": "string",
  "position_id": "string",
  "results": [
    {
      "strategy_shape": "spot",
      "estimated_fee_capture_usd": 10.2,
      "estimated_recenter_cost_usd": 2.4,
      "estimated_net_return_usd": 7.8,
      "recommended_action": "HOLD"
    },
    {
      "strategy_shape": "curve",
      "estimated_fee_capture_usd": 14.1,
      "estimated_recenter_cost_usd": 5.7,
      "estimated_net_return_usd": 8.4,
      "recommended_action": "WATCH"
    },
    {
      "strategy_shape": "bid_ask",
      "estimated_fee_capture_usd": 16.5,
      "estimated_recenter_cost_usd": 9.8,
      "estimated_net_return_usd": 6.7,
      "recommended_action": "BLOCK"
    }
  ],
  "best_shape_by_net_return": "curve"
}
```

## Logica de Decisao

- `HOLD`: posicao saudavel, `in-range`, sem ganho liquido relevante em reposicionar.
- `WATCH`: ha sinal de degradacao, mas ainda nao compensa agir.
- `RECENTER`: beneficio liquido esperado supera custo, sem violar `cooldown` ou limite diario.
- `BLOCK`: operacao impedida por risco, custo excessivo, baixa confianca ou regra de governanca.

## Politica Minima de Rebalance

- Exigir movimento minimo de preco antes de considerar recenter.
- Exigir `estimated_net_return_usd > 0`.
- Exigir folga sobre custo para evitar churn por ruido.
- Bloquear recenter se `cooldown_until` ainda nao expirou.
- Bloquear se `daily_rebalance_count >= max_daily_rebalances`.

## Telemetria por Estrategia

Persistir por `pool_id + position_id + strategy_shape`:

- snapshots de `in_range_ratio`
- snapshots de `active_liquidity_ratio`
- contagem de `rebalance_count`
- estimativas de fees, custo e retorno liquido
- historico de `recommended_action`
- timestamps de simulacoes e recenter executados

## Riscos e Limitacoes

- Estimativa de fees pode divergir do realizado por condicoes de mercado.
- `Curve` e `Bid-Ask` podem aumentar sensibilidade a movimentos rapidos de preco.
- Recenter frequente pode destruir retorno liquido mesmo com fee capture alta.
- A deteccao de `shape` atual depende da qualidade dos dados expostos pela Bitflow/HODLMM.
- Simulacoes `dry-run` nao garantem execucao futura no mesmo custo.
- Cooldown e limite diario precisam ser configurados por pool ou perfil de risco.
- Se a skill nao tiver acesso completo ao estado da pool, a recomendacao deve degradar para `WATCH` ou `BLOCK`.

## Entregaveis

1. Arquitetura da skill.
2. Schema de state.
3. Suporte a `strategy_shape`.
4. Comando `status-only`.
5. Comando `dry-run`.
6. Comparacao de estrategias em JSON.
7. Riscos e limitacoes.
