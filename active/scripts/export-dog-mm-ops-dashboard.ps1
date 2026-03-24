param(
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$defaultOutputPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-ops-dashboard.html"
$resolvedOutputPath = if ($OutputPath) { $OutputPath } else { $defaultOutputPath }
$dir = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$resolvedOutputPath = if (Test-Path $dir) { Join-Path (Resolve-Path $dir).Path (Split-Path $resolvedOutputPath -Leaf) } else { $resolvedOutputPath }

$bundleScript = Join-Path $PSScriptRoot "export-dog-mm-ops-bundle.ps1"
$morningBriefScript = Join-Path $PSScriptRoot "export-dog-mm-morning-brief.ps1"
$bundlePath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-ops-bundle.json"
$morningBriefPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-morning-brief.md"

if (-not (Test-Path $bundlePath)) {
    $null = powershell -ExecutionPolicy Bypass -File $bundleScript
}

if (-not (Test-Path $morningBriefPath)) {
    $null = powershell -ExecutionPolicy Bypass -File $morningBriefScript
}

$bundle = Get-Content $bundlePath -Raw | ConvertFrom-Json

$html = @"
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DOG MM Agent Ops Dashboard</title>
  <style>
    :root {
      --bg: #f2efe7;
      --panel: #fffaf0;
      --ink: #1f1f1a;
      --muted: #5d5a50;
      --accent: #c2581b;
      --accent-2: #145f4a;
      --warn: #9c2f1f;
      --line: #d8cfbf;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(194,88,27,.12), transparent 30%),
        radial-gradient(circle at bottom right, rgba(20,95,74,.1), transparent 25%),
        var(--bg);
    }
    .wrap {
      max-width: 1180px;
      margin: 0 auto;
      padding: 32px 20px 56px;
    }
    .hero {
      border: 1px solid var(--line);
      background: linear-gradient(135deg, rgba(255,250,240,.96), rgba(244,236,220,.96));
      padding: 28px;
      border-radius: 20px;
      box-shadow: 0 18px 50px rgba(31,31,26,.08);
      margin-bottom: 22px;
    }
    .eyebrow {
      text-transform: uppercase;
      letter-spacing: .16em;
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 10px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: clamp(32px, 6vw, 56px);
      line-height: .95;
    }
    .lead {
      font-size: 18px;
      color: var(--muted);
      max-width: 760px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 16px;
    }
    .card {
      grid-column: span 4;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 18px;
      box-shadow: 0 10px 30px rgba(31,31,26,.05);
    }
    .card.wide { grid-column: span 6; }
    .card.full { grid-column: 1 / -1; }
    h2 {
      margin: 0 0 14px;
      font-size: 14px;
      letter-spacing: .1em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .big {
      font-size: 30px;
      font-weight: 700;
      margin: 0 0 6px;
    }
    .status-ok { color: var(--accent-2); }
    .status-blocked { color: var(--warn); }
    dl {
      margin: 0;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px 14px;
    }
    dt {
      color: var(--muted);
    }
    dd {
      margin: 0;
      font-weight: 700;
    }
    .pill {
      display: inline-block;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: rgba(194,88,27,.08);
      margin: 0 8px 8px 0;
      font-size: 14px;
    }
    .path {
      font-family: Consolas, "Courier New", monospace;
      font-size: 13px;
      word-break: break-all;
      color: var(--muted);
    }
    @media (max-width: 900px) {
      .card, .card.wide { grid-column: 1 / -1; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <div class="eyebrow">DOG MM Agent</div>
      <h1>Ops Dashboard</h1>
      <p class="lead">
        Trilha separada do Speedy Indra. Fase 0 em sBTC-USDCx e fase 1 em sBTC-DOG, ambas travadas pelo gate de wallet segregada.
      </p>
      <span class="pill">Generated: $($bundle.generatedAtUtc)</span>
      <span class="pill">Stage: $($bundle.stage)</span>
      <span class="pill">Next action: $($bundle.nextAction)</span>
    </section>

    <section class="grid">
      <article class="card">
        <h2>Wallet Gate</h2>
        <p class="big $(if ($bundle.status.wallet.validated -and $bundle.status.wallet.funded) { 'status-ok' } else { 'status-blocked' })">$($bundle.nextAction)</p>
        <dl>
          <dt>Created</dt><dd>$($bundle.status.wallet.created)</dd>
          <dt>Validated</dt><dd>$($bundle.status.wallet.validated)</dd>
          <dt>Funded</dt><dd>$($bundle.status.wallet.funded)</dd>
          <dt>Name</dt><dd>$($bundle.status.wallet.name)</dd>
        </dl>
      </article>

      <article class="card">
        <h2>HODLMM Status</h2>
        <p class="big $(if ($bundle.hodlmm.hodlmmDogPoolAvailable) { 'status-ok' } else { 'status-blocked' })">$($bundle.hodlmm.hodlmmDogPoolAvailable)</p>
        <dl>
          <dt>DOG pools</dt><dd>$($bundle.hodlmm.dogPoolCount)</dd>
          <dt>Checked</dt><dd>$($bundle.hodlmm.checkedAtUtc)</dd>
        </dl>
      </article>

      <article class="card">
        <h2>Phase 1 Market</h2>
        <p class="big">$($bundle.phase1.poolSnapshot.pool.tvlUsd) USD</p>
        <dl>
          <dt>Pool</dt><dd>$($bundle.phase1.poolSnapshot.pool.symbol)</dd>
          <dt>Friction</dt><dd>$($bundle.phase1.poolSnapshot.pool.estimatedEntryFrictionPct)%</dd>
          <dt>sBTC</dt><dd>$($bundle.phase1.poolSnapshot.tokens.sBTC.priceUsd)</dd>
          <dt>DOG</dt><dd>$($bundle.phase1.poolSnapshot.tokens.DOG.priceUsd)</dd>
        </dl>
      </article>

      <article class="card wide">
        <h2>Phase 0</h2>
        <dl>
          <dt>Selected pool</dt><dd>$($bundle.phase0.preflight.selectedPool)</dd>
          <dt>Bin step</dt><dd>$($bundle.phase0.preflight.selectedBinStep)</dd>
          <dt>Launch ready</dt><dd>$($bundle.phase0.preflight.readiness.phase0LaunchReady)</dd>
          <dt>Blocker</dt><dd>$($bundle.phase0.preflight.readiness.nextAction)</dd>
        </dl>
      </article>

      <article class="card wide">
        <h2>Phase 1</h2>
        <dl>
          <dt>Selected pool</dt><dd>$($bundle.phase1.preflight.selectedPool)</dd>
          <dt>Asset base</dt><dd>$($bundle.phase1.preflight.assetBase)</dd>
          <dt>Launch ready</dt><dd>$($bundle.phase1.preflight.readiness.phase1LaunchReady)</dd>
          <dt>Blocker</dt><dd>$($bundle.phase1.preflight.readiness.nextAction)</dd>
        </dl>
      </article>

      <article class="card full">
        <h2>Artifacts</h2>
        <p class="path">Bundle JSON: $(Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\\state\\dog-mm')).Path 'dog-mm-ops-bundle.json')</p>
        <p class="path">Bundle MD: $(Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\\state\\dog-mm')).Path 'dog-mm-ops-bundle.md')</p>
        <p class="path">Phase 0 Brief: $(Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\\state\\dog-mm')).Path 'dog-mm-phase0-execution-brief.md')</p>
        <p class="path">Phase 1 Brief: $(Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\\state\\dog-mm')).Path 'dog-mm-phase1-execution-brief.md')</p>
        <p class="path">Morning Brief: $(Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\\state\\dog-mm')).Path 'dog-mm-morning-brief.md')</p>
      </article>
    </section>
  </div>
</body>
</html>
"@

[System.IO.File]::WriteAllText($resolvedOutputPath, $html, [System.Text.Encoding]::UTF8)

Write-Host "DOG MM ops dashboard exported to: $resolvedOutputPath"
