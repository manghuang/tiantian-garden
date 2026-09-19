@echo off
setlocal
cd /d "%~dp0companion"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.12 or newer, then run this file again.
  pause
  exit /b 1
)
if not exist node_modules\.bin\vite.cmd (
  call npm ci --include=dev
  if errorlevel 1 goto failed
)
call npm run build
if errorlevel 1 goto failed
call npm start -- --open
if errorlevel 1 goto failed
exit /b 0
:failed
echo Startup failed. Please check the message above.
pause
exit /b 1
