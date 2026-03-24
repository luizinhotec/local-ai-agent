# AIBTC_MCP_INSTALL.md

## Objetivo

Este guia documenta a instalacao manual do MCP da AIBTC no fluxo alvo deste repositorio.

Referencias oficiais:

- https://aibtc.com/guide/mcp
- https://aibtc.com/llms.txt
- https://aibtc.com/install

Base oficial usada aqui:

- a AIBTC informa em `llms.txt` que o MCP pode ser instalado com `npx @aibtc/mcp-server@latest --install`
- a mesma referencia indica que o `--install` tenta detectar automaticamente o cliente MCP e configurar a integracao
- a pagina `aibtc.com/install` descreve o starter kit completo como opcao recomendada e separa o uso do MCP como bloco fundamental

Base local validada neste repositorio:

- `codex.cmd mcp add aibtc --env NETWORK=mainnet -- npx @aibtc/mcp-server@latest`
- `codex.cmd mcp list`
- `codex.cmd mcp get aibtc`

## Pre-Requisitos

Antes da instalacao:

- `Node.js 18+`
- `npm`
- um cliente MCP compativel
- `Codex CLI` instalado

Checklist rapido:

```powershell
node -v
npm -v
```

## Caminho Recomendado para Codex

### Opcao 1. Configurar diretamente no Codex

Comando validado neste ambiente:

```powershell
codex.cmd mcp add aibtc --env NETWORK=mainnet -- npx @aibtc/mcp-server@latest
```

Validacao:

```powershell
codex.cmd mcp list
codex.cmd mcp get aibtc
```

Resultado local ja confirmado:

- `aibtc` configurado como servidor MCP global do Codex
- configuracao persistida em `C:\Users\pedro\.codex\config.toml`
- `codex.cmd login status` retorna `Logged in using ChatGPT`

### Opcao 2. Instalacao automatica do MCP

Comando oficial resumido pela AIBTC:

```powershell
npx @aibtc/mcp-server@latest --install
```

Segundo o `llms.txt` da AIBTC, esse comando:

- instala a versao mais recente do MCP
- tenta detectar o cliente MCP
- tenta configurar o cliente automaticamente

Depois disso:

- reinicie a sessao do cliente
- confirme que as tools da AIBTC estao visiveis

Validacao local ja concluida neste ambiente:

- instalacao executada com sucesso anteriormente
- no caminho atual, a configuracao principal usada passou a ser a do Codex em `C:\Users\pedro\.codex\config.toml`
- network configurada localmente: `mainnet`

Validacao sugerida pela propria AIBTC:

- procure tools com `wallet`
- por exemplo, a referencia menciona buscar algo como `ToolSearch "+aibtc wallet"`

### Opcao 3. Configuracao manual

Se a instalacao automatica nao configurar o cliente corretamente, use um arquivo de configuracao MCP manual.

Template incluido no repositorio:

- [mcp.aibtc.example.toml](/c:/dev/local-ai-agent/active/templates/codex/mcp.aibtc.example.toml)

Exemplo compativel com o Codex:

```toml
[mcp_servers.aibtc]
command = "npx"
args = ["@aibtc/mcp-server@latest"]

[mcp_servers.aibtc.env]
NETWORK = "mainnet"
```

## Validacao Pos-Instalacao

Apos instalar:

1. reinicie o cliente MCP
2. confirme se as tools da AIBTC aparecem
3. confirme se as tools de wallet existem
4. so depois siga para wallet, registro e heartbeat

## Proximos Passos

Depois do MCP instalado:

1. consulte [AIBTC_SECRETS_AND_CONFIG.md](/c:/dev/local-ai-agent/active/docs/AIBTC_SECRETS_AND_CONFIG.md)
2. consulte [AIBTC_AGENT_OPERATIONS.md](/c:/dev/local-ai-agent/active/docs/AIBTC_AGENT_OPERATIONS.md)
3. siga o fluxo oficial da AIBTC para wallet, registro e heartbeat

## Atalho Alternativo

Se o objetivo for seguir o caminho mais automatizado, a AIBTC tambem expõe um starter kit em:

```bash
curl -fsSL aibtc.com/install | sh
```

Na pagina [aibtc.com/install](https://aibtc.com/install), a AIBTC descreve esse fluxo como um atalho que cuida de MCP, wallet, registro, heartbeat e loop autonomo.

Use esse caminho apenas se voce quiser seguir o bootstrap mais opinativo da propria AIBTC.
