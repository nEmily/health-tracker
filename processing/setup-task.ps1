# Health Tracker — Task Scheduler setup
# Run this once (elevated) to register the watcher task.
#
# Note: Uses schtasks.exe instead of PowerShell Register-ScheduledTask cmdlets.
# The -Once + -RepetitionInterval + -RepetitionDuration combo in the PowerShell
# cmdlets produces malformed XML on some Windows versions (HRESULT 0x80041318),
# making the task impossible to query or remove. schtasks.exe is reliable.

# Derive processing dir from script location
$projectDir = $PSScriptRoot
$watcherPath = Join-Path $projectDir 'watcher.ps1'

# Ensure PowerShell profile scripts can run (needed for the coach alias).
# RemoteSigned: local scripts run freely; downloaded scripts need a signature.
$policy = Get-ExecutionPolicy -Scope CurrentUser
if ($policy -eq 'Restricted' -or $policy -eq 'Undefined') {
    Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
    Write-Output "Set ExecutionPolicy to RemoteSigned for current user."
}

# Remove old tasks if they exist (ignore errors if they don't)
schtasks /Delete /TN "CoachWatcher" /F 2>$null | Out-Null
schtasks /Delete /TN "HealthTrackerWatcher" /F 2>$null | Out-Null
schtasks /Delete /TN "HealthTrackerNightly" /F 2>$null | Out-Null

# Register task using schtasks CLI (/SC MINUTE /MO 30 = every 30 minutes)
$trArg = "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -NoProfile -File `"$watcherPath`""
$result = schtasks /Create /TN "CoachWatcher" /TR $trArg /SC MINUTE /MO 30 /F 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to register CoachWatcher task. Try running as Administrator."
    Write-Error $result
    exit 1
}

Write-Output "Registered CoachWatcher - runs every 30 minutes."
Write-Output "Make sure HEALTH_SYNC_URL and HEALTH_SYNC_KEY are set as user environment variables."
