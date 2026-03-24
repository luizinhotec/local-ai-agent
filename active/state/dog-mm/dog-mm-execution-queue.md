# DOG MM Execution Queue

Generated at UTC: 2026-03-17T02:56:07.8804742Z

## Current Gate

- next_action: phase0_and_phase1_gates_open

## Recommended Order

1. Start phase 0 session
2. Execute first shadow-training cycle in sBTC-USDCx
3. Fill phase 0 log completely
4. Review whether the training heuristic still holds
5. Only then consider deliberate phase 1 execution in sBTC-DOG

## Commands

- phase0_start: powershell -ExecutionPolicy Bypass -File active/scripts/start-dog-mm-phase0-session.ps1
- phase1_start: powershell -ExecutionPolicy Bypass -File active/scripts/start-dog-mm-phase1-session.ps1
- phase0_pack: powershell -ExecutionPolicy Bypass -File active/scripts/export-dog-mm-phase0-session-pack.ps1
- phase1_pack: powershell -ExecutionPolicy Bypass -File active/scripts/export-dog-mm-phase1-session-pack.ps1

