# Apresentação do Projeto: Local AI Agent

**Data:** Abril de 2026  
**Repositório:** `c:\dev\local-ai-agent`

---

## O que é este projeto?

Este é o workspace de operação de **agentes de IA autônomos** integrados ao ecossistema **AIBTC** — uma plataforma blockchain (Bitcoin + Stacks) que permite registrar e operar agentes de IA na mainnet.

O projeto usa o **Codex CLI (OpenAI)** como motor de raciocínio e o **AIBTC MCP** (Model Context Protocol) como interface com o protocolo blockchain.

---

## Agentes em operação

### 1. Speedy Indra (agente principal — ativo)

O agente registrado e operacional na mainnet AIBTC.

| Campo | Valor |
|---|---|
| Nome | Speedy Indra |
| Nível | 2 — Genesis |
| Rede | Bitcoin/Stacks mainnet |
| Status | Operacional |

**O que ele faz:**
- Mantém heartbeat periódico (sinal de vida na rede)
- Monitora e responde mensagens na plataforma AIBTC
- Executa operações em carteiras Bitcoin e Stacks
- Participa de DeFi (yield farming via Zest Protocol, swaps via Bitflow)
- Envia alertas e recebe comandos via Telegram

### 2. DOG MM Agent (em desenvolvimento)

Agente de **market-making** para o token DOG na DEX Bitflow, com carteira e trilha de desenvolvimento separadas do Speedy Indra.

### 3. Deribit (pesquisa / track futuro)

Framework de pesquisa para trading de derivativos na Deribit. Em fase de estudo, sem operação real ativa.

---

## Arquitetura resumida

```
local-ai-agent/
├── runtime/speedy-indra/     ← scripts de execução do agente principal
│   ├── agent-standard-loop   ← loop principal de decisão
│   ├── skill-messaging       ← mensagens AIBTC
│   ├── skill-wallet-actions  ← operações de carteira
│   └── skill-defi-simple     ← yield farming e swaps
├── active/
│   ├── scripts/              ← automação PowerShell
│   ├── tools/                ← CLI de heartbeat, dashboard, helper Python
│   ├── docs/                 ← runbooks operacionais (329 arquivos)
│   └── state/                ← histórico de operações (logs JSONL)
└── workspace/deribit/        ← track de pesquisa separado
```

**Stack:**
- Node.js (runtime principal, módulos .cjs)
- Python 3 (servidor auxiliar local — estado, dashboard, API proxy)
- PowerShell (automação e scripts operacionais)
- Blockchain: Bitcoin mainnet + Stacks mainnet

---

## Como executar

### Pré-requisitos

```bash
node --version        # Node.js instalado
npm --version         # npm disponível
codex.cmd --version   # Codex CLI autenticado
```

### Comandos principais

```bash
# Status do agente
npm run agent:status

# Heartbeat (manter agente vivo na rede)
npm run agent:heartbeat

# Loop padrão de operação (execução única)
npm run agent:loop:once

# Loop com intervalo de 60s (operação contínua)
npm run agent:loop:standard

# Verificar mensagens
npm run agent:messages

# Status da carteira
npm run agent:wallet:check

# Simulação DeFi sem executar (dry run)
npm run agent:defi:dryrun

# Monitoramento contínuo
npm run agent:monitor
```

### Servidor auxiliar (dashboard e API local)

```bash
python active/tools/register_helper_server.py
# Dashboard disponível em: http://localhost:8765
```

---

## Segredos e configuração

Os segredos **não ficam no repositório**. São gerenciados via:

- **Windows Credential Manager** (método preferido)
- Arquivo `.env.local` (local apenas, fora do versionamento)

Segredos necessários para operação:
- Seed phrase / chave privada das carteiras Bitcoin e Stacks
- Tokens de API: AIBTC, Hiro, Bitflow, Deribit
- Token do bot Telegram

Documentação detalhada: `active/docs/AIBTC_SECRETS_AND_CONFIG.md`

---

## Estado atual (março/abril 2026)

- Fase interna concluída
- Agente Speedy Indra registrado e operacional na mainnet
- Heartbeat validado, claims/viral confirmados
- Infraestrutura local consolidada: logs, backup, dashboard, auditoria
- DOG MM Agent em desenvolvimento ativo na trilha separada

---

## Políticas de segurança operacional

- Toda operação sensível exige aprovação manual (gates de execução)
- Modo dry-run disponível para todas as operações antes de executar de verdade
- Carteiras separadas por agente — sem mistura de fundos
- Sem alavancagem ou empréstimo na fase atual
- Alertas via Telegram para qualquer ação de risco
- Sistema de watchdog para detectar travamentos ou estado inválido

---

## Documentação disponível

O repositório possui mais de **329 arquivos de documentação** cobrindo:

- Quickstart e instalação (`active/docs/AIBTC_QUICKSTART.md`)
- Operação do agente (`active/docs/AIBTC_AGENT_OPERATIONS.md`)
- Política de carteiras (`active/docs/AIBTC_WALLET_POLICY.md`)
- Runbook de heartbeat (`active/docs/AIBTC_HEARTBEAT_RUNBOOK.md`)
- Setup completo Windows (`active/docs/WINDOWS_CODEX_AIBTC_SETUP.md`)
- Runbooks específicos do DOG MM Agent (`active/docs/dog-mm/`)

---

## Contato e próximos passos

Para avançar com o projeto ou tirar dúvidas operacionais, os documentos de referência são:

- `CODEX.md` — arquitetura e restrições do Speedy Indra
- `ROADMAP.md` — estado atual e próximas etapas
- `DOG_MM_CODEX.md` — trilha do segundo agente
