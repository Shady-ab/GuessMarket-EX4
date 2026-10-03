@echo off
setlocal
cd /d "%~dp0"
title Guess Market web client

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js and run this file again.
  pause
  exit /b 1
)

rem The web client has no npm dependencies, so there is nothing to install.
set GM_OPEN_BROWSER=1
node server.js
pause
endlocal
