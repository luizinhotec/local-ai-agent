# WINDOWS_CODEX_AIBTC_SETUP.md

## Objetivo

Este guia adapta o fluxo principal do repositorio para um ambiente Windows com PowerShell usando `Codex CLI`.

Ele complementa:

- [AIBTC_QUICKSTART.md](/c:/dev/local-ai-agent/active/docs/AIBTC_QUICKSTART.md)
- [AIBTC_MCP_INSTALL.md](/c:/dev/local-ai-agent/active/docs/AIBTC_MCP_INSTALL.md)
- [AIBTC_SECRETS_AND_CONFIG.md](/c:/dev/local-ai-agent/active/docs/AIBTC_SECRETS_AND_CONFIG.md)

## Pre-Requisitos

Validar no PowerShell:

```powershell
node -v
npm -v
codex.cmd --version
```

## Fluxo Recomendado no Windows

### 1. Entrar na pasta do repositorio

```powershell
cd c:\dev\local-ai-agent
```

### 2. Validar login do Codex

```powershell
codex.cmd login status
```

Se ainda nao estiver autenticado:

```powershell
codex.cmd login
```

### 3. Validar MCP da AIBTC

```powershell
codex.cmd mcp list
codex.cmd mcp get aibtc
```

### 4. Conferir configuracao local

Config global atual do Codex:

- `C:\Users\pedro\.codex\config.toml`

Template versionado no repositorio:

- [mcp.aibtc.example.toml](/c:/dev/local-ai-agent/active/templates/codex/mcp.aibtc.example.toml)

### 5. Conferir arquivos ignorados

```powershell
git status
```

### 6. Validar o fluxo operacional

Depois do login e do MCP:

- confirmar que o MCP da AIBTC aparece como `enabled`
- seguir para wallet, registro e operacao

## Problemas Comuns no Windows

### `npm.ps1` bloqueado

Use o wrapper `.cmd`:

```powershell
npm.cmd install -g @openai/codex
```

### `codex.ps1` bloqueado

Use o wrapper `.cmd`:

```powershell
codex.cmd --version
```

### MCP nao aparece

Verifique:

```powershell
codex.cmd mcp list
Get-Content $env:USERPROFILE\.codex\config.toml
```
