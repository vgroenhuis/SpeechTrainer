# Synthesise all English test words with the voices built into Windows (offline).
# Usage: powershell -File test\make-audio-windows.ps1   -> test\audio\en\win-<voice>-<rate>\<word>.wav
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$words = node "$here\list-words.js" en | Where-Object { $_ }
$rates = @{ normal = 0; slow = -4 }

# Classic SAPI voices
Add-Type -AssemblyName System.Speech
$sapi = New-Object System.Speech.Synthesis.SpeechSynthesizer
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
foreach ($v in $sapi.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'en-*' }) {
  $name = ($v.VoiceInfo.Name -replace 'Microsoft ', '' -replace ' Desktop', '')
  $sapi.SelectVoice($v.VoiceInfo.Name)
  foreach ($r in $rates.Keys) {
    $dir = "$here\audio\en\win-$name-$r"; New-Item -ItemType Directory -Force $dir | Out-Null
    $sapi.Rate = $rates[$r]
    foreach ($w in $words) { $sapi.SetOutputToWaveFile("$dir\$w.wav", $fmt); $sapi.Speak($w); $sapi.SetOutputToNull() }
  }
}

# Newer OneCore voices (WinRT); only those not already covered by SAPI
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$wr = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$ssmlRate = @{ normal = 'medium'; slow = 'slow' }
foreach ($v in [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Language -like 'en-*' }) {
  $name = $v.DisplayName -replace 'Microsoft ', ''
  if (Test-Path "$here\audio\en\win-$name-normal") { continue }
  $wr.Voice = $v
  foreach ($r in $rates.Keys) {
    $dir = "$here\audio\en\win-$name-$r"; New-Item -ItemType Directory -Force $dir | Out-Null
    foreach ($w in $words) {
      $ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='$($v.Language)'><prosody rate='$($ssmlRate[$r])'>$w</prosody></speak>"
      $stream = Await ($wr.SynthesizeSsmlToStreamAsync($ssml)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
      $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
      [void](Await ($reader.LoadAsync([uint32]$stream.Size)) ([uint32]))
      $bytes = New-Object byte[] $stream.Size; $reader.ReadBytes($bytes)
      [IO.File]::WriteAllBytes("$dir\$w.wav", $bytes)
    }
  }
}
Write-Output 'done'
