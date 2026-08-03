@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-llmwiki.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo Failed to stop LLM Wiki. See the stop.log file in the logs directory.
  pause
)
exit /b %EXIT_CODE%
