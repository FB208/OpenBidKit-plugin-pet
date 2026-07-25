param(
  [string]$UserDataPath = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if ([string]::IsNullOrWhiteSpace($UserDataPath)) {
  $UserDataPath = Join-Path $env:APPDATA "yibiao-client"
}

$userDataRoot = [System.IO.Path]::GetFullPath($UserDataPath)
$pluginsRoot = [System.IO.Path]::GetFullPath((Join-Path $userDataRoot "plugins"))
$targetDirectory = [System.IO.Path]::GetFullPath((Join-Path $pluginsRoot "openbidkit-pet"))

if ([System.IO.Path]::GetDirectoryName($targetDirectory) -ne $pluginsRoot) {
  throw "Invalid plugin deployment path."
}

$runtimeFiles = @(
  "manifest.json",
  "package.json",
  "main.cjs",
  "preload.cjs",
  "bubble.html",
  "bubble.css",
  "bubble.js",
  "drag-preview.html",
  "drag-preview.css",
  "drag-preview.js",
  "drag-handle.html",
  "drag-handle.css",
  "drag-handle.js",
  "pet.html",
  "pet.css",
  "pet.js",
  "assets\icon.png",
  "assets\pet-spritesheet.webp"
)

New-Item -ItemType Directory -Path $pluginsRoot -Force | Out-Null
if (Test-Path -LiteralPath $targetDirectory) {
  Remove-Item -LiteralPath $targetDirectory -Recurse -Force
}
New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null

foreach ($relativePath in $runtimeFiles) {
  $sourcePath = Join-Path $projectRoot $relativePath
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Missing runtime file: $relativePath"
  }

  $destinationPath = Join-Path $targetDirectory $relativePath
  $destinationDirectory = Split-Path -Parent $destinationPath
  New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
}

Write-Host "Plugin deployed: $targetDirectory"
