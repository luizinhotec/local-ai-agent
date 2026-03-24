Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell -NoProfile -ExecutionPolicy Bypass -File C:\dev\local-ai-agent\run-dog-mm-loop.ps1", 0, False
