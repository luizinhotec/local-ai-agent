# config/README.md

## Objetivo

Esta pasta organiza convencoes locais de configuracao para o novo fluxo principal do repositorio:

- `Codex CLI`
- `AIBTC MCP`
- arquivos locais nao versionados

## Regra Principal

Arquivos com segredos ou configuracoes locais reais nao devem ser commitados.

Esta pasta deve conter apenas:

- documentacao
- exemplos
- templates sem credenciais
- configuracoes versionadas sem segredos que alimentem monitores locais

## Convencoes Recomendadas

Arquivos locais que voce pode criar fora do versionamento:

- `config/aibtc.local.json`
- `config/claude.local.json`
- `config/secrets.local.json`
- `.claude/mcp.local.json`
- `.env.local`

## O Que Vai em Cada Lugar

Use `templates/` para:

- exemplos versionados
- estrutura base de configuracao

Use `config/*.local.json` para:

- configuracao real local do seu ambiente
- caminhos do seu cliente
- parametros MCP que nao devem ir para o git

Use arquivos versionados especificos desta pasta para:

- baseline operacional sem segredos
- pisos de reserva
- politica de revisao consumida por scripts ou helper local

Use `~/.codex/` para:

- configuracao global do Codex
- estado local de autenticacao e MCP

## Relacao com o Legado Python

O arquivo `.env.example` atual ainda e do legado Python.

Ele nao deve ser tratado como fonte principal do novo fluxo AIBTC.

## Checklist Antes de Criar Arquivos Locais

- confirmar que o arquivo esta ignorado no git
- confirmar que nao existe mnemonic ou senha em texto aberto em arquivos versionados
- confirmar que o template de origem continua sem segredos
