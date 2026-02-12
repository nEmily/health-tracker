@echo off
REM Health Tracker — Nightly Processing via Task Scheduler
REM Runs Claude Code to analyze today's health data from ZIP exports

set ICLOUD_DIR=%USERPROFILE%\iCloudDrive\HealthTracker
set REPO_DIR=%USERPROFILE%\projects\health-tracker

REM Get today's date (YYYY-MM-DD)
for /f "tokens=1-3 delims=/" %%a in ("%date%") do set TODAY=%%c-%%a-%%b

echo [%date% %time%] Starting nightly processing for %TODAY%

REM Check if there are any ZIP files to process
dir /b "%ICLOUD_DIR%\incoming\*.zip" >nul 2>&1
if errorlevel 1 (
    echo [%date% %time%] No ZIP files in incoming/, skipping.
    exit /b 0
)

REM Create logs directory
mkdir "%ICLOUD_DIR%\logs" 2>nul

REM Run Claude Code to process
echo [%date% %time%] Running Claude Code analysis...
claude -p "Process today's health data. Today is %TODAY%. The iCloud data is at %ICLOUD_DIR%. Follow the instructions in %REPO_DIR%\processing\process-day-prompt.md" --allowedTools "Read,Write,Glob,Grep,Bash" >>"%ICLOUD_DIR%\logs\%TODAY%.log" 2>&1

REM Move processed ZIPs
for %%f in ("%ICLOUD_DIR%\incoming\*.zip") do (
    move "%%f" "%ICLOUD_DIR%\processed\" >nul 2>&1
)

echo [%date% %time%] Processing complete.
