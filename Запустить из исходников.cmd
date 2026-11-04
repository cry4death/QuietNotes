@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Установите Node.js LTS версии 24 или новее с https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules\electron\package.json" (
  call npm ci
  if errorlevel 1 goto failed
)
call npm start
if errorlevel 1 goto failed
exit /b 0
:failed
echo Не удалось запустить приложение. Причина указана выше.
pause
exit /b 1
