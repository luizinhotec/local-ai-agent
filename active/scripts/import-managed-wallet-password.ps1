param(
  [string]$WalletName = "agent-mainnet",
  [string]$CredentialTarget = ""
)

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

function Get-StoredGenericCredentialSecret {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Target
  )

  $credentialPtr = [IntPtr]::Zero
  $readOk = [WinCredentialManager]::CredRead($Target, 1, 0, [ref]$credentialPtr)
  if (-not $readOk) {
    return $null
  }

  try {
    $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($credentialPtr, [type][WinCredentialManager+CREDENTIAL])
    if ($credential.CredentialBlobSize -le 0 -or $credential.CredentialBlob -eq [IntPtr]::Zero) {
      return ""
    }
    return [Runtime.InteropServices.Marshal]::PtrToStringUni($credential.CredentialBlob, [Math]::Floor($credential.CredentialBlobSize / 2))
  } finally {
    if ($credentialPtr -ne [IntPtr]::Zero) {
      [WinCredentialManager]::CredFree($credentialPtr)
    }
  }
}

$target = if ($CredentialTarget) { $CredentialTarget } else { "local-ai-agent/managed-wallet/$WalletName" }
$secret = Get-StoredGenericCredentialSecret -Target $target

if ($null -eq $secret) {
  throw "credencial nao encontrada no Windows Credential Manager: $target"
}

$env:AIBTC_WALLET_PASSWORD = $secret
$env:DOG_MM_WALLET_PASSWORD = $secret
$env:AIBTC_WALLET_NAME = $WalletName
$env:DOG_MM_WALLET_NAME = $WalletName

Write-Host "Wallet gerenciada carregada na sessao atual: $WalletName" -ForegroundColor Green
