$ErrorActionPreference = 'Stop'
# Normalize duplicate casing in this launcher process only. Neither values nor
# names are logged, and machine/user environment settings are not changed.
$inherited = [Environment]::GetEnvironmentVariables('Process')
$duplicates = $inherited.Keys | Group-Object { $_.ToUpperInvariant() } | Where-Object { $_.Count -gt 1 }
foreach ($group in $duplicates) {
    $key = $group.Group[0]
    $value = [string]$inherited[$key]
    foreach ($duplicate in $group.Group) { [Environment]::SetEnvironmentVariable($duplicate, $null, 'Process') }
    [Environment]::SetEnvironmentVariable($key, $value, 'Process')
}
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$python = Join-Path $workspace '.tools/voice-venv/Scripts/python.exe'
$apiScript = Join-Path $PSScriptRoot 'run_api.py'
$voiceConfig = Join-Path $workspace 'companion/.env.voice.local'
if (!(Test-Path -LiteralPath $python) -or !(Test-Path -LiteralPath $voiceConfig)) { throw 'Local voice environment is not configured. See companion/local-voice/README.md.' }
if (!(Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22.12 or newer is required.' }
$stateFile = Join-Path $workspace '.tools/voice-runtime/bridge-state.json'
if (Test-Path -LiteralPath $stateFile) {
    try {
        $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
        $existing = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
        if ($existing -and $existing.ProcessName -eq 'node' -and $state.workspace -eq $workspace -and [Math]::Abs(($existing.StartTime.ToUniversalTime() - ([DateTime]$state.processStartedAt).ToUniversalTime()).TotalSeconds) -lt 10) {
            Write-Host 'The local voice bridge is already running. Open the online garden to use it.'
            return
        }
    } catch { # A stale or partially written status file is not a running process.
    }
}
function Get-VoiceHealth {
    try { return Invoke-RestMethod -Uri 'http://127.0.0.1:9880/health' -TimeoutSec 2 } catch { return $null }
}
$ownedApi = $null
$errorStream = $null
$errorCopy = $null
try {
    $health = Get-VoiceHealth
    if ($health -and ($health.service -ne 'tiantian-local-voice' -or $health.workspace -ne $workspace)) { throw 'Port 9880 belongs to another service.' }
    if (!$health) {
        $runtime = Join-Path $workspace '.tools/voice-runtime'
        New-Item -ItemType Directory -Path $runtime -Force | Out-Null
        # Some hosts supply both Path and PATH. PowerShell 5 Start-Process
        # rejects those duplicate environment keys; normalize by assignment.
        $launch = New-Object System.Diagnostics.ProcessStartInfo
        $launch.FileName = $python
        $launch.Arguments = '"' + $apiScript + '"'
        $launch.WorkingDirectory = $workspace
        $launch.UseShellExecute = $false
        $launch.CreateNoWindow = $true
        $launch.RedirectStandardError = $true
        $launch.EnvironmentVariables.Clear()
        foreach ($entry in [Environment]::GetEnvironmentVariables('Process').GetEnumerator()) { $launch.EnvironmentVariables[$entry.Key] = [string]$entry.Value }
        $errorStream = [IO.File]::Open((Join-Path $runtime 'api.stderr.log'), [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)
        $ownedApi = [Diagnostics.Process]::Start($launch)
        $errorCopy = $ownedApi.StandardError.BaseStream.CopyToAsync($errorStream)
        Write-Host 'Loading the character model on the GPU...'
        $deadline = (Get-Date).AddMinutes(3)
        do {
            if ($ownedApi.HasExited) { throw 'Voice model stopped. Check .tools/voice-runtime/api.stderr.log.' }
            Start-Sleep -Seconds 1
            $health = Get-VoiceHealth
        } while (!$health -and (Get-Date) -lt $deadline)
    }
    if (!$health -or $health.service -ne 'tiantian-local-voice' -or $health.workspace -ne $workspace -or !$health.cuda) { throw 'The GPU voice service did not become ready.' }
    Write-Host 'Connecting character voice to the online garden. Keep this window open; Ctrl+C stops it.'
    Push-Location (Join-Path $workspace 'companion')
    try { & node scripts/local-voice-worker.mjs; if ($LASTEXITCODE -ne 0) { throw 'Voice bridge stopped with an error.' } } finally { Pop-Location }
} finally {
    # Only stop the exact process created by this invocation.
    if ($ownedApi -and !$ownedApi.HasExited) { & taskkill.exe /PID $ownedApi.Id /T /F | Out-Null }
    if ($errorCopy) { try { $errorCopy.Wait(3000) | Out-Null } catch {} }
    if ($errorStream) { $errorStream.Dispose() }
}
