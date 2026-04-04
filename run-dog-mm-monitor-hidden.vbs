Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell -NoProfile -ExecutionPolicy Bypass -File C:\dev\local-ai-agent\active\scripts\start-dog-mm-monitor.ps1", 0, False
