const { spawnSync } = require('child_process');

let credentialLoadAttempted = false;
let credentialLoadResult = null;

function readSecretFromWindowsCredentialManager(target) {
  const script = `
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class WinCredentialManager
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL
    {
        public UInt32 Flags;
        public UInt32 Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public UInt32 CredentialBlobSize;
        public IntPtr CredentialBlob;
        public UInt32 Persist;
        public UInt32 AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredRead(string target, uint type, uint reservedFlag, out IntPtr credentialPtr);

    [DllImport("Advapi32.dll", EntryPoint = "CredFree", SetLastError = true)]
    public static extern void CredFree([In] IntPtr cred);
}
"@

$credentialPtr = [IntPtr]::Zero
$readOk = [WinCredentialManager]::CredRead("${target}", 1, 0, [ref]$credentialPtr)
if (-not $readOk) {
  exit 2
}

try {
  $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($credentialPtr, [type][WinCredentialManager+CREDENTIAL])
  if ($credential.CredentialBlobSize -le 0 -or $credential.CredentialBlob -eq [IntPtr]::Zero) {
    exit 3
  }
  [Runtime.InteropServices.Marshal]::PtrToStringUni($credential.CredentialBlob, [Math]::Floor($credential.CredentialBlobSize / 2))
} finally {
  if ($credentialPtr -ne [IntPtr]::Zero) {
    [WinCredentialManager]::CredFree($credentialPtr)
  }
}
`;

  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      encoding: 'utf8',
      windowsHide: true,
    }
  );

  if (result.status !== 0) {
    return null;
  }

  const secret = String(result.stdout || '').trim();
  return secret || null;
}

function ensureManagedWalletSession(options = {}) {
  if (credentialLoadAttempted) {
    return credentialLoadResult;
  }
  credentialLoadAttempted = true;

  if (process.platform !== 'win32') {
    // On Linux/macOS credentials come from .env / .env.local already loaded
    const password = process.env.AIBTC_WALLET_PASSWORD || process.env.DOG_MM_WALLET_PASSWORD;
    if (password) {
      credentialLoadResult = { ok: true, source: 'env_file' };
    } else {
      credentialLoadResult = { ok: false, reason: 'missing_env_credentials' };
    }
    return credentialLoadResult;
  }

  if (process.env.AIBTC_WALLET_PASSWORD || process.env.DOG_MM_WALLET_PASSWORD) {
    credentialLoadResult = { ok: true, source: 'existing_env' };
    return credentialLoadResult;
  }

  const walletName = String(
    options.walletName ||
    process.env.AIBTC_WALLET_NAME ||
    process.env.DOG_MM_WALLET_NAME ||
    'agent-mainnet'
  ).trim();
  const credentialTarget = String(
    options.credentialTarget ||
    process.env.AIBTC_WALLET_CREDENTIAL_TARGET ||
    `local-ai-agent/managed-wallet/${walletName}`
  ).trim();

  const secret = readSecretFromWindowsCredentialManager(credentialTarget);
  if (!secret) {
    credentialLoadResult = {
      ok: false,
      reason: 'credential_not_found',
      walletName,
      credentialTarget,
    };
    return credentialLoadResult;
  }

  process.env.AIBTC_WALLET_PASSWORD = secret;
  process.env.DOG_MM_WALLET_PASSWORD = secret;
  if (!process.env.AIBTC_WALLET_NAME) {
    process.env.AIBTC_WALLET_NAME = walletName;
  }
  if (!process.env.DOG_MM_WALLET_NAME) {
    process.env.DOG_MM_WALLET_NAME = walletName;
  }

  credentialLoadResult = {
    ok: true,
    source: 'windows_credential_manager',
    walletName,
    credentialTarget,
  };
  return credentialLoadResult;
}

module.exports = {
  ensureManagedWalletSession,
};
