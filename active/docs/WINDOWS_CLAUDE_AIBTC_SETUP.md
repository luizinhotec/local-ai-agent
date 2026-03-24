# WINDOWS_CLAUDE_AIBTC_SETUP.md

## Objetivo

Este guia adapta o novo fluxo principal do repositorio para um ambiente Windows com PowerShell.

Ele serve como complemento de:

- [AIBTC_QUICKSTART.md](/c:/dev/local-ai-agent/docs/AIBTC_QUICKSTART.md)
- [AIBTC_MCP_INSTALL.md](/c:/dev/local-ai-agent/docs/AIBTC_MCP_INSTALL.md)
- [AIBTC_SECRETS_AND_CONFIG.md](/c:/dev/local-ai-agent/docs/AIBTC_SECRETS_AND_CONFIG.md)

## Pre-Requisitos

Validar no PowerShell:

```powershell
node -v
npm -v
```

Se `Claude Code` estiver disponivel no terminal, valide tambem:

```powershell
claude --version
```

Se o PowerShell bloquear `claude.ps1`, use:

```powershell
claude.cmd --version
```

## Fluxo Recomendado no Windows

### 1. Entrar na pasta do repositorio

```powershell
cd c:\dev\local-ai-agent
```

### 2. Instalar o MCP da AIBTC

Comando oficial resumido pela AIBTC:

```powershell
npx @aibtc/mcp-server@latest --install
```

Se houver bloqueio por politica local, revise:

- permissao do `npm`
- PATH do `node`
- politicas do PowerShell

### 3. Preparar configuracao local

Use os templates do repositorio como base:

- [mcp.aibtc.example.json](/c:/dev/local-ai-agent/templates/claude-code/mcp.aibtc.example.json)
- [mcp.aibtc.mainnet.example.json](/c:/dev/local-ai-agent/templates/claude-code/mcp.aibtc.mainnet.example.json)

Convencoes locais sugeridas:

- `config/aibtc.local.json`
- `.claude/mcp.local.json`

### 4. Conferir arquivos ignorados

Antes de colocar qualquer configuracao real:

```powershell
git status
```

Confirme que arquivos locais sensiveis nao aparecem para commit.

### 5. Validar o cliente

Depois da instalacao:

- reinicie o cliente
- confirme se as tools da AIBTC aparecem
- confirme se o MCP foi carregado

### 6. Validar autenticacao do Claude Code

Verifique:

```powershell
claude.cmd auth status
```

Se `loggedIn` estiver `false`, execute:

```powershell
claude.cmd auth login
```

Sem esse login, o MCP pode aparecer como conectado, mas o fluxo real de prompts e wallet nao vai prosseguir.

## Problemas Comuns no Windows

### `npx` nao encontrado

Verifique:

```powershell
Get-Command node
Get-Command npm
Get-Command npx
```

### PowerShell com restricao de execucao

Se houver bloqueio de script:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
```

Use isso com cuidado e apenas para a sessao atual.

### Arquivos locais indo para o git

Revise:

```powershell
git status
Get-Content .gitignore
```

## Sequencia Pratica Recomendada

1. instalar o MCP
2. configurar arquivos locais
3. validar tools no cliente
4. revisar segredos e wallet
5. seguir para registro e operacao
