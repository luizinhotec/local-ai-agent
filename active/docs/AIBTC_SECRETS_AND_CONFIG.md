# AIBTC_SECRETS_AND_CONFIG.md

## Objetivo

Este documento organiza o checklist local de configuracao e segredos para o fluxo `GPT/Codex + AIBTC MCP`.

Ele existe para evitar dois problemas:

- colocar credenciais no repositorio
- misturar configuracoes do novo fluxo com o legado Python sem clareza

## Principios

- nada sensivel deve ser commitado
- prefira arquivos locais fora do versionamento
- documente o nome do segredo e o local de uso
- nunca documente valores reais no repositorio

## O Que Pode Existir Como Segredo

Dependendo do fluxo seguido, voce pode precisar armazenar localmente:

- senhas da wallet criada pelo MCP
- frases de recuperacao, quando exibidas
- tokens de cliente ou sessao, se algum fluxo externo exigir
- configuracoes locais do cliente MCP
- variaveis adicionais do ambiente operacional

## Regras Minimas

- a mnemonic da wallet deve ser registrada offline de forma segura
- a mnemonic nao deve ser salva em arquivos versionados
- senhas locais devem ficar fora do git
- qualquer arquivo de config local derivado dos templates deve ficar fora do versionamento

## Estrategia Recomendada

### 1. Usar templates versionados

Este repositorio inclui apenas templates:

- [mcp.aibtc.example.toml](/c:/dev/local-ai-agent/active/templates/codex/mcp.aibtc.example.toml)

### 2. Criar arquivos locais nao versionados

Exemplos de convencao local:

- `.codex/config.toml`
- `config/aibtc.local.json`
- `.env.local`

Observacao:

- o repositorio ja ignora `*.local.json` e `.env.local` em [.gitignore](/c:/dev/local-ai-agent/.gitignore)

### 2.1. Preferir o cofre local do Windows para senha da wallet

Para o fluxo principal do heartbeat:

- a senha da wallet pode ficar no `Windows Credential Manager`
- alvo padrao usado pelo wrapper local: `local-ai-agent/aibtc-heartbeat/leather`
- isso evita manter senha em arquivo local ou variavel persistente de shell
- a mnemonic continua fora do repositorio e deve permanecer como material de recovery, nao como dependencia do dia a dia

### 3. Separar o legado Python

O arquivo [.env.example](/c:/dev/local-ai-agent/.env.example) atual ainda pertence ao legado Python.

Nao trate esse arquivo como fonte principal do fluxo AIBTC.

## Checklist de Configuracao

Antes de operar:

- confirmar qual cliente MCP sera usado
- confirmar se o MCP da AIBTC ja esta instalado
- confirmar em qual rede o ambiente vai operar
- confirmar onde a wallet sera armazenada localmente
- confirmar onde senhas e mnemonics serao guardadas fora do repositorio
- confirmar que nada sensivel sera commitado

## Checklist de Revisao Antes de Commit

Sempre revisar:

- `git diff`
- `git status`
- arquivos `.json`, `.env`, `.local`, `.txt` e pastas ocultas

Perguntas obrigatorias:

- este arquivo contem senha?
- este arquivo contem mnemonic?
- este arquivo contem endereco ou identidade que nao deveria ser publica?
- este arquivo e realmente para versionar?

## Limite Deste Documento

Este documento nao substitui os passos oficiais da AIBTC para wallet e registro.

Ele apenas define guardrails locais para este repositorio.
