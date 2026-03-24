# REPOSITORY_STRATEGY.md

## Objetivo

Este documento resume a estrategia recomendada para o futuro deste repositorio.

## Decisao

O ideal e separar em dois repositorios distintos:

- um repositorio principal para `GPT/Codex + AIBTC MCP`
- um repositorio legado para o agente Python antigo

## Por Que Separar

- reduzir ambiguidade
- evitar que o legado continue parecendo produto principal
- simplificar onboarding
- simplificar roadmap
- simplificar manutencao

## Referencia de Execucao

Para o plano concreto de split:

- [REPO_SPLIT_PLAN.md](/c:/dev/local-ai-agent/REPO_SPLIT_PLAN.md)

## Estado Atual

Depois do split:

- `active/` representa o caminho principal
- o legado Python foi removido deste repositorio principal
- o foco atual e `GPT/Codex + AIBTC MCP`
- `Bitflow` fica registrado apenas como trilha futura
