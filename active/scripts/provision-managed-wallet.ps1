param(
  [string]$WalletName = "agent-mainnet",
  [string]$CredentialTarget = "",
  [switch]$DoNotPersist
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

    [DllImport("Advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredWrite([In] ref CREDENTIAL userCredential, uint flags);
}
"@

function Set-StoredGenericCredentialSecret {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Target,
    [Parameter(Mandatory = $true)]
    [string]$Secret,
    [string]$UserName = "managed-wallet"
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

function Convert-SecureStringToPlainText {
  param(
    [Parameter(Mandatory = $true)]
    [Security.SecureString]$SecureValue
  )

  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    if ($bstr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
  }
}

$credentialName = if ($CredentialTarget) { $CredentialTarget } else { "local-ai-agent/managed-wallet/$WalletName" }
$toolPath = Join-Path $PSScriptRoot "..\tools\provision-managed-wallet.cjs"

Write-Host "Provisionando wallet gerenciada local para automacao." -ForegroundColor Cyan
Write-Host "A mnemonic e a senha nao serao gravadas no repositorio." -ForegroundColor Cyan

$mnemonicSecure = Read-Host "Mnemonic da wallet dedicada" -AsSecureString
$passwordSecure = Read-Host "Senha local para criptografar a wallet" -AsSecureString

$mnemonic = Convert-SecureStringToPlainText -SecureValue $mnemonicSecure
$walletPassword = Convert-SecureStringToPlainText -SecureValue $passwordSecure

if (-not $mnemonic.Trim()) {
  throw "mnemonic vazia"
}
if (-not $walletPassword.Trim()) {
  throw "senha vazia"
}

$env:AIBTC_MANAGED_WALLET_MNEMONIC = $mnemonic
$env:AIBTC_MANAGED_WALLET_PASSWORD = $walletPassword
$env:AIBTC_MANAGED_WALLET_NAME = $WalletName

try {
  node $toolPath --name $WalletName
  if (-not $DoNotPersist) {
    Set-StoredGenericCredentialSecret -Target $credentialName -Secret $walletPassword -UserName $WalletName
    Write-Host "Senha salva no Windows Credential Manager em $credentialName" -ForegroundColor Green
  } else {
    Write-Host "Provisionamento concluido sem persistir a senha no Credential Manager." -ForegroundColor Yellow
  }
} finally {
  Remove-Item Env:AIBTC_MANAGED_WALLET_MNEMONIC -ErrorAction SilentlyContinue
  Remove-Item Env:AIBTC_MANAGED_WALLET_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:AIBTC_MANAGED_WALLET_NAME -ErrorAction SilentlyContinue
}
