$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskNode = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $taskNode -or [int]((& $taskNode --version).TrimStart('v').Split('.')[0]) -lt 22) {
    $taskNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (-not (Test-Path -LiteralPath $taskNode)) { throw 'Install Node.js 22+ first.' }
Push-Location $taskRoot
try {
    if (-not (Test-Path 'node_modules/@capacitor/cli/bin/capacitor')) {
        throw 'Dependencies missing. Run npm ci with Node.js 22+ first.'
    }
    & $taskNode scripts/build-web.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
    & $taskNode node_modules/@capacitor/cli/bin/capacitor sync android
    if ($LASTEXITCODE -ne 0) { throw 'Android sync failed.' }
    & $taskNode scripts/build-android.cjs
    if ($LASTEXITCODE -ne 0) { throw 'APK build failed.' }
} finally { Pop-Location }
