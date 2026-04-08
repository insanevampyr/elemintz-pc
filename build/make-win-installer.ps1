$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$packageJsonPath = Join-Path $projectRoot "package.json"
$packageJson = Get-Content -Raw $packageJsonPath | ConvertFrom-Json

$productName = "EleMintz"
$version = [string]$packageJson.version
$distDir = Join-Path $projectRoot "dist"
$appSource = Join-Path $distDir "win-unpacked"
$outputFile = Join-Path $distDir "EleMintz-Setup-$version.exe"
$scriptPath = Join-Path $projectRoot "build\\alpha-installer.nsi"
$iconPath = Join-Path $projectRoot "build\\icon.ico"
$defaultMakensis = Join-Path $env:LOCALAPPDATA "electron-builder\\Cache\\nsis\\nsis-3.0.4.1\\Bin\\makensis.exe"

if (-not (Test-Path $iconPath)) {
  throw "Installer icon was not found at $iconPath"
}

if (-not (Test-Path $appSource)) {
  & npm.cmd run pack:win
  if ($LASTEXITCODE -ne 0) {
    throw "pack:win failed with exit code $LASTEXITCODE"
  }
}

$makensisPath = $env:MAKENSIS_PATH
if ([string]::IsNullOrWhiteSpace($makensisPath)) {
  if (Test-Path $defaultMakensis) {
    $makensisPath = $defaultMakensis
  } else {
    $command = Get-Command makensis.exe -ErrorAction SilentlyContinue
    if ($command) {
      $makensisPath = $command.Source
    }
  }
}

if ([string]::IsNullOrWhiteSpace($makensisPath) -or -not (Test-Path $makensisPath)) {
  throw "makensis.exe was not found. Set MAKENSIS_PATH or install NSIS on the build machine."
}

& $makensisPath `
  "/DAPP_SOURCE=$appSource" `
  "/DAPP_EXECUTABLE=EleMintz.exe" `
  "/DAPP_ICON=$iconPath" `
  "/DOUTPUT_FILE=$outputFile" `
  "/DPRODUCT_NAME=$productName" `
  "/DPRODUCT_VERSION=$version" `
  "/DINSTALL_DIR_NAME=$productName" `
  "/DUNINSTALL_REGISTRY_KEY=Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$productName" `
  $scriptPath

if ($LASTEXITCODE -ne 0) {
  throw "makensis.exe failed with exit code $LASTEXITCODE"
}

Write-Output "Created installer: $outputFile"
