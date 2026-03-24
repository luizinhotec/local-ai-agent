# AIBTC_QUICKSTART.md

## Objetivo

Este guia resume o caminho principal desejado para este repositorio apos o pivot arquitetural:

- usar `GPT/Codex` como base do agente
- conectar o `@aibtc/mcp-server`
- operar no fluxo recomendado pela AIBTC

Referencias oficiais:

- https://aibtc.com/guide/mcp
- https://aibtc.com/llms.txt

## O Que Este Repositorio Faz Agora

Este repositorio passa a servir como:

- workspace local para organizar setup e operacao
- documentacao de apoio
- templates de configuracao
- runbooks para o fluxo AIBTC

Este repositorio nao deve mais ser tratado como um framework proprio de agente.

## Pre-Requisitos

Antes de seguir:

- ter `Codex CLI` instalado e funcional
- ter `Node.js` e `npm` disponiveis no ambiente
- ter acesso aos guias da AIBTC
- ter um ambiente seguro para lidar com wallet e credenciais

## Fluxo Recomendado

### 1. Validar o ambiente local

Checklist:

- `node -v`
- `npm -v`
- `codex.cmd --version`

### 2. Configurar o MCP da AIBTC

Este repositorio inclui um template inicial em:

- [mcp.aibtc.example.toml](/c:/dev/local-ai-agent/active/templates/codex/mcp.aibtc.example.toml)

Ele mostra a estrutura minima de configuracao do Codex para plugar o `@aibtc/mcp-server`.

Importante:

- variaveis de ambiente
- credenciais
- parametros especificos de rede

devem seguir a documentacao oficial da AIBTC.

### 3. Usar o contexto oficial da AIBTC com o agente

O arquivo `https://aibtc.com/llms.txt` e uma referencia importante para instrucoes operacionais do ecossistema.

Diretriz:

- tratar esse material como fonte principal para orientar o comportamento do agente no ecossistema AIBTC

### 4. Preparar wallet e registro

O fluxo real de wallet, registro e heartbeat deve ser tratado como operacao guiada.

Use tambem:

- [AIBTC_AGENT_OPERATIONS.md](/c:/dev/local-ai-agent/active/docs/AIBTC_AGENT_OPERATIONS.md)

### 5. Manter o legado Python isolado

O legado Python foi extraido para um snapshot separado em:

- `c:\dev\local-ai-agent-python-legacy-snapshot`

## Estrutura Sugerida de Trabalho

Ordem pratica:

1. validar Codex
2. configurar MCP da AIBTC
3. revisar os guias oficiais
4. preparar wallet e operacao com seguranca
5. so depois decidir se algum utilitario Python local ainda ajuda

## O Que Nao Fazer

- nao continuar criando novas fases do agente Python sem checar alinhamento com a AIBTC
- nao inventar configuracoes sensiveis sem base na documentacao oficial
- nao tratar o legado Python como caminho principal do produto
