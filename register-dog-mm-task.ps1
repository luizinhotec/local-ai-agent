$taskName = "LocalAiAgent-DOG-MM"
$scriptPath = "C:\dev\local-ai-agent\run-dog-mm-once.ps1"
$runAsUser = (whoami)
$startBoundary = (Get-Date).AddMinutes(1).ToString("s")
$xmlPath = Join-Path $env:TEMP "LocalAiAgent-DOG-MM-task.xml"

if (-not (Test-Path $scriptPath)) {
    throw "Script not found: $scriptPath"
}

$taskCommand = 'powershell.exe'
$taskArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $scriptPath

$taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Executa o DOG MM safe wrapper a cada 5 minutos sem janela interativa.</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>$startBoundary</StartBoundary>
      <Enabled>true</Enabled>
      <Repetition>
        <Interval>PT5M</Interval>
        <Duration>P1D</Duration>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$runAsUser</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT72H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$taskCommand</Command>
      <Arguments>$taskArgs</Arguments>
      <WorkingDirectory>C:\dev\local-ai-agent</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

[System.IO.File]::WriteAllText($xmlPath, $taskXml, [System.Text.Encoding]::Unicode)

schtasks.exe /Delete /TN $taskName /F | Out-Null
schtasks.exe /Create /TN $taskName /XML $xmlPath /RU $runAsUser /F | Out-Null

if ($LASTEXITCODE -ne 0) {
    Remove-Item $xmlPath -ErrorAction SilentlyContinue
    throw "Failed to register scheduled task: $taskName"
}

schtasks.exe /Run /TN $taskName | Out-Null

if ($LASTEXITCODE -ne 0) {
    Remove-Item $xmlPath -ErrorAction SilentlyContinue
    throw "Task registered but failed to start: $taskName"
}

Remove-Item $xmlPath -ErrorAction SilentlyContinue

Write-Output "REGISTERED_TASK=$taskName"
