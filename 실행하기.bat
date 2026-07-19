@echo off
cd /d "%~dp0"
powershell -NoProfile -Command "$c=Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue; foreach($x in $c){$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$x.OwningProcess); if($p.Name -eq 'node.exe' -and $p.CommandLine -match 'server\.mjs'){Stop-Process -Id $x.OwningProcess}}"
start "" /b node server.mjs
timeout /t 1 /nobreak >nul
start "" http://localhost:8787
pause
