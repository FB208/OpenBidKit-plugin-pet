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

# 简化版文件平铺覆盖到插件根目录，宿主仍按 package.json 的 main 加载 main.cjs。
$mappedFiles = [ordered]@{
  "simple/manifest.json" = "manifest.json"
  "simple/main.cjs"      = "main.cjs"
  "simple/preload.cjs"   = "preload.cjs"
  "simple/pet.html"      = "pet.html"
  "simple/pet.css"       = "pet.css"
  "simple/pet.js"        = "pet.js"
  "simple/bubble.html"   = "bubble.html"
  "simple/bubble.js"     = "bubble.js"
}

# 与完整版共用、无需改动的业务文件。
$sharedFiles = @(
  "package.json",
  "bubble.css",
  "agent-question.html",
  "agent-question.css",
  "agent-question.js",
  "outline-selection.html",
  "outline-selection.css",
  "outline-selection.js",
  "ai-chat.html",
  "ai-chat.css",
  "ai-chat.js"
)

# 简化版只用到 logo，精灵图与皮肤资源一律不部署。
$assetFiles = @(
  "assets/icon.png"
)

New-Item -ItemType Directory -Path $pluginsRoot -Force | Out-Null
if (Test-Path -LiteralPath $targetDirectory) {
  Remove-Item -LiteralPath $targetDirectory -Recurse -Force
}
New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null

foreach ($sourceRelativePath in $mappedFiles.Keys) {
  $sourcePath = Join-Path $projectRoot $sourceRelativePath
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Missing runtime file: $sourceRelativePath"
  }

  $destinationPath = Join-Path $targetDirectory $mappedFiles[$sourceRelativePath]
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
}

foreach ($relativePath in $sharedFiles) {
  $sourcePath = Join-Path $projectRoot $relativePath
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Missing runtime file: $relativePath"
  }

  $destinationPath = Join-Path $targetDirectory $relativePath
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
}

foreach ($relativePath in $assetFiles) {
  $sourcePath = Join-Path $projectRoot $relativePath
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Missing runtime file: $relativePath"
  }

  $destinationPath = Join-Path $targetDirectory $relativePath
  $destinationDirectory = Split-Path -Parent $destinationPath
  New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
}

Write-Host "Simple plugin deployed: $targetDirectory"
