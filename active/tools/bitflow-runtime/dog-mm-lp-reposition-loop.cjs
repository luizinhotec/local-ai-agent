#!/usr/bin/env node
'use strict';

// Loop de monitoramento: verifica a posição LP a cada 30 minutos.
// Se detectar out-of-range (status=dry_run), dispara reposicionamento com --broadcast.
//
// Logs:  active/state/dog-mm/lp-reposition-loop.log
// PID:   active/state/dog-mm/lp-reposition.pid

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const STATE_DIR         = path.resolve(__dirname, '..', '..', 'state', 'dog-mm');
const LOG_FILE          = path.resolve(STATE_DIR, 'lp-reposition-loop.log');
const PID_FILE          = path.resolve(STATE_DIR, 'lp-reposition.pid');
const REPOSITION_SCRIPT = path.resolve(__dirname, 'dog-mm-bitflow-lp-reposition.cjs');
const INTERVAL_MS       = 30 * 60 * 1000;

// ── I/O ────────────────────────────────────────────────────────────────────────

function logLine(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync(LOG_FILE, line); } catch (_) {}
}

// ── PID ────────────────────────────────────────────────────────────────────────

function checkStaleOrConflict() {
  if (!fs.existsSync(PID_FILE)) return;
  const existing = fs.readFileSync(PID_FILE, 'utf8').trim();
  try {
    process.kill(Number(existing), 0);
    console.error(`Outra instância já está rodando (PID ${existing}). Encerrando.`);
    process.exit(1);
  } catch (_) {
    logLine(`PID obsoleto (${existing}) encontrado. Sobrescrevendo.`);
  }
}

function writePid() {
  fs.writeFileSync(PID_FILE, String(process.pid));
}

function removePid() {
  try { fs.unlinkSync(PID_FILE); } catch (_) {}
}

// ── Script runner ──────────────────────────────────────────────────────────────

function runReposition(extraArgs = []) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn('node', [REPOSITION_SCRIPT, '--json-only', ...extraArgs], {
      env: process.env,
    });
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// ── Check cycle ────────────────────────────────────────────────────────────────

async function check() {
  logLine('--- Verificando posição LP...');

  const { code, stdout, stderr } = await runReposition();

  if (code !== 0) {
    logLine(`ERRO: script saiu com código ${code}. stderr=${stderr.trim().slice(0, 300)}`);
    return;
  }

  let result;
  try {
    result = JSON.parse(stdout.trim());
  } catch (_) {
    logLine(`ERRO: JSON inválido no stdout. stdout=${stdout.slice(0, 200)}`);
    return;
  }

  const { status, activeBinId, activeBinAtStart, entryBin, dlpBalance, dlpRemoved } = result;
  const bin = activeBinId ?? activeBinAtStart ?? 'n/a';
  const dlp = dlpBalance ?? dlpRemoved ?? 'n/a';
  logLine(`status=${status} | activeBin=${bin} | entryBin=${entryBin ?? 'n/a'} | dlp=${dlp}`);

  if (status === 'no_position') {
    logLine('Sem posição LP ativa. Nada a fazer.');
    return;
  }

  if (status === 'in_range') {
    logLine('Posição in-range. Nada a fazer.');
    return;
  }

  if (status === 'dry_run') {
    logLine('⚠️  OUT-OF-RANGE detectado. Reposicionando com --broadcast...');

    const bcast = await runReposition(['--broadcast']);

    if (bcast.code !== 0) {
      logLine(`ERRO no broadcast: código ${bcast.code}. stderr=${bcast.stderr.trim().slice(0, 300)}`);
      return;
    }

    let bcastResult;
    try {
      bcastResult = JSON.parse(bcast.stdout.trim());
    } catch (_) {
      logLine('ERRO: JSON inválido na resposta do broadcast.');
      return;
    }

    if (bcastResult.status === 'repositioned') {
      logLine(`✅ Reposicionamento OK. remove=${bcastResult.remove?.txid} | add=${bcastResult.add?.txid}`);
    } else {
      logLine(`Status inesperado após broadcast: ${bcastResult.status}`);
    }
    return;
  }

  logLine(`Status inesperado: ${status}`);
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

process.on('SIGTERM', () => { logLine('SIGTERM recebido. Encerrando.'); removePid(); process.exit(0); });
process.on('SIGINT',  () => { logLine('SIGINT recebido. Encerrando.');  removePid(); process.exit(0); });
process.on('uncaughtException', (e) => { logLine(`ERRO não capturado: ${e.message}`); });

// ── Main ───────────────────────────────────────────────────────────────────────

fs.mkdirSync(STATE_DIR, { recursive: true });
checkStaleOrConflict();
writePid();

logLine(`DOG-MM LP Reposition Loop iniciado (PID=${process.pid}). Intervalo=30min.`);

check().catch(e => logLine(`ERRO no check inicial: ${e.message}`));

setInterval(() => {
  check().catch(e => logLine(`ERRO no check: ${e.message}`));
}, INTERVAL_MS);
