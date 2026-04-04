Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell -NoProfile -ExecutionPolicy Bypass -File C:\dev\local-ai-agent\runtime\supervisor\start-supervisor.ps1", 0, False
