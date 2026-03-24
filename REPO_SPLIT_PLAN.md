# REPO_SPLIT_PLAN.md

## Objetivo

Este documento define como separar o estado atual em dois repositorios distintos, reduzindo a ambiguidade entre:

- o caminho principal atual: `Claude Code + AIBTC MCP`
- o legado Python: agente proprio construido antes do pivot

## Decisao Recomendada

### Repositorio 1. Principal

Nome sugerido:

- `local-ai-agent-aibtc-workspace`

Objetivo:

- ser o repositorio principal do produto
- concentrar o fluxo `Claude Code + AIBTC MCP`
- conter setup, templates, scripts e runbooks

Este repositorio atual deve idealmente virar esse repositorio.

### Repositorio 2. Legado

Nome sugerido:

- `local-ai-agent-python-legacy`

Objetivo:

- preservar o agente Python como referencia tecnica
- manter historico, testes e implementacao antiga
- deixar claro que nao e mais o caminho principal do produto

## Recomendacao Sobre o Nome Atual

Recomendacao:

- manter o nome atual ou um nome parecido no repositorio principal
- extrair o legado Python para um novo repositorio separado

Motivo:

- o alvo atual do produto mudou
- o repositorio principal deve representar o caminho ativo, nao o legado

## Como Dividir os Arquivos

### Fica no repositorio principal

Arquivos e pastas:

- `README.md`
- `CODEX.md`
- `ROADMAP.md`
- `REPO_SPLIT_PLAN.md`
- `active/`

Tambem podem ficar:

- um `README` curto explicando onde o legado foi parar
- links para o repositorio legado

### Vai para o repositorio legado

Arquivos e pastas:

- `main.py`
- `requirements.txt`
- `.env.example`
- `aibtc_agent/`
- `tests/`
- `workspace/`, se fizer sentido como amostra
- `data/`, apenas se houver conteudo seguro e nao sensivel
- `legacy/`

Tambem deve receber:

- um `README.md` proprio
- um `CODEX.md` proprio, reduzido ao contexto do legado

## Estrutura Final Sugerida

### Repositorio principal

```text
local-ai-agent-aibtc-workspace/
|-- README.md
|-- CODEX.md
|-- ROADMAP.md
|-- REPO_SPLIT_PLAN.md
`-- active/
    |-- README.md
    |-- SETUP_STATUS.md
    |-- config/
    |   `-- README.md
    |-- docs/
    |   |-- AIBTC_QUICKSTART.md
    |   |-- AIBTC_MCP_INSTALL.md
    |   |-- AIBTC_SECRETS_AND_CONFIG.md
    |   |-- AIBTC_AGENT_OPERATIONS.md
    |   `-- WINDOWS_CLAUDE_AIBTC_SETUP.md
    |-- scripts/
    |   `-- validate-aibtc-env.ps1
    `-- templates/
        `-- claude-code/
            |-- mcp.aibtc.example.json
            `-- mcp.aibtc.mainnet.example.json
```

### Repositorio legado

```text
local-ai-agent-python-legacy/
|-- README.md
|-- CODEX.md
|-- main.py
|-- requirements.txt
|-- .env.example
|-- aibtc_agent/
|-- tests/
`-- legacy/
    |-- README.md
    `-- docs/
        |-- LEGACY_PYTHON_AGENT.md
        |-- LEGACY_MIGRATION_CHECKLIST.md
        `-- OPERATIONS.md
```

## Ordem de Execucao Recomendada

### Etapa 1. Congelar o estado atual

- confirmar que a documentacao atual esta consistente
- decidir se o split vai preservar historico git ou apenas snapshot

### Etapa 2. Criar o repositorio legado

- copiar ou extrair os arquivos do agente Python
- criar `README.md` explicando que o repositorio e legado
- ajustar links internos

### Etapa 3. Limpar o repositorio principal

- remover codigo Python legado do repositorio principal
- manter apenas a estrutura `active/` e documentos de governanca
- simplificar o `README.md`

### Etapa 4. Criar links cruzados

- no repositorio principal, linkar para o legado
- no legado, linkar para o repositorio principal

## Opcoes de Migracao

### Opcao A. Split por snapshot

Como funciona:

- copiar os arquivos para um novo repositorio
- iniciar o legado como snapshot do estado atual

Vantagens:

- simples
- rapido
- baixo risco operacional

Desvantagens:

- o historico git antigo nao fica limpo por projeto

### Opcao B. Split preservando historico

Como funciona:

- usar ferramentas de filtragem de historico para extrair pastas e arquivos

Vantagens:

- historico mais fiel em cada repositorio

Desvantagens:

- mais complexo
- mais facil errar
- exige mais cuidado com referencias antigas

## Recomendacao Pratica

Para este caso, a melhor escolha e:

- `Opcao A. Split por snapshot`

Motivo:

- o ponto principal agora e clareza futura
- a separacao de produto e mais importante que a pureza do historico
- o repositorio atual ja passou por um pivot forte, entao simplicidade vale mais

## Checklist de Split

- [ ] decidir o nome final do repositorio principal
- [ ] criar o repositorio legado
- [ ] copiar o codigo Python legado
- [ ] criar `README.md` do legado
- [ ] limpar o repositorio principal
- [ ] revisar links cruzados
- [ ] revisar `.gitignore` de cada lado
- [ ] validar se nenhum segredo foi movido

## Resultado Esperado

Depois do split:

- nao existira mais ambiguidade sobre o produto principal
- o legado Python continuara acessivel sem disputar a direcao do produto
- a documentacao de cada repositorio ficara muito mais simples

## Snapshot Ja Preparado

Um snapshot local do repositorio legado ja foi preparado em:

- `c:\dev\local-ai-agent-python-legacy-snapshot`

Status desse snapshot:

- arquivos principais copiados
- documentacao propria adicionada
- suite validada com `256` testes passando
