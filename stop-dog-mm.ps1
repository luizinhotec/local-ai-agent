$ErrorActionPreference = "SilentlyContinue"

$targets = @(
    "run-dog-mm-loop.ps1",
    "run-dog-mm-hidden.vbs"
)

$processes = Get-CimInstance Win32_Process | Where-Object {
    $process = $_
    ($process.Name -ieq "powershell.exe" -or $process.Name -ieq "wscript.exe" -or $process.Name -ieq "cscript.exe") -and
    ($targets | Where-Object { $process.CommandLine -like "*$_*" })
}

foreach ($process in $processes) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

Write-Output ("stopped_process_count: " + (($processes | Measure-Object).Count))
