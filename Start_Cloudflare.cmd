@echo off
setlocal
cd /d "%~dp0companion"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.12 or newer, then run this file again.
  pause
  exit /b 1
)
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22 || major===22 && minor>=12 ? 0 : 1)"
if errorlevel 1 (
  echo Node.js 22.12 or newer is required.
  pause
  exit /b 1
)
if not exist node_modules\.bin\wrangler.cmd goto install
if not exist node_modules\.bin\vite.cmd goto install
goto prepare
:install
call npm ci --include=dev
if errorlevel 1 goto failed
:prepare
if not exist .dev.vars (
  copy /y .dev.vars.example .dev.vars >nul
  if errorlevel 1 goto failed
  echo Created companion\.dev.vars for local use. Edit it to configure API keys.
)
call npm run cf:build
if errorlevel 1 goto failed
echo.
echo Open http://127.0.0.1:8787/ after Wrangler reports Ready.
echo Use the ACCESS_CODE from companion\.dev.vars to log in.
echo This starts a local Cloudflare emulator. It does not deploy online.
echo If port 8787 is already in use, use the existing app or close it first.
echo Keep this window open. Press Ctrl+C to stop.
call npm run cf:dev
if errorlevel 1 goto failed
exit /b 0
:failed
echo Startup failed. Please check the message above.
pause
exit /b 1
