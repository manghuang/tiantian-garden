param([Parameter(Mandatory=$true)][string]$ManifestPath,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$entries = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$root = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($root) | Out-Null
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $synth.SelectVoice('Microsoft Yaoyao')
  foreach ($entry in $entries) {
    if ($entry.file -notmatch '^[a-f0-9]{20}\.wav$') { throw 'Invalid asset name' }
    $target = Join-Path $root $entry.file
    # Yaoyao ignores SSML prosody on some Windows installations. Use the engine's
    # Rate property and a small PCM playback-rate shift (pitch and tempo together).
    $synth.Rate = if ($entry.calm -or $entry.style -eq 'gentle') { -1 } else { 0 }
    $pitchRatio = if ($entry.calm) { 1.03 } elseif ($entry.style -eq 'bright') { 1.14 } else { 1.05 }
    $synth.SetOutputToWaveFile($target)
    $synth.Speak([string]$entry.text)
    $synth.SetOutputToNull()
    $wave = [IO.File]::ReadAllBytes($target)
    for ($offset = 12; $offset + 8 -le $wave.Length;) {
      $size = [BitConverter]::ToUInt32($wave, $offset + 4)
      if ([Text.Encoding]::ASCII.GetString($wave, $offset, 4) -eq 'fmt ') {
        if ([BitConverter]::ToUInt16($wave, $offset + 8) -ne 1) { throw 'Expected PCM voice output' }
        $sampleRate = [uint32][Math]::Round([BitConverter]::ToUInt32($wave, $offset + 12) * $pitchRatio)
        $blockAlign = [BitConverter]::ToUInt16($wave, $offset + 20)
        [BitConverter]::GetBytes($sampleRate).CopyTo($wave, $offset + 12)
        [BitConverter]::GetBytes([uint32]($sampleRate * $blockAlign)).CopyTo($wave, $offset + 16)
        break
      }
      $offset += 8 + $size + ($size % 2)
    }
    [IO.File]::WriteAllBytes($target, $wave)
    if ($entry.sample) { [IO.File]::WriteAllBytes((Join-Path $root ('preview-' + $entry.style + '.wav')), $wave) }
  }
} finally { $synth.Dispose() }
Write-Output ('Generated ' + $entries.Count + ' local voice assets.')
