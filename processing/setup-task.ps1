$batPath = Join-Path $env:USERPROFILE "projects\health-tracker\processing\process-day.bat"
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$batPath`""
$trigger = New-ScheduledTaskTrigger -Daily -At '11:00PM'
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName 'HealthTrackerNightly' -Action $action -Trigger $trigger -Settings $settings -Description 'Nightly Claude Code processing of health tracker data'
