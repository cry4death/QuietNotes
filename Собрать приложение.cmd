@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Установите Node.js LTS версии 24 или новее с https://nodejs.org/
  echo После установки снова откройте этот файл.
  pause
  exit /b 1
)
echo Устанавливаем библиотеки. Для этого нужен интернет.
call npm ci
if errorlevel 1 goto failed
echo Собираем portable и установщик Windows...
call npm run dist
if errorlevel 1 goto failed
echo.
echo Готово! Файлы приложения лежат в папке release.
explorer "%~dp0release"
pause
exit /b 0
:failed
echo.
echo Сборка не завершена. Сообщение с причиной находится выше.
echo Проверьте интернет и закройте запущенную копию приложения, затем повторите.
pause
exit /b 1
