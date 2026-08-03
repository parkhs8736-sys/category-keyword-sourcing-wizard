@echo off
cd /d "%~dp0"
powershell -NoProfile -Command "$c=Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue; foreach($x in $c){$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$x.OwningProcess); if($p.Name -eq 'node.exe' -and $p.CommandLine -match 'server\.mjs'){Stop-Process -Id $x.OwningProcess}}"
start "" /b node server.mjs
timeout /t 2 /nobreak >nul
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" --new-window "http://localhost:8787/?launch=%RANDOM%%RANDOM%"
) else (
  start "" "http://localhost:8787/?launch=%RANDOM%%RANDOM%"
)
pause
