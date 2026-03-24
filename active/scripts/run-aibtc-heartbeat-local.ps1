param(
  [switch]$StatusOnly,
  [switch]$DryRun,
  [switch]$Force,
  [string]$WalletName = "leather",
  [string]$CredentialTarget = "",
  [switch]$DoNotPersist,
  [switch]$ForgetStoredPassword
)

$ErrorActionPreference = "Stop"

$helperScript = Join-Path $PSScriptRoot "start-aibtc-register-helper.ps1"
$cliPath = Join-Path $PSScriptRoot "..\tools\aibtc-heartbeat-cli.cjs"
$defaultCredentialTarget = if ($CredentialTarget) { $CredentialTarget } else { "local-ai-agent/aibtc-heartbeat/$WalletName" }

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

    [DllImport("Advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredWrite([In] ref CREDENTIAL userCredential, uint flags);

    [DllImport("Advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredDelete(string target, uint type, uint flags);

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

function Set-StoredGenericCredentialSecret {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Target,
    [Parameter(Mandatory = $true)]
    [string]$Secret,
    [string]$UserName = "aibtc-wallet"
  )

  $credential = New-Object WinCredentialManager+CREDENTIAL
  $credential.Type = 1
  $credential.TargetName = $Target
  $credential.UserName = $UserName
  $credential.Persist = 2
  $credential.CredentialBlobSize = [Text.Encoding]::Unicode.GetByteCount($Secret)
  $credential.CredentialBlob = [Runtime.InteropServices.Marshal]::StringToCoTaskMemUni($Secret)

  try {
    $writeOk = [WinCredentialManager]::CredWrite([ref]$credential, 0)
    if (-not $writeOk) {
      throw "falha ao gravar credencial no Windows Credential Manager"
    }
  } finally {
    if ($credential.CredentialBlob -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeCoTaskMemUnicode($credential.CredentialBlob)
    }
  }
}

function Remove-StoredGenericCredentialSecret {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Target
  )

  $deleteOk = [WinCredentialManager]::CredDelete($Target, 1, 0)
  if (-not $deleteOk) {
    $lastError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($lastError -ne 1168) {
      throw "falha ao remover credencial do Windows Credential Manager (Win32=$lastError)"
    }
  }
}

powershell -ExecutionPolicy Bypass -File $helperScript | Out-Null

$argsList = @($cliPath)
if ($StatusOnly) { $argsList += "--status-only" }
if ($DryRun) { $argsList += "--dry-run" }
if ($Force) { $argsList += "--force" }
$argsList += "--wallet-name=$WalletName"

$shouldSign = -not $StatusOnly
$hadWalletPassword = [bool]$env:AIBTC_WALLET_PASSWORD
$hadMnemonic = [bool]($env:AIBTC_HEARTBEAT_MNEMONIC -or $env:CLIENT_MNEMONIC)
$usingPromptedPassword = $false
$storedSecret = $null

if ($ForgetStoredPassword) {
  Remove-StoredGenericCredentialSecret -Target $defaultCredentialTarget
}

if ($shouldSign -and $hadWalletPassword -and -not $hadMnemonic -and -not $DoNotPersist) {
  $storedSecret = Get-StoredGenericCredentialSecret -Target $defaultCredentialTarget
  if (-not $storedSecret) {
    Set-StoredGenericCredentialSecret -Target $defaultCredentialTarget -Secret $env:AIBTC_WALLET_PASSWORD -UserName $WalletName
  }
}

if ($shouldSign -and -not $hadWalletPassword -and -not $hadMnemonic) {
  $storedSecret = Get-StoredGenericCredentialSecret -Target $defaultCredentialTarget
  if ($storedSecret) {
    $env:AIBTC_WALLET_PASSWORD = $storedSecret
  } else {
    $secure = Read-Host "Senha da wallet gerenciada" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
      $env:AIBTC_WALLET_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
      $usingPromptedPassword = $true
    } finally {
      if ($bstr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
      }
    }

    if (-not $DoNotPersist -and $env:AIBTC_WALLET_PASSWORD) {
      Set-StoredGenericCredentialSecret -Target $defaultCredentialTarget -Secret $env:AIBTC_WALLET_PASSWORD -UserName $WalletName
    }
  }
}

try {
  node $argsList
} finally {
  if ($shouldSign -and -not $hadWalletPassword) {
    Remove-Item Env:AIBTC_WALLET_PASSWORD -ErrorAction SilentlyContinue
  }
  if ($usingPromptedPassword) {
    $usingPromptedPassword = $false
  }
}
