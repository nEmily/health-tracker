# Health Tracker — Task Scheduler setup
# Run this once (elevated) to register both tasks

# Derive processing dir from script location
$projectDir = $PSScriptRoot

# --- Watcher: polls relay every 30 min, processes if pending ---
$watcherPath = Join-Path $projectDir 'watcher.ps1'
$watcherAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$watcherPath`""
$watcherTrigger = New-ScheduledTaskTrigger -Once -At '00:00' -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Days 365)
$watcherSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

# Remove old tasks if they exist
Unregister-ScheduledTask -TaskName 'HealthTrackerWatcher' -Confirm:$false -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'HealthTrackerNightly' -Confirm:$false -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'Health Tracker Nightly' -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask -TaskName 'HealthTrackerWatcher' -Action $watcherAction -Trigger $watcherTrigger -Settings $watcherSettings -Description 'Polls health relay every 30 min, processes pending data with Claude'

Write-Output "Registered HealthTrackerWatcher - runs every 30 minutes."
Write-Output "Make sure HEALTH_SYNC_URL and HEALTH_SYNC_KEY are set as user environment variables."
