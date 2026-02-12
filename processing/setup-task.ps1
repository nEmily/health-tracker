$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c "C:\Users\emily\projects\health-tracker\processing\process-day.bat"'
$trigger = New-ScheduledTaskTrigger -Daily -At '11:00PM'
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName 'HealthTrackerNightly' -Action $action -Trigger $trigger -Settings $settings -Description 'Nightly Claude Code processing of health tracker data'
