@echo off
setlocal
cd /d "%~dp0"

set NAME=GuessMarket-EX4-325556835-213726094
set SUB=submission\%NAME%
set ZIP=%NAME%.zip

echo === 1/3 readme ===
powershell -NoProfile -ExecutionPolicy Bypass -File make-readme.ps1 readme.html
if not exist readme.pdf if not exist readme.docx (
  echo *** STOP: the readme could not be created. Run this on a machine with Word.
  goto fail
)

echo === 2/3 collecting files ===
if exist submission rmdir /s /q submission
mkdir "%SUB%\GuessMarketWeb"
copy /y run.bat "%SUB%\GuessMarketWeb\" >nul
copy /y server.js "%SUB%\GuessMarketWeb\" >nul
copy /y package.json "%SUB%\GuessMarketWeb\" >nul
xcopy /e /i /q /y public "%SUB%\GuessMarketWeb\public" >nul
if exist readme.docx copy /y readme.docx "%SUB%\" >nul
if exist readme.pdf copy /y readme.pdf "%SUB%\" >nul

echo === 3/3 zipping ===
if exist "%ZIP%" del "%ZIP%"
powershell -NoProfile -Command "Compress-Archive -Path '%SUB%' -DestinationPath '%ZIP%' -Force"
if not exist "%ZIP%" goto fail

echo.
echo Done. Upload this file to the Exercise 4 submission box:
echo   %~dp0%ZIP%
goto end

:fail
echo.
echo Packaging aborted.
pause
exit /b 1

:end
endlocal
