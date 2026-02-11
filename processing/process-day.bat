@echo off
REM Health Tracker — Nightly Processing via Task Scheduler
REM Runs Claude Code to analyze today's health data

set ICLOUD_DIR=%USERPROFILE%\iCloudDrive\HealthTracker
set REPO_DIR=%USERPROFILE%\projects\health-tracker

REM Get today's date
for /f "tokens=1-3 delims=/" %%a in ("%date%") do set TODAY=%%c-%%a-%%b

echo [%date% %time%] Starting nightly processing for %TODAY%

REM Check if today's log exists
if not exist "%ICLOUD_DIR%\daily\%TODAY%\log.json" (
    echo [%date% %time%] No log found for %TODAY%, skipping.
    exit /b 0
)

REM Check if already processed
if exist "%ICLOUD_DIR%\analysis\%TODAY%\summary.json" (
    echo [%date% %time%] Already processed %TODAY%, skipping.
    exit /b 0
)

REM Create analysis output directory
mkdir "%ICLOUD_DIR%\analysis\%TODAY%" 2>nul

REM Run Claude Code
echo [%date% %time%] Running Claude Code analysis...
claude -p "Process today's health data. Today is %TODAY%. The iCloud data is at %ICLOUD_DIR%. Follow the instructions in %REPO_DIR%\processing\process-day-prompt.md" --allowedTools "Read,Write,Glob,Grep" 2>>"%ICLOUD_DIR%\processing-logs\%TODAY%.log"

echo [%date% %time%] Processing complete.
