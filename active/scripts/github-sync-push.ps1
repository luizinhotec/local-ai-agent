param(
    [string]$Message,
    [switch]$DryRun
)

$ErrorActionPreference = "Continue"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..") | Select-Object -ExpandProperty Path
$logDir   = Join-Path $repoRoot "logs"
$logFile  = Join-Path $logDir "github-sync.log"

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}

function Write-SyncLog {
    param([string]$Line)
    $ts = [datetime]::UtcNow.ToString("yyyy-MM-dd HH:mm:ss UTC")
    $entry = "[$ts] $Line"
    Write-Host $entry
    Add-Content -Path $logFile -Value $entry
}

Set-Location $repoRoot

Write-SyncLog "github-sync-push: START (dry_run=$DryRun)"

# --- Allowed paths to stage (never state/, logs/, .env) ---
$allowedPaths = @(
    "active/docs",
    "active/scripts",
    "active/state/dog-mm/results*.json",
    "active/state/dog-mm/results-template.json",
    "*.md",
    "DOG_MM_ROADMAP.md",
    "package.json"
)

foreach ($path in $allowedPaths) {
    $expanded = Join-Path $repoRoot $path
    $gitPath  = $path -replace '\\', '/'

    $result = git add -- $gitPath 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-SyncLog "git add WARN ($gitPath): $result"
    } else {
        Write-SyncLog "git add OK: $gitPath"
    }
}

# Check if there is anything staged
$staged = git diff --cached --name-only 2>&1
if (-not $staged) {
    Write-SyncLog "nothing to commit - skipping push"
    exit 0
}

Write-SyncLog "staged files:`n$staged"

# Build commit message
$timestamp = [datetime]::UtcNow.ToString("yyyy-MM-dd HH:mm UTC")
$commitMsg = if ($Message) { $Message } else { "sync: auto-push $timestamp" }

if ($DryRun) {
    Write-SyncLog "DRY RUN - would commit: $commitMsg"
    Write-SyncLog "DRY RUN - would push origin main"
    exit 0
}

$commitOut = git commit -m $commitMsg 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-SyncLog "git commit FAILED: $commitOut"
    exit 1
}
Write-SyncLog "git commit OK: $commitMsg"

$pushOut = git push origin main 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-SyncLog "git push FAILED: $pushOut"
    exit 1
}
Write-SyncLog "git push OK - origin main"
Write-SyncLog "github-sync-push: END"
